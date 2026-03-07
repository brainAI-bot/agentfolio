/**
 * Premium Profiles System for AgentFolio
 * Tiers: free, pro, elite
 * Features: custom badges, featured placement, priority support, analytics
 */

const path = require('path');
const crypto = require('crypto');

// Lazy DB init
let db;
function getDb() {
  if (!db) {
    const Database = require('better-sqlite3');
    db = Database(path.join(__dirname, '..', '..', 'data', 'agentfolio.db'));
    initSchema();
  }
  return db;
}

function initSchema() {
  // Add premium_tier column if missing
  try {
    db.prepare("ALTER TABLE profiles ADD COLUMN premium_tier TEXT DEFAULT 'free'").run();
  } catch (e) { /* column exists */ }
  try {
    db.prepare("ALTER TABLE profiles ADD COLUMN premium_expires_at TEXT").run();
  } catch (e) { /* column exists */ }
  try {
    db.prepare("ALTER TABLE profiles ADD COLUMN custom_badges TEXT DEFAULT '[]'").run();
  } catch (e) { /* column exists */ }

  // Premium purchases/history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS premium_purchases (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      tier TEXT NOT NULL,
      amount_usd REAL NOT NULL,
      duration_days INTEGER NOT NULL,
      payment_method TEXT,
      payment_ref TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `);

  // Custom badge definitions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_badge_defs (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL,
      description TEXT DEFAULT '',
      color TEXT DEFAULT '#8b5cf6',
      created_at TEXT NOT NULL
    )
  `);
}

// Tier definitions
const TIERS = {
  free: {
    id: 'free',
    name: 'Free',
    emoji: '',
    price_monthly: 0,
    price_yearly: 0,
    features: {
      custom_badges: 0,
      featured_placement: false,
      priority_support: false,
      analytics_dashboard: false,
      custom_theme: false,
      verified_checkmark: false,
      profile_banner: false,
      priority_matching: false,
      api_rate_limit: 100
    }
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    emoji: '⭐',
    price_monthly: 9.99,
    price_yearly: 99,
    features: {
      custom_badges: 3,
      featured_placement: false,
      priority_support: true,
      analytics_dashboard: true,
      custom_theme: true,
      verified_checkmark: true,
      profile_banner: true,
      priority_matching: true,
      api_rate_limit: 1000
    }
  },
  elite: {
    id: 'elite',
    name: 'Elite',
    emoji: '💎',
    price_monthly: 29.99,
    price_yearly: 299,
    features: {
      custom_badges: 10,
      featured_placement: true,
      priority_support: true,
      analytics_dashboard: true,
      custom_theme: true,
      verified_checkmark: true,
      profile_banner: true,
      priority_matching: true,
      api_rate_limit: 10000
    }
  }
};

/**
 * Get a profile's premium tier
 */
function getProfileTier(profileId) {
  const d = getDb();
  const row = d.prepare('SELECT premium_tier, premium_expires_at FROM profiles WHERE id = ?').get(profileId);
  if (!row) return 'free';
  
  // Check expiry
  if (row.premium_tier !== 'free' && row.premium_expires_at) {
    if (new Date(row.premium_expires_at) < new Date()) {
      // Expired - downgrade
      d.prepare("UPDATE profiles SET premium_tier = 'free', premium_expires_at = NULL WHERE id = ?").run(profileId);
      return 'free';
    }
  }
  return row.premium_tier || 'free';
}

/**
 * Get tier info with features
 */
function getTierInfo(tier) {
  return TIERS[tier] || TIERS.free;
}

/**
 * Upgrade a profile to a premium tier
 */
function upgradeTier(profileId, tier, durationDays, paymentMethod, paymentRef, amountUsd) {
  const d = getDb();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
  const purchaseId = `purchase_${crypto.randomBytes(8).toString('hex')}`;

  d.prepare('UPDATE profiles SET premium_tier = ?, premium_expires_at = ? WHERE id = ?')
    .run(tier, expiresAt.toISOString(), profileId);

  d.prepare(`INSERT INTO premium_purchases (id, profile_id, tier, amount_usd, duration_days, payment_method, payment_ref, status, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`).run(
    purchaseId, profileId, tier, amountUsd || 0, durationDays,
    paymentMethod || 'manual', paymentRef || null,
    now.toISOString(), expiresAt.toISOString()
  );

  return { purchaseId, tier, expiresAt: expiresAt.toISOString() };
}

/**
 * Downgrade to free
 */
function downgradeTier(profileId) {
  const d = getDb();
  d.prepare("UPDATE profiles SET premium_tier = 'free', premium_expires_at = NULL, custom_badges = '[]' WHERE id = ?").run(profileId);
}

/**
 * Get custom badges for a profile
 */
function getCustomBadges(profileId) {
  const d = getDb();
  const rows = d.prepare('SELECT * FROM custom_badge_defs WHERE profile_id = ? ORDER BY created_at ASC').all(profileId);
  return rows;
}

/**
 * Add a custom badge to a profile
 */
function addCustomBadge(profileId, name, emoji, description, color) {
  const d = getDb();
  const tier = getProfileTier(profileId);
  const tierInfo = getTierInfo(tier);
  const existing = getCustomBadges(profileId);

  if (existing.length >= tierInfo.features.custom_badges) {
    throw new Error(`${tierInfo.name} tier allows max ${tierInfo.features.custom_badges} custom badges`);
  }

  // Validate
  if (!name || name.length > 30) throw new Error('Badge name required (max 30 chars)');
  if (!emoji || emoji.length > 10) throw new Error('Badge emoji required');

  const badgeId = `cb_${crypto.randomBytes(6).toString('hex')}`;
  d.prepare(`INSERT INTO custom_badge_defs (id, profile_id, name, emoji, description, color, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    badgeId, profileId, name, emoji, description || '', color || '#8b5cf6', new Date().toISOString()
  );

  // Update profile's custom_badges array
  const badges = [...existing.map(b => b.id), badgeId];
  d.prepare('UPDATE profiles SET custom_badges = ? WHERE id = ?').run(JSON.stringify(badges), profileId);

  return { id: badgeId, name, emoji, description, color };
}

/**
 * Remove a custom badge
 */
function removeCustomBadge(profileId, badgeId) {
  const d = getDb();
  d.prepare('DELETE FROM custom_badge_defs WHERE id = ? AND profile_id = ?').run(badgeId, profileId);
  
  const remaining = getCustomBadges(profileId).map(b => b.id);
  d.prepare('UPDATE profiles SET custom_badges = ? WHERE id = ?').run(JSON.stringify(remaining), profileId);
}

/**
 * Check if a profile has a specific premium feature
 */
function hasFeature(profileId, featureName) {
  const tier = getProfileTier(profileId);
  const info = getTierInfo(tier);
  return !!info.features[featureName];
}

/**
 * Get purchase history for a profile
 */
function getPurchaseHistory(profileId) {
  const d = getDb();
  return d.prepare('SELECT * FROM premium_purchases WHERE profile_id = ? ORDER BY created_at DESC').all(profileId);
}

/**
 * Get premium stats
 */
function getPremiumStats() {
  const d = getDb();
  const stats = {};
  for (const tier of ['free', 'pro', 'elite']) {
    const row = d.prepare('SELECT COUNT(*) as count FROM profiles WHERE premium_tier = ?').get(tier);
    stats[tier] = row?.count || 0;
  }
  const freeRow = d.prepare("SELECT COUNT(*) as count FROM profiles WHERE premium_tier IS NULL OR premium_tier = 'free'").get();
  stats.free = freeRow?.count || 0;
  stats.total_revenue = d.prepare('SELECT COALESCE(SUM(amount_usd), 0) as total FROM premium_purchases').get()?.total || 0;
  return stats;
}

/**
 * Render premium badge next to agent name
 */
function renderPremiumBadge(tier) {
  if (tier === 'elite') {
    return '<span class="premium-badge elite" title="Elite Agent">💎</span>';
  } else if (tier === 'pro') {
    return '<span class="premium-badge pro" title="Pro Agent">⭐</span>';
  }
  return '';
}

/**
 * Render custom badges HTML
 */
function renderCustomBadges(badges) {
  if (!badges || badges.length === 0) return '';
  return `<div class="custom-badges" style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;">
    ${badges.map(b => `<span class="custom-badge" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:16px;background:${b.color}22;border:1px solid ${b.color}44;font-size:12px;color:${b.color};" title="${b.description || b.name}">
      <span>${b.emoji}</span>
      <span style="font-weight:500;">${b.name}</span>
    </span>`).join('')}
  </div>`;
}

/**
 * Get premium CSS styles
 */
function getPremiumStyles() {
  return `
    .premium-badge {
      display: inline-flex;
      align-items: center;
      margin-left: 6px;
      font-size: 16px;
      cursor: help;
    }
    .premium-badge.elite {
      animation: elite-sparkle 2s ease-in-out infinite;
    }
    @keyframes elite-sparkle {
      0%, 100% { filter: brightness(1); }
      50% { filter: brightness(1.3) drop-shadow(0 0 4px #8b5cf6); }
    }
    .premium-badge.pro {
      animation: pro-glow 3s ease-in-out infinite;
    }
    @keyframes pro-glow {
      0%, 100% { filter: brightness(1); }
      50% { filter: brightness(1.2) drop-shadow(0 0 3px #eab308); }
    }
    .premium-tier-card {
      border-radius: 16px;
      padding: 24px;
      background: #18181b;
      border: 1px solid #27272a;
      text-align: center;
      transition: all 0.2s;
    }
    .premium-tier-card:hover {
      border-color: #8b5cf6;
      transform: translateY(-2px);
    }
    .premium-tier-card.recommended {
      border-color: #8b5cf6;
      box-shadow: 0 0 20px rgba(139,92,246,0.15);
    }
    .premium-tier-price {
      font-size: 36px;
      font-weight: 700;
      color: #fafafa;
      margin: 12px 0;
    }
    .premium-tier-price span {
      font-size: 14px;
      color: #71717a;
      font-weight: 400;
    }
    .premium-feature-list {
      list-style: none;
      padding: 0;
      margin: 16px 0;
      text-align: left;
    }
    .premium-feature-list li {
      padding: 6px 0;
      color: #a1a1aa;
      font-size: 14px;
    }
    .premium-feature-list li::before {
      content: '✓ ';
      color: #22c55e;
      font-weight: bold;
    }
    .premium-feature-list li.disabled::before {
      content: '✗ ';
      color: #3f3f46;
    }
    .premium-feature-list li.disabled {
      color: #3f3f46;
    }
  `;
}

module.exports = {
  TIERS,
  getProfileTier,
  getTierInfo,
  upgradeTier,
  downgradeTier,
  getCustomBadges,
  addCustomBadge,
  removeCustomBadge,
  hasFeature,
  getPurchaseHistory,
  getPremiumStats,
  renderPremiumBadge,
  renderCustomBadges,
  getPremiumStyles,
  initSchema
};
