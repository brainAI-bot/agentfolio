/**
 * Website Verification — Hardened (.well-known challenge with crypto nonce + expiry)
 * 
 * Flow:
 * 1. POST /api/profile/:id/verify/website/initiate — returns challenge token + instructions
 * 2. POST /api/profile/:id/verify/website/complete — checks .well-known file for token
 */
const crypto = require('crypto');

const challenges = new Map();
const CHALLENGE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CHALLENGES_PER_PROFILE = 10;
const FETCH_TIMEOUT_MS = 10000;

/**
 * Initiate hardened website verification — returns cryptographic token to place
 */
function initiateWebsiteVerification(profileId, websiteUrl) {
  // Validate URL
  let parsedUrl;
  try {
    parsedUrl = new URL(websiteUrl);
  } catch {
    throw new Error('Invalid URL format');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('URL must use http or https protocol');
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
  const token = `agentfolio-verify-${crypto.randomBytes(16).toString('hex')}`;
  const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;

  challenges.set(challengeId, {
    profileId,
    websiteUrl: baseUrl,
    token,
    createdAt: Date.now(),
  });

  // Cleanup expired
  for (const [id, ch] of challenges) {
    if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) challenges.delete(id);
  }

  return {
    success: true,
    challengeId,
    websiteUrl: baseUrl,
    token,
    instructions: `Place a file at ${baseUrl}/.well-known/agentfolio-verification.txt containing exactly:\n${token}`,
    verificationUrl: `${baseUrl}/.well-known/agentfolio-verification.txt`,
    expiresIn: '30 minutes',
  };
}

/**
 * Complete hardened website verification — fetch .well-known file and check token
 */
async function completeWebsiteVerification(challengeId) {
  const ch = challenges.get(challengeId);
  if (!ch) throw new Error('Challenge not found or expired');
  if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) {
    challenges.delete(challengeId);
    throw new Error('Challenge expired (30 minute limit). Please initiate a new verification.');
  }

  const verificationUrl = `${ch.websiteUrl}/.well-known/agentfolio-verification.txt`;

  try {
    const res = await fetch(verificationUrl, {
      headers: { 'User-Agent': 'AgentFolio-Website-Verify/1.0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });

    if (!res.ok) {
      return {
        verified: false,
        error: `Could not fetch verification file: HTTP ${res.status}. Place the token at ${verificationUrl}`,
        verificationUrl,
      };
    }

    const content = (await res.text()).trim();
    if (content !== ch.token) {
      return {
        verified: false,
        error: `Token mismatch. File contains "${content.slice(0, 80)}", expected "${ch.token}"`,
        verificationUrl,
      };
    }
  } catch (e) {
    return {
      verified: false,
      error: `Failed to reach ${verificationUrl}: ${e.message}`,
      verificationUrl,
    };
  }

  // Verification successful
  try {
    const profileStore = require('../profile-store');
    profileStore.addVerification(ch.profileId, 'website', ch.websiteUrl, {
      challengeId,
      url: ch.websiteUrl,
      method: 'hardened_well_known',
      token: ch.token,
      verifiedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[Website-Hardened] Failed to save verification:', e.message);
  }

  challenges.delete(challengeId);

  return {
    verified: true,
    platform: 'website',
    websiteUrl: ch.websiteUrl,
    profileId: ch.profileId,
    method: 'hardened_well_known',
    message: 'Website ownership verified via .well-known challenge with cryptographic token',
  };
}

module.exports = {
  initiateWebsiteVerification,
  completeWebsiteVerification,
};
