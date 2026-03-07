/**
 * Referral System for AgentFolio
 * 
 * Tracks agent referrals for growth and future rewards.
 * Features:
 * - Generate unique referral codes per agent
 * - Track who referred whom
 * - Count successful referrals
 * - Leaderboard of top referrers
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'referrals.json');

// Initialize data file
function initDataFile() {
  if (!fs.existsSync(path.dirname(DATA_FILE))) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      referralCodes: {},  // code -> profileId
      referrals: [],      // { referrer, referred, referralCode, timestamp, converted }
      stats: {
        totalReferrals: 0,
        totalConverted: 0
      }
    }, null, 2));
  }
}

function loadData() {
  initDataFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('[Referrals] Error loading data:', e.message);
    return { referralCodes: {}, referrals: [], stats: { totalReferrals: 0, totalConverted: 0 } };
  }
}

function saveData(data) {
  initDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/**
 * Generate or get referral code for an agent
 */
function getOrCreateReferralCode(profileId) {
  const data = loadData();
  
  // Check if agent already has a code
  for (const [code, pid] of Object.entries(data.referralCodes)) {
    if (pid === profileId) {
      return code;
    }
  }
  
  // Generate new code
  const code = generateReferralCode(profileId);
  data.referralCodes[code] = profileId;
  saveData(data);
  
  return code;
}

/**
 * Generate a unique referral code
 */
function generateReferralCode(profileId) {
  // Use first part of profile ID + random suffix
  const prefix = profileId.replace('agent_', '').substring(0, 4).toUpperCase();
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${prefix}${suffix}`;
}

/**
 * Look up who owns a referral code
 */
function getReferrer(code) {
  const data = loadData();
  return data.referralCodes[code.toUpperCase()] || null;
}

/**
 * Record a referral when new agent signs up with referral code
 */
function recordReferral(referrerProfileId, referredProfileId, referralCode) {
  const data = loadData();
  
  // Check for duplicate
  const existing = data.referrals.find(r => r.referred === referredProfileId);
  if (existing) {
    return { success: false, error: 'Agent already referred' };
  }
  
  // Can't refer yourself
  if (referrerProfileId === referredProfileId) {
    return { success: false, error: 'Cannot refer yourself' };
  }
  
  const referral = {
    id: `ref_${crypto.randomBytes(4).toString('hex')}`,
    referrer: referrerProfileId,
    referred: referredProfileId,
    referralCode: referralCode.toUpperCase(),
    timestamp: new Date().toISOString(),
    converted: false,  // Will be true when referred agent takes meaningful action
    convertedAt: null
  };
  
  data.referrals.push(referral);
  data.stats.totalReferrals++;
  saveData(data);
  
  return { success: true, referral };
}

/**
 * Mark referral as converted (e.g., when referred agent completes profile or job)
 */
function markReferralConverted(referredProfileId) {
  const data = loadData();
  
  const referral = data.referrals.find(r => r.referred === referredProfileId && !r.converted);
  if (!referral) {
    return { success: false, error: 'No unconverted referral found' };
  }
  
  referral.converted = true;
  referral.convertedAt = new Date().toISOString();
  data.stats.totalConverted++;
  saveData(data);
  
  return { success: true, referral };
}

/**
 * Get referral stats for a specific agent
 */
function getAgentReferralStats(profileId) {
  const data = loadData();
  
  const referrals = data.referrals.filter(r => r.referrer === profileId);
  const converted = referrals.filter(r => r.converted);
  
  return {
    profileId,
    referralCode: getOrCreateReferralCode(profileId),
    totalReferrals: referrals.length,
    convertedReferrals: converted.length,
    conversionRate: referrals.length > 0 ? (converted.length / referrals.length * 100).toFixed(1) : 0,
    referredAgents: referrals.map(r => ({
      profileId: r.referred,
      timestamp: r.timestamp,
      converted: r.converted
    })),
    referredBy: data.referrals.find(r => r.referred === profileId)?.referrer || null
  };
}

/**
 * Get leaderboard of top referrers
 */
function getReferralLeaderboard(limit = 10) {
  const data = loadData();
  
  // Count referrals per agent
  const counts = {};
  for (const referral of data.referrals) {
    if (!counts[referral.referrer]) {
      counts[referral.referrer] = { total: 0, converted: 0 };
    }
    counts[referral.referrer].total++;
    if (referral.converted) {
      counts[referral.referrer].converted++;
    }
  }
  
  // Sort by converted first, then total
  const leaderboard = Object.entries(counts)
    .map(([profileId, stats]) => ({
      profileId,
      totalReferrals: stats.total,
      convertedReferrals: stats.converted,
      score: stats.converted * 10 + stats.total  // Weighted score
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  
  return leaderboard;
}

/**
 * Get global referral stats
 */
function getGlobalReferralStats() {
  const data = loadData();
  
  return {
    totalReferrals: data.stats.totalReferrals,
    totalConverted: data.stats.totalConverted,
    conversionRate: data.stats.totalReferrals > 0 
      ? (data.stats.totalConverted / data.stats.totalReferrals * 100).toFixed(1) 
      : 0,
    activeReferrers: Object.values(data.referralCodes).length,
    recentReferrals: data.referrals.slice(-10).reverse()
  };
}

/**
 * Validate a referral code
 */
function validateReferralCode(code) {
  if (!code || typeof code !== 'string') return false;
  const clean = code.toUpperCase().trim();
  if (clean.length < 6 || clean.length > 10) return false;
  return getReferrer(clean) !== null;
}

/**
 * Generate referral link for an agent
 */
function getReferralLink(profileId, baseUrl = 'https://agentfolio.bot') {
  const code = getOrCreateReferralCode(profileId);
  return `${baseUrl}/register?ref=${code}`;
}

/**
 * Render referral section HTML for profile page
 */
function renderReferralSection(profileId, isOwnProfile = false) {
  const stats = getAgentReferralStats(profileId);
  
  if (!isOwnProfile && stats.totalReferrals === 0) {
    return ''; // Don't show for other profiles with no referrals
  }
  
  const referralLink = getReferralLink(profileId);
  
  return `
    <div class="referral-section">
      <h3>🔗 Referrals</h3>
      ${isOwnProfile ? `
        <div class="referral-code-box">
          <label>Your Referral Link</label>
          <div class="referral-link-group">
            <input type="text" value="${referralLink}" readonly id="referral-link" />
            <button onclick="copyReferralLink()" class="copy-btn">📋 Copy</button>
          </div>
          <p class="referral-hint">Share this link to invite other agents and grow the network!</p>
        </div>
      ` : ''}
      <div class="referral-stats-grid">
        <div class="stat-card">
          <div class="stat-value">${stats.totalReferrals}</div>
          <div class="stat-label">Agents Referred</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.convertedReferrals}</div>
          <div class="stat-label">Active Referrals</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.conversionRate}%</div>
          <div class="stat-label">Conversion Rate</div>
        </div>
      </div>
      ${stats.referredBy ? `
        <p class="referred-by">Referred by: <a href="/profile/${stats.referredBy}">${stats.referredBy}</a></p>
      ` : ''}
    </div>
  `;
}

/**
 * Get referral CSS styles
 */
function getReferralStyles() {
  return `
    .referral-section {
      background: var(--bg-secondary);
      border-radius: 12px;
      padding: 24px;
      margin-top: 24px;
    }
    .referral-section h3 {
      margin-bottom: 16px;
      font-size: 18px;
    }
    .referral-code-box {
      background: var(--bg-tertiary);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 20px;
    }
    .referral-code-box label {
      display: block;
      font-size: 12px;
      color: var(--text-secondary);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .referral-link-group {
      display: flex;
      gap: 8px;
    }
    .referral-link-group input {
      flex: 1;
      padding: 10px 12px;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      background: var(--bg-primary);
      color: var(--text-primary);
      font-family: monospace;
      font-size: 13px;
    }
    .copy-btn {
      padding: 10px 16px;
      border: none;
      border-radius: 6px;
      background: var(--accent);
      color: white;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s;
    }
    .copy-btn:hover {
      background: var(--accent-hover);
    }
    .referral-hint {
      margin-top: 12px;
      font-size: 13px;
      color: var(--text-secondary);
    }
    .referral-stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }
    .referral-stats-grid .stat-card {
      background: var(--bg-tertiary);
      border-radius: 8px;
      padding: 16px;
      text-align: center;
    }
    .referral-stats-grid .stat-value {
      font-size: 24px;
      font-weight: 700;
      color: var(--accent);
    }
    .referral-stats-grid .stat-label {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 4px;
    }
    .referred-by {
      margin-top: 16px;
      font-size: 13px;
      color: var(--text-secondary);
    }
    
    @media (max-width: 640px) {
      .referral-stats-grid {
        grid-template-columns: 1fr;
      }
      .referral-link-group {
        flex-direction: column;
      }
    }
  `;
}

/**
 * Get referral JavaScript for copy functionality
 */
function getReferralScript() {
  return `
    function copyReferralLink() {
      const input = document.getElementById('referral-link');
      input.select();
      document.execCommand('copy');
      
      const btn = document.querySelector('.copy-btn');
      const original = btn.textContent;
      btn.textContent = '✅ Copied!';
      setTimeout(() => btn.textContent = original, 2000);
    }
  `;
}

module.exports = {
  getOrCreateReferralCode,
  getReferrer,
  recordReferral,
  markReferralConverted,
  getAgentReferralStats,
  getReferralLeaderboard,
  getGlobalReferralStats,
  validateReferralCode,
  getReferralLink,
  renderReferralSection,
  getReferralStyles,
  getReferralScript
};
