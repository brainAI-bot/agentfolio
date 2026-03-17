/**
 * Website .well-known Verification
 * Verifies website ownership by checking for a challenge token at
 * {website}/.well-known/agentfolio-verification.txt
 */

const crypto = require('crypto');

const VERIFY_TIMEOUT = 10000;

// In-memory challenge store (same pattern as verification-challenges.js)
const websiteChallenges = new Map();

/**
 * Generate a website verification challenge
 */
function generateWebsiteChallenge(profileId, websiteUrl) {
  const token = 'agentfolio-verify-' + crypto.randomBytes(16).toString('hex');
  const challengeId = crypto.randomUUID();
  const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour

  const challenge = {
    id: challengeId,
    profileId,
    websiteUrl: websiteUrl.replace(/\/+$/, ''),
    token,
    expiresAt,
    createdAt: Date.now()
  };

  websiteChallenges.set(challengeId, challenge);

  // Auto-cleanup
  setTimeout(() => websiteChallenges.delete(challengeId), 60 * 60 * 1000);

  return {
    challengeId,
    token,
    profileId,
    websiteUrl: challenge.websiteUrl,
    instructions: `Place a file at ${challenge.websiteUrl}/.well-known/agentfolio-verification.txt containing exactly: ${token}`,
    expiresAt: new Date(expiresAt).toISOString()
  };
}

/**
 * Get an existing challenge
 */
function getWebsiteChallenge(challengeId) {
  const challenge = websiteChallenges.get(challengeId);
  if (!challenge) return null;
  if (Date.now() > challenge.expiresAt) {
    websiteChallenges.delete(challengeId);
    return null;
  }
  return challenge;
}

/**
 * Confirm website verification by fetching the challenge token
 */
async function confirmWebsiteVerification(challengeId) {
  const challenge = getWebsiteChallenge(challengeId);
  if (!challenge) {
    return { verified: false, error: 'Challenge not found or expired' };
  }

  const verifyUrl = `${challenge.websiteUrl}/.well-known/agentfolio-verification.txt`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT);

    const res = await fetch(verifyUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AgentFolio-Verify/1.0' }
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return {
        verified: false,
        error: `Could not fetch verification file: HTTP ${res.status}`,
        url: verifyUrl
      };
    }

    const content = (await res.text()).trim();

    if (content === challenge.token) {
      // Clean up used challenge
      websiteChallenges.delete(challengeId);

      return {
        verified: true,
        profileId: challenge.profileId,
        websiteUrl: challenge.websiteUrl,
        url: verifyUrl
      };
    }

    return {
      verified: false,
      error: 'Token mismatch. Make sure the file contains exactly the challenge token with no extra whitespace.',
      url: verifyUrl,
      expected: challenge.token,
      got: content.substring(0, 100)
    };
  } catch (e) {
    return {
      verified: false,
      error: `Failed to fetch verification file: ${e.message}`,
      url: verifyUrl
    };
  }
}

module.exports = { generateWebsiteChallenge, getWebsiteChallenge, confirmWebsiteVerification };
