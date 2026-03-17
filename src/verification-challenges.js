/**
 * Verification Challenge System
 * Manages time-limited verification challenges for all platforms
 */

const crypto = require('crypto');

// In-memory storage for challenges (would use Redis in production)
const challenges = new Map();

// Generate a new verification challenge
function generateChallenge(profileId, platform, identifier) {
  const challengeId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
  
  const challenge = {
    id: challengeId,
    profileId,
    platform,
    challengeData: {
      identifier,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString()
    },
    status: 'pending'
  };
  
  return challenge;
}

// Store challenge (async for database compatibility)
async function storeChallenge(challenge) {
  challenges.set(challenge.id, challenge);
  
  // Auto-cleanup after expiration
  setTimeout(() => {
    challenges.delete(challenge.id);
  }, 30 * 60 * 1000);
  
  return challenge.id;
}

// Retrieve challenge
async function getChallenge(challengeId) {
  const challenge = challenges.get(challengeId);
  
  if (!challenge) return null;
  
  // Check expiration
  if (new Date() > new Date(challenge.challengeData.expiresAt)) {
    challenges.delete(challengeId);
    return null;
  }
  
  return challenge;
}

// Complete challenge
async function completeChallenge(challengeId, verificationData) {
  const challenge = challenges.get(challengeId);
  
  if (!challenge) {
    throw new Error('Challenge not found');
  }
  
  challenge.status = 'completed';
  challenge.completedAt = new Date().toISOString();
  challenge.verificationData = verificationData;
  
  challenges.set(challengeId, challenge);
  
  return challenge;
}

// Cleanup expired challenges (run periodically)
function cleanupExpiredChallenges() {
  const now = new Date();
  
  for (const [id, challenge] of challenges.entries()) {
    if (now > new Date(challenge.challengeData.expiresAt)) {
      challenges.delete(id);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredChallenges, 5 * 60 * 1000);

module.exports = {
  generateChallenge,
  storeChallenge,
  getChallenge,
  completeChallenge,
  cleanupExpiredChallenges
};