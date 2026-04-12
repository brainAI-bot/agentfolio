/**
 * Website .well-known Verification Module
 * Two-phase verification: challenge generation + confirmation
 */

const crypto = require('crypto');

const TIMEOUT_MS = 10000;

// In-memory storage for challenges (would use Redis in production)
const challenges = new Map();

function normalizeWebsiteUrl(websiteUrl) {
  let parsed;
  try {
    parsed = new URL(websiteUrl);
  } catch (_) {
    throw new Error('Invalid website URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Website URL must start with http:// or https://');
  }

  return parsed.origin;
}

/**
 * Generate a verification challenge for website ownership
 */
function generateWebsiteChallenge(profileId, websiteUrl) {
  const normalizedWebsiteUrl = normalizeWebsiteUrl(websiteUrl);
  const challengeId = crypto.randomUUID();
  const token = `agentfolio-verify-${crypto.randomBytes(16).toString('hex')}`;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
  
  const challenge = {
    challengeId,
    profileId,
    websiteUrl: normalizedWebsiteUrl,
    token,
    expiresAt,
    createdAt: new Date()
  };
  
  challenges.set(challengeId, challenge);
  
  // Clean up expired challenges
  setTimeout(() => {
    challenges.delete(challengeId);
  }, 30 * 60 * 1000);
  
  return {
    challengeId,
    token,
    profileId,
    websiteUrl: normalizedWebsiteUrl,
    instructions: `Place a file at ${normalizedWebsiteUrl}/.well-known/agentfolio-verification.txt containing exactly: ${token}`,
    expiresAt: expiresAt.toISOString()
  };
}

/**
 * Confirm website verification by checking the challenge token
 */
async function confirmWebsiteVerification(challengeId) {
  const challenge = challenges.get(challengeId);
  
  if (!challenge) {
    return {
      verified: false,
      error: 'Challenge not found or expired'
    };
  }
  
  if (new Date() > challenge.expiresAt) {
    challenges.delete(challengeId);
    return {
      verified: false,
      error: 'Challenge expired'
    };
  }
  
  try {
    // Normalize URL
    const url = new URL(challenge.websiteUrl);
    const baseUrl = `${url.protocol}//${url.host}`;
    const verificationUrl = `${baseUrl}/.well-known/agentfolio-verification.txt`;
    
    const res = await fetch(verificationUrl, {
      headers: { 'User-Agent': 'AgentFolio-Website-Verify/1.0' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    
    if (!res.ok) {
      return {
        verified: false,
        error: `Verification file not found: HTTP ${res.status}`,
        challengeId,
        websiteUrl: challenge.websiteUrl
      };
    }
    
    const content = (await res.text()).trim();
    
    if (content !== challenge.token) {
      return {
        verified: false,
        error: `Token mismatch: file contains "${content}", expected "${challenge.token}"`,
        challengeId,
        websiteUrl: challenge.websiteUrl
      };
    }
    
    // Verification successful - clean up challenge
    challenges.delete(challengeId);
    
    return {
      verified: true,
      profileId: challenge.profileId,
      websiteUrl: challenge.websiteUrl,
      verifiedAt: new Date().toISOString(),
      message: 'Website ownership verified successfully'
    };
    
  } catch (error) {
    return {
      verified: false,
      error: `Verification failed: ${error.message}`,
      challengeId,
      websiteUrl: challenge.websiteUrl
    };
  }
}

module.exports = {
  generateWebsiteChallenge,
  confirmWebsiteVerification
};