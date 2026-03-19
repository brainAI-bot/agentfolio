/**
 * Hyperliquid Verification — Hardened (wallet signature required)
 * 
 * Flow:
 * 1. POST /api/profile/:id/verify/hyperliquid/initiate — returns challenge message
 * 2. POST /api/profile/:id/verify/hyperliquid/complete — submit signature + verify activity
 */
const crypto = require('crypto');
const { verifyHyperliquidTrading } = require('./hyperliquid-verify');

let ethers;
try { ethers = require('ethers'); } catch {}

const challenges = new Map();
const CHALLENGE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CHALLENGES_PER_PROFILE = 10;

/**
 * Initiate hardened HL verification — returns challenge message to sign
 */
function initiateHLVerification(profileId, walletAddress) {
  const clean = walletAddress.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(clean)) {
    throw new Error('Invalid Ethereum/Hyperliquid wallet address');
  }

  // Rate limit
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
  const signMessage = `AgentFolio Hyperliquid Verification\n\nProfile: ${profileId}\nWallet: ${clean.toLowerCase()}\nNonce: ${nonce}\nTimestamp: ${new Date().toISOString()}`;

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
    instructions: 'Sign this message with your Hyperliquid wallet to prove ownership, then POST the signature to the complete endpoint.',
    expiresIn: '30 minutes',
  };
}

/**
 * Complete hardened HL verification — verify signature then check trading activity
 */
async function completeHLVerification(challengeId, signature) {
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

  // Step 2: Check Hyperliquid trading activity
  const result = await verifyHyperliquidTrading(ch.walletAddress);
  if (!result.verified) {
    return {
      verified: false,
      signatureVerified: true,
      error: `Wallet ownership verified, but no Hyperliquid trading activity found for ${ch.walletAddress}.`,
    };
  }

  // Step 3: Save verification
  try {
    const profileStore = require('../profile-store');
    profileStore.addVerification(ch.profileId, 'hyperliquid', ch.walletAddress, {
      challengeId,
      walletAddress: ch.walletAddress,
      method: 'signature-then-activity',
      signatureVerified: true,
      accountValue: result.accountValue,
      totalTrades: result.stats?.totalTrades,
      verificationLevel: result.verificationLevel,
      verifiedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[HL-Hardened] Failed to save verification:', e.message);
  }

  challenges.delete(challengeId);

  return {
    verified: true,
    signatureVerified: true,
    platform: 'hyperliquid',
    identifier: ch.walletAddress,
    profileId: ch.profileId,
    accountValue: result.accountValue,
    stats: result.stats,
  };
}

module.exports = {
  initiateHLVerification,
  completeHLVerification,
};
