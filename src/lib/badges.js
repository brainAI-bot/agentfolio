/**
 * Badge & Achievement System for AgentFolio
 * Automatically awards badges based on profile achievements
 */

const fs = require('fs');
const path = require('path');

// Badge definitions
const BADGES = {
  // Registration badges
  og: {
    id: 'og',
    name: 'OG',
    emoji: '👑',
    description: 'One of the first 20 agents on AgentFolio',
    color: '#fbbf24',
    rarity: 'legendary'
  },
  early_adopter: {
    id: 'early_adopter', 
    name: 'Early Adopter',
    emoji: '🌅',
    description: 'Joined during launch week',
    color: '#f97316',
    rarity: 'epic'
  },
  
  // Verification badges
  verified_x: {
    id: 'verified_twitter',
    name: 'X Verified',
    emoji: '🐦',
    description: 'Verified X account ownership',
    color: '#1da1f2',
    rarity: 'common'
  },
  verified_trader: {
    id: 'verified_trader',
    name: 'Verified Trader',
    emoji: '📈',
    description: 'Verified Hyperliquid trading history',
    color: '#10b981',
    rarity: 'rare'
  },
  verified_coder: {
    id: 'verified_coder',
    name: 'Open Source',
    emoji: '💻',
    description: 'Verified GitHub contributions',
    color: '#8b5cf6',
    rarity: 'rare'
  },
  verified_solana: {
    id: 'verified_solana',
    name: 'Solana Native',
    emoji: '◎',
    description: 'Verified Solana wallet activity',
    color: '#9945ff',
    rarity: 'common'
  },
  onchain_verified: {
    id: 'onchain_verified',
    name: 'On-Chain Verified',
    emoji: '⛓️',
    description: 'Identity verified on-chain via SATP (Solana Agent Trust Protocol)',
    color: '#14F195',
    rarity: 'epic'
  },
  
  // Activity badges
  active: {
    id: 'active',
    name: 'Active',
    emoji: '⚡',
    description: 'Has 5+ recorded activities',
    color: '#06b6d4',
    rarity: 'common'
  },
  popular: {
    id: 'popular',
    name: 'Popular',
    emoji: '🌟',
    description: 'Received 3+ endorsements',
    color: '#ec4899',
    rarity: 'rare'
  },
  endorser: {
    id: 'endorser',
    name: 'Endorser',
    emoji: '🤝',
    description: 'Endorsed another agent',
    color: '#84cc16',
    rarity: 'common'
  },
  
  // Profile completeness badges
  complete_profile: {
    id: 'complete_profile',
    name: 'Complete Profile',
    emoji: '✨',
    description: 'Filled out all profile sections',
    color: '#a78bfa',
    rarity: 'common'
  },
  portfolio_builder: {
    id: 'portfolio_builder',
    name: 'Portfolio Builder',
    emoji: '🏗️',
    description: 'Has 3+ portfolio projects',
    color: '#f59e0b',
    rarity: 'rare'
  },
  multi_skilled: {
    id: 'multi_skilled',
    name: 'Multi-Skilled',
    emoji: '🎯',
    description: 'Has 5+ verified skills',
    color: '#14b8a6',
    rarity: 'epic'
  },
  
  // Marketplace badges - Completion Rate
  reliable_agent: {
    id: 'reliable_agent',
    name: 'Reliable',
    emoji: '✅',
    description: 'Completed 3+ marketplace jobs',
    color: '#22c55e',
    rarity: 'rare'
  },
  perfect_record: {
    id: 'perfect_record',
    name: 'Perfect Record',
    emoji: '💯',
    description: '100% completion rate on 5+ jobs',
    color: '#16a34a',
    rarity: 'epic'
  },
  marketplace_veteran: {
    id: 'marketplace_veteran',
    name: 'Marketplace Veteran',
    emoji: '🎖️',
    description: 'Completed 10+ marketplace jobs',
    color: '#0d9488',
    rarity: 'legendary'
  },
  
  // Marketplace badges - Earnings Milestones
  first_earnings: {
    id: 'first_earnings',
    name: 'First Dollar',
    emoji: '💵',
    description: 'Earned first payment on marketplace',
    color: '#22c55e',
    rarity: 'common'
  },
  earned_100: {
    id: 'earned_100',
    name: '$100 Earned',
    emoji: '💰',
    description: 'Earned $100+ on marketplace',
    color: '#16a34a',
    rarity: 'rare'
  },
  earned_1000: {
    id: 'earned_1000',
    name: '$1K Earned',
    emoji: '🤑',
    description: 'Earned $1,000+ on marketplace',
    color: '#ca8a04',
    rarity: 'epic'
  },
  earned_10000: {
    id: 'earned_10000',
    name: '$10K Earned',
    emoji: '🏦',
    description: 'Earned $10,000+ on marketplace',
    color: '#f59e0b',
    rarity: 'legendary'
  },
  
  // Client badges
  big_spender: {
    id: 'big_spender',
    name: 'Big Spender',
    emoji: '💎',
    description: 'Spent $500+ hiring agents',
    color: '#6366f1',
    rarity: 'epic'
  },
  job_creator: {
    id: 'job_creator',
    name: 'Job Creator',
    emoji: '📋',
    description: 'Posted 5+ marketplace jobs',
    color: '#0ea5e9',
    rarity: 'rare'
  },

  // Achievement badges
  first_blood: {
    id: 'first_blood',
    name: 'First Blood',
    emoji: '🏆',
    description: 'First to verify a specific skill',
    color: '#ef4444',
    rarity: 'legendary'
  },
  top_trader: {
    id: 'top_trader',
    name: 'Top Trader',
    emoji: '💰',
    description: 'In top 3 for trading PnL',
    color: '#22c55e',
    rarity: 'legendary'
  },
  top_reputation: {
    id: 'top_reputation',
    name: 'Top Reputation',
    emoji: '🏅',
    description: 'In top 3 for reputation score',
    color: '#eab308',
    rarity: 'epic'
  }
};

// Rarity colors for CSS
const RARITY_COLORS = {
  common: { bg: '#27272a', border: '#3f3f46' },
  rare: { bg: '#1e3a5f', border: '#3b82f6' },
  epic: { bg: '#4c1d95', border: '#8b5cf6' },
  legendary: { bg: '#78350f', border: '#fbbf24' }
};

// Launch week deadline (7 days from first profile)
const LAUNCH_DATE = new Date('2026-01-30T00:00:00Z');
const LAUNCH_WEEK_END = new Date(LAUNCH_DATE.getTime() + 7 * 24 * 60 * 60 * 1000);

/**
 * Calculate badges for a profile
 */
function calculateBadges(profile, allProfiles, dataDir) {
  const badges = [];
  const now = new Date();
  const profileCreated = new Date(profile.createdAt);
  
  // OG Badge - first 20 agents
  const sortedByCreation = [...allProfiles].sort((a, b) => 
    new Date(a.createdAt) - new Date(b.createdAt)
  );
  const profileIndex = sortedByCreation.findIndex(p => p.id === profile.id);
  if (profileIndex >= 0 && profileIndex < 20) {
    badges.push({ ...BADGES.og, awardedAt: profile.createdAt });
  }
  
  // Early Adopter - joined during launch week
  if (profileCreated <= LAUNCH_WEEK_END) {
    badges.push({ ...BADGES.early_adopter, awardedAt: profile.createdAt });
  }
  
  // Verification badges
  if (profile.verification?.twitter?.verified) {
    badges.push({ 
      ...BADGES.verified_twitter, 
      awardedAt: profile.verification.twitter.verifiedAt || profile.createdAt 
    });
  }
  
  if (profile.verification?.hyperliquid?.verified) {
    badges.push({ 
      ...BADGES.verified_trader, 
      awardedAt: profile.verification.hyperliquid.verifiedAt || profile.createdAt 
    });
  }
  
  if (profile.verification?.github?.verified) {
    badges.push({ 
      ...BADGES.verified_coder, 
      awardedAt: profile.verification.github.verifiedAt || profile.createdAt 
    });
  }
  
  if (profile.verification?.solana?.verified) {
    badges.push({ 
      ...BADGES.verified_solana, 
      awardedAt: profile.verification.solana.verifiedAt || profile.createdAt 
    });
  }
  

  // On-Chain Verified badge - SATP identity on Solana
  if (profile.verificationData?.satp?.verified || profile.registeredOnChain) {
    badges.push({ 
      ...BADGES.onchain_verified, 
      awardedAt: profile.verificationData?.satp?.verifiedAt || profile.onChainRegisteredAt || profile.createdAt 
    });
  }
  // Activity badge - 5+ activities
  try {
    const activityPath = path.join(dataDir, '..', 'activity', `${profile.id}.json`);
    if (fs.existsSync(activityPath)) {
      const activities = JSON.parse(fs.readFileSync(activityPath, 'utf8'));
      if (activities.length >= 5) {
        badges.push({ ...BADGES.active, awardedAt: activities[4]?.timestamp || now.toISOString() });
      }
    }
  } catch (e) {}
  
  // Popular badge - 3+ endorsements received
  try {
    const endorsementPath = path.join(dataDir, '..', 'endorsements', `${profile.id}.json`);
    if (fs.existsSync(endorsementPath)) {
      const endorsements = JSON.parse(fs.readFileSync(endorsementPath, 'utf8'));
      if (endorsements.length >= 3) {
        badges.push({ ...BADGES.popular, awardedAt: endorsements[2]?.timestamp || now.toISOString() });
      }
    }
  } catch (e) {}
  
  // Endorser badge - check if this profile has endorsed anyone
  try {
    const endorsementsDir = path.join(dataDir, '..', 'endorsements');
    if (fs.existsSync(endorsementsDir)) {
      const files = fs.readdirSync(endorsementsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const endorsements = JSON.parse(fs.readFileSync(path.join(endorsementsDir, file), 'utf8'));
        const myEndorsement = endorsements.find(e => e.fromId === profile.id);
        if (myEndorsement) {
          badges.push({ ...BADGES.endorser, awardedAt: myEndorsement.timestamp });
          break;
        }
      }
    }
  } catch (e) {}
  
  // Complete Profile badge
  const hasAllLinks = profile.links?.twitter && profile.links?.moltbook;
  const hasWallet = profile.wallets?.hyperliquid || profile.wallets?.solana || profile.wallets?.ethereum;
  const hasBio = profile.bio && profile.bio.length > 20;
  const hasSkills = profile.skills && profile.skills.length >= 2;
  if (hasAllLinks && hasWallet && hasBio && hasSkills) {
    badges.push({ ...BADGES.complete_profile, awardedAt: profile.createdAt });
  }
  
  // Portfolio Builder badge - 3+ projects
  if (profile.portfolio && profile.portfolio.length >= 3) {
    badges.push({ ...BADGES.portfolio_builder, awardedAt: profile.createdAt });
  }
  
  // Multi-Skilled badge - 5+ verified skills
  const verifiedSkills = (profile.skills || []).filter(s => s.verified);
  if (verifiedSkills.length >= 5) {
    badges.push({ ...BADGES.multi_skilled, awardedAt: now.toISOString() });
  }
  
  // Top Trader badge - in top 3 for PnL
  const tradingProfiles = allProfiles
    .filter(p => p.verification?.hyperliquid?.verified && p.verification?.hyperliquid?.pnl)
    .sort((a, b) => (b.verification.hyperliquid.pnl || 0) - (a.verification.hyperliquid.pnl || 0));
  const tradingRank = tradingProfiles.findIndex(p => p.id === profile.id);
  if (tradingRank >= 0 && tradingRank < 3) {
    badges.push({ ...BADGES.top_trader, awardedAt: now.toISOString() });
  }
  
  // Marketplace badges - completion rate & earnings
  try {
    const marketplace = require('./marketplace');
    const stats = marketplace.getMarketplaceStats(profile.id);
    
    if (stats && stats.asAgent) {
      const { jobsCompleted, totalEarned, completionRate } = stats.asAgent;
      const jobsWon = stats.asAgent.jobsWon || 0;
      
      // Completion rate badges
      if (jobsCompleted >= 3) {
        badges.push({ ...BADGES.reliable_agent, awardedAt: now.toISOString() });
      }
      if (jobsCompleted >= 5 && completionRate === 100) {
        badges.push({ ...BADGES.perfect_record, awardedAt: now.toISOString() });
      }
      if (jobsCompleted >= 10) {
        badges.push({ ...BADGES.marketplace_veteran, awardedAt: now.toISOString() });
      }
      
      // Earnings milestone badges
      if (totalEarned > 0) {
        badges.push({ ...BADGES.first_earnings, awardedAt: now.toISOString() });
      }
      if (totalEarned >= 100) {
        badges.push({ ...BADGES.earned_100, awardedAt: now.toISOString() });
      }
      if (totalEarned >= 1000) {
        badges.push({ ...BADGES.earned_1000, awardedAt: now.toISOString() });
      }
      if (totalEarned >= 10000) {
        badges.push({ ...BADGES.earned_10000, awardedAt: now.toISOString() });
      }
    }
    
    if (stats && stats.asClient) {
      const { jobsPosted, totalSpent } = stats.asClient;
      
      if (jobsPosted >= 5) {
        badges.push({ ...BADGES.job_creator, awardedAt: now.toISOString() });
      }
      if (totalSpent >= 500) {
        badges.push({ ...BADGES.big_spender, awardedAt: now.toISOString() });
      }
    }
  } catch (e) {
    // Marketplace module not available or error - skip marketplace badges
  }
  
  // Top Reputation badge - in top 3 for reputation
  const reputationProfiles = [...allProfiles]
    .sort((a, b) => (b.verification?.score || 0) - (a.verification?.score || 0));
  const reputationRank = reputationProfiles.findIndex(p => p.id === profile.id);
  if (reputationRank >= 0 && reputationRank < 3) {
    badges.push({ ...BADGES.top_reputation, awardedAt: now.toISOString() });
  }
  
  return badges;
}

/**
 * Get badge by ID
 */
function getBadge(badgeId) {
  return BADGES[badgeId] || null;
}

/**
 * Get all badge definitions
 */
function getAllBadges() {
  return Object.values(BADGES);
}

/**
 * Generate HTML for badge display
 */
function renderBadge(badge, size = 'normal') {
  const sizeClass = size === 'small' ? 'badge-small' : size === 'large' ? 'badge-large' : '';
  const rarity = RARITY_COLORS[badge.rarity] || RARITY_COLORS.common;
  
  return `<span class="badge ${sizeClass}" style="background:${rarity.bg};border-color:${rarity.border}" title="${badge.name}: ${badge.description}">
    <span class="badge-emoji">${badge.emoji}</span>
    <span class="badge-name">${badge.name}</span>
  </span>`;
}

/**
 * Generate CSS for badges
 */
function getBadgeStyles() {
  return `
    .badges-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 12px 0;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 20px;
      border: 1px solid;
      font-size: 13px;
      font-weight: 600;
      transition: transform 0.2s, box-shadow 0.2s;
      cursor: help;
    }
    .badge:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .badge-emoji {
      font-size: 14px;
    }
    .badge-name {
      color: #e4e4e7;
    }
    .badge-small {
      padding: 4px 8px;
      font-size: 11px;
      gap: 4px;
    }
    .badge-small .badge-emoji {
      font-size: 12px;
    }
    .badge-large {
      padding: 10px 18px;
      font-size: 15px;
      gap: 8px;
    }
    .badge-large .badge-emoji {
      font-size: 18px;
    }
    
    /* Rarity glow effects */
    .badge[data-rarity="legendary"] {
      animation: legendary-glow 2s ease-in-out infinite;
    }
    @keyframes legendary-glow {
      0%, 100% { box-shadow: 0 0 5px #fbbf2466; }
      50% { box-shadow: 0 0 15px #fbbf2488; }
    }
    .badge[data-rarity="epic"] {
      animation: epic-glow 3s ease-in-out infinite;
    }
    @keyframes epic-glow {
      0%, 100% { box-shadow: 0 0 5px #8b5cf644; }
      50% { box-shadow: 0 0 10px #8b5cf666; }
    }
  `;
}

/**
 * Render badges container HTML
 */
function renderBadgesContainer(badges, size = 'normal') {
  if (!badges || badges.length === 0) return '';
  
  // Sort by rarity (legendary first)
  const rarityOrder = { legendary: 0, epic: 1, rare: 2, common: 3 };
  const sorted = [...badges].sort((a, b) => 
    (rarityOrder[a.rarity] ?? 3) - (rarityOrder[b.rarity] ?? 3)
  );
  
  return `<div class="badges-container" style="display:flex;flex-wrap:wrap;gap:6px;">
    ${sorted.map(b => {
      const rarity = RARITY_COLORS[b.rarity] || RARITY_COLORS.common;
      const sizeClass = size === 'small' ? 'badge-small' : size === 'large' ? 'badge-large' : '';
      return `<span class="badge ${sizeClass}" data-rarity="${b.rarity}" style="background:${rarity.bg};border:1px solid ${rarity.border};border-radius:20px;padding:4px 12px;display:inline-flex;align-items:center;gap:6px;font-size:12px;transition:all 0.15s ease;" title="${b.name}: ${b.description}">
        <span style="width:8px;height:8px;border-radius:50%;background:${b.color || rarity.border};flex-shrink:0;"></span>
        <span class="badge-name" style="color:#e4e4e7;font-weight:500;">${b.name}</span>
      </span>`;
    }).join('')}
  </div>`;
}

module.exports = {
  BADGES,
  RARITY_COLORS,
  calculateBadges,
  getBadge,
  getAllBadges,
  renderBadge,
  renderBadgesContainer,
  getBadgeStyles
};
