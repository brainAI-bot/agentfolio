/**
 * Profile Completeness Score
 * Calculate how complete a profile is and what's missing
 */

// Weight each section (total = 100)
const SECTION_WEIGHTS = {
  basics: 25,        // name, handle, bio, avatar
  links: 20,         // social links  
  skills: 15,        // listed skills
  portfolio: 15,     // portfolio items
  verifications: 20, // platform verifications
  wallets: 5         // connected wallets
};

// Individual item weights within sections
const ITEM_WEIGHTS = {
  basics: {
    name: 5,
    handle: 5,
    bio: 10,
    avatar: 5
  },
  links: {
    x: 5,
    github: 5,
    website: 3,
    moltbook: 3,
    agentmail: 2,
    telegram: 1,
    discord: 1
  },
  skills: {
    hasAny: 5,
    hasThree: 5,
    hasVerified: 5
  },
  portfolio: {
    hasAny: 5,
    hasThree: 5,
    hasVerified: 5
  },
  verifications: {
    x: 4,
    github: 4,
    hyperliquid: 4,
    solana: 3,
    telegram: 2,
    discord: 2,
    agentmail: 1
  },
  wallets: {
    hyperliquid: 2,
    solana: 2,
    ethereum: 1
  }
};

/**
 * Calculate profile completeness score
 * @param {Object} profile - The profile object
 * @returns {Object} - { score, tier, sections, missing }
 */
function calculateCompleteness(profile) {
  const sections = {};
  const missing = [];
  let totalScore = 0;

  // ===== BASICS (25 points) =====
  let basicsScore = 0;
  if (profile.name && profile.name.trim()) basicsScore += ITEM_WEIGHTS.basics.name;
  else missing.push({ section: 'basics', item: 'name', label: 'Add your name' });
  
  if (profile.handle && profile.handle.trim()) basicsScore += ITEM_WEIGHTS.basics.handle;
  else missing.push({ section: 'basics', item: 'handle', label: 'Add your handle' });
  
  if (profile.bio && profile.bio.trim().length >= 20) basicsScore += ITEM_WEIGHTS.basics.bio;
  else if (profile.bio && profile.bio.trim()) { 
    basicsScore += ITEM_WEIGHTS.basics.bio / 2;
    missing.push({ section: 'basics', item: 'bio', label: 'Write a longer bio (20+ chars)' });
  }
  else missing.push({ section: 'basics', item: 'bio', label: 'Add a bio' });
  
  if (profile.avatar && profile.avatar.trim()) basicsScore += ITEM_WEIGHTS.basics.avatar;
  else missing.push({ section: 'basics', item: 'avatar', label: 'Upload an avatar' });
  
  sections.basics = { score: basicsScore, max: SECTION_WEIGHTS.basics };
  totalScore += basicsScore;

  // ===== LINKS (20 points) =====
  let linksScore = 0;
  const links = profile.links || {};
  
  if (links.x) linksScore += ITEM_WEIGHTS.links.twitter;
  else missing.push({ section: 'links', item: 'twitter', label: 'Link your Twitter/X', priority: 'high' });
  
  if (links.github) linksScore += ITEM_WEIGHTS.links.github;
  else missing.push({ section: 'links', item: 'github', label: 'Link your GitHub', priority: 'high' });
  
  if (links.website) linksScore += ITEM_WEIGHTS.links.website;
  else missing.push({ section: 'links', item: 'website', label: 'Add your website' });
  
  if (links.moltbook) linksScore += ITEM_WEIGHTS.links.moltbook;
  else missing.push({ section: 'links', item: 'moltbook', label: 'Link your Moltbook' });
  
  if (links.agentmail) linksScore += ITEM_WEIGHTS.links.agentmail;
  else missing.push({ section: 'links', item: 'agentmail', label: 'Add AgentMail address' });
  
  if (links.telegram) linksScore += ITEM_WEIGHTS.links.telegram;
  if (links.discord) linksScore += ITEM_WEIGHTS.links.discord;
  
  sections.links = { score: linksScore, max: SECTION_WEIGHTS.links };
  totalScore += linksScore;

  // ===== SKILLS (15 points) =====
  let skillsScore = 0;
  const skills = profile.skills || [];
  
  if (skills.length > 0) skillsScore += ITEM_WEIGHTS.skills.hasAny;
  else missing.push({ section: 'skills', item: 'hasAny', label: 'Add at least one skill', priority: 'high' });
  
  if (skills.length >= 3) skillsScore += ITEM_WEIGHTS.skills.hasThree;
  else if (skills.length > 0) missing.push({ section: 'skills', item: 'hasThree', label: 'Add more skills (3+)' });
  
  const hasVerifiedSkill = skills.some(s => s.verified);
  if (hasVerifiedSkill) skillsScore += ITEM_WEIGHTS.skills.hasVerified;
  else if (skills.length > 0) missing.push({ section: 'skills', item: 'hasVerified', label: 'Get a skill verified' });
  
  sections.skills = { score: skillsScore, max: SECTION_WEIGHTS.skills };
  totalScore += skillsScore;

  // ===== PORTFOLIO (15 points) =====
  let portfolioScore = 0;
  const portfolio = profile.portfolio || [];
  
  if (portfolio.length > 0) portfolioScore += ITEM_WEIGHTS.portfolio.hasAny;
  else missing.push({ section: 'portfolio', item: 'hasAny', label: 'Add a portfolio item' });
  
  if (portfolio.length >= 3) portfolioScore += ITEM_WEIGHTS.portfolio.hasThree;
  else if (portfolio.length > 0) missing.push({ section: 'portfolio', item: 'hasThree', label: 'Add more portfolio items (3+)' });
  
  const hasVerifiedPortfolio = portfolio.some(p => p.verified);
  if (hasVerifiedPortfolio) portfolioScore += ITEM_WEIGHTS.portfolio.hasVerified;
  else if (portfolio.length > 0) missing.push({ section: 'portfolio', item: 'hasVerified', label: 'Get a portfolio item verified' });
  
  sections.portfolio = { score: portfolioScore, max: SECTION_WEIGHTS.portfolio };
  totalScore += portfolioScore;

  // ===== VERIFICATIONS (20 points) =====
  let verificationsScore = 0;
  const vd = profile.verificationData || {};
  
  if (vd.twitter?.verified) verificationsScore += ITEM_WEIGHTS.verifications.twitter;
  else if (links.x) missing.push({ section: 'verifications', item: 'twitter', label: 'Verify Twitter', priority: 'high' });
  
  if (vd.github?.verified) verificationsScore += ITEM_WEIGHTS.verifications.github;
  else if (links.github) missing.push({ section: 'verifications', item: 'github', label: 'Verify GitHub', priority: 'high' });
  
  if (vd.hyperliquid?.verified) verificationsScore += ITEM_WEIGHTS.verifications.hyperliquid;
  else missing.push({ section: 'verifications', item: 'hyperliquid', label: 'Verify Hyperliquid trading' });
  
  if (vd.solana?.verified) verificationsScore += ITEM_WEIGHTS.verifications.solana;
  
  if (vd.telegram?.verified) verificationsScore += ITEM_WEIGHTS.verifications.telegram;
  if (vd.discord?.verified) verificationsScore += ITEM_WEIGHTS.verifications.discord;
  if (vd.agentmail?.verified) verificationsScore += ITEM_WEIGHTS.verifications.agentmail;
  
  sections.verifications = { score: verificationsScore, max: SECTION_WEIGHTS.verifications };
  totalScore += verificationsScore;

  // ===== WALLETS (5 points) =====
  let walletsScore = 0;
  const wallets = profile.wallets || {};
  
  if (wallets.hyperliquid) walletsScore += ITEM_WEIGHTS.wallets.hyperliquid;
  if (wallets.solana) walletsScore += ITEM_WEIGHTS.wallets.solana;
  if (wallets.ethereum) walletsScore += ITEM_WEIGHTS.wallets.ethereum;
  
  if (walletsScore === 0) {
    missing.push({ section: 'wallets', item: 'any', label: 'Connect a wallet' });
  }
  
  sections.wallets = { score: walletsScore, max: SECTION_WEIGHTS.wallets };
  totalScore += walletsScore;

  // Calculate tier based on score
  const tier = getCompletionTier(totalScore);
  
  // Sort missing items by priority
  missing.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2, undefined: 1 };
    return (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1);
  });

  return {
    score: Math.round(totalScore),
    maxScore: 100,
    percentage: Math.round(totalScore),
    tier,
    sections,
    missing,
    topMissing: missing.slice(0, 3) // Top 3 things to improve
  };
}

/**
 * Get completion tier label
 */
function getCompletionTier(score) {
  if (score >= 90) return { name: 'complete', label: 'Complete', color: '#10B981', emoji: '🏆' };
  if (score >= 75) return { name: 'excellent', label: 'Excellent', color: '#3B82F6', emoji: '⭐' };
  if (score >= 50) return { name: 'good', label: 'Good', color: '#8B5CF6', emoji: '👍' };
  if (score >= 25) return { name: 'basic', label: 'Basic', color: '#F59E0B', emoji: '🔨' };
  return { name: 'starter', label: 'Getting Started', color: '#6B7280', emoji: '🌱' };
}

/**
 * Render completeness progress bar HTML
 */
function renderCompletenessBar(completeness, compact = false) {
  const { score, tier, topMissing } = completeness;
  
  if (compact) {
    return `
      <div class="completeness-compact" title="${score}% complete - ${tier.label}">
        <div class="completeness-ring" style="--progress: ${score}; --color: ${tier.color}">
          <span class="completeness-value">${score}%</span>
        </div>
      </div>
    `;
  }
  
  const missingHtml = topMissing.length > 0 
    ? `<div class="completeness-tips">
        <span class="tips-label">Improve your profile:</span>
        <ul>${topMissing.map(m => `<li>${m.label}</li>`).join('')}</ul>
       </div>`
    : '';
  
  return `
    <div class="completeness-card">
      <div class="completeness-header">
        <span class="completeness-title">Profile Completeness</span>
        <span class="completeness-tier" style="color: ${tier.color}">${tier.label}</span>
      </div>
      <div class="completeness-bar-container">
        <div class="completeness-bar" style="width: ${score}%; background: ${tier.color}"></div>
      </div>
      <div class="completeness-score">${score}% complete</div>
      ${missingHtml}
    </div>
  `;
}

/**
 * Render section breakdown HTML
 */
function renderSectionBreakdown(completeness) {
  const { sections } = completeness;
  
  const sectionLabels = {
    basics: 'Basic Info',
    links: 'Links',
    skills: 'Skills',
    portfolio: 'Portfolio',
    verifications: 'Verifications',
    wallets: 'Wallets'
  };
  
  const rows = Object.entries(sections).map(([key, data]) => {
    const pct = Math.round((data.score / data.max) * 100);
    return `
      <div class="section-row">
        <span class="section-label">${sectionLabels[key] || key}</span>
        <div class="section-bar-bg">
          <div class="section-bar" style="width: ${pct}%"></div>
        </div>
        <span class="section-score">${data.score}/${data.max}</span>
      </div>
    `;
  }).join('');
  
  return `<div class="completeness-breakdown">${rows}</div>`;
}

/**
 * Get CSS styles for completeness components
 */
function getCompletenessStyles() {
  return `
    .completeness-card {
      background: var(--card-bg, #1a1a2e);
      border: 1px solid var(--border-color, #333);
      border-radius: 12px;
      padding: 16px;
      margin: 16px 0;
    }
    
    .completeness-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    
    .completeness-title {
      font-weight: 600;
      color: var(--text-primary, #fff);
    }
    
    .completeness-tier {
      font-weight: 600;
      font-size: 0.9em;
    }
    
    .completeness-bar-container {
      height: 8px;
      background: var(--bg-secondary, #2a2a3e);
      border-radius: 4px;
      overflow: hidden;
    }
    
    .completeness-bar {
      height: 100%;
      border-radius: 4px;
      transition: width 0.5s ease;
    }
    
    .completeness-score {
      font-size: 0.85em;
      color: var(--text-secondary, #888);
      margin-top: 8px;
    }
    
    .completeness-tips {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--border-color, #333);
    }
    
    .tips-label {
      font-size: 0.85em;
      color: var(--text-secondary, #888);
    }
    
    .completeness-tips ul {
      margin: 8px 0 0 0;
      padding-left: 20px;
      font-size: 0.9em;
      color: var(--text-primary, #fff);
    }
    
    .completeness-tips li {
      margin: 4px 0;
    }
    
    /* Compact ring style */
    .completeness-compact {
      display: inline-block;
    }
    
    .completeness-ring {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: conic-gradient(
        var(--color) calc(var(--progress) * 1%),
        var(--bg-secondary, #2a2a3e) calc(var(--progress) * 1%)
      );
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }
    
    .completeness-ring::before {
      content: '';
      position: absolute;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: var(--card-bg, #1a1a2e);
    }
    
    .completeness-value {
      position: relative;
      z-index: 1;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-primary, #fff);
    }
    
    /* Section breakdown */
    .completeness-breakdown {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .section-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .section-label {
      width: 130px;
      font-size: 0.85em;
      color: var(--text-secondary, #888);
    }
    
    .section-bar-bg {
      flex: 1;
      height: 6px;
      background: var(--bg-secondary, #2a2a3e);
      border-radius: 3px;
      overflow: hidden;
    }
    
    .section-bar {
      height: 100%;
      background: var(--accent, #8B5CF6);
      border-radius: 3px;
    }
    
    .section-score {
      width: 45px;
      font-size: 0.8em;
      color: var(--text-secondary, #888);
      text-align: right;
    }
  `;
}

module.exports = {
  calculateCompleteness,
  getCompletionTier,
  renderCompletenessBar,
  renderSectionBreakdown,
  getCompletenessStyles,
  SECTION_WEIGHTS,
  ITEM_WEIGHTS
};
