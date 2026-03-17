/**
 * Activity Feed System
 * Tracks all profile events for public activity feeds
 * 
 * Uses SQLite database for storage (see database.js)
 */

const db = require('./database');

// Activity types
const ACTIVITY_TYPES = {
  PROFILE_CREATED: 'profile_created',
  PROFILE_UPDATED: 'profile_updated',
  VERIFICATION_TWITTER: 'verification_twitter',
  VERIFICATION_GITHUB: 'verification_github',
  VERIFICATION_HYPERLIQUID: 'verification_hyperliquid',
  VERIFICATION_SOLANA: 'verification_solana',
  VERIFICATION_AGENTMAIL: 'verification_agentmail',
  VERIFICATION_TELEGRAM: 'verification_telegram',
  VERIFICATION_DISCORD: 'verification_discord',
  ENDORSEMENT_RECEIVED: 'endorsement_received',
  ENDORSEMENT_GIVEN: 'endorsement_given',
  SKILL_ADDED: 'skill_added',
  SKILL_VERIFIED: 'skill_verified',
  PROJECT_ADDED: 'project_added',
  TIER_UPGRADE: 'tier_upgrade',
  JOB_POSTED: 'job_posted',
  JOB_COMPLETED: 'job_completed',
  APPLICATION_ACCEPTED: 'application_accepted'
};

// Activity icons and labels
const ACTIVITY_META = {
  [ACTIVITY_TYPES.PROFILE_CREATED]: { icon: '🎉', label: 'Joined AgentFolio' },
  [ACTIVITY_TYPES.PROFILE_UPDATED]: { icon: '✏️', label: 'Updated profile' },
  [ACTIVITY_TYPES.VERIFICATION_TWITTER]: { icon: '𝕏', label: 'Verified Twitter' },
  [ACTIVITY_TYPES.VERIFICATION_GITHUB]: { icon: '💻', label: 'Verified GitHub' },
  [ACTIVITY_TYPES.VERIFICATION_HYPERLIQUID]: { icon: '📈', label: 'Verified Hyperliquid' },
  [ACTIVITY_TYPES.VERIFICATION_SOLANA]: { icon: '◎', label: 'Verified Solana' },
  [ACTIVITY_TYPES.VERIFICATION_AGENTMAIL]: { icon: '📧', label: 'Verified AgentMail' },
  [ACTIVITY_TYPES.VERIFICATION_TELEGRAM]: { icon: '📱', label: 'Verified Telegram' },
  [ACTIVITY_TYPES.VERIFICATION_DISCORD]: { icon: '🎮', label: 'Verified Discord' },
  [ACTIVITY_TYPES.ENDORSEMENT_RECEIVED]: { icon: '🤝', label: 'Received endorsement' },
  [ACTIVITY_TYPES.ENDORSEMENT_GIVEN]: { icon: '👍', label: 'Endorsed' },
  [ACTIVITY_TYPES.SKILL_ADDED]: { icon: '🛠️', label: 'Added skill' },
  [ACTIVITY_TYPES.SKILL_VERIFIED]: { icon: '✅', label: 'Verified skill' },
  [ACTIVITY_TYPES.PROJECT_ADDED]: { icon: '📁', label: 'Added project' },
  [ACTIVITY_TYPES.TIER_UPGRADE]: { icon: '🏆', label: 'Tier upgraded' },
  [ACTIVITY_TYPES.JOB_POSTED]: { icon: '📝', label: 'Posted job' },
  [ACTIVITY_TYPES.JOB_COMPLETED]: { icon: '✅', label: 'Completed job' },
  [ACTIVITY_TYPES.APPLICATION_ACCEPTED]: { icon: '🎉', label: 'Won job' }
};

/**
 * Add an activity to a profile
 * @param {string} profileId - Profile ID to add activity to
 * @param {string} type - Activity type from ACTIVITY_TYPES
 * @param {object} data - Additional data for the activity
 * @param {string} dataDir - (ignored, kept for backwards compatibility)
 * @returns {object} The created activity or error
 */
function addActivity(profileId, type, data = {}, dataDir = null) {
  // Check if profile exists
  const profile = db.loadProfile(profileId);
  if (!profile) {
    return { error: 'Profile not found' };
  }
  
  const activity = db.addActivity(profileId, type, data);
  return activity;
}

/**
 * Get activities for a profile
 * @param {string} profileId - Profile ID
 * @param {string} dataDir - (ignored, kept for backwards compatibility)
 * @param {number} limit - Max activities to return
 * @returns {array} Activities with metadata
 */
function getActivities(profileId, dataDir = null, limit = 10) {
  const activities = db.getActivities(profileId, limit);
  
  // Enrich with metadata
  return activities.map(a => ({
    ...a,
    meta: ACTIVITY_META[a.type] || { icon: '📌', label: 'Activity' }
  }));
}

/**
 * Get global activity feed across all profiles
 * @param {string} dataDir - (ignored, kept for backwards compatibility)
 * @param {number} limit - Max activities to return
 * @returns {array} Activities with profile info
 */
function getGlobalFeed(dataDir = null, limit = 20) {
  const activities = db.getGlobalFeed(limit);
  
  return activities.map(a => ({
    ...a,
    meta: ACTIVITY_META[a.type] || { icon: '📌', label: 'Activity' }
  }));
}

/**
 * Format activity for display
 * @param {object} activity - Activity object
 * @returns {string} Formatted activity text
 */
function formatActivity(activity) {
  const meta = activity.meta || ACTIVITY_META[activity.type] || { icon: '📌', label: 'Activity' };
  let text = meta.label;
  
  // Add context based on type
  switch (activity.type) {
    case ACTIVITY_TYPES.ENDORSEMENT_RECEIVED:
      if (activity.data?.fromName) {
        text = `Received endorsement from ${activity.data.fromName}`;
        if (activity.data.skill) text += ` for ${activity.data.skill}`;
      }
      break;
    case ACTIVITY_TYPES.ENDORSEMENT_GIVEN:
      if (activity.data?.toName) {
        text = `Endorsed ${activity.data.toName}`;
        if (activity.data.skill) text += ` for ${activity.data.skill}`;
      }
      break;
    case ACTIVITY_TYPES.SKILL_ADDED:
      if (activity.data?.skill) text = `Added skill: ${activity.data.skill}`;
      break;
    case ACTIVITY_TYPES.SKILL_VERIFIED:
      if (activity.data?.skill) text = `Verified skill: ${activity.data.skill}`;
      break;
    case ACTIVITY_TYPES.PROJECT_ADDED:
      if (activity.data?.project) text = `Added project: ${activity.data.project}`;
      break;
    case ACTIVITY_TYPES.TIER_UPGRADE:
      if (activity.data?.tier) text = `Upgraded to ${activity.data.tier} tier`;
      break;
    case ACTIVITY_TYPES.VERIFICATION_HYPERLIQUID:
      if (activity.data?.accountValue) text = `Verified Hyperliquid ($${activity.data.accountValue})`;
      break;
    case ACTIVITY_TYPES.VERIFICATION_GITHUB:
      if (activity.data?.repos) text = `Verified GitHub (${activity.data.repos} repos)`;
      break;
    case ACTIVITY_TYPES.JOB_POSTED:
      if (activity.data?.title) text = `Posted job: ${activity.data.title}`;
      break;
    case ACTIVITY_TYPES.JOB_COMPLETED:
      if (activity.data?.title) text = `Completed job: ${activity.data.title}`;
      break;
    case ACTIVITY_TYPES.APPLICATION_ACCEPTED:
      if (activity.data?.title) text = `Won job: ${activity.data.title}`;
      break;
  }
  
  return text;
}

/**
 * Format relative time
 * @param {string} isoDate - ISO date string
 * @returns {string} Relative time string
 */
function timeAgo(isoDate) {
  const seconds = Math.floor((new Date() - new Date(isoDate)) / 1000);
  
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  
  return new Date(isoDate).toLocaleDateString();
}

module.exports = {
  ACTIVITY_TYPES,
  ACTIVITY_META,
  addActivity,
  getActivities,
  getGlobalFeed,
  formatActivity,
  timeAgo
};

/**
 * Get activity heatmap (date -> count) for a profile
 * Used for GitHub-style contribution grid
 * @param {string} profileId
 * @param {number} days - How many days back (default 365)
 * @returns {object} { heatmap: {date: count}, totalEvents, activeDays, streak }
 */
function getHeatmap(profileId, days = 365) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = db.db.prepare(
    "SELECT DATE(created_at) as day, COUNT(*) as count FROM activity WHERE profile_id = ? AND created_at >= ? GROUP BY DATE(created_at) ORDER BY day"
  ).all(profileId, since);
  
  const heatmap = {};
  let totalEvents = 0;
  rows.forEach(r => { heatmap[r.day] = r.count; totalEvents += r.count; });
  
  // Calculate current streak
  let streak = 0;
  const today = new Date().toISOString().slice(0, 10);
  let checkDate = new Date();
  // Allow today to not have activity yet
  if (!heatmap[today]) checkDate.setDate(checkDate.getDate() - 1);
  while (true) {
    const ds = checkDate.toISOString().slice(0, 10);
    if (heatmap[ds]) { streak++; checkDate.setDate(checkDate.getDate() - 1); }
    else break;
  }
  
  return {
    heatmap,
    totalEvents,
    activeDays: Object.keys(heatmap).length,
    streak
  };
}

module.exports.getHeatmap = getHeatmap;

/**
 * Get heatmap with event summaries per date
 * Returns heatmap with top event types per day for rich tooltips
 */
function getHeatmapDetailed(profileId, days = 365) {
  const base = getHeatmap(profileId, days);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  
  // Get event type breakdown per day
  const rows = db.db.prepare(
    "SELECT DATE(created_at) as day, type, COUNT(*) as count FROM activity WHERE profile_id = ? AND created_at >= ? GROUP BY DATE(created_at), type ORDER BY day, count DESC"
  ).all(profileId, since);
  
  const details = {};
  rows.forEach(r => {
    if (!details[r.day]) details[r.day] = [];
    const meta = ACTIVITY_META[r.type] || { icon: "📌", label: r.type.replace(/_/g, " ") };
    details[r.day].push({ type: r.type, label: meta.label, icon: meta.icon, count: r.count });
  });
  
  return { ...base, details };
}

module.exports.getHeatmapDetailed = getHeatmapDetailed;
