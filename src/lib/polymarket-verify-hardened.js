/**
 * Polymarket Verification — Hardened (EIP-191 wallet signature required)
 * 
 * Flow:
 * 1. POST /api/profile/:id/verify/polymarket/initiate — returns challenge message
 * 2. POST /api/profile/:id/verify/polymarket/complete — submit signature + verify activity
 */
const crypto = require('crypto');
const { getPolymarketStats } = require('./polymarket-verify');

let ethers;
try { ethers = require('ethers'); } catch {}

const challenges = new Map();
const CHALLENGE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CHALLENGES_PER_PROFILE = 30;

/**
 * Initiate hardened Polymarket verification — returns challenge message to sign
 */
function initiatePMVerification(profileId, walletAddress) {
  const clean = walletAddress.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(clean)) {
    throw new Error('Invalid Ethereum/Polygon wallet address');
  }

  // Rate limit: max challenges per profile per hour
  let count = 0;
  const oneHourAgo = Date.now() - 3600000;
  for (const [, ch] of challenges) {
    if (ch.profileId === profileId && ch.createdAt > oneHourAgo) count++;
  }
  if (count >= MAX_CHALLENGES_PER_PROFILE) {
    throw new Error('Too many verification attempts. Try again in 1 hour.');
  }

  const challengeId = crypto.randomUUID();
  const nonce = crypto.randomBytes(16).toString('hex');
  const signMessage = `AgentFolio Polymarket Verification\n\nProfile: ${profileId}\nWallet: ${clean.toLowerCase()}\nNonce: ${nonce}\nTimestamp: ${new Date().toISOString()}`;

  challenges.set(challengeId, {
    profileId,
    walletAddress: clean.toLowerCase(),
    nonce,
    signMessage,
    createdAt: Date.now(),
  });

  // Cleanup expired
  for (const [id, ch] of challenges) {
    if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) challenges.delete(id);
  }

  return {
    success: true,
    challengeId,
    walletAddress: clean.toLowerCase(),
    signMessage,
    instructions: 'Sign this message with your Polymarket wallet to prove ownership, then POST the signature to the complete endpoint.',
    expiresIn: '30 minutes',
  };
}

/**
 * Complete hardened Polymarket verification — verify signature then check trading activity
 */
async function completePMVerification(challengeId, signature) {
  const ch = challenges.get(challengeId);
  if (!ch) throw new Error('Challenge not found or expired');
  if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) {
    challenges.delete(challengeId);
    throw new Error('Challenge expired');
  }

  if (!signature) {
    return { verified: false, error: 'Signature required. Sign the challenge message with your wallet.' };
  }

  // Step 1: Verify EIP-191 signature
  if (!ethers) {
    return { verified: false, error: 'ethers.js not available on server — cannot verify signature' };
  }

  try {
    let recoveredAddress;
    try {
      recoveredAddress = ethers.verifyMessage(ch.signMessage, signature);
    } catch {
      try {
        recoveredAddress = ethers.utils.verifyMessage(ch.signMessage, signature);
      } catch {
        const msgHash = ethers.hashMessage ? ethers.hashMessage(ch.signMessage) : null;
        if (!msgHash) throw new Error('Cannot verify signature');
        recoveredAddress = ethers.recoverAddress(msgHash, signature);
      }
    }

    if (recoveredAddress.toLowerCase() !== ch.walletAddress) {
      return {
        verified: false,
        error: `Signature does not match wallet ${ch.walletAddress}. Recovered: ${recoveredAddress.toLowerCase()}`,
      };
    }
  } catch (e) {
    return { verified: false, error: `Signature verification failed: ${e.message}` };
  }

  // Step 2: Check Polymarket trading activity
  const stats = await getPolymarketStats(ch.walletAddress);
  if (stats.error) {
    challenges.delete(challengeId);
    return {
      verified: false,
      signatureVerified: true,
      error: `Wallet ownership verified, but Polymarket stats could not be fetched: ${stats.error}`,
    };
  }

  if ((stats.totalTrades || 0) < 5) {
    challenges.delete(challengeId);
    return {
      verified: false,
      signatureVerified: true,
      error: `Wallet ownership verified, but minimum 5 Polymarket trades are required. Found ${stats.totalTrades || 0}.`,
      stats,
    };
  }

  // Step 3: Save verification
  try {
    const profileStore = require('../profile-store');
    profileStore.addVerification(ch.profileId, 'polymarket', ch.walletAddress, {
      challengeId,
      walletAddress: ch.walletAddress,
      method: 'signature-then-activity',
      signatureVerified: true,
      stats,
      verifiedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[PM-Hardened] Failed to save verification:', e.message);
  }

  challenges.delete(challengeId);

  return {
    verified: true,
    signatureVerified: true,
    platform: 'polymarket',
    identifier: ch.walletAddress,
    profileId: ch.profileId,
    stats,
  };
}

module.exports = {
  initiatePMVerification,
  completePMVerification,
};
