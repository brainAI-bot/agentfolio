/**
 * Marketplace On-Chain Escrow Integration
 * 
 * Wires the escrow_v3 Solana program into marketplace job lifecycle.
 * All fund/release/refund actions require wallet signature (no spoofing).
 * Returns unsigned transactions for client-side signing.
 * 
 * Endpoints:
 *   POST /api/marketplace/jobs/:id/escrow/onchain     — Build unsigned fund escrow TX
 *   POST /api/marketplace/jobs/:id/escrow/confirm      — Confirm signed TX, update job state
 *   POST /api/marketplace/escrow/:id/release/onchain   — Build unsigned release TX
 *   POST /api/marketplace/escrow/:id/release/confirm    — Confirm release TX
 *   POST /api/marketplace/escrow/:id/refund/onchain     — Build unsigned refund TX
 *   POST /api/marketplace/escrow/:id/refund/confirm     — Confirm refund TX
 *   GET  /api/marketplace/escrow/:id/onchain            — Read on-chain escrow state
 * 
 * brainForge — 2026-04-02
 */

const path = require('path');
const fs = require('fs');
const nacl = require('tweetnacl');
const _bs58 = require('bs58');
const bs58 = _bs58.default || _bs58;

let escrowOnchain;
try {
  escrowOnchain = require('./lib/escrow-onchain');
  console.log('[Marketplace Escrow] ✅ On-chain escrow module loaded');
} catch (e) {
  console.warn('[Marketplace Escrow] ⚠️ escrow-onchain not available:', e.message);
}

const DATA_DIR = path.join(__dirname, '..', 'data', 'marketplace');
const { syncMarketplaceJobToDb, syncMarketplaceEscrowToDb } = require('./lib/marketplace-db-sync');
const MARKETPLACE_AUTH_WINDOW_MS = 5 * 60 * 1000;

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function writeJSON(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function resolveExistingProfileId(actorId) {
  if (actorId == null) return null;
  const raw = String(actorId).trim();
  if (!raw) return null;
  try {
    const profileStore = require('./profile-store');
    const db = profileStore.getDb();
    let row = db.prepare('SELECT id FROM profiles WHERE id = ?').get(raw);
    if (!row && !raw.startsWith('agent_')) {
      row = db.prepare('SELECT id FROM profiles WHERE id = ?').get('agent_' + raw.toLowerCase());
    }
    if (!row) {
      row = db.prepare('SELECT id FROM profiles WHERE LOWER(name) = ?').get(raw.toLowerCase());
    }
    if (!row) {
      row = db.prepare(`
        SELECT id FROM profiles
        WHERE LOWER(json_extract(wallets, '$.solana')) = LOWER(?)
           OR LOWER(json_extract(wallets, '$.ethereum')) = LOWER(?)
           OR LOWER(json_extract(verification_data, '$.solana.address')) = LOWER(?)
           OR LOWER(json_extract(verification_data, '$.eth.address')) = LOWER(?)
           OR LOWER(json_extract(verification_data, '$.ethereum.address')) = LOWER(?)
        LIMIT 1
      `).get(raw, raw, raw, raw, raw);
    }
    return row ? row.id : null;
  } catch (_) {
    return null;
  }
}

function walletMatchesClaimedActor(claimedActorId, walletAddress) {
  if (claimedActorId == null || walletAddress == null) return false;
  const claimed = String(claimedActorId).trim();
  const wallet = String(walletAddress).trim();
  if (!claimed || !wallet) return false;
  try {
    const profileStore = require('./profile-store');
    const db = profileStore.getDb();
    let row = db.prepare('SELECT id, wallet, wallets, verification_data FROM profiles WHERE id = ?').get(claimed);
    if (!row && !claimed.startsWith('agent_')) {
      row = db.prepare('SELECT id, wallet, wallets, verification_data FROM profiles WHERE id = ?').get('agent_' + claimed.toLowerCase());
    }
    if (!row) {
      row = db.prepare('SELECT id, wallet, wallets, verification_data FROM profiles WHERE LOWER(name) = ?').get(claimed.toLowerCase());
    }
    if (!row) return false;
    const wallets = typeof row.wallets === 'string' ? JSON.parse(row.wallets || '{}') : (row.wallets || {});
    const verificationData = typeof row.verification_data === 'string' ? JSON.parse(row.verification_data || '{}') : (row.verification_data || {});
    const candidates = [
      row.wallet,
      wallets?.solana,
      wallets?.solana_wallet,
      wallets?.wallet,
      verificationData?.solana?.address,
      verificationData?.solana?.identifier,
      verificationData?.eth?.address,
      verificationData?.ethereum?.address,
    ].filter(Boolean).map((value) => String(value).trim().toLowerCase());
    return candidates.includes(wallet.toLowerCase());
  } catch (_) {
    return false;
  }
}

function normalizeActorId(actorId) {
  if (actorId == null) return null;
  const raw = String(actorId).trim();
  if (!raw) return null;
  return resolveExistingProfileId(raw) || raw;
}

function matchesActor(actorId, expectedId) {
  if (actorId == null || expectedId == null) return false;
  const rawActor = String(actorId).trim();
  const rawExpected = String(expectedId).trim();
  if (!rawActor || !rawExpected) return false;
  if (rawActor === rawExpected) return true;
  const normalizedActor = normalizeActorId(rawActor);
  const normalizedExpected = normalizeActorId(rawExpected);
  return !!normalizedActor && normalizedActor === normalizedExpected;
}

function isJobPoster(actorId, job) {
  return !!job && (matchesActor(actorId, job.clientId) || matchesActor(actorId, job.postedBy));
}

function isAcceptedWorker(actorId, job) {
  return !!job && (matchesActor(actorId, job.acceptedApplicant) || matchesActor(actorId, job.selectedAgentId));
}

function buildMarketplaceAuthMessage({ action, jobId = '-', escrowId = '-', actorId = '-', walletAddress = '-', timestamp = '-' }) {
  return [
    'agentfolio-marketplace',
    action,
    jobId || '-',
    '-',
    escrowId || '-',
    '-',
    actorId || '-',
    walletAddress || '-',
    timestamp || '-',
  ].join(':');
}

function verifyMarketplaceOnchainAction(req, { action, job, actorId, escrowId = '-' }) {
  const walletAddress = String(req.headers['x-wallet-address'] || req.body?.walletAddress || '').trim();
  const walletSignature = String(req.headers['x-wallet-signature'] || req.body?.walletSignature || '').trim();
  const walletMessage = String(req.headers['x-wallet-message'] || req.body?.walletMessage || '').trim();
  const walletTimestamp = String(req.headers['x-wallet-timestamp'] || req.body?.walletTimestamp || '').trim();

  if (!walletAddress || !walletSignature || !walletMessage || !walletTimestamp) {
    return { ok: false, status: 401, error: 'Wallet signature required for marketplace action' };
  }
  if (!/^\d{10,}$/.test(walletTimestamp)) {
    return { ok: false, status: 400, error: 'Invalid wallet auth timestamp' };
  }

  const timestampNumber = Number(walletTimestamp);
  if (!Number.isFinite(timestampNumber) || Math.abs(Date.now() - timestampNumber) > MARKETPLACE_AUTH_WINDOW_MS) {
    return { ok: false, status: 401, error: 'Wallet auth expired. Please sign again.' };
  }

  const claimedActorId = actorId == null ? '' : String(actorId).trim();
  const expectedMessage = buildMarketplaceAuthMessage({
    action,
    jobId: job?.id || req.params?.id || '-',
    escrowId,
    actorId: claimedActorId || '-',
    walletAddress,
    timestamp: walletTimestamp,
  });

  if (walletMessage !== expectedMessage) {
    return { ok: false, status: 400, error: 'Wallet auth message mismatch' };
  }

  try {
    const sigBytes = Buffer.from(walletSignature, 'base64');
    const msgBytes = Buffer.from(walletMessage);
    const pubBytes = bs58.decode(walletAddress);
    if (!nacl.sign.detached.verify(msgBytes, sigBytes, pubBytes)) {
      return { ok: false, status: 403, error: 'Invalid wallet signature' };
    }
  } catch (e) {
    return { ok: false, status: 400, error: `Wallet auth verification failed: ${e.message}` };
  }

  const walletActorId = normalizeActorId(walletAddress) || walletAddress;
  if (claimedActorId && !matchesActor(claimedActorId, walletActorId) && !walletMatchesClaimedActor(claimedActorId, walletAddress)) {
    return { ok: false, status: 403, error: 'Signed wallet does not control the claimed marketplace actor' };
  }
  const effectiveActorId = normalizeActorId(claimedActorId || walletActorId) || claimedActorId || walletActorId;
  if (job && !isJobPoster(effectiveActorId, job) && !isJobPoster(walletAddress, job)) {
    return { ok: false, status: 403, error: 'Only the job poster can perform this action' };
  }

  return { ok: true, actorId: effectiveActorId, walletAddress, walletTimestamp: timestampNumber };
}

function registerMarketplaceEscrowOnchain(app) {
  if (!escrowOnchain) {
    console.warn('[Marketplace Escrow] Skipping on-chain routes (module not loaded)');
    return;
  }

  // 1. Fund escrow (build unsigned TX)
  app.post('/api/marketplace/jobs/:id/escrow/onchain', async (req, res) => {
    try {
      const jobPath = path.join(DATA_DIR, 'jobs', `${req.params.id}.json`);
      const job = readJSON(jobPath);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      if (!['open', 'in_progress', 'awaiting_funding'].includes(job.status)) return res.status(400).json({ error: 'Job must be open, awaiting_funding, or in_progress to fund escrow' });
      if (job.onchainEscrowPDA) return res.status(400).json({ error: 'On-chain escrow already created for this job' });

      const { clientWallet, amount, deadlineUnix } = req.body;
      if (!clientWallet || !amount) return res.status(400).json({ error: 'clientWallet and amount required' });
      if (!isJobPoster(clientWallet, job)) {
        return res.status(403).json({ error: 'Only the job poster can fund escrow' });
      }

      const deadline = deadlineUnix || Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
      const result = await escrowOnchain.buildCreateEscrowTx(clientWallet, req.params.id, parseFloat(amount), deadline);

      if (!result.success) return res.status(500).json({ error: 'Failed to build escrow TX', details: result });

      res.json({
        transaction: result.transaction,
        escrowPDA: result.escrowPDA,
        vaultPDA: result.vaultPDA,
        jobId: req.params.id,
        amount: parseFloat(amount),
        deadline,
        message: 'Sign this transaction with your wallet to fund the on-chain escrow'
      });
    } catch (e) {
      console.error('[Marketplace Escrow] Fund error:', e.message);
      res.status(500).json({ error: 'Failed to build escrow transaction', details: e.message });
    }
  });

  // 2. Confirm funded escrow (after client signs + submits TX)
  app.post('/api/marketplace/jobs/:id/escrow/confirm', async (req, res) => {
    try {
      const jobPath = path.join(DATA_DIR, 'jobs', `${req.params.id}.json`);
      const job = readJSON(jobPath);
      if (!job) return res.status(404).json({ error: 'Job not found' });

      const { txSignature, escrowPDA, clientWallet } = req.body;
      if (!txSignature || !escrowPDA) return res.status(400).json({ error: 'txSignature and escrowPDA required' });
      if (!clientWallet) return res.status(400).json({ error: 'clientWallet required' });

      const auth = verifyMarketplaceOnchainAction(req, {
        action: 'confirm_onchain_escrow',
        job,
        actorId: clientWallet,
        escrowId: escrowPDA,
      });
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
      if (!isJobPoster(auth.actorId, job) || !matchesActor(auth.actorId, clientWallet)) {
        return res.status(403).json({ error: 'Only the job poster can confirm escrow funding' });
      }

      const confirmed = await escrowOnchain.confirmTransaction(txSignature);
      if (!confirmed) return res.status(400).json({ error: 'Transaction not confirmed on-chain' });

      let onchainState;
      try { onchainState = await escrowOnchain.readEscrowAccount(job.id); } catch { onchainState = null; }
      if (!onchainState?.exists) return res.status(400).json({ error: 'Escrow PDA not found on-chain' });
      if (onchainState.escrowPDA !== escrowPDA) return res.status(400).json({ error: 'Escrow PDA mismatch' });
      if (onchainState.status !== 'created') return res.status(400).json({ error: `Escrow is ${onchainState.status || 'not funded'} on-chain` });
      if (clientWallet && onchainState.client !== clientWallet) return res.status(400).json({ error: 'On-chain client wallet mismatch' });

      const amt = onchainState ? onchainState.amountUSDC : parseFloat(req.body.amount || 0);
      const escrow = {
        id: genId('esc'),
        jobId: job.id,
        fundedBy: clientWallet || job.clientId,
        worker: job.acceptedApplicant,
        amount: amt,
        currency: 'USDC',
        platformFee: amt * 0.05,
        workerPayout: amt * 0.95,
        txHash: txSignature,
        escrowPDA,
        onchain: true,
        status: 'funded',
        fundedAt: new Date().toISOString(),
        releasedAt: null,
        refundedAt: null
      };
      writeJSON(path.join(DATA_DIR, 'escrow', `${escrow.id}.json`), escrow);
      try { syncMarketplaceEscrowToDb(escrow, job); } catch (e) { console.warn('[Marketplace Escrow] escrow DB sync failed after funding:', e.message); }

      job.escrowId = escrow.id;
      job.onchainEscrowPDA = escrowPDA;
      job.escrowFunded = true;
      job.depositConfirmedAt = escrow.fundedAt;
      job.fundsLocked = true;
      if (job.selectedAgentId || job.acceptedApplicant) {
        job.status = 'in_progress';
      }
      job.updatedAt = new Date().toISOString();
      writeJSON(jobPath, job);
      try { syncMarketplaceJobToDb(job); } catch (e) { console.warn('[Marketplace Escrow] job DB sync failed after funding:', e.message); }

      res.status(201).json({
        message: 'On-chain escrow confirmed and linked to job',
        escrow,
        onchainState,
        explorerUrl: `https://explorer.solana.com/tx/${txSignature}`
      });
    } catch (e) {
      console.error('[Marketplace Escrow] Confirm error:', e.message);
      res.status(500).json({ error: 'Failed to confirm escrow', details: e.message });
    }
  });

  // 3. Agent accepts escrow on-chain (build unsigned TX)
  app.post('/api/marketplace/jobs/:id/escrow/accept/onchain', async (req, res) => {
    try {
      const jobPath = path.join(DATA_DIR, 'jobs', `${req.params.id}.json`);
      const job = readJSON(jobPath);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      if (!job.onchainEscrowPDA) return res.status(400).json({ error: 'On-chain escrow not created for this job' });

      const { agentWallet, agentId, actorId } = req.body;
      if (!agentWallet) return res.status(400).json({ error: 'agentWallet required' });
      const workerActor = String(agentId || actorId || agentWallet || '').trim();
      if (!isAcceptedWorker(workerActor, job)) {
        return res.status(403).json({ error: 'Only the accepted worker can accept escrow' });
      }

      const result = await escrowOnchain.buildAcceptJobTx(agentWallet, req.params.id);
      if (!result.success) return res.status(500).json({ error: 'Failed to build accept_job TX' });

      res.json({
        transaction: result.transaction,
        escrowPDA: result.escrowPDA,
        jobId: req.params.id,
        message: 'Sign this transaction with the accepted agent wallet to accept the on-chain escrow'
      });
    } catch (e) {
      console.error('[Marketplace Escrow] Accept build error:', e.message);
      res.status(500).json({ error: 'Failed to build accept transaction', details: e.message });
    }
  });

  // 4. Agent submits work on-chain (build unsigned TX)
  app.post('/api/marketplace/jobs/:id/escrow/submit/onchain', async (req, res) => {
    try {
      const jobPath = path.join(DATA_DIR, 'jobs', `${req.params.id}.json`);
      const job = readJSON(jobPath);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      if (!job.onchainEscrowPDA) return res.status(400).json({ error: 'On-chain escrow not created for this job' });

      const { agentWallet, agentId, actorId } = req.body;
      if (!agentWallet) return res.status(400).json({ error: 'agentWallet required' });
      const workerActor = String(agentId || actorId || agentWallet || '').trim();
      if (!isAcceptedWorker(workerActor, job)) {
        return res.status(403).json({ error: 'Only the accepted worker can submit work' });
      }

      const result = await escrowOnchain.buildSubmitWorkTx(agentWallet, req.params.id);
      if (!result.success) return res.status(500).json({ error: 'Failed to build submit_work TX' });

      res.json({
        transaction: result.transaction,
        escrowPDA: result.escrowPDA,
        jobId: req.params.id,
        message: 'Sign this transaction with the accepted agent wallet to submit work on-chain'
      });
    } catch (e) {
      console.error('[Marketplace Escrow] Submit build error:', e.message);
      res.status(500).json({ error: 'Failed to build submit transaction', details: e.message });
    }
  });

  // 5. Release payment (build unsigned TX)
  app.post('/api/marketplace/escrow/:id/release/onchain', async (req, res) => {
    try {
      const escrowPath = path.join(DATA_DIR, 'escrow', `${req.params.id}.json`);
      const escrow = readJSON(escrowPath);
      if (!escrow) return res.status(404).json({ error: 'Escrow not found' });
      if (!escrow.onchain) return res.status(400).json({ error: 'Not an on-chain escrow. Use /release instead.' });
      if (escrow.status !== 'funded') return res.status(400).json({ error: 'Escrow not in funded state' });

      const { clientWallet, agentWallet } = req.body;
      if (!clientWallet || !agentWallet) return res.status(400).json({ error: 'clientWallet and agentWallet required' });
      const jobPath = path.join(DATA_DIR, 'jobs', `${escrow.jobId}.json`);
      const job = readJSON(jobPath);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      if (!isJobPoster(clientWallet, job) || !matchesActor(clientWallet, escrow.fundedBy)) {
        return res.status(403).json({ error: 'Only the job poster can release payment' });
      }
      if (!isAcceptedWorker(agentWallet, job)) {
        return res.status(403).json({ error: 'Only the accepted worker can be paid for this job' });
      }
      const onchainState = await escrowOnchain.readEscrowAccount(escrow.jobId);
      if (!onchainState?.exists) return res.status(400).json({ error: 'Escrow PDA not found on-chain' });
      if (!['work_submitted', 'agent_accepted'].includes(onchainState.status)) {
        return res.status(400).json({ error: `Escrow is ${onchainState.status || 'not releasable'} on-chain` });
      }

      const result = await escrowOnchain.buildReleaseTx(clientWallet, agentWallet, escrow.jobId);
      if (!result.success) return res.status(500).json({ error: 'Failed to build release TX' });

      res.json({
        transaction: result.transaction,
        escrowPDA: result.escrowPDA,
        escrowId: escrow.id,
        message: 'Sign this transaction to release payment to the agent'
      });
    } catch (e) {
      console.error('[Marketplace Escrow] Release build error:', e.message);
      res.status(500).json({ error: 'Failed to build release transaction', details: e.message });
    }
  });

  // 4. Confirm release
  app.post('/api/marketplace/escrow/:id/release/confirm', async (req, res) => {
    try {
      const escrowPath = path.join(DATA_DIR, 'escrow', `${req.params.id}.json`);
      const escrow = readJSON(escrowPath);
      if (!escrow) return res.status(404).json({ error: 'Escrow not found' });

      const { txSignature, clientWallet } = req.body;
      if (!txSignature) return res.status(400).json({ error: 'txSignature required' });
      if (!clientWallet) return res.status(400).json({ error: 'clientWallet required' });

      const jobPath = path.join(DATA_DIR, 'jobs', `${escrow.jobId}.json`);
      const job = readJSON(jobPath);
      if (!job) return res.status(404).json({ error: 'Job not found' });

      const auth = verifyMarketplaceOnchainAction(req, {
        action: 'confirm_onchain_release',
        job,
        actorId: clientWallet,
        escrowId: escrow.id,
      });
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
      if (!isJobPoster(auth.actorId, job) || !matchesActor(auth.actorId, escrow.fundedBy)) {
        return res.status(403).json({ error: 'Only the job poster can confirm release' });
      }

      const confirmed = await escrowOnchain.confirmTransaction(txSignature);
      if (!confirmed) return res.status(400).json({ error: 'Transaction not confirmed on-chain' });

      const onchainState = await escrowOnchain.readEscrowAccount(escrow.jobId);
      if (!onchainState?.exists) return res.status(400).json({ error: 'Escrow PDA not found on-chain' });
      if (!['released', 'auto_released'].includes(onchainState.status)) {
        return res.status(400).json({ error: 'Escrow PDA is not released on-chain' });
      }

      escrow.status = 'released';
      escrow.releaseTxHash = txSignature;
      escrow.releasedAt = new Date().toISOString();
      writeJSON(escrowPath, escrow);
      try { syncMarketplaceEscrowToDb(escrow); } catch (e) { console.warn('[Marketplace Escrow] escrow DB sync failed after release:', e.message); }

      if (job) {
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
        job.updatedAt = new Date().toISOString();
        job.fundsReleased = true;
        job.fundsLocked = false;
        job.escrowFunded = true;
        job.releaseTxHash = txSignature;
        job.releasedAt = escrow.releasedAt || new Date().toISOString();
        writeJSON(jobPath, job);
        try { syncMarketplaceJobToDb(job); } catch (e) { console.warn('[Marketplace Escrow] job DB sync failed after release:', e.message); }
        if (job.deliverableId) {
          const dlvPath = path.join(DATA_DIR, 'deliverables', `${job.deliverableId}.json`);
          const dlv = readJSON(dlvPath);
          if (dlv) { dlv.status = 'approved'; writeJSON(dlvPath, dlv); }
        }
      }

      res.json({
        message: 'Payment released on-chain',
        escrow,
        explorerUrl: `https://explorer.solana.com/tx/${txSignature}`
      });
    } catch (e) {
      console.error('[Marketplace Escrow] Release confirm error:', e.message);
      res.status(500).json({ error: 'Failed to confirm release', details: e.message });
    }
  });

  // 5. Refund (build unsigned TX)
  app.post('/api/marketplace/escrow/:id/refund/onchain', async (req, res) => {
    try {
      const escrowPath = path.join(DATA_DIR, 'escrow', `${req.params.id}.json`);
      const escrow = readJSON(escrowPath);
      if (!escrow) return res.status(404).json({ error: 'Escrow not found' });
      if (!escrow.onchain) return res.status(400).json({ error: 'Not an on-chain escrow' });
      if (escrow.status !== 'funded') return res.status(400).json({ error: 'Escrow not in funded state' });

      const { clientWallet } = req.body;
      if (!clientWallet) return res.status(400).json({ error: 'clientWallet required' });
      const jobPath = path.join(DATA_DIR, 'jobs', `${escrow.jobId}.json`);
      const job = readJSON(jobPath);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      if (!isJobPoster(clientWallet, job) || !matchesActor(clientWallet, escrow.fundedBy)) {
        return res.status(403).json({ error: 'Only the job poster can request refund' });
      }

      const result = await escrowOnchain.buildRefundTx(clientWallet, escrow.jobId);
      if (!result.success) return res.status(500).json({ error: 'Failed to build refund TX' });

      res.json({
        transaction: result.transaction,
        escrowPDA: result.escrowPDA,
        escrowId: escrow.id,
        message: 'Sign this transaction to refund the escrow'
      });
    } catch (e) {
      console.error('[Marketplace Escrow] Refund build error:', e.message);
      res.status(500).json({ error: 'Failed to build refund transaction', details: e.message });
    }
  });

  // 6. Confirm refund
  app.post('/api/marketplace/escrow/:id/refund/confirm', async (req, res) => {
    try {
      const escrowPath = path.join(DATA_DIR, 'escrow', `${req.params.id}.json`);
      const escrow = readJSON(escrowPath);
      if (!escrow) return res.status(404).json({ error: 'Escrow not found' });

      const { txSignature, clientWallet } = req.body;
      if (!txSignature) return res.status(400).json({ error: 'txSignature required' });
      if (!clientWallet) return res.status(400).json({ error: 'clientWallet required' });

      const jobPath = path.join(DATA_DIR, 'jobs', `${escrow.jobId}.json`);
      const job = readJSON(jobPath);
      if (!job) return res.status(404).json({ error: 'Job not found' });

      const auth = verifyMarketplaceOnchainAction(req, {
        action: 'confirm_onchain_refund',
        job,
        actorId: clientWallet,
        escrowId: escrow.id,
      });
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
      if (!isJobPoster(auth.actorId, job) || !matchesActor(auth.actorId, escrow.fundedBy)) {
        return res.status(403).json({ error: 'Only the job poster can confirm refund' });
      }

      const confirmed = await escrowOnchain.confirmTransaction(txSignature);
      if (!confirmed) return res.status(400).json({ error: 'Transaction not confirmed on-chain' });

      const onchainState = await escrowOnchain.readEscrowAccount(escrow.jobId);
      if (!onchainState?.exists) return res.status(400).json({ error: 'Escrow PDA not found on-chain' });
      if (onchainState.status !== 'refunded') return res.status(400).json({ error: 'Escrow PDA is not refunded on-chain' });

      escrow.status = 'refunded';
      escrow.refundTxHash = txSignature;
      escrow.refundedAt = new Date().toISOString();
      writeJSON(escrowPath, escrow);
      try { syncMarketplaceEscrowToDb(escrow); } catch (e) { console.warn('[Marketplace Escrow] escrow DB sync failed after refund:', e.message); }

      if (job) {
        job.status = 'cancelled';
        job.updatedAt = new Date().toISOString();
        writeJSON(jobPath, job);
      }

      res.json({
        message: 'Escrow refunded on-chain',
        escrow,
        explorerUrl: `https://explorer.solana.com/tx/${txSignature}`
      });
    } catch (e) {
      console.error('[Marketplace Escrow] Refund confirm error:', e.message);
      res.status(500).json({ error: 'Failed to confirm refund', details: e.message });
    }
  });

  // 7. Read on-chain escrow state
  app.get('/api/marketplace/escrow/:id/onchain', async (req, res) => {
    try {
      const escrowPath = path.join(DATA_DIR, 'escrow', `${req.params.id}.json`);
      const escrow = readJSON(escrowPath);
      if (!escrow) return res.status(404).json({ error: 'Escrow not found' });
      if (!escrow.escrowPDA) return res.status(400).json({ error: 'No on-chain PDA linked' });

      const onchainState = await escrowOnchain.readEscrowAccount(escrow.jobId);
      const localNeedsSync = (onchainState.status === 'released' && escrow.status === 'funded') ||
                              (onchainState.status === 'refunded' && escrow.status === 'funded');

      res.json({
        local: escrow,
        onchain: onchainState,
        synced: !localNeedsSync,
        syncWarning: localNeedsSync ? 'On-chain state differs from local — may need manual sync' : null
      });
    } catch (e) {
      console.error('[Marketplace Escrow] Read onchain error:', e.message);
      res.status(500).json({ error: 'Failed to read on-chain escrow', details: e.message });
    }
  });

  console.log('[Marketplace Escrow] ✅ On-chain escrow routes mounted (9 endpoints)');
}

module.exports = { registerMarketplaceEscrowOnchain };
