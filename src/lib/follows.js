/**
 * Profile Follow System
 * Allow agents/users to follow other agent profiles for updates
 * 
 * Uses SQLite database for storage (see database.js)
 */

const db = require('./database');

/**
 * Follow a profile
 * @param {string} followerId - The follower's identifier (userId or agentId)
 * @param {string} targetId - The profile being followed
 * @param {string} followerType - 'agent' or 'user' (deprecated, ignored)
 */
function followProfile(followerId, targetId, followerType = 'user') {
  // Check if already following
  if (db.isFollowing(followerId, targetId)) {
    return { success: false, error: 'Already following this profile' };
  }
  
  db.followProfile(followerId, targetId);
  
  return { 
    success: true, 
    follow: {
      followerId,
      targetId,
      createdAt: new Date().toISOString()
    }
  };
}

/**
 * Unfollow a profile
 */
function unfollowProfile(followerId, targetId) {
  if (!db.isFollowing(followerId, targetId)) {
    return { success: false, error: 'Not following this profile' };
  }
  
  db.unfollowProfile(followerId, targetId);
  return { success: true };
}

/**
 * Check if following
 */
function isFollowing(followerId, targetId) {
  return db.isFollowing(followerId, targetId);
}

/**
 * Get profiles a user/agent is following
 */
function getFollowing(followerId) {
  const following = db.getFollowing(followerId);
  return following.map(targetId => ({
    targetId,
    followedAt: null // We don't track this in the simple schema
  }));
}

/**
 * Get followers of a profile
 */
function getFollowers(targetId) {
  const followers = db.getFollowers(targetId);
  return followers.map(followerId => ({
    followerId,
    followerType: 'user', // deprecated
    followedAt: null
  }));
}

/**
 * Get follower count for a profile
 */
function getFollowerCount(targetId) {
  return db.getFollowerCount(targetId);
}

/**
 * Get follow stats for multiple profiles
 */
function getFollowStats(profileIds) {
  const stats = {};
  for (const id of profileIds) {
    stats[id] = db.getFollowerCount(id);
  }
  return stats;
}

/**
 * Get most followed profiles
 */
function getMostFollowed(limit = 10) {
  // Get all profiles and their follower counts
  const profiles = db.listProfiles();
  const withCounts = profiles.map(p => ({
    profileId: p.id,
    followers: db.getFollowerCount(p.id)
  }));
  
  return withCounts
    .filter(p => p.followers > 0)
    .sort((a, b) => b.followers - a.followers)
    .slice(0, limit);
}

/**
 * Get follow feed - recent activity from followed profiles
 */
function getFollowFeed(followerId, activities, limit = 20) {
  const following = db.getFollowing(followerId);
  
  if (following.length === 0) {
    return [];
  }
  
  return activities
    .filter(a => following.includes(a.profileId))
    .slice(0, limit);
}

module.exports = {
  followProfile,
  unfollowProfile,
  isFollowing,
  getFollowing,
  getFollowers,
  getFollowerCount,
  getFollowStats,
  getMostFollowed,
  getFollowFeed
};
