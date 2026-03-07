/**
 * AgentFolio Analytics Module
 * Tracks profile views and API usage
 * 
 * Uses SQLite database for storage (see database.js)
 */

const db = require('./database');

/**
 * Track a profile view
 */
function trackProfileView(profileId) {
  db.trackProfileView(profileId);
  return db.getProfileAnalytics(profileId);
}

/**
 * Track an API call
 */
function trackApiCall(endpoint) {
  db.trackApiCall(endpoint);
}

/**
 * Get analytics for a specific profile
 */
function getProfileAnalytics(profileId) {
  return db.getProfileAnalytics(profileId);
}

/**
 * Get global analytics
 */
function getGlobalAnalytics() {
  return db.getGlobalAnalytics();
}

/**
 * Get top profiles by views
 */
function getViewsLeaderboard(limit = 10) {
  const leaders = db.getViewsLeaderboard(limit);
  
  // Enrich with profile data
  return leaders.map(l => {
    const profile = db.loadProfile(l.profileId);
    return {
      profileId: l.profileId,
      profileName: profile?.name || 'Unknown',
      profileHandle: profile?.handle || '',
      views: l.views
    };
  }).filter(l => l.profileName !== 'Unknown');
}

/**
 * Cleanup old analytics data
 */
function cleanupOldData(daysToKeep = 90) {
  db.cleanupOldAnalytics(daysToKeep);
  console.log(`[Analytics] Cleaned up data older than ${daysToKeep} days`);
}

module.exports = {
  trackProfileView,
  trackApiCall,
  getProfileAnalytics,
  getGlobalAnalytics,
  getViewsLeaderboard,
  cleanupOldData
};
