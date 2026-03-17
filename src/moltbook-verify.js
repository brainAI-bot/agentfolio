/**
 * Moltbook Verification Module (SECURED)
 * Verifies agent identity by checking Moltbook profile bio.
 * Uses unique per-challenge nonce to prevent impersonation.
 */
const crypto = require('crypto');

const challenges = new Map();
const CHALLENGE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CHALLENGES_PER_PROFILE = 10;

/**
 * Initiate Moltbook verification.
 * User must add the UNIQUE challenge string (with nonce) to their Moltbook bio.
 */
async function initiateMoltbookVerification(profileId, moltbookUrl) {
  const clean = moltbookUrl.trim().replace(/\/+$/, '');
  if (!clean.includes('moltbook') && !clean.includes('molt.')) {
    throw new Error('Invalid Moltbook URL — must be a Moltbook profile URL');
  }

  // Rate limit
  let profileChallengeCount = 0;
  const oneHourAgo = Date.now() - 3600000;
  for (const [, ch] of challenges) {
    if (ch.profileId === profileId && ch.createdAt > oneHourAgo) profileChallengeCount++;
  }
  if (profileChallengeCount >= MAX_CHALLENGES_PER_PROFILE) {
    throw new Error('Too many verification attempts. Try again in 1 hour.');
  }

  const challengeId = crypto.randomUUID();
  const nonce = crypto.randomBytes(6).toString('hex');
  // SECURED: unique per-challenge string prevents impersonation
  const expectedContent = `agentfolio:${profileId}:${nonce}`;

  challenges.set(challengeId, {
    profileId,
    moltbookUrl: clean,
    expectedContent,
    nonce,
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
    moltbookUrl: clean,
    expectedContent,
    instructions: `Add "${expectedContent}" to your Moltbook profile bio, then click "Verify". This code is unique to this verification attempt.`,
    expiresIn: '1 hour',
  };
}

/**
 * Verify Moltbook challenge by fetching the profile page.
 */
async function verifyMoltbookChallenge(challengeId) {
  const ch = challenges.get(challengeId);
  if (!ch) throw new Error('Challenge not found or expired');
  if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) {
    challenges.delete(challengeId);
    throw new Error('Challenge expired');
  }

  try {
    const response = await fetch(ch.moltbookUrl, {
      headers: {
        'User-Agent': 'AgentFolio-Verification/1.0',
        'Accept': 'text/html,application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { verified: false, error: `Failed to fetch Moltbook profile: HTTP ${response.status}` };
    }

    const body = await response.text();

    // Check for the UNIQUE challenge string (includes nonce)
    if (!body.includes(ch.expectedContent)) {
      return {
        verified: false,
        error: `"${ch.expectedContent}" not found in Moltbook profile. Make sure the EXACT string (including the code) is in your bio.`,
      };
    }
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      return { verified: false, error: 'Moltbook profile fetch timed out. Try again.' };
    }
    return { verified: false, error: `Failed to fetch Moltbook profile: ${e.message}` };
  }

  ch.verified = true;

  const urlParts = ch.moltbookUrl.split('/');
  const username = urlParts[urlParts.length - 1] || urlParts[urlParts.length - 2] || ch.moltbookUrl;

  try {
    const profileStore = require('./profile-store');
    profileStore.addVerification(ch.profileId, 'moltbook', username, {
      challengeId,
      moltbookUrl: ch.moltbookUrl,
      method: 'bio-check-with-nonce',
      verifiedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[MoltbookVerify] Failed to save:', e.message);
  }

  challenges.delete(challengeId);

  return {
    verified: true,
    platform: 'moltbook',
    identifier: username,
    profileId: ch.profileId,
  };
}

function getMoltbookVerificationStatus(challengeId) {
  const ch = challenges.get(challengeId);
  if (!ch) return { found: false };
  return {
    found: true,
    verified: ch.verified,
    moltbookUrl: ch.moltbookUrl,
    expiresAt: new Date(ch.createdAt + CHALLENGE_TTL_MS).toISOString(),
  };
}

module.exports = {
  initiateMoltbookVerification,
  verifyMoltbookChallenge,
  getMoltbookVerificationStatus,
};
