/**
 * Moltbook Verification — Hardened (cryptographic nonce + expiry)
 * 
 * Flow:
 * 1. POST /api/profile/:id/verify/moltbook/initiate — returns nonce-based challenge string
 * 2. POST /api/profile/:id/verify/moltbook/complete — verify challenge in bio within expiry
 */
const crypto = require('crypto');

let fetchMoltbookProfile;
try {
  ({ fetchMoltbookProfile } = require('./moltbook'));
} catch (e) {
  console.warn('[Moltbook-Hardened] moltbook.js not found, using direct API');
}

const MOLTBOOK_API = 'https://www.moltbook.com/api/v1';
const challenges = new Map();
const CHALLENGE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CHALLENGES_PER_PROFILE = 30;

/**
 * Fetch Moltbook profile with fallback
 */
async function fetchProfile(username) {
  try {
    const res = await fetch(`${MOLTBOOK_API}/agents/profile?name=${encodeURIComponent(username)}`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'AgentFolio-Verify/1.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (res.ok) return await res.json();
  } catch (e) { /* fallback */ }

  if (fetchMoltbookProfile) {
    try { return await fetchMoltbookProfile(username); } catch (e) { /* ignore */ }
  }
  return null;
}

/**
 * Initiate hardened Moltbook verification — returns cryptographic challenge
 */
function initiateMoltbookVerification(profileId, moltbookUsername) {
  const username = moltbookUsername.trim().replace(/^@/, '');
  if (!username || username.length < 2 || username.length > 64) {
    throw new Error('Invalid Moltbook username');
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
  const nonce = crypto.randomBytes(8).toString('hex');
  const challengeString = `agentfolio:${profileId}:${nonce}`;

  challenges.set(challengeId, {
    profileId,
    moltbookUsername: username,
    nonce,
    challengeString,
    createdAt: Date.now(),
  });

  // Cleanup expired
  for (const [id, ch] of challenges) {
    if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) challenges.delete(id);
  }

  return {
    success: true,
    challengeId,
    moltbookUsername: username,
    challengeString,
    instructions: `Add "${challengeString}" to your Moltbook bio, then submit verification within 30 minutes.`,
    expiresIn: '30 minutes',
  };
}

/**
 * Complete hardened Moltbook verification — check bio for nonce-based challenge
 */
async function completeMoltbookVerification(challengeId) {
  const ch = challenges.get(challengeId);
  if (!ch) throw new Error('Challenge not found or expired');
  if (Date.now() - ch.createdAt > CHALLENGE_TTL_MS) {
    challenges.delete(challengeId);
    throw new Error('Challenge expired (30 minute limit). Please initiate a new verification.');
  }

  // Fetch Moltbook profile
  const moltbookData = await fetchProfile(ch.moltbookUsername);
  if (!moltbookData) {
    return { verified: false, error: `Moltbook profile "${ch.moltbookUsername}" not found. Check the username.` };
  }

  const agent = moltbookData.agent || moltbookData;
  const bio = (agent.description || agent.bio || agent.about || '');
  const hasChallengeInBio = bio.includes(ch.challengeString);

  if (!hasChallengeInBio) {
    return {
      verified: false,
      error: `Challenge string not found in Moltbook bio. Add "${ch.challengeString}" to your bio and try again.`,
      challengeString: ch.challengeString,
      hint: 'The exact string must appear in your bio, including the nonce.',
    };
  }

  // Verification successful
  const karma = agent.karma || 0;
  const followers = agent.follower_count || agent.followers || 0;
  const posts = agent.posts_count || agent.posts || 0;

  // Save verification
  try {
    const profileStore = require('../profile-store');
    profileStore.addVerification(ch.profileId, 'moltbook', ch.moltbookUsername, {
      challengeId,
      username: ch.moltbookUsername,
      method: 'hardened_bio_nonce',
    nonce: ch.nonce,
    challengeString: ch.challengeString,
      nonce: ch.nonce,
      karma,
      followers,
      posts,
      verifiedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[Moltbook-Hardened] Failed to save verification:', e.message);
  }

  challenges.delete(challengeId);

  return {
    verified: true,
    platform: 'moltbook',
    username: ch.moltbookUsername,
    profileId: ch.profileId,
    karma,
    followers,
    posts,
    method: 'hardened_bio_nonce',
    nonce: ch.nonce,
    challengeString: ch.challengeString,
    message: 'Moltbook account verified via hardened bio check with cryptographic nonce',
  };
}

module.exports = {
  initiateMoltbookVerification,
  completeMoltbookVerification,
};
