/**
 * Governance Token System for AgentFolio
 * 
 * Token-weighted voting for platform decisions:
 * - Proposals (create, vote, execute)
 * - Voting power from staking tokens on agents
 * - Quorum requirements
 * - Time-locked execution
 * - Delegation of voting power
 * 
 * Token source: staking.js (staked tokens = voting power)
 * 1 staked token = 1 vote. Unstaked tokens don't count.
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
    CREATE TABLE IF NOT EXISTS governance_proposals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      proposer_id TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      quorum INTEGER DEFAULT 100,
      votes_for INTEGER DEFAULT 0,
      votes_against INTEGER DEFAULT 0,
      votes_abstain INTEGER DEFAULT 0,
      total_voting_power INTEGER DEFAULT 0,
      execution_delay_hours INTEGER DEFAULT 48,
      executable_action TEXT,
      executed_at TEXT,
      starts_at TEXT DEFAULT (datetime('now')),
      ends_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS governance_votes (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      voter_id TEXT NOT NULL,
      vote TEXT NOT NULL,
      voting_power INTEGER DEFAULT 1,
      comment TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(proposal_id, voter_id)
    );

    CREATE TABLE IF NOT EXISTS governance_delegations (
      id TEXT PRIMARY KEY,
      delegator_id TEXT NOT NULL,
      delegate_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(delegator_id)
    );

    CREATE INDEX IF NOT EXISTS idx_gov_proposals_status ON governance_proposals(status);
    CREATE INDEX IF NOT EXISTS idx_gov_votes_proposal ON governance_votes(proposal_id);
    CREATE INDEX IF NOT EXISTS idx_gov_votes_voter ON governance_votes(voter_id);
    CREATE INDEX IF NOT EXISTS idx_gov_delegations_delegate ON governance_delegations(delegate_id);
  `);
}

// ============ CONSTANTS ============

const PROPOSAL_STATUS = {
  ACTIVE: 'active',
  PASSED: 'passed',
  REJECTED: 'rejected',
  EXECUTED: 'executed',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled'
};

const VOTE_OPTIONS = ['for', 'against', 'abstain'];

const CATEGORIES = ['general', 'fees', 'features', 'policy', 'treasury', 'partnerships'];

const DEFAULT_VOTING_PERIOD_DAYS = 7;
const DEFAULT_QUORUM = 100; // minimum total voting power
const MIN_VOTING_POWER_TO_PROPOSE = 10; // need at least 10 staked tokens

// ============ VOTING POWER ============

/**
 * Get voting power for an agent (= total tokens staked by them)
 */
function getVotingPower(profileId) {
  const d = getDb();
  try {
    const result = d.prepare(`
      SELECT COALESCE(SUM(amount), 0) as power 
      FROM stakes WHERE staker_id = ? AND status = 'active'
    `).get(profileId);
    return result?.power || 0;
  } catch (e) {
    return 0; // stakes table may not exist
  }
}

/**
 * Get effective voting power (own + delegated)
 */
function getEffectiveVotingPower(profileId) {
  const d = getDb();
  let ownPower = getVotingPower(profileId);
  
  // Add delegated power
  try {
    const delegators = d.prepare('SELECT delegator_id FROM governance_delegations WHERE delegate_id = ?').all(profileId);
    for (const del of delegators) {
      ownPower += getVotingPower(del.delegator_id);
    }
  } catch (e) {}
  
  return ownPower;
}

// ============ PROPOSALS ============

function createProposal(proposerId, data) {
  const d = getDb();
  initSchema();
  
  const power = getEffectiveVotingPower(proposerId);
  if (power < MIN_VOTING_POWER_TO_PROPOSE) {
    throw new Error(`Need ${MIN_VOTING_POWER_TO_PROPOSE}+ voting power to create proposals (you have ${power})`);
  }

  const { title, description, category = 'general', votingPeriodDays = DEFAULT_VOTING_PERIOD_DAYS, quorum = DEFAULT_QUORUM, executableAction } = data;
  if (!title || !description) throw new Error('Title and description required');
  if (!CATEGORIES.includes(category)) throw new Error('Invalid category');

  const endsAt = new Date(Date.now() + votingPeriodDays * 24 * 60 * 60 * 1000).toISOString();
  const id = 'prop_' + crypto.randomUUID().split('-')[0];

  d.prepare(`
    INSERT INTO governance_proposals (id, title, description, category, proposer_id, quorum, ends_at, executable_action)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, description, category, proposerId, quorum, endsAt, executableAction || null);

  return { id, title, category, status: 'active', endsAt, quorum };
}

function getProposal(proposalId) {
  const d = getDb();
  initSchema();
  const proposal = d.prepare('SELECT * FROM governance_proposals WHERE id = ?').get(proposalId);
  if (!proposal) return null;
  
  // Check if expired
  if (proposal.status === 'active' && new Date(proposal.ends_at) < new Date()) {
    finalizeProposal(proposalId);
    return d.prepare('SELECT * FROM governance_proposals WHERE id = ?').get(proposalId);
  }
  return proposal;
}

function listProposals(filters = {}) {
  const d = getDb();
  initSchema();
  
  let query = 'SELECT * FROM governance_proposals';
  const params = [];
  const conditions = [];

  if (filters.status) { conditions.push('status = ?'); params.push(filters.status); }
  if (filters.category) { conditions.push('category = ?'); params.push(filters.category); }
  if (filters.proposerId) { conditions.push('proposer_id = ?'); params.push(filters.proposerId); }

  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY created_at DESC';
  
  const limit = Math.min(filters.limit || 50, 200);
  query += ' LIMIT ?'; params.push(limit);

  return d.prepare(query).all(...params);
}

// ============ VOTING ============

function castVote(proposalId, voterId, vote, comment) {
  const d = getDb();
  initSchema();
  
  if (!VOTE_OPTIONS.includes(vote)) throw new Error('Vote must be: for, against, or abstain');

  const proposal = getProposal(proposalId);
  if (!proposal) throw new Error('Proposal not found');
  if (proposal.status !== 'active') throw new Error('Proposal is not active');

  // Check if delegate is voting on behalf
  const delegation = d.prepare('SELECT delegate_id FROM governance_delegations WHERE delegator_id = ?').get(voterId);
  if (delegation) throw new Error('You have delegated your vote. Undelegate first to vote directly.');

  const power = getEffectiveVotingPower(voterId);
  if (power < 1) throw new Error('No voting power. Stake tokens to vote.');

  // Upsert vote
  const existing = d.prepare('SELECT * FROM governance_votes WHERE proposal_id = ? AND voter_id = ?').get(proposalId, voterId);
  
  if (existing) {
    // Reverse old vote
    const oldField = `votes_${existing.vote}`;
    d.prepare(`UPDATE governance_proposals SET ${oldField} = ${oldField} - ?, total_voting_power = total_voting_power - ? WHERE id = ?`)
      .run(existing.voting_power, existing.voting_power, proposalId);
    
    d.prepare('UPDATE governance_votes SET vote = ?, voting_power = ?, comment = ?, created_at = datetime(\'now\') WHERE id = ?')
      .run(vote, power, comment || null, existing.id);
  } else {
    d.prepare('INSERT INTO governance_votes (id, proposal_id, voter_id, vote, voting_power, comment) VALUES (?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), proposalId, voterId, vote, power, comment || null);
  }

  // Apply new vote
  const field = `votes_${vote}`;
  d.prepare(`UPDATE governance_proposals SET ${field} = ${field} + ?, total_voting_power = total_voting_power + ?, updated_at = datetime('now') WHERE id = ?`)
    .run(power, power, proposalId);

  return { proposalId, voterId, vote, power };
}

function getProposalVotes(proposalId, limit = 100) {
  const d = getDb();
  initSchema();
  return d.prepare('SELECT * FROM governance_votes WHERE proposal_id = ? ORDER BY created_at DESC LIMIT ?').all(proposalId, limit);
}

// ============ FINALIZATION ============

function finalizeProposal(proposalId) {
  const d = getDb();
  const proposal = d.prepare('SELECT * FROM governance_proposals WHERE id = ?').get(proposalId);
  if (!proposal || proposal.status !== 'active') return null;

  const quorumMet = proposal.total_voting_power >= proposal.quorum;
  const passed = quorumMet && proposal.votes_for > proposal.votes_against;
  const newStatus = passed ? PROPOSAL_STATUS.PASSED : PROPOSAL_STATUS.REJECTED;

  d.prepare('UPDATE governance_proposals SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newStatus, proposalId);
  return { proposalId, status: newStatus, quorumMet, votes: { for: proposal.votes_for, against: proposal.votes_against, abstain: proposal.votes_abstain } };
}

function executeProposal(proposalId) {
  const d = getDb();
  initSchema();
  const proposal = d.prepare('SELECT * FROM governance_proposals WHERE id = ?').get(proposalId);
  if (!proposal) throw new Error('Proposal not found');
  if (proposal.status !== 'passed') throw new Error('Proposal must be in passed status');
  
  d.prepare('UPDATE governance_proposals SET status = ?, executed_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?')
    .run(PROPOSAL_STATUS.EXECUTED, proposalId);

  return { proposalId, status: 'executed', action: proposal.executable_action };
}

function cancelProposal(proposalId, requesterId) {
  const d = getDb();
  initSchema();
  const proposal = d.prepare('SELECT * FROM governance_proposals WHERE id = ?').get(proposalId);
  if (!proposal) throw new Error('Proposal not found');
  if (proposal.proposer_id !== requesterId) throw new Error('Only proposer can cancel');
  if (!['active'].includes(proposal.status)) throw new Error('Can only cancel active proposals');

  d.prepare('UPDATE governance_proposals SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(PROPOSAL_STATUS.CANCELLED, proposalId);
  return { proposalId, status: 'cancelled' };
}

// ============ DELEGATION ============

function delegateVote(delegatorId, delegateId) {
  const d = getDb();
  initSchema();
  if (delegatorId === delegateId) throw new Error('Cannot delegate to yourself');
  
  d.prepare(`
    INSERT INTO governance_delegations (id, delegator_id, delegate_id) VALUES (?, ?, ?)
    ON CONFLICT(delegator_id) DO UPDATE SET delegate_id = excluded.delegate_id, created_at = datetime('now')
  `).run(crypto.randomUUID(), delegatorId, delegateId);

  return { delegatorId, delegateId };
}

function undelegateVote(delegatorId) {
  const d = getDb();
  initSchema();
  d.prepare('DELETE FROM governance_delegations WHERE delegator_id = ?').run(delegatorId);
  return { delegatorId, undelegated: true };
}

function getDelegation(profileId) {
  const d = getDb();
  initSchema();
  return d.prepare('SELECT * FROM governance_delegations WHERE delegator_id = ?').get(profileId);
}

function getDelegators(delegateId) {
  const d = getDb();
  initSchema();
  return d.prepare('SELECT * FROM governance_delegations WHERE delegate_id = ?').all(delegateId);
}

// ============ STATS ============

function getGovernanceStats() {
  const d = getDb();
  initSchema();

  const stats = d.prepare(`
    SELECT 
      COUNT(*) as total_proposals,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) as passed,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
      SUM(CASE WHEN status = 'executed' THEN 1 ELSE 0 END) as executed
    FROM governance_proposals
  `).get();

  const totalVotes = d.prepare('SELECT COUNT(*) as count FROM governance_votes').get();
  const totalDelegations = d.prepare('SELECT COUNT(*) as count FROM governance_delegations').get();

  return { ...stats, totalVotes: totalVotes.count, totalDelegations: totalDelegations.count };
}

module.exports = {
  createProposal, getProposal, listProposals,
  castVote, getProposalVotes,
  finalizeProposal, executeProposal, cancelProposal,
  delegateVote, undelegateVote, getDelegation, getDelegators,
  getVotingPower, getEffectiveVotingPower,
  getGovernanceStats, initSchema,
  PROPOSAL_STATUS, VOTE_OPTIONS, CATEGORIES
};
