/**
 * Polymarket Verification Module (SECURED)
 * Verifies trading activity on Polymarket via data-api.polymarket.com
 * REQUIRES wallet signature proof before checking activity.
 */
const crypto = require('crypto');
const { ethers } = require('ethers') || {};

const challenges = new Map();
const CHALLENGE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CHALLENGES_PER_PROFILE = 10; // Rate limit

const POLYMARKET_DATA_API = 'https://data-api.polymarket.com';

/**
 * Initiate Polymarket verification.
 * Returns a message the user must sign with their wallet private key.
 */
async function initiatePolymarketVerification(profileId, walletAddress) {
  const clean = walletAddress.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(clean)) {
    throw new Error('Invalid Ethereum wallet address');
  }

  // Rate limit: max challenges per profileId
  let profileChallengeCount = 0;
  const oneHourAgo = Date.now() - 3600000;
  for (const [, ch] of challenges) {
    if (ch.profileId === profileId && ch.createdAt > oneHourAgo) profileChallengeCount++;
  }
  if (profileChallengeCount >= MAX_CHALLENGES_PER_PROFILE) {
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
    signatureVerified: false,
    createdAt: Date.now(),
    verified: false,
  });

  // Cleanup old
  for (const [id, ch] of challenges) {
    if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) challenges.delete(id);
  }

  return {
    success: true,
    challengeId,
    walletAddress: clean.toLowerCase(),
    signMessage,
    instructions: `Sign this message with your Polymarket wallet to prove ownership, then submit the signature along with the challengeId.`,
    expiresIn: '30 minutes',
  };
}

/**
 * Verify Polymarket challenge.
 * Step 1: Verify wallet signature (ownership proof)
 * Step 2: Check Polymarket activity
 */
async function verifyPolymarketChallenge(challengeId, signature) {
  const ch = challenges.get(challengeId);
  if (!ch) throw new Error('Challenge not found or expired');
  if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) {
    challenges.delete(challengeId);
    throw new Error('Challenge expired');
  }

  // Step 1: Verify wallet signature
  if (!signature) {
    return { verified: false, error: 'Signature required. Sign the challenge message with your wallet.' };
  }

  try {
    let recoveredAddress;
    try {
      // Try ethers.js v6
      recoveredAddress = ethers.verifyMessage(ch.signMessage, signature);
    } catch {
      try {
        // Try ethers.js v5
        recoveredAddress = ethers.utils.verifyMessage(ch.signMessage, signature);
      } catch {
        // Manual EIP-191 recovery fallback
        const msgHash = ethers.hashMessage ? ethers.hashMessage(ch.signMessage) : null;
        if (!msgHash) throw new Error('Cannot verify signature — ethers not available');
        recoveredAddress = ethers.recoverAddress(msgHash, signature);
      }
    }

    if (recoveredAddress.toLowerCase() !== ch.walletAddress) {
      return { verified: false, error: `Signature does not match wallet ${ch.walletAddress}. Recovered: ${recoveredAddress}` };
    }
    ch.signatureVerified = true;
  } catch (e) {
    return { verified: false, error: `Signature verification failed: ${e.message}` };
  }

  // Step 2: Check Polymarket activity
  let activityData = null;

  try {
    const profileRes = await fetch(`${POLYMARKET_DATA_API}/profile/${ch.walletAddress}`, {
      headers: { 'User-Agent': 'AgentFolio-Verification/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (profileRes.ok) activityData = await profileRes.json();
  } catch (e) { /* fallback below */ }

  if (!activityData) {
    try {
      const gammaRes = await fetch(`https://gamma-api.polymarket.com/query?active=true&closed=true&limit=5&maker_address=${ch.walletAddress}`, {
        headers: { 'User-Agent': 'AgentFolio-Verification/1.0' },
        signal: AbortSignal.timeout(10000),
      });
      if (gammaRes.ok) {
        const gammaData = await gammaRes.json();
        if (Array.isArray(gammaData) && gammaData.length > 0) {
          activityData = { trades: gammaData.length, source: 'gamma-api' };
        }
      }
    } catch (e) { /* exhausted */ }
  }

  if (!activityData) {
    return {
      verified: false,
      signatureVerified: true,
      error: `Wallet ownership verified, but no Polymarket activity found for ${ch.walletAddress}.`,
    };
  }

  ch.verified = true;

  try {
    const profileStore = require('./profile-store');
    profileStore.addVerification(ch.profileId, 'polymarket', ch.walletAddress, {
      challengeId,
      walletAddress: ch.walletAddress,
      method: 'signature-then-activity',
      signatureVerified: true,
      verifiedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[PolymarketVerify] Failed to save:', e.message);
  }

  challenges.delete(challengeId);

  return {
    verified: true,
    platform: 'polymarket',
    identifier: ch.walletAddress,
    profileId: ch.profileId,
  };
}

function getPolymarketVerificationStatus(challengeId) {
  const ch = challenges.get(challengeId);
  if (!ch) return { found: false };
  return {
    found: true,
    verified: ch.verified,
    signatureVerified: ch.signatureVerified || false,
    walletAddress: ch.walletAddress,
    expiresAt: new Date(ch.createdAt + CHALLENGE_TTL_MS).toISOString(),
  };
}

module.exports = {
  initiatePolymarketVerification,
  verifyPolymarketChallenge,
  getPolymarketVerificationStatus,
};
