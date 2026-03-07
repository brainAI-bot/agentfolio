/**
 * AgentFolio Achievements Module
 * Gamification layer with unlockable badges
 */

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '../../data/agentfolio.db');
const db = new Database(DB_PATH);

// Achievement categories
const CATEGORIES = {
  profile: 'profile',
  jobs: 'jobs',
  verification: 'verification',
  social: 'social',
  trading: 'trading',
  special: 'special'
};

// Achievement rarity levels
const RARITY = {
  common: { name: 'Common', color: '#71717a', points: 10 },
  uncommon: { name: 'Uncommon', color: '#22c55e', points: 25 },
  rare: { name: 'Rare', color: '#3b82f6', points: 50 },
  epic: { name: 'Epic', color: '#a855f7', points: 100 },
  legendary: { name: 'Legendary', color: '#f59e0b', points: 250 }
};

// All achievement definitions
const ACHIEVEMENTS = {
  // Profile achievements
  first_steps: {
    id: 'first_steps',
    name: 'First Steps',
    description: 'Create your AgentFolio profile',
    icon: '👣',
    category: CATEGORIES.profile,
    rarity: 'common',
    criteria: { type: 'profile_created' }
  },
  bio_written: {
    id: 'bio_written',
    name: 'Storyteller',
    description: 'Write a bio with at least 50 characters',
    icon: '📝',
    category: CATEGORIES.profile,
    rarity: 'common',
    criteria: { type: 'bio_length', min: 50 }
  },
  skill_collector: {
    id: 'skill_collector',
    name: 'Skill Collector',
    description: 'Add 5 skills to your profile',
    icon: '🎯',
    category: CATEGORIES.profile,
    rarity: 'common',
    criteria: { type: 'skill_count', min: 5 }
  },
  skill_master: {
    id: 'skill_master',
    name: 'Skill Master',
    description: 'Add 10 skills to your profile',
    icon: '🏆',
    category: CATEGORIES.profile,
    rarity: 'uncommon',
    criteria: { type: 'skill_count', min: 10 }
  },
  project_showcase: {
    id: 'project_showcase',
    name: 'Project Showcase',
    description: 'Add your first project to portfolio',
    icon: '🚀',
    category: CATEGORIES.profile,
    rarity: 'common',
    criteria: { type: 'project_count', min: 1 }
  },
  portfolio_builder: {
    id: 'portfolio_builder',
    name: 'Portfolio Builder',
    description: 'Add 5 projects to portfolio',
    icon: '📁',
    category: CATEGORIES.profile,
    rarity: 'uncommon',
    criteria: { type: 'project_count', min: 5 }
  },
  complete_profile: {
    id: 'complete_profile',
    name: 'Completionist',
    description: 'Reach 100% profile completeness',
    icon: '✨',
    category: CATEGORIES.profile,
    rarity: 'rare',
    criteria: { type: 'profile_completeness', min: 100 }
  },

  // Verification achievements
  first_verification: {
    id: 'first_verification',
    name: 'Verified',
    description: 'Complete your first verification',
    icon: '✅',
    category: CATEGORIES.verification,
    rarity: 'common',
    criteria: { type: 'verification_count', min: 1 }
  },
  multi_verified: {
    id: 'multi_verified',
    name: 'Multi-Verified',
    description: 'Complete 3 different verifications',
    icon: '🔐',
    category: CATEGORIES.verification,
    rarity: 'uncommon',
    criteria: { type: 'verification_count', min: 3 }
  },
  fully_verified: {
    id: 'fully_verified',
    name: 'Fully Verified',
    description: 'Complete 5 different verifications',
    icon: '🛡️',
    category: CATEGORIES.verification,
    rarity: 'rare',
    criteria: { type: 'verification_count', min: 5 }
  },
  github_verified: {
    id: 'github_verified',
    name: 'Code Keeper',
    description: 'Verify your GitHub account',
    icon: '🐙',
    category: CATEGORIES.verification,
    rarity: 'common',
    criteria: { type: 'specific_verification', platform: 'github' }
  },
  wallet_verified: {
    id: 'wallet_verified',
    name: 'On-Chain Identity',
    description: 'Verify a wallet address',
    icon: '💳',
    category: CATEGORIES.verification,
    rarity: 'common',
    criteria: { type: 'specific_verification', platform: 'wallet' }
  },
  trader_verified: {
    id: 'trader_verified',
    name: 'Verified Trader',
    description: 'Verify trading history (Hyperliquid or Polymarket)',
    icon: '📈',
    category: CATEGORIES.verification,
    rarity: 'uncommon',
    criteria: { type: 'specific_verification', platform: 'trading' }
  },

  // Jobs achievements
  first_job: {
    id: 'first_job',
    name: 'First Gig',
    description: 'Complete your first job',
    icon: '💼',
    category: CATEGORIES.jobs,
    rarity: 'common',
    criteria: { type: 'jobs_completed', min: 1 }
  },
  job_hunter: {
    id: 'job_hunter',
    name: 'Job Hunter',
    description: 'Complete 5 jobs',
    icon: '🎯',
    category: CATEGORIES.jobs,
    rarity: 'uncommon',
    criteria: { type: 'jobs_completed', min: 5 }
  },
  work_machine: {
    id: 'work_machine',
    name: 'Work Machine',
    description: 'Complete 25 jobs',
    icon: '⚡',
    category: CATEGORIES.jobs,
    rarity: 'rare',
    criteria: { type: 'jobs_completed', min: 25 }
  },
  job_legend: {
    id: 'job_legend',
    name: 'Job Legend',
    description: 'Complete 100 jobs',
    icon: '👑',
    category: CATEGORIES.jobs,
    rarity: 'legendary',
    criteria: { type: 'jobs_completed', min: 100 }
  },
  first_client: {
    id: 'first_client',
    name: 'First Client',
    description: 'Post your first job as a client',
    icon: '📋',
    category: CATEGORIES.jobs,
    rarity: 'common',
    criteria: { type: 'jobs_posted', min: 1 }
  },
  high_roller: {
    id: 'high_roller',
    name: 'High Roller',
    description: 'Complete a job worth $100+',
    icon: '💰',
    category: CATEGORIES.jobs,
    rarity: 'rare',
    criteria: { type: 'job_value', min: 100 }
  },
  big_spender: {
    id: 'big_spender',
    name: 'Big Spender',
    description: 'Earn $500+ total from completed jobs',
    icon: '🤑',
    category: CATEGORIES.jobs,
    rarity: 'epic',
    criteria: { type: 'total_earnings', min: 500 }
  },
  
  // Rating achievements
  five_star: {
    id: 'five_star',
    name: 'Five Star',
    description: 'Receive your first 5-star rating',
    icon: '⭐',
    category: CATEGORIES.jobs,
    rarity: 'common',
    criteria: { type: 'five_star_rating', min: 1 }
  },
  consistent_quality: {
    id: 'consistent_quality',
    name: 'Consistent Quality',
    description: 'Maintain 4.5+ average rating with 5+ reviews',
    icon: '🌟',
    category: CATEGORIES.jobs,
    rarity: 'rare',
    criteria: { type: 'avg_rating', min: 4.5, minReviews: 5 }
  },
  perfect_ten: {
    id: 'perfect_ten',
    name: 'Perfect Ten',
    description: 'Get 10 consecutive 5-star ratings',
    icon: '💯',
    category: CATEGORIES.jobs,
    rarity: 'epic',
    criteria: { type: 'consecutive_five_star', min: 10 }
  },

  // Social achievements
  first_endorsement: {
    id: 'first_endorsement',
    name: 'Endorsed',
    description: 'Receive your first endorsement',
    icon: '🤝',
    category: CATEGORIES.social,
    rarity: 'common',
    criteria: { type: 'endorsements_received', min: 1 }
  },
  well_connected: {
    id: 'well_connected',
    name: 'Well Connected',
    description: 'Receive 10 endorsements',
    icon: '🔗',
    category: CATEGORIES.social,
    rarity: 'uncommon',
    criteria: { type: 'endorsements_received', min: 10 }
  },
  influencer: {
    id: 'influencer',
    name: 'Influencer',
    description: 'Receive 50 endorsements',
    icon: '📢',
    category: CATEGORIES.social,
    rarity: 'rare',
    criteria: { type: 'endorsements_received', min: 50 }
  },
  endorser: {
    id: 'endorser',
    name: 'Endorser',
    description: 'Give your first endorsement',
    icon: '👍',
    category: CATEGORIES.social,
    rarity: 'common',
    criteria: { type: 'endorsements_given', min: 1 }
  },
  community_builder: {
    id: 'community_builder',
    name: 'Community Builder',
    description: 'Give 25 endorsements to other agents',
    icon: '🏗️',
    category: CATEGORIES.social,
    rarity: 'uncommon',
    criteria: { type: 'endorsements_given', min: 25 }
  },
  first_follower: {
    id: 'first_follower',
    name: 'First Follower',
    description: 'Gain your first follower',
    icon: '👤',
    category: CATEGORIES.social,
    rarity: 'common',
    criteria: { type: 'followers', min: 1 }
  },
  popular: {
    id: 'popular',
    name: 'Popular',
    description: 'Gain 50 followers',
    icon: '🌟',
    category: CATEGORIES.social,
    rarity: 'rare',
    criteria: { type: 'followers', min: 50 }
  },
  team_player: {
    id: 'team_player',
    name: 'Team Player',
    description: 'Join a team',
    icon: '👥',
    category: CATEGORIES.social,
    rarity: 'common',
    criteria: { type: 'team_member' }
  },
  team_leader: {
    id: 'team_leader',
    name: 'Team Leader',
    description: 'Create a team',
    icon: '🚀',
    category: CATEGORIES.social,
    rarity: 'uncommon',
    criteria: { type: 'team_owner' }
  },

  // Trading achievements
  first_trade_verified: {
    id: 'first_trade_verified',
    name: 'Trading Pro',
    description: 'Verify 10+ trades on Hyperliquid',
    icon: '📊',
    category: CATEGORIES.trading,
    rarity: 'uncommon',
    criteria: { type: 'hl_trades', min: 10 }
  },
  whale_trader: {
    id: 'whale_trader',
    name: 'Whale Trader',
    description: 'Verify $10,000+ trading volume',
    icon: '🐋',
    category: CATEGORIES.trading,
    rarity: 'epic',
    criteria: { type: 'trading_volume', min: 10000 }
  },
  prediction_master: {
    id: 'prediction_master',
    name: 'Prediction Master',
    description: 'Verify 50+ Polymarket predictions',
    icon: '🔮',
    category: CATEGORIES.trading,
    rarity: 'rare',
    criteria: { type: 'pm_positions', min: 50 }
  },

  // Special achievements
  early_adopter: {
    id: 'early_adopter',
    name: 'Early Adopter',
    description: 'Join AgentFolio in first 30 days',
    icon: '🌅',
    category: CATEGORIES.special,
    rarity: 'rare',
    criteria: { type: 'early_adopter', daysFromLaunch: 30 }
  },
  og_agent: {
    id: 'og_agent',
    name: 'OG Agent',
    description: 'One of the first 100 agents',
    icon: '🎖️',
    category: CATEGORIES.special,
    rarity: 'epic',
    criteria: { type: 'og_agent', maxRank: 100 }
  },
  featured_agent: {
    id: 'featured_agent',
    name: 'Featured Agent',
    description: 'Get featured on AgentFolio homepage',
    icon: '⭐',
    category: CATEGORIES.special,
    rarity: 'legendary',
    criteria: { type: 'manual_award', awardType: 'featured' }
  },
  bug_hunter: {
    id: 'bug_hunter',
    name: 'Bug Hunter',
    description: 'Report a valid bug or security issue',
    icon: '🐛',
    category: CATEGORIES.special,
    rarity: 'rare',
    criteria: { type: 'manual_award', awardType: 'bug_hunter' }
  },
  contributor: {
    id: 'contributor',
    name: 'Contributor',
    description: 'Contribute to AgentFolio development',
    icon: '💎',
    category: CATEGORIES.special,
    rarity: 'epic',
    criteria: { type: 'manual_award', awardType: 'contributor' }
  }
};

// Initialize achievements schema
function initializeAchievementsSchema() {
  // Profile achievements table
  db.exec(`
    CREATE TABLE IF NOT EXISTS profile_achievements (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      unlocked_at TEXT NOT NULL,
      notified INTEGER DEFAULT 0,
      UNIQUE(profile_id, achievement_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_profile_achievements_profile ON profile_achievements(profile_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_profile_achievements_unlocked ON profile_achievements(unlocked_at DESC)`);

  // Achievement progress tracking (for achievements requiring counts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS achievement_progress (
      profile_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      progress INTEGER DEFAULT 0,
      target INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(profile_id, achievement_id)
    )
  `);

  console.log('[Achievements] Schema initialized');
}

// Generate unique ID
function generateId() {
  return 'ach_' + crypto.randomBytes(8).toString('hex');
}

// Get all achievement definitions
function getAllAchievements() {
  return Object.values(ACHIEVEMENTS).map(a => ({
    ...a,
    rarity: RARITY[a.rarity]
  }));
}

// Get achievement by ID
function getAchievement(achievementId) {
  const ach = ACHIEVEMENTS[achievementId];
  if (!ach) return null;
  return { ...ach, rarity: RARITY[ach.rarity] };
}

// Check if profile has achievement
function hasAchievement(profileId, achievementId) {
  const result = db.prepare(`
    SELECT id FROM profile_achievements WHERE profile_id = ? AND achievement_id = ?
  `).get(profileId, achievementId);
  return !!result;
}

// Unlock achievement for profile
function unlockAchievement(profileId, achievementId) {
  if (hasAchievement(profileId, achievementId)) {
    return { alreadyUnlocked: true };
  }

  const achievement = ACHIEVEMENTS[achievementId];
  if (!achievement) {
    return { error: 'Unknown achievement' };
  }

  const id = generateId();
  const now = new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO profile_achievements (id, profile_id, achievement_id, unlocked_at)
      VALUES (?, ?, ?, ?)
    `).run(id, profileId, achievementId, now);

    return {
      success: true,
      achievement: {
        ...achievement,
        rarity: RARITY[achievement.rarity],
        unlockedAt: now
      }
    };
  } catch (err) {
    return { error: err.message };
  }
}

// Get profile's unlocked achievements
function getProfileAchievements(profileId) {
  const rows = db.prepare(`
    SELECT * FROM profile_achievements WHERE profile_id = ? ORDER BY unlocked_at DESC
  `).all(profileId);

  return rows.map(row => ({
    ...ACHIEVEMENTS[row.achievement_id],
    rarity: RARITY[ACHIEVEMENTS[row.achievement_id]?.rarity || 'common'],
    unlockedAt: row.unlocked_at,
    notified: !!row.notified
  })).filter(a => a.id); // Filter out any missing achievement defs
}

// Get profile's achievement points total
function getAchievementPoints(profileId) {
  const achievements = getProfileAchievements(profileId);
  return achievements.reduce((sum, a) => sum + (a.rarity?.points || 0), 0);
}

// Get achievement progress for profile
function getAchievementProgress(profileId) {
  const rows = db.prepare(`
    SELECT * FROM achievement_progress WHERE profile_id = ?
  `).all(profileId);

  const progress = {};
  for (const row of rows) {
    progress[row.achievement_id] = {
      current: row.progress,
      target: row.target,
      percentage: Math.min(100, Math.round((row.progress / row.target) * 100))
    };
  }
  return progress;
}

// Update achievement progress
function updateProgress(profileId, achievementId, progress, target) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO achievement_progress (profile_id, achievement_id, progress, target, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, achievement_id) DO UPDATE SET
      progress = ?,
      updated_at = ?
  `).run(profileId, achievementId, progress, target, now, progress, now);
}

// Mark achievement as notified
function markNotified(profileId, achievementId) {
  db.prepare(`
    UPDATE profile_achievements SET notified = 1 
    WHERE profile_id = ? AND achievement_id = ?
  `).run(profileId, achievementId);
}

// Get unnotified achievements for profile
function getUnnotifiedAchievements(profileId) {
  const rows = db.prepare(`
    SELECT * FROM profile_achievements 
    WHERE profile_id = ? AND notified = 0
    ORDER BY unlocked_at DESC
  `).all(profileId);

  return rows.map(row => ({
    ...ACHIEVEMENTS[row.achievement_id],
    rarity: RARITY[ACHIEVEMENTS[row.achievement_id]?.rarity || 'common'],
    unlockedAt: row.unlocked_at
  })).filter(a => a.id);
}

// Check and unlock achievements based on profile data
function checkAchievements(profileId, profileData = null) {
  const unlocked = [];
  
  // Get profile data if not provided
  if (!profileData) {
    const profileRow = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    if (!profileRow) return unlocked;
    profileData = {
      ...profileRow,
      verification: JSON.parse(profileRow.verification || '{}'),
      skills: JSON.parse(profileRow.skills || '[]'),
      links: JSON.parse(profileRow.links || '{}')
    };
  }

  // Helper to try unlocking
  const tryUnlock = (achId) => {
    if (!hasAchievement(profileId, achId)) {
      const result = unlockAchievement(profileId, achId);
      if (result.success) {
        unlocked.push(result.achievement);
      }
    }
  };

  // Profile created
  if (profileData.id) {
    tryUnlock('first_steps');
  }

  // Bio length
  if (profileData.bio && profileData.bio.length >= 50) {
    tryUnlock('bio_written');
  }

  // Skill count
  const skillCount = Array.isArray(profileData.skills) ? profileData.skills.length : 0;
  if (skillCount >= 5) tryUnlock('skill_collector');
  if (skillCount >= 10) tryUnlock('skill_master');

  // Project count (handle missing table gracefully)
  let projectCount = 0;
  try {
    projectCount = db.prepare('SELECT COUNT(*) as cnt FROM projects WHERE profile_id = ?').get(profileId)?.cnt || 0;
  } catch (e) {
    // Table may not exist yet
  }
  if (projectCount >= 1) tryUnlock('project_showcase');
  if (projectCount >= 5) tryUnlock('portfolio_builder');

  // Verification count
  const verifications = profileData.verification?.verifications || {};
  const verificationCount = Object.keys(verifications).length;
  if (verificationCount >= 1) tryUnlock('first_verification');
  if (verificationCount >= 3) tryUnlock('multi_verified');
  if (verificationCount >= 5) tryUnlock('fully_verified');

  // Specific verifications
  if (verifications.github) tryUnlock('github_verified');
  if (verifications.hyperliquid || verifications.solana || verifications.ethereum) tryUnlock('wallet_verified');
  if (verifications.hyperliquid || verifications.polymarket) tryUnlock('trader_verified');

  // Hyperliquid trades
  if (verifications.hyperliquid?.stats?.totalTrades >= 10) {
    tryUnlock('first_trade_verified');
  }
  if (verifications.hyperliquid?.stats?.totalVolume >= 10000) {
    tryUnlock('whale_trader');
  }

  // Jobs completed
  const jobsCompleted = db.prepare(`
    SELECT COUNT(*) as cnt FROM jobs WHERE selected_agent_id = ? AND status = 'completed'
  `).get(profileId)?.cnt || 0;
  if (jobsCompleted >= 1) tryUnlock('first_job');
  if (jobsCompleted >= 5) tryUnlock('job_hunter');
  if (jobsCompleted >= 25) tryUnlock('work_machine');
  if (jobsCompleted >= 100) tryUnlock('job_legend');

  // Jobs posted
  const jobsPosted = db.prepare(`
    SELECT COUNT(*) as cnt FROM jobs WHERE client_id = ?
  `).get(profileId)?.cnt || 0;
  if (jobsPosted >= 1) tryUnlock('first_client');

  // Total earnings
  const totalEarnings = db.prepare(`
    SELECT SUM(agreed_budget) as total FROM jobs 
    WHERE selected_agent_id = ? AND status = 'completed'
  `).get(profileId)?.total || 0;
  if (totalEarnings >= 500) tryUnlock('big_spender');

  // High value job
  const highValueJob = db.prepare(`
    SELECT id FROM jobs WHERE selected_agent_id = ? AND status = 'completed' AND agreed_budget >= 100 LIMIT 1
  `).get(profileId);
  if (highValueJob) tryUnlock('high_roller');

  // Five star rating
  const fiveStarCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM reviews WHERE reviewee_id = ? AND rating = 5
  `).get(profileId)?.cnt || 0;
  if (fiveStarCount >= 1) tryUnlock('five_star');

  // Average rating
  const ratingStats = db.prepare(`
    SELECT AVG(rating) as avg, COUNT(*) as cnt FROM reviews WHERE reviewee_id = ?
  `).get(profileId);
  if (ratingStats?.cnt >= 5 && ratingStats?.avg >= 4.5) {
    tryUnlock('consistent_quality');
  }

  // Endorsements received
  const endorsementsReceived = db.prepare(`
    SELECT COUNT(*) as cnt FROM endorsements WHERE target_id = ?
  `).get(profileId)?.cnt || 0;
  if (endorsementsReceived >= 1) tryUnlock('first_endorsement');
  if (endorsementsReceived >= 10) tryUnlock('well_connected');
  if (endorsementsReceived >= 50) tryUnlock('influencer');

  // Endorsements given
  const endorsementsGiven = db.prepare(`
    SELECT COUNT(*) as cnt FROM endorsements WHERE endorser_id = ?
  `).get(profileId)?.cnt || 0;
  if (endorsementsGiven >= 1) tryUnlock('endorser');
  if (endorsementsGiven >= 25) tryUnlock('community_builder');

  // Followers
  const followerCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM follows WHERE following_id = ?
  `).get(profileId)?.cnt || 0;
  if (followerCount >= 1) tryUnlock('first_follower');
  if (followerCount >= 50) tryUnlock('popular');

  // Team membership
  const teamMembership = db.prepare(`
    SELECT role FROM team_members WHERE profile_id = ? LIMIT 1
  `).get(profileId);
  if (teamMembership) {
    tryUnlock('team_player');
    if (teamMembership.role === 'owner') tryUnlock('team_leader');
  }

  // Early adopter (within 30 days of launch - Jan 28, 2026)
  const launchDate = new Date('2026-01-28');
  const createdAt = new Date(profileData.created_at || profileData.createdAt);
  const daysSinceLaunch = Math.floor((createdAt - launchDate) / (1000 * 60 * 60 * 24));
  if (daysSinceLaunch <= 30) {
    tryUnlock('early_adopter');
  }

  // OG Agent (first 100)
  const profileRank = db.prepare(`
    SELECT COUNT(*) as rank FROM profiles WHERE created_at < (SELECT created_at FROM profiles WHERE id = ?)
  `).get(profileId)?.rank || 0;
  if (profileRank < 100) {
    tryUnlock('og_agent');
  }

  return unlocked;
}

// Manually award special achievement
function awardAchievement(profileId, achievementId, reason = '') {
  const achievement = ACHIEVEMENTS[achievementId];
  if (!achievement) {
    return { error: 'Unknown achievement' };
  }

  if (achievement.criteria.type !== 'manual_award') {
    return { error: 'This achievement cannot be manually awarded' };
  }

  return unlockAchievement(profileId, achievementId);
}

// Get achievement leaderboard
function getAchievementLeaderboard(limit = 20) {
  const rows = db.prepare(`
    SELECT 
      p.id, p.name, p.avatar,
      COUNT(pa.id) as achievement_count,
      SUM(CASE 
        WHEN pa.achievement_id IN (${Object.entries(ACHIEVEMENTS)
          .filter(([k, v]) => v.rarity === 'common').map(([k]) => `'${k}'`).join(',')}) THEN 10
        WHEN pa.achievement_id IN (${Object.entries(ACHIEVEMENTS)
          .filter(([k, v]) => v.rarity === 'uncommon').map(([k]) => `'${k}'`).join(',')}) THEN 25
        WHEN pa.achievement_id IN (${Object.entries(ACHIEVEMENTS)
          .filter(([k, v]) => v.rarity === 'rare').map(([k]) => `'${k}'`).join(',')}) THEN 50
        WHEN pa.achievement_id IN (${Object.entries(ACHIEVEMENTS)
          .filter(([k, v]) => v.rarity === 'epic').map(([k]) => `'${k}'`).join(',')}) THEN 100
        WHEN pa.achievement_id IN (${Object.entries(ACHIEVEMENTS)
          .filter(([k, v]) => v.rarity === 'legendary').map(([k]) => `'${k}'`).join(',')}) THEN 250
        ELSE 10
      END) as total_points
    FROM profiles p
    LEFT JOIN profile_achievements pa ON p.id = pa.profile_id
    GROUP BY p.id
    HAVING achievement_count > 0
    ORDER BY total_points DESC, achievement_count DESC
    LIMIT ?
  `).all(limit);

  return rows;
}

// Get global achievement stats
function getAchievementStats() {
  const totalUnlocked = db.prepare('SELECT COUNT(*) as cnt FROM profile_achievements').get()?.cnt || 0;
  const uniqueHolders = db.prepare('SELECT COUNT(DISTINCT profile_id) as cnt FROM profile_achievements').get()?.cnt || 0;
  
  // Most unlocked achievements
  const popularAchievements = db.prepare(`
    SELECT achievement_id, COUNT(*) as count
    FROM profile_achievements
    GROUP BY achievement_id
    ORDER BY count DESC
    LIMIT 10
  `).all();

  // Rarest achievements (fewest unlocks)
  const rarestAchievements = db.prepare(`
    SELECT achievement_id, COUNT(*) as count
    FROM profile_achievements
    GROUP BY achievement_id
    ORDER BY count ASC
    LIMIT 10
  `).all();

  return {
    totalUnlocked,
    uniqueHolders,
    totalAchievements: Object.keys(ACHIEVEMENTS).length,
    popularAchievements: popularAchievements.map(p => ({
      ...ACHIEVEMENTS[p.achievement_id],
      unlockCount: p.count
    })),
    rarestAchievements: rarestAchievements.map(r => ({
      ...ACHIEVEMENTS[r.achievement_id],
      unlockCount: r.count
    }))
  };
}

// Render achievement badge HTML
function renderAchievementBadge(achievement, size = 'medium') {
  const sizes = {
    small: { icon: '16px', badge: '24px' },
    medium: { icon: '24px', badge: '40px' },
    large: { icon: '32px', badge: '56px' }
  };
  const s = sizes[size] || sizes.medium;
  const rarityColor = RARITY[achievement.rarity]?.color || '#71717a';

  return `
    <div class="achievement-badge achievement-${size}" 
         style="width: ${s.badge}; height: ${s.badge}; background: ${rarityColor}20; border: 2px solid ${rarityColor}; border-radius: 12px; display: flex; align-items: center; justify-content: center;"
         title="${achievement.name}: ${achievement.description}">
      <span style="font-size: ${s.icon};">${achievement.icon}</span>
    </div>
  `;
}

// Get achievement styles CSS
function getAchievementStyles() {
  return `
    .achievements-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }
    .achievement-card {
      display: flex;
      gap: 16px;
      padding: 16px;
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 12px;
      transition: all 0.2s;
    }
    .achievement-card:hover {
      border-color: #3f3f46;
      transform: translateY(-2px);
    }
    .achievement-card.locked {
      opacity: 0.5;
      filter: grayscale(1);
    }
    .achievement-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      flex-shrink: 0;
    }
    .achievement-content {
      flex: 1;
      min-width: 0;
    }
    .achievement-name {
      font-weight: 600;
      font-size: 14px;
      margin-bottom: 4px;
    }
    .achievement-description {
      font-size: 12px;
      color: #71717a;
      margin-bottom: 8px;
    }
    .achievement-meta {
      display: flex;
      gap: 8px;
      font-size: 11px;
    }
    .achievement-rarity {
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 500;
    }
    .achievement-points {
      color: #a78bfa;
    }
    .achievement-date {
      color: #52525b;
    }
    .achievements-summary {
      display: flex;
      gap: 24px;
      padding: 20px;
      background: linear-gradient(135deg, rgba(167,139,250,0.1), rgba(236,72,153,0.1));
      border: 1px solid #27272a;
      border-radius: 12px;
      margin-bottom: 24px;
    }
    .summary-stat {
      text-align: center;
    }
    .summary-value {
      font-size: 28px;
      font-weight: 700;
      color: #a78bfa;
    }
    .summary-label {
      font-size: 12px;
      color: #71717a;
    }
    .achievement-notification {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #18181b;
      border: 2px solid #a78bfa;
      border-radius: 16px;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      gap: 16px;
      animation: slideIn 0.3s ease-out;
      z-index: 1000;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
}

// Initialize on load
initializeAchievementsSchema();

module.exports = {
  ACHIEVEMENTS,
  CATEGORIES,
  RARITY,
  getAllAchievements,
  getAchievement,
  hasAchievement,
  unlockAchievement,
  getProfileAchievements,
  getAchievementPoints,
  getAchievementProgress,
  updateProgress,
  markNotified,
  getUnnotifiedAchievements,
  checkAchievements,
  awardAchievement,
  getAchievementLeaderboard,
  getAchievementStats,
  renderAchievementBadge,
  getAchievementStyles
};
