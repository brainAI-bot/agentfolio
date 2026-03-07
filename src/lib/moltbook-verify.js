/**
 * Moltbook Verification Module
 * Verifies and syncs Moltbook karma for AgentFolio profiles
 */

const { fetchMoltbookProfile } = require('./moltbook');
const fs = require('fs');
const path = require('path');

/**
 * Load profile from JSON (since we can't require database functions)
 */
function loadProfileData(profileId, dataDir = process.env.DATA_DIR || './data') {
  try {
    const profilePath = path.join(dataDir, 'profiles', profileId + '.json');
    if (!fs.existsSync(profilePath)) return null;
    const content = fs.readFileSync(profilePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error loading profile:', error);
    return null;
  }
}

/**
 * Save profile to JSON (since we can't require database functions)
 */
function saveProfileData(profile, dataDir = process.env.DATA_DIR || './data') {
  try {
    const profilePath = path.join(dataDir, 'profiles', profile.id + '.json');
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving profile:', error);
    return false;
  }
}

/**
 * Verify Moltbook account and sync karma
 */
async function verifyMoltbookAccount(profileId, moltbookUsername) {
  try {
    // Fetch Moltbook profile
    const moltbookData = await fetchMoltbookProfile(moltbookUsername);
    if (!moltbookData) {
      return { verified: false, error: 'Moltbook profile not found' };
    }

    // Load AgentFolio profile
    const profile = loadProfileData(profileId);
    if (!profile) {
      return { verified: false, error: 'AgentFolio profile not found' };
    }

    // Update moltbook link and stats
    profile.links = profile.links || {};
    profile.links.moltbook = moltbookUsername;
    
    profile.moltbookStats = {
      karma: moltbookData.karma || 0,
      followers: moltbookData.followers || 0,
      posts: moltbookData.posts || 0,
      comments: moltbookData.comments || 0,
      lastSyncAt: new Date().toISOString()
    };

    // Add verification data
    profile.verificationData = profile.verificationData || {};
    profile.verificationData.moltbook = {
      verified: true,
      username: moltbookUsername,
      karma: moltbookData.karma || 0,
      verifiedAt: new Date().toISOString(),
      method: 'profile-fetch'
    };

    profile.updatedAt = new Date().toISOString();

    // Save profile
    const saved = saveProfileData(profile);
    if (!saved) {
      return { verified: false, error: 'Failed to save profile' };
    }

    return {
      verified: true,
      username: moltbookUsername,
      karma: moltbookData.karma || 0,
      followers: moltbookData.followers || 0,
      posts: moltbookData.posts || 0,
      comments: moltbookData.comments || 0,
      message: 'Moltbook account verified successfully'
    };

  } catch (error) {
    console.error('Moltbook verification error:', error);
    return { verified: false, error: error.message };
  }
}

/**
 * Sync karma for existing verified accounts
 */
async function syncMoltbookKarma(profileId) {
  try {
    const profile = loadProfileData(profileId);
    if (!profile || !profile.links || !profile.links.moltbook) {
      return { synced: false, error: 'No Moltbook account linked' };
    }

    const moltbookData = await fetchMoltbookProfile(profile.links.moltbook);
    if (!moltbookData) {
      return { synced: false, error: 'Failed to fetch Moltbook data' };
    }

    // Update stats
    profile.moltbookStats = profile.moltbookStats || {};
    const oldKarma = profile.moltbookStats.karma || 0;
    profile.moltbookStats.karma = moltbookData.karma || 0;
    profile.moltbookStats.followers = moltbookData.followers || 0;
    profile.moltbookStats.posts = moltbookData.posts || 0;
    profile.moltbookStats.comments = moltbookData.comments || 0;
    profile.moltbookStats.lastSyncAt = new Date().toISOString();

    profile.updatedAt = new Date().toISOString();
    
    const saved = saveProfileData(profile);
    if (!saved) {
      return { synced: false, error: 'Failed to save profile' };
    }

    return {
      synced: true,
      username: profile.links.moltbook,
      oldKarma,
      newKarma: moltbookData.karma || 0,
      karmaDelta: (moltbookData.karma || 0) - oldKarma,
      message: 'Karma synced successfully'
    };

  } catch (error) {
    console.error('Moltbook sync error:', error);
    return { synced: false, error: error.message };
  }
}

/**
 * Batch sync all profiles with Moltbook links
 */
async function batchSyncMoltbook() {
  const results = {
    processed: 0,
    synced: 0,
    errors: []
  };

  try {
    return { ...results, message: 'Batch sync not implemented yet' };
  } catch (error) {
    console.error('Batch sync error:', error);
    return { ...results, error: error.message };
  }
}

module.exports = {
  verifyMoltbookAccount,
  syncMoltbookKarma,
  batchSyncMoltbook
};
