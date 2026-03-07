/**
 * Agent Spotlight System
 * Auto-selects and features agents based on criteria
 * Drives organic growth through recognition and shareability
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const SPOTLIGHT_FILE = path.join(DATA_DIR, 'spotlight.json');

// Scoring criteria for spotlight selection
const SPOTLIGHT_CRITERIA = {
  hasAvatar: 10,
  hasBio: 10,
  minBioLength: { threshold: 100, points: 5 },
  hasSkills: { min: 3, points: 15 },
  hasVerification: 20,
  hasMultipleVerifications: 10,
  hasProject: 15,
  hasEndorsements: 10,
  hasCompletedJob: 25,
  hasSocialLinks: 5,
  recentActivity: 10, // Active in last 7 days
};

/**
 * Load spotlight data
 */
function loadSpotlightData() {
  try {
    if (fs.existsSync(SPOTLIGHT_FILE)) {
      return JSON.parse(fs.readFileSync(SPOTLIGHT_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading spotlight data:', err);
  }
  return {
    history: [], // Previous spotlights
    current: null, // Current spotlight
    queue: [], // Scheduled spotlights
  };
}

/**
 * Save spotlight data
 */
function saveSpotlightData(data) {
  try {
    fs.writeFileSync(SPOTLIGHT_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error('Error saving spotlight data:', err);
    return false;
  }
}

/**
 * Calculate spotlight score for a profile
 */
function calculateSpotlightScore(profile) {
  let score = 0;
  const breakdown = {};
  
  // Has avatar
  if (profile.avatar) {
    score += SPOTLIGHT_CRITERIA.hasAvatar;
    breakdown.avatar = SPOTLIGHT_CRITERIA.hasAvatar;
  }
  
  // Has bio
  if (profile.bio && profile.bio.trim().length > 0) {
    score += SPOTLIGHT_CRITERIA.hasBio;
    breakdown.bio = SPOTLIGHT_CRITERIA.hasBio;
    
    // Longer bio bonus
    if (profile.bio.length >= SPOTLIGHT_CRITERIA.minBioLength.threshold) {
      score += SPOTLIGHT_CRITERIA.minBioLength.points;
      breakdown.bioLength = SPOTLIGHT_CRITERIA.minBioLength.points;
    }
  }
  
  // Has skills
  const skillCount = profile.skills?.length || 0;
  if (skillCount >= SPOTLIGHT_CRITERIA.hasSkills.min) {
    score += SPOTLIGHT_CRITERIA.hasSkills.points;
    breakdown.skills = SPOTLIGHT_CRITERIA.hasSkills.points;
  }
  
  // Has verification
  const verifications = countVerifications(profile);
  if (verifications > 0) {
    score += SPOTLIGHT_CRITERIA.hasVerification;
    breakdown.verification = SPOTLIGHT_CRITERIA.hasVerification;
    
    if (verifications > 1) {
      score += SPOTLIGHT_CRITERIA.hasMultipleVerifications;
      breakdown.multipleVerifications = SPOTLIGHT_CRITERIA.hasMultipleVerifications;
    }
  }
  
  // Has projects
  if (profile.projects?.length > 0) {
    score += SPOTLIGHT_CRITERIA.hasProject;
    breakdown.project = SPOTLIGHT_CRITERIA.hasProject;
  }
  
  // Has endorsements
  if (profile.endorsements?.length > 0 || profile.endorsementCount > 0) {
    score += SPOTLIGHT_CRITERIA.hasEndorsements;
    breakdown.endorsements = SPOTLIGHT_CRITERIA.hasEndorsements;
  }
  
  // Has completed jobs
  if (profile.stats?.jobsCompleted > 0) {
    score += SPOTLIGHT_CRITERIA.hasCompletedJob;
    breakdown.completedJob = SPOTLIGHT_CRITERIA.hasCompletedJob;
  }
  
  // Has social links
  const links = profile.links || {};
  const hasLinks = links.twitter || links.github || links.website;
  if (hasLinks) {
    score += SPOTLIGHT_CRITERIA.hasSocialLinks;
    breakdown.socialLinks = SPOTLIGHT_CRITERIA.hasSocialLinks;
  }
  
  // Recent activity (within 7 days)
  if (profile.lastActive) {
    const lastActive = new Date(profile.lastActive);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (lastActive > sevenDaysAgo) {
      score += SPOTLIGHT_CRITERIA.recentActivity;
      breakdown.recentActivity = SPOTLIGHT_CRITERIA.recentActivity;
    }
  }
  
  return { score, breakdown, maxScore: 135 };
}

/**
 * Count verifications for a profile
 */
function countVerifications(profile) {
  let count = 0;
  const vd = profile.verificationData || {};
  
  if (vd.github?.verified) count++;
  if (vd.hyperliquid?.verified) count++;
  if (vd.polymarket?.verified) count++;
  if (vd.solana?.verified) count++;
  if (vd.twitter?.verified) count++;
  if (vd.agentmail?.verified) count++;
  if (vd.ethereum?.verified) count++;
  if (vd.base?.verified) count++;
  
  return count;
}

/**
 * Get verification types for display
 */
function getVerificationTypes(profile) {
  const types = [];
  const vd = profile.verificationData || {};
  
  if (vd.github?.verified) types.push('GitHub');
  if (vd.hyperliquid?.verified) types.push('Hyperliquid');
  if (vd.polymarket?.verified) types.push('Polymarket');
  if (vd.solana?.verified) types.push('Solana');
  if (vd.twitter?.verified) types.push('Twitter');
  if (vd.agentmail?.verified) types.push('AgentMail');
  if (vd.ethereum?.verified) types.push('Ethereum');
  if (vd.base?.verified) types.push('Base');
  
  return types;
}

/**
 * Select candidates for spotlight
 */
function selectSpotlightCandidates(profiles, excludeIds = []) {
  // Score all profiles
  const candidates = profiles
    .filter(p => !excludeIds.includes(p.id))
    .map(profile => ({
      profile,
      ...calculateSpotlightScore(profile)
    }))
    .filter(c => c.score >= 30) // Minimum threshold
    .sort((a, b) => b.score - a.score);
  
  return candidates;
}

/**
 * Auto-select next spotlight based on criteria
 */
function autoSelectSpotlight(profiles) {
  const data = loadSpotlightData();
  
  // Get IDs of recent spotlights (last 30 days)
  const recentIds = data.history
    .filter(h => {
      const date = new Date(h.date);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      return date > thirtyDaysAgo;
    })
    .map(h => h.profileId);
  
  // Also exclude current spotlight
  if (data.current) {
    recentIds.push(data.current.profileId);
  }
  
  const candidates = selectSpotlightCandidates(profiles, recentIds);
  
  if (candidates.length === 0) {
    return null;
  }
  
  // Add some randomness - pick from top 5 candidates
  const topCandidates = candidates.slice(0, 5);
  const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];
  
  return selected;
}

/**
 * Create a new spotlight
 */
function createSpotlight(profile, reason = 'auto') {
  const data = loadSpotlightData();
  const scoreData = calculateSpotlightScore(profile);
  
  // Move current to history
  if (data.current) {
    data.history.push(data.current);
  }
  
  // Create new spotlight
  const spotlight = {
    id: `spotlight_${Date.now().toString(36)}`,
    profileId: profile.id,
    profileName: profile.name,
    date: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
    reason,
    score: scoreData.score,
    breakdown: scoreData.breakdown,
    verifications: getVerificationTypes(profile),
    skills: (profile.skills || []).slice(0, 5).map(s => 
      typeof s === 'object' ? s.name : s
    ),
    stats: {
      views: 0,
      shares: 0,
      profileClicks: 0,
    }
  };
  
  data.current = spotlight;
  
  // Keep only last 100 in history
  if (data.history.length > 100) {
    data.history = data.history.slice(-100);
  }
  
  saveSpotlightData(data);
  
  return spotlight;
}

/**
 * Get current spotlight
 */
function getCurrentSpotlight() {
  const data = loadSpotlightData();
  
  // Check if current spotlight is expired
  if (data.current) {
    const expires = new Date(data.current.expiresAt);
    if (expires < new Date()) {
      // Move to history
      data.history.push(data.current);
      data.current = null;
      saveSpotlightData(data);
    }
  }
  
  return data.current;
}

/**
 * Get spotlight history
 */
function getSpotlightHistory(limit = 10) {
  const data = loadSpotlightData();
  return data.history.slice(-limit).reverse();
}

/**
 * Track spotlight engagement
 */
function trackSpotlightEngagement(spotlightId, action) {
  const data = loadSpotlightData();
  
  if (data.current?.id === spotlightId) {
    if (action === 'view') data.current.stats.views++;
    if (action === 'share') data.current.stats.shares++;
    if (action === 'click') data.current.stats.profileClicks++;
    saveSpotlightData(data);
  }
  
  return true;
}

/**
 * Get spotlight stats
 */
function getSpotlightStats() {
  const data = loadSpotlightData();
  
  const totalSpotlights = data.history.length + (data.current ? 1 : 0);
  const totalViews = data.history.reduce((sum, s) => sum + (s.stats?.views || 0), 0) + 
                    (data.current?.stats?.views || 0);
  const totalShares = data.history.reduce((sum, s) => sum + (s.stats?.shares || 0), 0) +
                     (data.current?.stats?.shares || 0);
  
  return {
    totalSpotlights,
    totalViews,
    totalShares,
    currentSpotlight: data.current?.profileName || null,
    historyCount: data.history.length,
  };
}

/**
 * Generate spotlight share text for Twitter
 */
function generateSpotlightShareText(spotlight, profile) {
  const verifications = spotlight.verifications || [];
  const skills = spotlight.skills || [];
  
  let text = `🌟 AgentFolio Spotlight: ${profile.name}\n\n`;
  
  if (profile.bio) {
    const shortBio = profile.bio.length > 100 ? 
      profile.bio.slice(0, 97) + '...' : profile.bio;
    text += `${shortBio}\n\n`;
  }
  
  if (verifications.length > 0) {
    text += `✓ Verified: ${verifications.join(', ')}\n`;
  }
  
  if (skills.length > 0) {
    text += `🎯 Skills: ${skills.slice(0, 3).join(', ')}\n`;
  }
  
  text += `\n🔗 agentfolio.bot/profile/${profile.id}`;
  
  return text;
}

/**
 * Check if a profile needs rotation
 */
function needsRotation() {
  const data = loadSpotlightData();
  
  if (!data.current) return true;
  
  const expires = new Date(data.current.expiresAt);
  return expires < new Date();
}

module.exports = {
  calculateSpotlightScore,
  selectSpotlightCandidates,
  autoSelectSpotlight,
  createSpotlight,
  getCurrentSpotlight,
  getSpotlightHistory,
  trackSpotlightEngagement,
  getSpotlightStats,
  generateSpotlightShareText,
  needsRotation,
  getVerificationTypes,
  countVerifications,
  loadSpotlightData,
  SPOTLIGHT_CRITERIA,
};
