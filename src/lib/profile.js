/**
 * AgentFolio Profile System
 * Agent profile schema and management
 * 
 * Uses SQLite database for storage (see database.js)
 */

const db = require('./database');
const { verifyGitHubCommits, verifyPackageOwnership, calculateVerificationScore } = require('./verification');

// Profile schema
const createProfile = (data) => ({
  id: data.id || generateId(),
  name: data.name,
  handle: data.handle, // e.g., @0xbrainKID
  bio: data.bio || '',
  avatar: data.avatar || null,
  
  // Linked accounts
  links: {
    moltbook: data.links?.moltbook || null,
    x: data.links?.twitter || null,
    github: data.links?.github || null,
    website: data.links?.website || null,
    agentmail: data.links?.agentmail || null,
    telegram: data.links?.telegram || null,
    discord: data.links?.discord || null,
  },
  
  // Wallets
  wallets: {
    hyperliquid: data.wallets?.hyperliquid || null,
    solana: data.wallets?.solana || null,
    ethereum: data.wallets?.ethereum || null,
  },
  
  // Skills with verification
  skills: data.skills || [],
  // Format: { name: 'Trading', category: 'Finance', verified: true, proofs: [...] }
  
  // Portfolio items
  portfolio: data.portfolio || [],
  // Format: { title, description, type, url, proofs: [...], verified: bool }
  
  // Track record (for traders)
  trackRecord: data.trackRecord || null,
  // Format: { trades: [...], pnl: num, winRate: num, verified: bool }
  
  // Verification metadata
  verification: {
    score: 0,
    tier: 'unverified',
    proofs: [],
    lastVerified: null
  },
  
  // Verification data from various platforms
  verificationData: data.verificationData || {},
  
  // Moltbook stats
  moltbookStats: data.moltbookStats || null,
  
  // Endorsements
  endorsements: data.endorsements || [],
  endorsementsGiven: data.endorsementsGiven || [],
  
  // Timestamps
  createdAt: data.createdAt || new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

function generateId() {
  return 'agent_' + Math.random().toString(36).substring(2, 15);
}

// Skills taxonomy
const SKILLS_TAXONOMY = {
  'Development': ['Frontend', 'Backend', 'Smart Contracts', 'AI/ML', 'DevOps', 'Mobile'],
  'Trading': ['Backtesting', 'Live Execution', 'Risk Management', 'Signal Generation', 'Portfolio Management'],
  'Research': ['Market Analysis', 'Due Diligence', 'Data Analysis', 'Competitive Intel'],
  'Content': ['Writing', 'Social Media', 'Community Management', 'Design'],
  'Infrastructure': ['Agent Tooling', 'API Development', 'Security', 'Protocol Design']
};

/**
 * Verify a profile's claims
 */
async function verifyProfile(profile) {
  const verifications = [];

  // Verify GitHub if linked
  if (profile.links?.github) {
    const parts = profile.links.github.split('/');
    const username = parts[parts.length - 1];
    
    // Check for repos in portfolio
    for (const item of profile.portfolio) {
      if (item.type === 'github' && item.url) {
        const repoParts = item.url.split('/');
        const repo = repoParts[repoParts.length - 1];
        const owner = repoParts[repoParts.length - 2];
        
        const result = await verifyGitHubCommits(owner, repo, username);
        verifications.push({
          type: 'github_commits',
          item: item.title,
          ...result
        });
      }
    }
  }

  // Verify npm packages
  for (const item of profile.portfolio) {
    if (item.type === 'npm') {
      const result = await verifyPackageOwnership(item.packageName, profile.links?.npm);
      verifications.push({
        type: 'npm_package',
        item: item.title,
        ...result
      });
    }
  }

  // Calculate overall score
  const score = calculateVerificationScore(verifications);
  
  // Determine tier
  let tier = 'unverified';
  if (score >= 80) tier = 'verified';
  else if (score >= 50) tier = 'partially_verified';
  else if (score > 0) tier = 'self_reported';

  return {
    score,
    tier,
    proofs: verifications,
    lastVerified: new Date().toISOString()
  };
}

/**
 * Save profile to database
 */
function saveProfile(profile, dataDir = null) {
  const { caches } = require('./cache');
  profile.updatedAt = new Date().toISOString();
  const result = db.saveProfile(profile);
  // Invalidate caches
  caches.profiles.del(`profile:${profile.id}`);
  caches.profiles.del('profiles:all');
  caches.search.clear(); // search results may be stale
  return result;
}

/**
 * Load profile from database
 */
function loadProfile(profileId, dataDir = null) {
  const { caches } = require('./cache');
  return caches.profiles.wrapSync(`profile:${profileId}`, 120, () => {
    const profile = db.loadProfile(profileId);
    if (profile) {
      profile.activity = db.getActivities(profileId, 50);
      // Enrich verification object with V3 scores (sync, from cache)
      try {
        const { _getFromCache } = require('../v3-score-service');
        const v3 = _getFromCache(profileId);
        if (v3 && v3.reputationScore !== undefined) {
          const tiers = ['unverified','registered','verified','established','trusted','sovereign'];
          profile.trustScore = v3.reputationScore;
          profile.verificationLevel = v3.verificationLevel;
          profile.tier = tiers[v3.verificationLevel] || 'unverified';
          profile.verification = profile.verification || {};
          profile.verification.score = v3.reputationScore;
          profile.verification.tier = tiers[v3.verificationLevel] || 'unverified';
          // Update verifiedPlatforms from verificationData
          const vd = profile.verificationData || {};
          profile.verification.verifiedPlatforms = Object.entries(vd)
            .filter(([k, v]) => v && v.verified && k !== 'onboardingDismissed')
            .map(([k]) => k);
        }
      } catch (e) { /* v3-score-service not available yet, skip enrichment */ }
    }
    return profile;
  });
}

/**
 * List all profiles
 */
function listProfiles(dataDir = null) {
  const { caches } = require('./cache');
  return caches.profiles.wrapSync('profiles:all', 60, () => {
    return db.listProfiles();
  });
}

/**
 * Delete a profile
 */
function deleteProfile(profileId, dataDir = null) {
  const { caches } = require('./cache');
  const result = db.deleteProfile(profileId);
  caches.profiles.del(`profile:${profileId}`);
  caches.profiles.del('profiles:all');
  caches.search.clear();
  return result;
}

/**
 * Check if profile exists
 */
function profileExists(profileId) {
  return !!db.loadProfile(profileId);
}

/**
 * Get profile count
 */
function getProfileCount() {
  return db.getProfileCount();
}

module.exports = {
  createProfile,
  verifyProfile,
  saveProfile,
  loadProfile,
  listProfiles,
  deleteProfile,
  profileExists,
  getProfileCount,
  SKILLS_TAXONOMY
};
