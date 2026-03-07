/**
 * AgentFolio Escrow System v2 — Moltlaunch-inspired design
 * 
 * Custodial escrow with:
 * - Auto-release timer (24h after work submission)
 * - Cancellation tiers (full refund / 10% compensation / auto-release)
 * - Dispute collateral (15% from disputing party)
 * - Buyback & burn support (configurable burnPct per job)
 * - Enhanced status tracking
 * 
 * Structured for future on-chain swap (IEscrowProvider interface pattern)
 * 
 * Flow:
 * 1. Client posts job → must deposit to escrow
 * 2. Agent accepts → status: agent_accepted / locked
 * 3. Agent submits work → status: work_submitted, 24h auto-release timer starts
 * 4. Client reviews → releases or disputes (within 24h)
 * 5. If client ghosts → auto-release after 24h
 * 6. Disputes require 15% collateral from filing party
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============ CONSTANTS ============

const ESCROW_STATUS = {
  PENDING_DEPOSIT: 'pending_deposit',
  FUNDED: 'funded',
  AGENT_ACCEPTED: 'agent_accepted',         // NEW: agent accepted, not started
  LOCKED: 'locked',                          // Agent working (backward compat)
  WORK_SUBMITTED: 'work_submitted',          // NEW: agent submitted, 24h timer
  RELEASING: 'releasing',
  RELEASED: 'released',
  AUTO_RELEASED: 'auto_released',            // NEW: 24h timer expired
  REFUNDED: 'refunded',
  CANCELLED_WITH_COMPENSATION: 'cancelled_with_compensation', // NEW
  DISPUTED: 'disputed'
};

const CURRENCIES = {
  USDC: { 
    name: 'USD Coin', symbol: 'USDC', decimals: 6,
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    icon: '💵'
  },
  SOL: {
    name: 'Solana', symbol: 'SOL', decimals: 9,
    mint: 'native', icon: '◎'
  }
};

// Config — easy to adjust
const PLATFORM_FEE_PCT = 5; // Default fallback; overridden by performance-fees when agent is known
let performanceFees;
try { performanceFees = require('./performance-fees'); } catch(e) { performanceFees = null; }
const DISPUTE_COLLATERAL_PCT = 15;
const AUTO_RELEASE_HOURS = 24;
const CANCEL_COMPENSATION_PCT = 10;  // agent gets 10% if client cancels after acceptance
const BURN_ADDRESS = 'BURN_ADDRESS_TBD'; // placeholder for $BRAIN token burn

const DATA_DIR = path.join(__dirname, '../../data/escrow');

let PLATFORM_ESCROW_WALLET;
try {
  const solanaEscrow = require('./solana-escrow');
  PLATFORM_ESCROW_WALLET = solanaEscrow.getEscrowKeypair().publicKey.toBase58();
} catch (e) {
  PLATFORM_ESCROW_WALLET = process.env.ESCROW_WALLET || 'ESCROW_WALLET_NOT_CONFIGURED';
  console.warn('[Escrow] Could not load escrow keypair:', e.message);
}

// ============ DATA HELPERS ============

function ensureDataDirs() {
  ['escrows', 'transactions', 'disputes'].forEach(dir => {
    const dirPath = path.join(DATA_DIR, dir);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  });
}

function generateEscrowId() {
  return `escrow_${crypto.randomBytes(8).toString('hex')}`;
}

function loadEscrow(escrowId) {
  ensureDataDirs();
  const p = path.join(DATA_DIR, 'escrows', `${escrowId}.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function loadEscrowByJob(jobId) {
  ensureDataDirs();
  const dir = path.join(DATA_DIR, 'escrows');
  if (!fs.existsSync(dir)) return null;
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    try {
      const e = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (e.jobId === jobId) return e;
    } catch {}
  }
  return null;
}

function saveEscrow(escrow) {
  ensureDataDirs();
  escrow.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(DATA_DIR, 'escrows', `${escrow.id}.json`), JSON.stringify(escrow, null, 2));
  return escrow;
}

function recordTransaction(escrowId, type, data) {
  ensureDataDirs();
  const tx = {
    id: `tx_${crypto.randomBytes(8).toString('hex')}`,
    escrowId, type,
    txHash: data.txHash || null,
    amount: data.amount,
    currency: data.currency,
    from: data.from,
    to: data.to,
    status: data.status || 'pending',
    timestamp: new Date().toISOString(),
    metadata: data.metadata || {}
  };
  fs.writeFileSync(path.join(DATA_DIR, 'transactions', `${tx.id}.json`), JSON.stringify(tx, null, 2));
  return tx;
}

// ============ CORE ESCROW OPERATIONS ============

/**
 * Create escrow for a job
 * @param {string} jobId
 * @param {object} data - clientId, clientWallet, amount, currency, expiresAt, burnPct
 */
function createEscrow(jobId, data) {
  ensureDataDirs();
  
  const burnPct = Math.max(0, Math.min(100, data.burnPct || 0));
  const amount = data.amount;
  const platformFee = Math.round(amount * PLATFORM_FEE_PCT) / 100;
  const burnAmount = Math.round(amount * burnPct) / 100;
  const agentPayout = Math.round(amount * (100 - PLATFORM_FEE_PCT)) / 100 - burnAmount;
  
  const escrow = {
    id: generateEscrowId(),
    jobId,
    clientId: data.clientId,
    clientWallet: data.clientWallet || null,
    agentId: null,
    agentWallet: null,
    
    // Amounts
    amount,
    currency: data.currency || 'USDC',
    platformFee,
    agentPayout,
    
    // Buyback & burn
    burnPct,
    burnAmount,
    burnAddress: burnPct > 0 ? BURN_ADDRESS : null,
    burnExecuted: false,
    
    // Status
    status: ESCROW_STATUS.PENDING_DEPOSIT,
    
    // Deposit
    depositAddress: PLATFORM_ESCROW_WALLET,
    depositTxHash: null,
    depositConfirmedAt: null,
    
    // Release
    releaseTxHash: null,
    releasedAt: null,
    
    // Work submission & auto-release
    submittedAt: null,               // when agent marks work submitted
    autoReleaseAt: null,             // submittedAt + 24h
    autoReleaseExecuted: false,
    
    // Cancellation
    cancellationType: null,          // 'no_response' | 'pre_start' | 'client_ghost'
    compensationAmount: null,
    compensationPct: null,
    
    // Dispute collateral
    disputeCollateralAmount: null,
    disputeCollateralFrom: null,     // 'client' | 'agent'
    disputeCollateralReturned: false,
    
    // Timestamps
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: data.expiresAt || null,
    
    notes: []
  };
  
  saveEscrow(escrow);
  return escrow;
}

/**
 * Confirm deposit received
 */
function confirmDeposit(escrowId, txHash) {
  const escrow = loadEscrow(escrowId);
  if (!escrow) return { error: 'Escrow not found' };
  if (escrow.status !== ESCROW_STATUS.PENDING_DEPOSIT) return { error: 'Escrow not awaiting deposit' };
  
  escrow.status = ESCROW_STATUS.FUNDED;
  escrow.depositTxHash = txHash;
  escrow.depositConfirmedAt = new Date().toISOString();
  escrow.notes.push({ timestamp: new Date().toISOString(), action: 'deposit_confirmed', txHash });
  
  recordTransaction(escrowId, 'deposit', {
    txHash, amount: escrow.amount, currency: escrow.currency,
    from: escrow.clientWallet, to: PLATFORM_ESCROW_WALLET, status: 'confirmed'
  });
  
  return saveEscrow(escrow);
}

/**
 * Lock funds when agent is selected (agent_accepted state)
 */
function lockFunds(escrowId, agentId, agentWallet) {
  const escrow = loadEscrow(escrowId);
  if (!escrow) return { error: 'Escrow not found' };
  if (escrow.status !== ESCROW_STATUS.FUNDED) return { error: 'Escrow not funded' };
  
  escrow.status = ESCROW_STATUS.AGENT_ACCEPTED;
  escrow.agentId = agentId;
  escrow.agentWallet = agentWallet;
  escrow.lockedAt = new Date().toISOString();
  escrow.notes.push({ timestamp: new Date().toISOString(), action: 'agent_accepted', agentId });
  
  return saveEscrow(escrow);
}

/**
 * Mark agent as actively working (transition from accepted → locked/in_progress)
 */
function startWork(escrowId) {
  const escrow = loadEscrow(escrowId);
  if (!escrow) return { error: 'Escrow not found' };
  if (escrow.status !== ESCROW_STATUS.AGENT_ACCEPTED) return { error: 'Agent must be accepted first' };
  
  escrow.status = ESCROW_STATUS.LOCKED;
  escrow.workStartedAt = new Date().toISOString();
  escrow.notes.push({ timestamp: new Date().toISOString(), action: 'work_started' });
  
  return saveEscrow(escrow);
}

/**
 * Agent submits work — starts the 24h auto-release timer
 */
function submitWork(escrowId) {
  const escrow = loadEscrow(escrowId);
  if (!escrow) return { error: 'Escrow not found' };
  // Allow submission from agent_accepted or locked status
  if (![ESCROW_STATUS.AGENT_ACCEPTED, ESCROW_STATUS.LOCKED].includes(escrow.status)) {
    return { error: 'Escrow not in a submittable state' };
  }
  
  const now = new Date();
  const autoRelease = new Date(now.getTime() + AUTO_RELEASE_HOURS * 60 * 60 * 1000);
  
  escrow.status = ESCROW_STATUS.WORK_SUBMITTED;
  escrow.submittedAt = now.toISOString();
  escrow.autoReleaseAt = autoRelease.toISOString();
  escrow.notes.push({
    timestamp: now.toISOString(),
    action: 'work_submitted',
    autoReleaseAt: autoRelease.toISOString()
  });
  
  return saveEscrow(escrow);
}

/**
 * Release funds to agent (job completed / client approves)
 */
async function releaseFunds(escrowId, txHash = null) {
  const escrow = loadEscrow(escrowId);
  if (!escrow) return { error: 'Escrow not found' };
  // Allow release from locked, work_submitted, or agent_accepted
  if (![ESCROW_STATUS.LOCKED, ESCROW_STATUS.WORK_SUBMITTED, ESCROW_STATUS.AGENT_ACCEPTED].includes(escrow.status)) {
    return { error: 'Escrow not in releasable state' };
  }
  if (!escrow.agentWallet) {
    return { error: 'Agent wallet not set. Agent must provide Solana wallet address.' };
  }
  
  // Calculate dynamic fee based on agent performance
  let effectiveFeePct = PLATFORM_FEE_PCT;
  if (performanceFees && escrow.agentId) {
    try {
      const feeInfo = performanceFees.calculateFeeRate(escrow.agentId);
      effectiveFeePct = Math.round(feeInfo.rate * 100 * 10) / 10; // e.g. 3.5
      performanceFees.recordFee(escrow.agentId, escrowId, escrow.jobId, escrow.amount, feeInfo.rate, feeInfo.tier);
      console.log(`[Escrow] Dynamic fee for ${escrow.agentId}: ${effectiveFeePct}% (tier ${feeInfo.tier} - ${feeInfo.tierName})`);
    } catch (e) {
      console.warn('[Escrow] Performance fee calc failed, using default:', e.message);
    }
  }

  // On-chain release
  let onChainResult = null;
  if (escrow.currency === 'USDC') {
    try {
      const solanaEscrow = require('./solana-escrow');
      onChainResult = await solanaEscrow.releaseWithFeeSplit(
        escrow.agentWallet, escrow.amount, effectiveFeePct
      );
      txHash = onChainResult.agentTx;
      console.log('[Escrow] On-chain release successful:', onChainResult);
    } catch (err) {
      console.error('[Escrow] On-chain release failed:', err.message);
      return { error: 'On-chain release failed: ' + err.message };
    }
  }
  
  escrow.status = ESCROW_STATUS.RELEASED;
  escrow.releaseTxHash = txHash;
  escrow.treasuryTxHash = onChainResult?.treasuryTx || null;
  escrow.releasedAt = new Date().toISOString();
  
  // Track burn amount (not executed on-chain yet — placeholder for $BRAIN)
  if (escrow.burnPct > 0 && escrow.burnAmount > 0) {
    escrow.notes.push({
      timestamp: new Date().toISOString(),
      action: 'burn_tracked',
      burnAmount: escrow.burnAmount,
      burnPct: escrow.burnPct,
      burnAddress: escrow.burnAddress,
      note: 'Burn amount tracked for future $BRAIN integration'
    });
  }
  
  escrow.notes.push({
    timestamp: new Date().toISOString(),
    action: 'funds_released',
    to: escrow.agentWallet,
    amount: escrow.agentPayout,
    txHash, onChain: !!onChainResult
  });
  
  recordTransaction(escrowId, 'release', {
    txHash,
    treasuryTxHash: onChainResult?.treasuryTx,
    amount: escrow.agentPayout,
    fee: onChainResult?.fee || escrow.platformFee,
    currency: escrow.currency,
    from: PLATFORM_ESCROW_WALLET,
    to: escrow.agentWallet,
    treasuryWallet: onChainResult?.treasuryWallet,
    status: 'confirmed'
  });
  
  return saveEscrow(escrow);
}

/**
 * Auto-release: called by periodic check when 24h timer expires
 */
async function autoRelease(escrowId) {
  const escrow = loadEscrow(escrowId);
  if (!escrow) return { error: 'Escrow not found' };
  if (escrow.status !== ESCROW_STATUS.WORK_SUBMITTED) return { error: 'Not in work_submitted state' };
  if (!escrow.autoReleaseAt) return { error: 'No auto-release timer set' };
  
  const now = new Date();
  if (now < new Date(escrow.autoReleaseAt)) {
    return { error: 'Auto-release timer not yet expired' };
  }
  
  if (!escrow.agentWallet) {
    return { error: 'Agent wallet not set' };
  }
  
  // Calculate dynamic fee for auto-release
  let autoReleaseFeePct = PLATFORM_FEE_PCT;
  if (performanceFees && escrow.agentId) {
    try {
      const feeInfo = performanceFees.calculateFeeRate(escrow.agentId);
      autoReleaseFeePct = Math.round(feeInfo.rate * 100 * 10) / 10;
      performanceFees.recordFee(escrow.agentId, escrow.id, escrow.jobId, escrow.amount, feeInfo.rate, feeInfo.tier);
    } catch (e) { /* use default */ }
  }

  // Perform release (reuse on-chain logic)
  let onChainResult = null;
  let txHash = null;
  if (escrow.currency === 'USDC') {
    try {
      const solanaEscrow = require('./solana-escrow');
      onChainResult = await solanaEscrow.releaseWithFeeSplit(
        escrow.agentWallet, escrow.amount, autoReleaseFeePct
      );
      txHash = onChainResult.agentTx;
      console.log('[Escrow] Auto-release on-chain successful:', onChainResult);
    } catch (err) {
      console.error('[Escrow] Auto-release on-chain failed:', err.message);
      return { error: 'Auto-release on-chain failed: ' + err.message };
    }
  }
  
  escrow.status = ESCROW_STATUS.AUTO_RELEASED;
  escrow.autoReleaseExecuted = true;
  escrow.releaseTxHash = txHash;
  escrow.treasuryTxHash = onChainResult?.treasuryTx || null;
  escrow.releasedAt = new Date().toISOString();
  
  escrow.notes.push({
    timestamp: now.toISOString(),
    action: 'auto_released',
    reason: 'Client did not review within 24h of work submission',
    to: escrow.agentWallet,
    amount: escrow.agentPayout,
    txHash
  });
  
  recordTransaction(escrowId, 'auto_release', {
    txHash, amount: escrow.agentPayout, currency: escrow.currency,
    from: PLATFORM_ESCROW_WALLET, to: escrow.agentWallet,
    status: txHash ? 'confirmed' : 'pending_manual',
    metadata: { autoRelease: true }
  });
  
  return saveEscrow(escrow);
}

/**
 * Refund to client — full refund (agent never responded)
 */
function refundClient(escrowId, reason = '', txHash = null) {
  const escrow = loadEscrow(escrowId);
  if (!escrow) return { error: 'Escrow not found' };
  if (![ESCROW_STATUS.FUNDED, ESCROW_STATUS.LOCKED, ESCROW_STATUS.AGENT_ACCEPTED,
        ESCROW_STATUS.WORK_SUBMITTED, ESCROW_STATUS.DISPUTED].includes(escrow.status)) {
    return { error: 'Cannot refund escrow in current status' };
  }
  
  escrow.status = ESCROW_STATUS.REFUNDED;
  escrow.refundTxHash = txHash;
  escrow.refundedAt = new Date().toISOString();
  escrow.refundReason = reason;
  escrow.cancellationType = 'no_response';
  escrow.notes.push({ timestamp: new Date().toISOString(), action: 'refunded', reason, txHash });
  
  recordTransaction(escrowId, 'refund', {
    txHash, amount: escrow.amount, currency: escrow.currency,
    from: PLATFORM_ESCROW_WALLET, to: escrow.clientWallet,
    status: txHash ? 'confirmed' : 'pending_manual'
  });
  
  return saveEscrow(escrow);
}

/**
 * Cancel with compensation — agent accepted but not started
 * Client gets 90%, agent gets 10% compensation
 */
async function cancelWithCompensation(escrowId, reason = '') {
  const escrow = loadEscrow(escrowId);
  if (!escrow) return { error: 'Escrow not found' };
  if (escrow.status !== ESCROW_STATUS.AGENT_ACCEPTED) {
    return { error: 'Can only cancel with compensation when agent is accepted but work not started' };
  }
  
  const compensationAmount = Math.round(escrow.amount * CANCEL_COMPENSATION_PCT) / 100;
  const refundAmount = escrow.amount - compensationAmount;
  
  escrow.status = ESCROW_STATUS.CANCELLED_WITH_COMPENSATION;
  escrow.cancellationType = 'pre_start';
  escrow.compensationAmount = compensationAmount;
  escrow.compensationPct = CANCEL_COMPENSATION_PCT;
  escrow.refundAmount = refundAmount;
  escrow.refundedAt = new Date().toISOString();
  escrow.refundReason = reason || 'Client cancelled after agent accepted, before work started';
  
  escrow.notes.push({
    timestamp: new Date().toISOString(),
    action: 'cancelled_with_compensation',
    compensationAmount,
    compensationPct: CANCEL_COMPENSATION_PCT,
    refundAmount,
    reason: escrow.refundReason
  });
  
  // Record both transactions
  recordTransaction(escrowId, 'compensation', {
    amount: compensationAmount, currency: escrow.currency,
    from: PLATFORM_ESCROW_WALLET, to: escrow.agentWallet || 'pending',
    status: 'pending_manual',
    metadata: { type: 'agent_compensation', pct: CANCEL_COMPENSATION_PCT }
  });
  
  recordTransaction(escrowId, 'partial_refund', {
    amount: refundAmount, currency: escrow.currency,
    from: PLATFORM_ESCROW_WALLET, to: escrow.clientWallet,
    status: 'pending_manual',
    metadata: { type: 'client_partial_refund' }
  });
  
  return saveEscrow(escrow);
}

/**
 * Open dispute — requires 15% collateral from disputing party
 */
function openDispute(escrowId, disputeData) {
  const escrow = loadEscrow(escrowId);
  if (!escrow) return { error: 'Escrow not found' };
  if (![ESCROW_STATUS.LOCKED, ESCROW_STATUS.WORK_SUBMITTED, ESCROW_STATUS.AGENT_ACCEPTED].includes(escrow.status)) {
    return { error: 'Can only dispute active escrows (locked, work_submitted, or agent_accepted)' };
  }
  
  // Calculate collateral requirement
  const collateralAmount = Math.round(escrow.amount * DISPUTE_COLLATERAL_PCT) / 100;
  const collateralFrom = disputeData.openedBy === escrow.clientId ? 'client' : 'agent';
  
  // In custodial mode, we track the collateral requirement
  // (In on-chain mode, this would require a deposit tx)
  if (!disputeData.collateralAcknowledged) {
    return { 
      error: 'Dispute requires 15% collateral deposit',
      collateralRequired: collateralAmount,
      collateralPct: DISPUTE_COLLATERAL_PCT,
      currency: escrow.currency,
      note: 'Set collateralAcknowledged: true to confirm collateral'
    };
  }
  
  escrow.status = ESCROW_STATUS.DISPUTED;
  escrow.disputedAt = new Date().toISOString();
  escrow.disputeCollateralAmount = collateralAmount;
  escrow.disputeCollateralFrom = collateralFrom;
  escrow.disputeCollateralReturned = false;
  
  escrow.notes.push({
    timestamp: new Date().toISOString(),
    action: 'dispute_opened',
    openedBy: disputeData.openedBy,
    reason: disputeData.reason,
    collateralAmount,
    collateralFrom
  });
  
  const dispute = {
    id: `dispute_${crypto.randomBytes(8).toString('hex')}`,
    escrowId,
    jobId: escrow.jobId,
    openedBy: disputeData.openedBy,
    reason: disputeData.reason,
    evidence: disputeData.evidence || [],
    collateralAmount,
    collateralFrom,
    collateralTxHash: disputeData.collateralTxHash || null,
    status: 'open',
    resolution: null,
    resolvedBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  fs.writeFileSync(path.join(DATA_DIR, 'disputes', `${dispute.id}.json`), JSON.stringify(dispute, null, 2));
  
  escrow.disputeId = dispute.id;
  saveEscrow(escrow);
  
  return { escrow, dispute };
}

/**
 * Resolve dispute
 */
function resolveDispute(disputeId, resolution, resolvedBy) {
  ensureDataDirs();
  const disputePath = path.join(DATA_DIR, 'disputes', `${disputeId}.json`);
  if (!fs.existsSync(disputePath)) return { error: 'Dispute not found' };
  
  const dispute = JSON.parse(fs.readFileSync(disputePath, 'utf8'));
  const escrow = loadEscrow(dispute.escrowId);
  if (!escrow) return { error: 'Escrow not found' };
  
  dispute.status = 'resolved';
  dispute.resolution = resolution;
  dispute.resolvedBy = resolvedBy;
  dispute.resolvedAt = new Date().toISOString();
  dispute.updatedAt = new Date().toISOString();
  
  // Return collateral to the winning party (or forfeit from losing party)
  if (resolution === 'release_to_agent') {
    // Agent wins — collateral returned if agent filed, forfeited if client filed
    escrow.disputeCollateralReturned = (escrow.disputeCollateralFrom === 'agent');
  } else if (resolution === 'refund_to_client') {
    escrow.disputeCollateralReturned = (escrow.disputeCollateralFrom === 'client');
  }
  
  escrow.notes.push({
    timestamp: new Date().toISOString(),
    action: 'dispute_resolved',
    resolution,
    resolvedBy,
    collateralReturned: escrow.disputeCollateralReturned
  });
  saveEscrow(escrow);
  
  fs.writeFileSync(disputePath, JSON.stringify(dispute, null, 2));
  
  if (resolution === 'release_to_agent') {
    escrow.status = ESCROW_STATUS.LOCKED;
    saveEscrow(escrow);
    return releaseFunds(escrow.id);
  } else if (resolution === 'refund_to_client') {
    return refundClient(escrow.id, 'Dispute resolved in client\'s favor');
  } else if (resolution === 'split') {
    escrow.notes.push({
      timestamp: new Date().toISOString(),
      action: 'dispute_split',
      note: 'Manual split resolution required'
    });
    saveEscrow(escrow);
    return { escrow, dispute, needsManualSplit: true };
  }
  
  return { escrow, dispute };
}

// ============ AUTO-RELEASE SCANNER ============

/**
 * Scan for escrows where auto-release timer has expired.
 * Call this periodically (e.g., every 5 minutes).
 * Returns array of results.
 */
async function scanAutoRelease() {
  ensureDataDirs();
  const dir = path.join(DATA_DIR, 'escrows');
  if (!fs.existsSync(dir)) return [];
  
  const now = new Date();
  const results = [];
  
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    try {
      const e = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (e.status === ESCROW_STATUS.WORK_SUBMITTED && e.autoReleaseAt) {
        if (now >= new Date(e.autoReleaseAt)) {
          console.log(`[Escrow] Auto-releasing ${e.id} (timer expired)`);
          const result = await autoRelease(e.id);
          results.push({ escrowId: e.id, jobId: e.jobId, result });
        }
      }
    } catch (err) {
      console.error(`[Escrow] Error scanning ${file}:`, err.message);
    }
  }
  
  return results;
}

// ============ DISPUTE QUERY FUNCTIONS ============

function loadDispute(disputeId) {
  ensureDataDirs();
  const p = path.join(DATA_DIR, 'disputes', `${disputeId}.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function listDisputes(filters = {}) {
  ensureDataDirs();
  const dir = path.join(DATA_DIR, 'disputes');
  if (!fs.existsSync(dir)) return [];

  let disputes = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } })
    .filter(Boolean);

  if (filters.status) disputes = disputes.filter(d => d.status === filters.status);
  if (filters.escrowId) disputes = disputes.filter(d => d.escrowId === filters.escrowId);
  if (filters.openedBy) disputes = disputes.filter(d => d.openedBy === filters.openedBy);
  if (filters.jobId) disputes = disputes.filter(d => d.jobId === filters.jobId);

  disputes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return disputes;
}

function addDisputeEvidence(disputeId, evidence) {
  const dispute = loadDispute(disputeId);
  if (!dispute) return { error: 'Dispute not found' };
  if (dispute.status !== 'open') return { error: 'Cannot add evidence to resolved dispute' };

  const entry = {
    id: `ev_${crypto.randomBytes(4).toString('hex')}`,
    submittedBy: evidence.submittedBy,
    type: evidence.type || 'text', // text, link, screenshot
    content: evidence.content,
    description: evidence.description || '',
    submittedAt: new Date().toISOString()
  };

  if (!dispute.evidence) dispute.evidence = [];
  dispute.evidence.push(entry);
  dispute.updatedAt = new Date().toISOString();

  fs.writeFileSync(path.join(DATA_DIR, 'disputes', `${disputeId}.json`), JSON.stringify(dispute, null, 2));
  return { dispute, entry };
}

function getDisputeStats() {
  const disputes = listDisputes();
  return {
    total: disputes.length,
    open: disputes.filter(d => d.status === 'open').length,
    resolved: disputes.filter(d => d.status === 'resolved').length,
    byResolution: {
      release_to_agent: disputes.filter(d => d.resolution === 'release_to_agent').length,
      refund_to_client: disputes.filter(d => d.resolution === 'refund_to_client').length,
      split: disputes.filter(d => d.resolution === 'split').length
    }
  };
}

// ============ QUERY FUNCTIONS ============

function getEscrowStatus(jobId) {
  const escrow = loadEscrowByJob(jobId);
  if (!escrow) return null;
  
  return {
    id: escrow.id,
    status: escrow.status,
    amount: escrow.amount,
    currency: escrow.currency,
    platformFee: escrow.platformFee,
    agentPayout: escrow.agentPayout,
    burnPct: escrow.burnPct || 0,
    burnAmount: escrow.burnAmount || 0,
    depositAddress: escrow.depositAddress,
    isDeposited: !!escrow.depositConfirmedAt,
    isLocked: [ESCROW_STATUS.LOCKED, ESCROW_STATUS.AGENT_ACCEPTED].includes(escrow.status),
    isReleased: [ESCROW_STATUS.RELEASED, ESCROW_STATUS.AUTO_RELEASED].includes(escrow.status),
    isDisputed: escrow.status === ESCROW_STATUS.DISPUTED,
    isWorkSubmitted: escrow.status === ESCROW_STATUS.WORK_SUBMITTED,
    submittedAt: escrow.submittedAt,
    autoReleaseAt: escrow.autoReleaseAt,
    clientWallet: escrow.clientWallet,
    agentWallet: escrow.agentWallet,
    disputeCollateralAmount: escrow.disputeCollateralAmount,
    cancellationType: escrow.cancellationType,
    compensationAmount: escrow.compensationAmount
  };
}

function listEscrows(filters = {}) {
  ensureDataDirs();
  const dir = path.join(DATA_DIR, 'escrows');
  if (!fs.existsSync(dir)) return [];
  
  let escrows = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } })
    .filter(Boolean);
  
  if (filters.status) escrows = escrows.filter(e => e.status === filters.status);
  if (filters.clientId) escrows = escrows.filter(e => e.clientId === filters.clientId);
  if (filters.agentId) escrows = escrows.filter(e => e.agentId === filters.agentId);
  
  escrows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return escrows;
}

function getEscrowStats() {
  const escrows = listEscrows();
  
  const totalDeposited = escrows.filter(e => e.depositConfirmedAt).reduce((s, e) => s + e.amount, 0);
  const releasedStatuses = [ESCROW_STATUS.RELEASED, ESCROW_STATUS.AUTO_RELEASED];
  const totalReleased = escrows.filter(e => releasedStatuses.includes(e.status)).reduce((s, e) => s + e.agentPayout, 0);
  const totalFees = escrows.filter(e => releasedStatuses.includes(e.status)).reduce((s, e) => s + e.platformFee, 0);
  const totalRefunded = escrows.filter(e => e.status === ESCROW_STATUS.REFUNDED).reduce((s, e) => s + e.amount, 0);
  const totalBurned = escrows.filter(e => releasedStatuses.includes(e.status) && e.burnAmount > 0).reduce((s, e) => s + (e.burnAmount || 0), 0);
  const totalCompensation = escrows.filter(e => e.status === ESCROW_STATUS.CANCELLED_WITH_COMPENSATION).reduce((s, e) => s + (e.compensationAmount || 0), 0);
  
  const activeEscrows = escrows.filter(e => 
    [ESCROW_STATUS.FUNDED, ESCROW_STATUS.LOCKED, ESCROW_STATUS.AGENT_ACCEPTED, ESCROW_STATUS.WORK_SUBMITTED].includes(e.status)
  );
  
  return {
    totalEscrows: escrows.length,
    activeEscrows: activeEscrows.length,
    totalDeposited, totalReleased, totalFees, totalRefunded, totalBurned, totalCompensation,
    pendingValue: activeEscrows.reduce((s, e) => s + e.amount, 0),
    byStatus: {
      pending_deposit: escrows.filter(e => e.status === ESCROW_STATUS.PENDING_DEPOSIT).length,
      funded: escrows.filter(e => e.status === ESCROW_STATUS.FUNDED).length,
      agent_accepted: escrows.filter(e => e.status === ESCROW_STATUS.AGENT_ACCEPTED).length,
      locked: escrows.filter(e => e.status === ESCROW_STATUS.LOCKED).length,
      work_submitted: escrows.filter(e => e.status === ESCROW_STATUS.WORK_SUBMITTED).length,
      released: escrows.filter(e => e.status === ESCROW_STATUS.RELEASED).length,
      auto_released: escrows.filter(e => e.status === ESCROW_STATUS.AUTO_RELEASED).length,
      refunded: escrows.filter(e => e.status === ESCROW_STATUS.REFUNDED).length,
      cancelled_with_compensation: escrows.filter(e => e.status === ESCROW_STATUS.CANCELLED_WITH_COMPENSATION).length,
      disputed: escrows.filter(e => e.status === ESCROW_STATUS.DISPUTED).length
    }
  };
}

function getDepositInstructions(escrowId) {
  const escrow = loadEscrow(escrowId);
  if (!escrow) return null;
  const c = CURRENCIES[escrow.currency] || CURRENCIES.USDC;
  return {
    escrowId: escrow.id,
    amount: escrow.amount,
    currency: escrow.currency,
    currencyIcon: c.icon,
    depositAddress: escrow.depositAddress,
    network: 'Solana',
    instructions: [
      `Send exactly ${escrow.amount} ${escrow.currency} to the escrow address below`,
      'Use a Solana wallet (Phantom, Solflare, etc.)',
      'Include the escrow ID in the memo/reference field',
      'Wait for confirmation (usually 1-2 minutes on Solana)'
    ],
    qrData: `solana:${escrow.depositAddress}?amount=${escrow.amount}&spl-token=${c.mint}&memo=${escrow.id}`,
    expiresAt: escrow.expiresAt,
    note: `Funds held in escrow until job completion. Platform fee: ${PLATFORM_FEE_PCT}%` +
      (escrow.burnPct > 0 ? ` | Burn: ${escrow.burnPct}%` : '')
  };
}

// ============ EXPORTS ============

module.exports = {
  // Constants
  ESCROW_STATUS,
  CURRENCIES,
  PLATFORM_FEE_PCT,
  PLATFORM_ESCROW_WALLET,
  DISPUTE_COLLATERAL_PCT,
  AUTO_RELEASE_HOURS,
  CANCEL_COMPENSATION_PCT,
  
  // Core
  createEscrow,
  loadEscrow,
  loadEscrowByJob,
  saveEscrow,
  
  // Flow
  confirmDeposit,
  lockFunds,
  startWork,
  submitWork,
  releaseFunds,
  autoRelease,
  refundClient,
  cancelWithCompensation,
  
  // Disputes
  openDispute,
  resolveDispute,
  loadDispute,
  listDisputes,
  addDisputeEvidence,
  getDisputeStats,
  
  // Auto-release scanner
  scanAutoRelease,
  
  // Query
  getEscrowStatus,
  listEscrows,
  getEscrowStats,
  getDepositInstructions,
  
  // Transactions
  recordTransaction
};
