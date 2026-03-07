/**
 * Performance-Based Fee Structures for AgentFolio
 * 
 * Dynamic platform fees based on agent performance metrics:
 * - Base fee: 5% (default for new/unverified agents)
 * - Reduced fees for high-performing agents (down to 1%)
 * - Fee tiers based on: completion rate, reputation score, earnings milestones, premium status
 * - Custom fee schedules for enterprise/high-volume agents
 * - Fee history tracking and transparency
 * 
 * Fee Tiers:
 *   Tier 0 (New):        5.0% — < 5 completed jobs
 *   Tier 1 (Rising):     4.0% — 5+ jobs, 70%+ completion rate
 *   Tier 2 (Established): 3.0% — 20+ jobs, 80%+ completion, 70+ reputation
 *   Tier 3 (Expert):     2.0% — 50+ jobs, 90%+ completion, 85+ reputation
 *   Tier 4 (Elite):      1.5% — 100+ jobs, 95%+ completion, 90+ reputation
 *   Tier 5 (Partner):    1.0% — Custom/negotiated (enterprise agents)
 * 
 * Premium discount: Pro = 0.5% off, Elite = 1.0% off (stacks with tier)
 * Minimum fee: 0.5% (floor)
 */

const path = require('path');
const crypto = require('crypto');

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
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS fee_schedules (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL UNIQUE,
      tier INTEGER DEFAULT 0,
      base_rate REAL DEFAULT 0.05,
      effective_rate REAL DEFAULT 0.05,
      premium_discount REAL DEFAULT 0.0,
      custom_rate REAL,
      custom_reason TEXT,
      last_recalculated TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fee_history (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      escrow_id TEXT,
      job_id TEXT,
      job_value REAL NOT NULL,
      fee_rate REAL NOT NULL,
      fee_amount REAL NOT NULL,
      tier INTEGER NOT NULL,
      breakdown TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_fee_schedules_profile ON fee_schedules(profile_id);
    CREATE INDEX IF NOT EXISTS idx_fee_history_profile ON fee_history(profile_id);
    CREATE INDEX IF NOT EXISTS idx_fee_history_created ON fee_history(created_at);
  `);
}

// ============ FEE TIER DEFINITIONS ============

const FEE_TIERS = [
  { tier: 0, name: 'New',         rate: 0.05, minJobs: 0,   minCompletion: 0,    minReputation: 0  },
  { tier: 1, name: 'Rising',      rate: 0.04, minJobs: 5,   minCompletion: 0.70, minReputation: 0  },
  { tier: 2, name: 'Established', rate: 0.03, minJobs: 20,  minCompletion: 0.80, minReputation: 70 },
  { tier: 3, name: 'Expert',      rate: 0.02, minJobs: 50,  minCompletion: 0.90, minReputation: 85 },
  { tier: 4, name: 'Elite',       rate: 0.015, minJobs: 100, minCompletion: 0.95, minReputation: 90 },
  { tier: 5, name: 'Partner',     rate: 0.01, minJobs: null, minCompletion: null, minReputation: null } // custom only
];

const PREMIUM_DISCOUNTS = {
  free: 0,
  pro: 0.005,    // 0.5% off
  elite: 0.01    // 1.0% off
};

const MIN_FEE_RATE = 0.005; // 0.5% floor

// ============ CORE FUNCTIONS ============

/**
 * Calculate the fee tier for an agent based on their performance metrics
 */
function calculateTier(metrics) {
  const { completedJobs = 0, completionRate = 0, reputationScore = 0 } = metrics;
  
  let bestTier = 0;
  for (const tier of FEE_TIERS) {
    if (tier.tier === 5) continue; // Partner is custom-only
    if (completedJobs >= tier.minJobs &&
        completionRate >= tier.minCompletion &&
        reputationScore >= tier.minReputation) {
      bestTier = tier.tier;
    }
  }
  return bestTier;
}

/**
 * Get agent performance metrics from existing DB tables
 */
function getAgentMetrics(profileId) {
  const d = getDb();
  
  // Count completed jobs (agent was the worker)
  let completedJobs = 0, totalJobs = 0;
  try {
    const jobStats = d.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('completed', 'released', 'auto_released') THEN 1 ELSE 0 END) as completed
      FROM escrows WHERE agent_id = ?
    `).get(profileId);
    completedJobs = jobStats?.completed || 0;
    totalJobs = jobStats?.total || 0;
  } catch (e) { /* escrows table may not exist */ }

  const completionRate = totalJobs > 0 ? completedJobs / totalJobs : 0;

  // Get reputation score
  let reputationScore = 0;
  try {
    const profile = d.prepare('SELECT reputation_score FROM profiles WHERE id = ?').get(profileId);
    reputationScore = profile?.reputation_score || 0;
  } catch (e) {}

  // Get premium tier
  let premiumTier = 'free';
  try {
    const profile = d.prepare('SELECT premium_tier FROM profiles WHERE id = ?').get(profileId);
    premiumTier = profile?.premium_tier || 'free';
  } catch (e) {}

  // Total earnings
  let totalEarnings = 0;
  try {
    const earnings = d.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM escrows WHERE agent_id = ? AND status IN ('released', 'auto_released')
    `).get(profileId);
    totalEarnings = earnings?.total || 0;
  } catch (e) {}

  return { completedJobs, totalJobs, completionRate, reputationScore, premiumTier, totalEarnings };
}

/**
 * Calculate the effective fee rate for an agent
 */
function calculateFeeRate(profileId) {
  const metrics = getAgentMetrics(profileId);
  const tier = calculateTier(metrics);
  const tierDef = FEE_TIERS[tier];
  
  // Check for custom rate
  const d = getDb();
  const schedule = d.prepare('SELECT custom_rate FROM fee_schedules WHERE profile_id = ?').get(profileId);
  if (schedule?.custom_rate != null) {
    return {
      rate: Math.max(schedule.custom_rate, MIN_FEE_RATE),
      tier: 5,
      tierName: 'Partner',
      isCustom: true,
      metrics
    };
  }

  let baseRate = tierDef.rate;
  const premiumDiscount = PREMIUM_DISCOUNTS[metrics.premiumTier] || 0;
  const effectiveRate = Math.max(baseRate - premiumDiscount, MIN_FEE_RATE);

  return {
    rate: effectiveRate,
    tier,
    tierName: tierDef.name,
    baseRate,
    premiumDiscount,
    isCustom: false,
    metrics
  };
}

/**
 * Recalculate and store the fee schedule for an agent
 */
function recalculateFeeSchedule(profileId) {
  const feeInfo = calculateFeeRate(profileId);
  const d = getDb();

  d.prepare(`
    INSERT INTO fee_schedules (id, profile_id, tier, base_rate, effective_rate, premium_discount, last_recalculated, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(profile_id) DO UPDATE SET
      tier = excluded.tier,
      base_rate = excluded.base_rate,
      effective_rate = excluded.effective_rate,
      premium_discount = excluded.premium_discount,
      last_recalculated = excluded.last_recalculated,
      updated_at = excluded.updated_at
  `).run(
    crypto.randomUUID(),
    profileId,
    feeInfo.tier,
    feeInfo.baseRate || feeInfo.rate,
    feeInfo.rate,
    feeInfo.premiumDiscount || 0
  );

  return feeInfo;
}

/**
 * Record a fee charged on a job
 */
function recordFee(profileId, escrowId, jobId, jobValue, feeRate, feeTier) {
  const d = getDb();
  const feeAmount = jobValue * feeRate;

  d.prepare(`
    INSERT INTO fee_history (id, profile_id, escrow_id, job_id, job_value, fee_rate, fee_amount, tier, breakdown)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    profileId,
    escrowId || null,
    jobId || null,
    jobValue,
    feeRate,
    feeAmount,
    feeTier,
    JSON.stringify({ rate: feeRate, amount: feeAmount, value: jobValue })
  );

  return { feeRate, feeAmount, jobValue };
}

/**
 * Get fee schedule for an agent
 */
function getFeeSchedule(profileId) {
  const d = getDb();
  initSchema();
  
  const schedule = d.prepare('SELECT * FROM fee_schedules WHERE profile_id = ?').get(profileId);
  if (!schedule) {
    return recalculateFeeSchedule(profileId);
  }
  return {
    ...schedule,
    tierName: FEE_TIERS[schedule.tier]?.name || 'Unknown'
  };
}

/**
 * Get fee history for an agent
 */
function getFeeHistory(profileId, limit = 50) {
  const d = getDb();
  initSchema();
  return d.prepare('SELECT * FROM fee_history WHERE profile_id = ? ORDER BY created_at DESC LIMIT ?').all(profileId, limit);
}

/**
 * Set a custom fee rate for an agent (admin/partner negotiation)
 */
function setCustomRate(profileId, rate, reason) {
  if (rate < MIN_FEE_RATE) rate = MIN_FEE_RATE;
  if (rate > 0.10) rate = 0.10; // max 10%
  
  const d = getDb();
  initSchema();

  d.prepare(`
    INSERT INTO fee_schedules (id, profile_id, tier, base_rate, effective_rate, custom_rate, custom_reason, last_recalculated, updated_at)
    VALUES (?, ?, 5, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(profile_id) DO UPDATE SET
      tier = 5,
      effective_rate = excluded.effective_rate,
      custom_rate = excluded.custom_rate,
      custom_reason = excluded.custom_reason,
      updated_at = excluded.updated_at
  `).run(crypto.randomUUID(), profileId, rate, rate, rate, reason || 'Partner rate');

  return { rate, tier: 5, tierName: 'Partner', isCustom: true };
}

/**
 * Remove custom rate (revert to performance-based)
 */
function removeCustomRate(profileId) {
  const d = getDb();
  initSchema();
  d.prepare('UPDATE fee_schedules SET custom_rate = NULL, custom_reason = NULL, updated_at = datetime(\'now\') WHERE profile_id = ?').run(profileId);
  return recalculateFeeSchedule(profileId);
}

/**
 * Get platform fee stats (admin)
 */
function getPlatformFeeStats() {
  const d = getDb();
  initSchema();

  const stats = d.prepare(`
    SELECT 
      COUNT(*) as total_fees,
      COALESCE(SUM(fee_amount), 0) as total_revenue,
      COALESCE(AVG(fee_rate), 0) as avg_rate,
      COALESCE(SUM(job_value), 0) as total_volume
    FROM fee_history
  `).get();

  const byTier = d.prepare(`
    SELECT tier, COUNT(*) as count, SUM(fee_amount) as revenue, AVG(fee_rate) as avg_rate
    FROM fee_history GROUP BY tier ORDER BY tier
  `).all();

  const schedules = d.prepare(`
    SELECT tier, COUNT(*) as agents FROM fee_schedules GROUP BY tier ORDER BY tier
  `).all();

  return { ...stats, byTier, agentsByTier: schedules };
}

/**
 * Get all fee tiers (for display)
 */
function getFeeTiers() {
  return FEE_TIERS.map(t => ({
    ...t,
    ratePercent: (t.rate * 100).toFixed(1) + '%',
    requirements: t.tier === 5 ? 'By invitation' : 
      t.tier === 0 ? 'Default' :
      `${t.minJobs}+ jobs, ${(t.minCompletion * 100)}%+ completion${t.minReputation ? `, ${t.minReputation}+ reputation` : ''}`
  }));
}

module.exports = {
  calculateFeeRate,
  recalculateFeeSchedule,
  recordFee,
  getFeeSchedule,
  getFeeHistory,
  setCustomRate,
  removeCustomRate,
  getPlatformFeeStats,
  getFeeTiers,
  getAgentMetrics,
  FEE_TIERS,
  PREMIUM_DISCOUNTS,
  MIN_FEE_RATE
};
