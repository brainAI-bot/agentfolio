/**
 * AgentFolio Capital Delegation System
 * Delegate capital for agents to manage — tracked portfolios with performance fees
 * 
 * MVP: Virtual USDC delegation (platform-tracked, custodial)
 * Future: On-chain vaults via Solana programs
 * 
 * How it works:
 * 1. Delegator deposits virtual USDC into an agent's vault
 * 2. Agent manages the capital (trades, investments)
 * 3. Agent reports NAV (Net Asset Value) updates
 * 4. Performance fee (default 20%) charged on profits at withdrawal
 * 5. Delegator can withdraw anytime (with optional lock period)
 * 6. High-water mark ensures no double-charging on recovered losses
 */

const { db } = require('./database');
const logger = require('../logger');

// ===== SCHEMA =====

function initDelegationSchema(database) {
  const d = database || db;
  if (!d || !d.exec) return;

  d.exec(`
    CREATE TABLE IF NOT EXISTS delegation_vaults (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Default Vault',
      description TEXT,
      strategy TEXT,
      performance_fee_bps INTEGER NOT NULL DEFAULT 2000,
      min_delegation INTEGER NOT NULL DEFAULT 100,
      max_capacity INTEGER,
      lock_period_days INTEGER NOT NULL DEFAULT 0,
      total_delegated INTEGER NOT NULL DEFAULT 0,
      current_nav INTEGER NOT NULL DEFAULT 0,
      high_water_mark INTEGER NOT NULL DEFAULT 0,
      total_fees_earned INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(agent_id, name)
    );

    CREATE TABLE IF NOT EXISTS delegations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vault_id TEXT NOT NULL,
      delegator_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      shares REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      locked_until TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      withdrawn_at TEXT,
      withdrawal_amount INTEGER,
      fee_paid INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (vault_id) REFERENCES delegation_vaults(id)
    );

    CREATE TABLE IF NOT EXISTS nav_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vault_id TEXT NOT NULL,
      nav INTEGER NOT NULL,
      share_price REAL NOT NULL DEFAULT 1.0,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (vault_id) REFERENCES delegation_vaults(id)
    );

    CREATE INDEX IF NOT EXISTS idx_delegations_vault ON delegations(vault_id);
    CREATE INDEX IF NOT EXISTS idx_delegations_delegator ON delegations(delegator_id);
    CREATE INDEX IF NOT EXISTS idx_nav_vault ON nav_snapshots(vault_id);
  `);

  logger.info('[delegation] Schema initialized');
}

// ===== VAULT MANAGEMENT =====

function createVault(agentId, { name, description, strategy, performanceFeeBps, minDelegation, maxCapacity, lockPeriodDays } = {}) {
  const id = `vault_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const fee = Math.min(Math.max(performanceFeeBps || 2000, 0), 5000); // 0-50%

  db.prepare(`
    INSERT INTO delegation_vaults (id, agent_id, name, description, strategy, performance_fee_bps, min_delegation, max_capacity, lock_period_days)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, agentId, name || 'Default Vault', description || null, strategy || null, fee, minDelegation || 100, maxCapacity || null, lockPeriodDays || 0);

  logger.info(`[delegation] Vault ${id} created for agent ${agentId}`);
  return getVault(id);
}

function getVault(vaultId) {
  return db.prepare('SELECT * FROM delegation_vaults WHERE id = ?').get(vaultId);
}

function getAgentVaults(agentId) {
  return db.prepare('SELECT * FROM delegation_vaults WHERE agent_id = ? ORDER BY created_at DESC').all(agentId);
}

function listActiveVaults({ limit = 20, offset = 0, sortBy = 'total_delegated' } = {}) {
  const validSorts = ['total_delegated', 'current_nav', 'created_at', 'total_fees_earned'];
  const sort = validSorts.includes(sortBy) ? sortBy : 'total_delegated';
  return db.prepare(`
    SELECT v.*, 
      (SELECT COUNT(*) FROM delegations d WHERE d.vault_id = v.id AND d.status = 'active') as delegator_count,
      CASE WHEN v.total_delegated > 0 THEN ROUND((CAST(v.current_nav AS REAL) / v.total_delegated - 1) * 100, 2) ELSE 0 END as pnl_pct
    FROM delegation_vaults v
    WHERE v.status = 'active'
    ORDER BY ${sort} DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

// ===== DELEGATION =====

function delegate(vaultId, delegatorId, amount) {
  const vault = getVault(vaultId);
  if (!vault) throw new Error('Vault not found');
  if (vault.status !== 'active') throw new Error('Vault is not active');
  if (amount < vault.min_delegation) throw new Error(`Minimum delegation is $${vault.min_delegation}`);
  if (vault.max_capacity && (vault.total_delegated + amount) > vault.max_capacity) {
    throw new Error('Vault capacity exceeded');
  }

  // Calculate shares based on current share price
  const sharePrice = vault.total_delegated > 0 ? vault.current_nav / vault.total_delegated : 1.0;
  const shares = amount / sharePrice;

  const lockUntil = vault.lock_period_days > 0
    ? new Date(Date.now() + vault.lock_period_days * 86400000).toISOString()
    : null;

  const result = db.prepare(`
    INSERT INTO delegations (vault_id, delegator_id, amount, shares, locked_until)
    VALUES (?, ?, ?, ?, ?)
  `).run(vaultId, delegatorId, amount, shares, lockUntil);

  // Update vault totals
  db.prepare(`
    UPDATE delegation_vaults 
    SET total_delegated = total_delegated + ?, 
        current_nav = current_nav + ?,
        high_water_mark = MAX(high_water_mark, current_nav + ?),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(amount, amount, amount, vaultId);

  // Record NAV snapshot
  const updated = getVault(vaultId);
  recordNav(vaultId, updated.current_nav, `Delegation of $${amount} by ${delegatorId}`);

  logger.info(`[delegation] ${delegatorId} delegated $${amount} to vault ${vaultId} (${shares.toFixed(4)} shares)`);
  return { delegationId: result.lastInsertRowid, shares, sharePrice, lockUntil };
}

function withdraw(delegationId, delegatorId) {
  const delegation = db.prepare('SELECT * FROM delegations WHERE id = ? AND delegator_id = ?').get(delegationId, delegatorId);
  if (!delegation) throw new Error('Delegation not found');
  if (delegation.status !== 'active') throw new Error('Delegation already withdrawn');
  
  if (delegation.locked_until && new Date(delegation.locked_until) > new Date()) {
    throw new Error(`Locked until ${delegation.locked_until}`);
  }

  const vault = getVault(delegation.vault_id);
  const sharePrice = vault.total_delegated > 0 ? vault.current_nav / vault.total_delegated : 1.0;
  const grossValue = Math.round(delegation.shares * sharePrice);
  const profit = grossValue - delegation.amount;

  // Performance fee only on profits, only above high-water mark
  let fee = 0;
  if (profit > 0) {
    fee = Math.round(profit * vault.performance_fee_bps / 10000);
  }

  const netValue = grossValue - fee;

  db.prepare(`
    UPDATE delegations 
    SET status = 'withdrawn', withdrawn_at = datetime('now'), withdrawal_amount = ?, fee_paid = ?
    WHERE id = ?
  `).run(netValue, fee, delegationId);

  db.prepare(`
    UPDATE delegation_vaults 
    SET total_delegated = MAX(0, total_delegated - ?),
        current_nav = MAX(0, current_nav - ?),
        total_fees_earned = total_fees_earned + ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(delegation.amount, grossValue, fee, delegation.vault_id);

  recordNav(vault.id, Math.max(0, vault.current_nav - grossValue), `Withdrawal by ${delegatorId}: $${netValue} (fee: $${fee})`);

  logger.info(`[delegation] ${delegatorId} withdrew $${netValue} from vault ${vault.id} (fee: $${fee})`);
  return { grossValue, fee, netValue, profit };
}

// ===== NAV MANAGEMENT =====

function updateNav(vaultId, agentId, newNav, note) {
  const vault = getVault(vaultId);
  if (!vault) throw new Error('Vault not found');
  if (vault.agent_id !== agentId) throw new Error('Only vault manager can update NAV');

  const hwm = Math.max(vault.high_water_mark, newNav);

  db.prepare(`
    UPDATE delegation_vaults 
    SET current_nav = ?, high_water_mark = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(newNav, hwm, vaultId);

  recordNav(vaultId, newNav, note);
  logger.info(`[delegation] NAV updated for vault ${vaultId}: $${newNav}`);
  return getVault(vaultId);
}

function recordNav(vaultId, nav, note) {
  const vault = getVault(vaultId);
  const totalDelegated = vault ? vault.total_delegated : 0;
  const sharePrice = totalDelegated > 0 ? nav / totalDelegated : 1.0;

  db.prepare(`
    INSERT INTO nav_snapshots (vault_id, nav, share_price, note)
    VALUES (?, ?, ?, ?)
  `).run(vaultId, nav, sharePrice, note || null);
}

function getNavHistory(vaultId, { limit = 30 } = {}) {
  return db.prepare(`
    SELECT * FROM nav_snapshots WHERE vault_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(vaultId, limit);
}

// ===== DELEGATOR QUERIES =====

function getDelegatorPositions(delegatorId) {
  return db.prepare(`
    SELECT d.*, v.name as vault_name, v.agent_id, v.current_nav, v.total_delegated, v.performance_fee_bps,
      CASE WHEN v.total_delegated > 0 
        THEN ROUND(d.shares * (CAST(v.current_nav AS REAL) / v.total_delegated), 0) 
        ELSE d.amount END as current_value,
      CASE WHEN v.total_delegated > 0 
        THEN ROUND(d.shares * (CAST(v.current_nav AS REAL) / v.total_delegated) - d.amount, 0) 
        ELSE 0 END as unrealized_pnl
    FROM delegations d
    JOIN delegation_vaults v ON d.vault_id = v.id
    WHERE d.delegator_id = ? AND d.status = 'active'
    ORDER BY d.created_at DESC
  `).all(delegatorId);
}

function getDelegationHistory(delegatorId, { limit = 50 } = {}) {
  return db.prepare(`
    SELECT d.*, v.name as vault_name, v.agent_id
    FROM delegations d
    JOIN delegation_vaults v ON d.vault_id = v.id
    WHERE d.delegator_id = ?
    ORDER BY d.created_at DESC
    LIMIT ?
  `).all(delegatorId, limit);
}

// ===== VAULT STATS =====

function getVaultStats(vaultId) {
  const vault = getVault(vaultId);
  if (!vault) return null;

  const delegators = db.prepare(`
    SELECT COUNT(*) as count, SUM(amount) as total_deposited
    FROM delegations WHERE vault_id = ? AND status = 'active'
  `).get(vaultId);

  const withdrawn = db.prepare(`
    SELECT COUNT(*) as count, SUM(withdrawal_amount) as total_withdrawn, SUM(fee_paid) as total_fees
    FROM delegations WHERE vault_id = ? AND status = 'withdrawn'
  `).get(vaultId);

  const navHistory = db.prepare(`
    SELECT MIN(nav) as min_nav, MAX(nav) as max_nav
    FROM nav_snapshots WHERE vault_id = ?
  `).get(vaultId);

  const pnlPct = vault.total_delegated > 0 
    ? ((vault.current_nav / vault.total_delegated) - 1) * 100 
    : 0;

  return {
    ...vault,
    delegator_count: delegators.count,
    total_deposited: delegators.total_deposited || 0,
    withdrawals: withdrawn.count,
    total_withdrawn: withdrawn.total_withdrawn || 0,
    total_fees_collected: withdrawn.total_fees || 0,
    pnl_pct: Math.round(pnlPct * 100) / 100,
    nav_min: navHistory?.min_nav,
    nav_max: navHistory?.max_nav
  };
}

// ===== LEADERBOARD =====

function getVaultLeaderboard({ limit = 20 } = {}) {
  return db.prepare(`
    SELECT v.*,
      (SELECT COUNT(*) FROM delegations d WHERE d.vault_id = v.id AND d.status = 'active') as delegator_count,
      CASE WHEN v.total_delegated > 0 THEN ROUND((CAST(v.current_nav AS REAL) / v.total_delegated - 1) * 100, 2) ELSE 0 END as pnl_pct
    FROM delegation_vaults v
    WHERE v.status = 'active' AND v.total_delegated > 0
    ORDER BY pnl_pct DESC
    LIMIT ?
  `).all(limit);
}

module.exports = {
  initDelegationSchema,
  createVault,
  getVault,
  getAgentVaults,
  listActiveVaults,
  delegate,
  withdraw,
  updateNav,
  getNavHistory,
  getDelegatorPositions,
  getDelegationHistory,
  getVaultStats,
  getVaultLeaderboard
};
