/**
 * AgentFolio Agent Staking System
 * Stake on agents you believe in — conviction-weighted reputation
 * 
 * MVP: Virtual points system (platform credits)
 * Future: On-chain token staking via SATP
 * 
 * Mechanics:
 * - Each user starts with 1000 FOLIO points (virtual)
 * - Stake points on agents you believe in
 * - If agent's reputation goes UP → you earn bonus points
 * - If agent's reputation goes DOWN → you lose staked points
 * - Leaderboard of best "agent scouts"
 * - Staked amount boosts agent's visibility/ranking
 */

const { db } = require('./database');
const logger = require('../logger');

// ===== SCHEMA =====

function initStakingSchema(database) {
  const d = database || db;
  if (!d || !d.exec) return;
  
  d.exec(`
    CREATE TABLE IF NOT EXISTS staking_balances (
      user_id TEXT PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 1000,
      total_earned INTEGER NOT NULL DEFAULT 0,
      total_lost INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stakes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staker_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      reputation_at_stake REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      unstaked_at TEXT,
      pnl INTEGER NOT NULL DEFAULT 0,
      UNIQUE(staker_id, agent_id, status)
    );

    CREATE INDEX IF NOT EXISTS idx_stakes_staker ON stakes(staker_id);
    CREATE INDEX IF NOT EXISTS idx_stakes_agent ON stakes(agent_id);
    CREATE INDEX IF NOT EXISTS idx_stakes_status ON stakes(status);

    CREATE TABLE IF NOT EXISTS staking_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staker_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      action TEXT NOT NULL,
      amount INTEGER NOT NULL,
      pnl INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reputation_snapshots (
      agent_id TEXT NOT NULL,
      score REAL NOT NULL,
      snapshot_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(agent_id, snapshot_at)
    );
  `);
}

// ===== BALANCE MANAGEMENT =====

function getOrCreateBalance(userId) {
  const d = db;
  let row = d.prepare('SELECT * FROM staking_balances WHERE user_id = ?').get(userId);
  if (!row) {
    d.prepare('INSERT INTO staking_balances (user_id) VALUES (?)').run(userId);
    row = d.prepare('SELECT * FROM staking_balances WHERE user_id = ?').get(userId);
  }
  return row;
}

function getBalance(userId) {
  const bal = getOrCreateBalance(userId);
  return {
    balance: bal.balance,
    totalEarned: bal.total_earned,
    totalLost: bal.total_lost,
    netPnL: bal.total_earned - bal.total_lost
  };
}

// ===== STAKING =====

function stakeOnAgent(stakerId, agentId, amount) {
  const d = db;
  
  if (amount < 10) throw new Error('Minimum stake is 10 FOLIO');
  if (amount > 500) throw new Error('Maximum stake per agent is 500 FOLIO');
  if (stakerId === agentId) throw new Error('Cannot stake on yourself');
  
  const balance = getOrCreateBalance(stakerId);
  if (balance.balance < amount) throw new Error(`Insufficient balance: ${balance.balance} FOLIO`);
  
  // Check existing active stake
  const existing = d.prepare(
    'SELECT * FROM stakes WHERE staker_id = ? AND agent_id = ? AND status = ?'
  ).get(stakerId, agentId, 'active');
  
  if (existing) throw new Error('Already staking on this agent. Unstake first.');
  
  // Get current agent reputation (calculated dynamically)
  const agent = d.prepare('SELECT id FROM profiles WHERE id = ?').get(agentId);
  if (!agent) throw new Error('Agent not found');
  
  let repScore = 0;
  try {
    const { calculateReputation } = require('./reputation');
    const { loadProfile } = require('./profile');
    const profile = loadProfile(agentId);
    if (profile) repScore = calculateReputation(profile).score || 0;
  } catch(e) { /* fallback to 0 */ }
  
  // Execute stake
  const txn = d.transaction(() => {
    d.prepare(`UPDATE staking_balances SET balance = balance - ?, updated_at = datetime('now') WHERE user_id = ?`)
      .run(amount, stakerId);
    
    d.prepare('INSERT INTO stakes (staker_id, agent_id, amount, reputation_at_stake) VALUES (?, ?, ?, ?)')
      .run(stakerId, agentId, amount, repScore);
    
    d.prepare('INSERT INTO staking_history (staker_id, agent_id, action, amount) VALUES (?, ?, ?, ?)')
      .run(stakerId, agentId, 'stake', amount);
    
    // Snapshot current reputation
    d.prepare('INSERT OR REPLACE INTO reputation_snapshots (agent_id, score) VALUES (?, ?)')
      .run(agentId, repScore);
  });
  
  txn();
  
  if (logger && logger.info) logger.info(`Stake: ${stakerId} staked ${amount} FOLIO on ${agentId}`);
  
  return {
    stakerId, agentId, amount,
    reputationAtStake: repScore,
    remainingBalance: balance.balance - amount
  };
}

function unstakeFromAgent(stakerId, agentId) {
  const d = db;
  
  const stake = d.prepare(
    'SELECT * FROM stakes WHERE staker_id = ? AND agent_id = ? AND status = ?'
  ).get(stakerId, agentId, 'active');
  
  if (!stake) throw new Error('No active stake on this agent');
  
  // Get current reputation (calculated dynamically)
  let currentRep = 0;
  try {
    const { calculateReputation } = require('./reputation');
    const { loadProfile } = require('./profile');
    const profile = loadProfile(agentId);
    if (profile) currentRep = calculateReputation(profile).score || 0;
  } catch(e) { /* fallback to 0 */ }
  const repChange = currentRep - stake.reputation_at_stake;
  
  // PnL: +10% of stake per +1 rep point, -10% per -1 rep point (capped at ±stake)
  let pnl = Math.round(stake.amount * repChange * 0.1);
  pnl = Math.max(-stake.amount, Math.min(stake.amount, pnl)); // cap at ±100%
  
  const returnAmount = stake.amount + pnl;
  
  const txn = d.transaction(() => {
    d.prepare(`UPDATE stakes SET status = ?, unstaked_at = datetime('now'), pnl = ? WHERE id = ?`)
      .run('closed', pnl, stake.id);
    
    d.prepare(`UPDATE staking_balances SET balance = balance + ?, total_earned = total_earned + ?, total_lost = total_lost + ?, updated_at = datetime('now') WHERE user_id = ?`)
      .run(returnAmount, Math.max(0, pnl), Math.abs(Math.min(0, pnl)), stakerId);
    
    d.prepare('INSERT INTO staking_history (staker_id, agent_id, action, amount, pnl) VALUES (?, ?, ?, ?, ?)')
      .run(stakerId, agentId, 'unstake', stake.amount, pnl);
  });
  
  txn();
  
  if (logger && logger.info) logger.info(`Unstake: ${stakerId} unstaked from ${agentId}, PnL: ${pnl}`);
  
  return {
    stakerId, agentId,
    originalAmount: stake.amount,
    returnAmount,
    pnl,
    reputationChange: repChange
  };
}

// ===== QUERIES =====

function getAgentStakes(agentId) {
  const d = db;
  const stakes = d.prepare(
    'SELECT staker_id, amount, created_at FROM stakes WHERE agent_id = ? AND status = ? ORDER BY amount DESC'
  ).all(agentId, 'active');
  
  const totalStaked = stakes.reduce((sum, s) => sum + s.amount, 0);
  return { agentId, totalStaked, stakerCount: stakes.length, stakes };
}

function getUserStakes(userId) {
  const d = db;
  return d.prepare(`
    SELECT s.*, p.name as agent_name
    FROM stakes s
    LEFT JOIN profiles p ON s.agent_id = p.id
    WHERE s.staker_id = ? AND s.status = ?
    ORDER BY s.created_at DESC
  `).all(userId, 'active');
}

function getUserHistory(userId, limit = 50) {
  const d = db;
  return d.prepare(
    'SELECT * FROM staking_history WHERE staker_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, limit);
}

function getStakingLeaderboard(limit = 20) {
  const d = db;
  
  // Top scouts by net PnL
  const scouts = d.prepare(`
    SELECT user_id, balance, total_earned, total_lost, 
           (total_earned - total_lost) as net_pnl
    FROM staking_balances
    WHERE total_earned > 0 OR total_lost > 0
    ORDER BY net_pnl DESC
    LIMIT ?
  `).all(limit);
  
  // Most staked agents
  const topAgents = d.prepare(`
    SELECT s.agent_id, p.name as agent_name, 
           SUM(s.amount) as total_staked, COUNT(*) as staker_count
    FROM stakes s
    LEFT JOIN profiles p ON s.agent_id = p.id
    WHERE s.status = 'active'
    GROUP BY s.agent_id
    ORDER BY total_staked DESC
    LIMIT ?
  `).all(limit);
  
  return { scouts, topAgents };
}

// ===== REPUTATION SETTLEMENT (cron job) =====

function settleReputationChanges() {
  const d = db;
  
  // Get all agents with active stakes
  const agents = d.prepare(`
    SELECT DISTINCT agent_id FROM stakes WHERE status = 'active'
  `).all();
  
  let updated = 0;
  for (const { agent_id } of agents) {
    const agent = d.prepare('SELECT reputation_score FROM profiles WHERE id = ?').get(agent_id);
    if (agent) {
      d.prepare('INSERT OR REPLACE INTO reputation_snapshots (agent_id, score) VALUES (?, ?)')
        .run(agent_id, agent.reputation_score || 0);
      updated++;
    }
  }
  
  return { agentsUpdated: updated };
}

module.exports = {
  initStakingSchema,
  getBalance,
  stakeOnAgent,
  unstakeFromAgent,
  getAgentStakes,
  getUserStakes,
  getUserHistory,
  getStakingLeaderboard,
  settleReputationChanges
};
