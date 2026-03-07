/**
 * Verification Challenge System
 * Generates cryptographic challenges for secure verification
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const CHALLENGES_FILE = '/tmp/verification-challenges.json';

/**
 * Generate a secure verification challenge
 */
function generateChallenge(profileId, provider, identifier) {
  const timestamp = Date.now();
  const challengeData = {
    profileId,
    provider,
    identifier,
    timestamp,
    nonce: crypto.randomBytes(16).toString('hex')
  };
  
  // Create challenge string
  const challengeString = `AgentFolio Verification Challenge
Profile ID: ${profileId}
Provider: ${provider}
Identifier: ${identifier}
Timestamp: ${new Date(timestamp).toISOString()}
Nonce: ${challengeData.nonce}
Signature: ${crypto.createHash('sha256').update(JSON.stringify(challengeData)).digest('hex')}`;

  const challengeId = crypto.createHash('sha256').update(challengeString).digest('hex').substring(0, 16);
  
  return {
    challengeId,
    challengeString,
    challengeData,
    expiresAt: timestamp + (30 * 60 * 1000) // 30 minutes
  };
}

/**
 * Store challenge for later verification
 */
async function storeChallenge(challenge) {
  try {
    let challenges = {};
    try {
      const data = await fs.readFile(CHALLENGES_FILE, 'utf8');
      challenges = JSON.parse(data);
    } catch (e) {
      // File doesn't exist, start fresh
    }
    
    // Clean expired challenges
    const now = Date.now();
    Object.keys(challenges).forEach(id => {
      if (challenges[id].expiresAt < now) {
        delete challenges[id];
      }
    });
    
    challenges[challenge.challengeId] = challenge;
    await fs.writeFile(CHALLENGES_FILE, JSON.stringify(challenges, null, 2));
    
    return challenge.challengeId;
  } catch (error) {
    console.error('Failed to store challenge:', error);
    throw new Error('Failed to store verification challenge');
  }
}

/**
 * Retrieve and validate challenge
 */
async function getChallenge(challengeId) {
  try {
    const data = await fs.readFile(CHALLENGES_FILE, 'utf8');
    const challenges = JSON.parse(data);
    
    const challenge = challenges[challengeId];
    if (!challenge) {
      return null;
    }
    
    if (challenge.expiresAt < Date.now()) {
      // Challenge expired, remove it
      delete challenges[challengeId];
      await fs.writeFile(CHALLENGES_FILE, JSON.stringify(challenges, null, 2));
      return null;
    }
    
    return challenge;
  } catch (error) {
    return null;
  }
}

/**
 * Mark challenge as completed
 */
async function completeChallenge(challengeId, proof) {
  try {
    const data = await fs.readFile(CHALLENGES_FILE, 'utf8');
    const challenges = JSON.parse(data);
    
    if (challenges[challengeId]) {
      challenges[challengeId].completed = true;
      challenges[challengeId].completedAt = Date.now();
      challenges[challengeId].proof = proof;
      
      await fs.writeFile(CHALLENGES_FILE, JSON.stringify(challenges, null, 2));
      return true;
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Generate email verification code
 */
function generateEmailCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Generate Solana signature challenge
 */
function generateSolanaChallenge(profileId, walletAddress) {
  const timestamp = Date.now();
  const message = `AgentFolio Wallet Verification
Profile: ${profileId}
Wallet: ${walletAddress}
Time: ${new Date(timestamp).toISOString()}
Nonce: ${crypto.randomBytes(8).toString('hex')}`;
  
  return {
    message,
    timestamp,
    profileId,
    walletAddress
  };
}

module.exports = {
  generateChallenge,
  storeChallenge,
  getChallenge,
  completeChallenge,
  generateEmailCode,
  generateSolanaChallenge
};
