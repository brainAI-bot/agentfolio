/**
 * Moltbook Verification Module
 * Verifies Moltbook account ownership by checking bio for agentfolio:{profileId}
 */

const { fetchMoltbookProfile } = require('./moltbook');

const MOLTBOOK_API = 'https://moltbook.com/api';

/**
 * Fetch a Moltbook user profile (with fallback to existing moltbook.js)
 */
async function fetchProfile(username) {
  try {
    // Try direct API first
    const res = await fetch(`${MOLTBOOK_API}/users/${encodeURIComponent(username)}/profile`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'AgentFolio-Verify/1.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    // Fall through to legacy method
  }

  // Fallback to existing moltbook lib
  try {
    return await fetchMoltbookProfile(username);
  } catch (e) {
    return null;
  }
}

/**
 * Generate the challenge string for Moltbook bio verification
 */
function getMoltbookChallengeString(profileId) {
  return `agentfolio:${profileId}`;
}

/**
 * Verify Moltbook account ownership via bio check
 * User must add "agentfolio:{profileId}" to their Moltbook bio
 */
async function verifyMoltbookAccount(profileId, moltbookUsername) {
  try {
    const moltbookData = await fetchProfile(moltbookUsername);
    if (!moltbookData) {
      return { verified: false, error: 'Moltbook profile not found. Check the username.' };
    }

    const challengeString = getMoltbookChallengeString(profileId);
    const bio = (moltbookData.bio || moltbookData.description || moltbookData.about || '').toLowerCase();
    const hasChallengeInBio = bio.includes(challengeString.toLowerCase());

    if (!hasChallengeInBio) {
      return {
        verified: false,
        error: `Add "${challengeString}" to your Moltbook bio, then try again.`,
        username: moltbookUsername,
        challengeString,
        hint: 'Go to your Moltbook profile settings and add the challenge string to your bio'
      };
    }

    return {
      verified: true,
      username: moltbookUsername,
      profileId,
      karma: moltbookData.karma || 0,
      followers: moltbookData.followers || 0,
      posts: moltbookData.posts || 0,
      message: 'Moltbook account verified via bio check'
    };
  } catch (error) {
    console.error('[Moltbook Verify] Error:', error.message);
    return { verified: false, error: error.message };
  }
}

/**
 * Sync Moltbook stats (karma, followers, etc.) for an already-verified account
 */
async function syncMoltbookKarma(moltbookUsername) {
  try {
    const data = await fetchProfile(moltbookUsername);
    if (!data) return { synced: false, error: 'Profile not found' };

    return {
      synced: true,
      username: moltbookUsername,
      karma: data.karma || 0,
      followers: data.followers || 0,
      posts: data.posts || 0,
      comments: data.comments || 0,
      syncedAt: new Date().toISOString()
    };
  } catch (error) {
    return { synced: false, error: error.message };
  }
}

module.exports = {
  verifyMoltbookAccount,
  syncMoltbookKarma,
  getMoltbookChallengeString
};
