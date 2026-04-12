/**
 * ETH Wallet Verification (Hardened)
 * Cryptographic proof via EIP-191 personal_sign
 * Agent signs a challenge message with their ETH wallet to prove ownership
 */

const crypto = require('crypto');

// In-memory challenge store (production: use Redis/DB)
const challenges = new Map();
const CHALLENGE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function generateChallenge(profileId, walletAddress) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now();
  const challengeId = crypto.randomBytes(12).toString('hex');
  
  const message = `AgentFolio Verification\n\nProfile: ${profileId}\nWallet: ${walletAddress}\nNonce: ${nonce}\nTimestamp: ${timestamp}\n\nSign this message to verify wallet ownership.`;
  
  challenges.set(challengeId, {
    profileId,
    walletAddress: walletAddress.toLowerCase(),
    message,
    nonce,
    timestamp,
    verified: false
  });
  
  // Cleanup expired challenges
  for (const [id, ch] of challenges) {
    if (Date.now() - ch.timestamp > CHALLENGE_TTL_MS) challenges.delete(id);
  }
  
  return { challengeId, message, expiresAt: new Date(timestamp + CHALLENGE_TTL_MS).toISOString() };
}

function verifySignature(challengeId, signature) {
  const challenge = challenges.get(challengeId);
  if (!challenge) return { verified: false, error: 'Challenge not found or expired' };
  if (challenge.verified) return { verified: false, error: 'Challenge already used' };
  if (Date.now() - challenge.timestamp > CHALLENGE_TTL_MS) {
    challenges.delete(challengeId);
    return { verified: false, error: 'Challenge expired' };
  }
  
  try {
    let ethersModule;
    try {
      ethersModule = require('ethers');
    } catch (e) {
      return { verified: false, error: 'ethers.js not available on server' };
    }

    const ethersApi = ethersModule.ethers || ethersModule;
    let recoveredAddress;
    try {
      recoveredAddress = ethersApi.verifyMessage(challenge.message, signature).toLowerCase();
    } catch (e) {
      return { verified: false, error: `Invalid signature: ${e.message}` };
    }

    if (recoveredAddress !== challenge.walletAddress) {
      return { verified: false, error: `Recovered address ${recoveredAddress} does not match ${challenge.walletAddress}` };
    }
    
    challenge.verified = true;
    challenges.delete(challengeId);
    
    return {
      verified: true,
      profileId: challenge.profileId,
      walletAddress: challenge.walletAddress,
      proof: {
        type: 'eth_personal_sign',
        signature,
        recoveredAddress,
        message: challenge.message,
        nonce: challenge.nonce,
        timestamp: challenge.timestamp
      }
    };
  } catch (err) {
    return { verified: false, error: `Verification failed: ${err.message}` };
  }
}

function getChallenge(id) { return challenges.get(id); }
module.exports = { generateChallenge, verifySignature, getChallenge };
