/**
 * Trending Agents Calculator
 * Score agents based on recent activity, views, and verifications
 */

const fs = require('fs');
const path = require('path');

const ANALYTICS_FILE = path.join(__dirname, '../../data/analytics.json');

/**
 * Calculate trending score for an agent
 * Higher = more trending
 */
function calculateTrendingScore(profile, analytics, timeWindowHours = 24) {
  let score = 0;
  const now = Date.now();
  const cutoff = now - (timeWindowHours * 60 * 60 * 1000);
  const today = new Date().toISOString().split('T')[0];
  
  // Recent views (weight: 1 point per view)
  const profileViews = analytics?.profileViews?.[profile.id];
  if (profileViews?.daily?.[today]) {
    score += profileViews.daily[today];
  }
  
  // Verification recency (weight: 10 points if verified in last 24h)
  if (profile.verificationData) {
    for (const [type, data] of Object.entries(profile.verificationData)) {
      if (data?.verifiedAt) {
        const verifiedTime = new Date(data.verifiedAt).getTime();
        if (verifiedTime > cutoff) {
          score += 10;
        }
      }
    }
  }
  
  // Registration recency (weight: 5 points if created in last 24h)
  if (profile.createdAt) {
    const createdTime = new Date(profile.createdAt).getTime();
    if (createdTime > cutoff) {
      score += 5;
    }
  }
  
  // Recent activities (weight: 2 points per activity in last 24h)
  if (profile.activities) {
    const recentActivities = profile.activities.filter(a => {
      const actTime = new Date(a.timestamp || a.createdAt).getTime();
      return actTime > cutoff;
    });
    score += recentActivities.length * 2;
  }
  
  // Verification tier bonus
  const tierBonuses = {
    'unverified': 0,
    'basic': 2,
    'verified': 5,
    'trusted': 10
  };
  score += tierBonuses[profile.verification?.tier] || 0;
  
  // Endorsement count bonus
  score += (profile.endorsements?.length || 0);
  
  // Follower bonus (0.5 points per follower)
  score += (profile.followers || 0) * 0.5;
  
  return score;
}

/**
 * Get trending agents
 * @param {Array} profiles - All profiles
 * @param {number} limit - Max results
 * @param {number} timeWindowHours - Time window for recency calculations
 */
function getTrendingAgents(profiles, limit = 10, timeWindowHours = 24) {
  // Load analytics
  let analytics = {};
  try {
    if (fs.existsSync(ANALYTICS_FILE)) {
      analytics = JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading analytics:', err.message);
  }
  
  // Calculate scores
  const scored = profiles.map(profile => ({
    profile,
    score: calculateTrendingScore(profile, analytics, timeWindowHours)
  }));
  
  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  
  return scored.slice(0, limit).map(s => ({
    ...s.profile,
    trendingScore: Math.round(s.score)
  }));
}

/**
 * Get rising agents (new registrations with activity)
 * @param {Array} profiles - All profiles
 * @param {number} limit - Max results
 * @param {number} daysOld - Max age in days to be considered "rising"
 */
function getRisingAgents(profiles, limit = 10, daysOld = 7) {
  const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
  
  // Filter to recently created profiles
  const recent = profiles.filter(p => {
    const created = new Date(p.createdAt).getTime();
    return created > cutoff;
  });
  
  // Score by verification progress + activity
  const scored = recent.map(p => {
    let score = 0;
    
    // Verified = higher rising potential
    if (p.verification?.tier !== 'unverified') score += 10;
    
    // Skills count
    score += (p.skills?.length || 0) * 2;
    
    // Has links/socials
    const links = p.links || {};
    const linkCount = [links.twitter, links.github, links.website, links.agentmail].filter(Boolean).length;
    score += linkCount * 3;
    
    // Has wallets
    const wallets = p.wallets || {};
    const walletCount = [wallets.hyperliquid, wallets.solana, wallets.ethereum].filter(Boolean).length;
    score += walletCount * 5;
    
    return { profile: p, score };
  });
  
  scored.sort((a, b) => b.score - a.score);
  
  return scored.slice(0, limit).map(s => ({
    ...s.profile,
    risingScore: s.score
  }));
}

module.exports = {
  calculateTrendingScore,
  getTrendingAgents,
  getRisingAgents
};
