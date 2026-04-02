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

let escrowOnchain;
try {
  escrowOnchain = require('./lib/escrow-onchain');
  console.log('[Marketplace Escrow] ✅ On-chain escrow module loaded');
} catch (e) {
  console.warn('[Marketplace Escrow] ⚠️ escrow-onchain not available:', e.message);
}

const DATA_DIR = path.join(__dirname, '..', 'data');

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
      if (job.status !== 'in_progress') return res.status(400).json({ error: 'Job must be in_progress to fund escrow' });
      if (job.onchainEscrowPDA) return res.status(400).json({ error: 'On-chain escrow already created for this job' });

      const { clientWallet, amount, deadlineUnix } = req.body;
      if (!clientWallet || !amount) return res.status(400).json({ error: 'clientWallet and amount required' });

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

      const confirmed = await escrowOnchain.confirmTransaction(txSignature);
      if (!confirmed) return res.status(400).json({ error: 'Transaction not confirmed on-chain' });

      let onchainState;
      try { onchainState = await escrowOnchain.readEscrowAccount(escrowPDA); } catch { onchainState = null; }

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

      job.escrowId = escrow.id;
      job.onchainEscrowPDA = escrowPDA;
      job.updatedAt = new Date().toISOString();
      writeJSON(jobPath, job);

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

  // 3. Release payment (build unsigned TX)
  app.post('/api/marketplace/escrow/:id/release/onchain', async (req, res) => {
    try {
      const escrowPath = path.join(DATA_DIR, 'escrow', `${req.params.id}.json`);
      const escrow = readJSON(escrowPath);
      if (!escrow) return res.status(404).json({ error: 'Escrow not found' });
      if (!escrow.onchain) return res.status(400).json({ error: 'Not an on-chain escrow. Use /release instead.' });
      if (escrow.status !== 'funded') return res.status(400).json({ error: 'Escrow not in funded state' });

      const { clientWallet, agentWallet } = req.body;
      if (!clientWallet || !agentWallet) return res.status(400).json({ error: 'clientWallet and agentWallet required' });
      if (clientWallet !== escrow.fundedBy) return res.status(403).json({ error: 'Only the funder can release payment' });

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

      const { txSignature } = req.body;
      if (!txSignature) return res.status(400).json({ error: 'txSignature required' });

      const confirmed = await escrowOnchain.confirmTransaction(txSignature);
      if (!confirmed) return res.status(400).json({ error: 'Transaction not confirmed on-chain' });

      escrow.status = 'released';
      escrow.releaseTxHash = txSignature;
      escrow.releasedAt = new Date().toISOString();
      writeJSON(escrowPath, escrow);

      const jobPath = path.join(DATA_DIR, 'jobs', `${escrow.jobId}.json`);
      const job = readJSON(jobPath);
      if (job) {
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
        job.updatedAt = new Date().toISOString();
        writeJSON(jobPath, job);
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
      if (clientWallet !== escrow.fundedBy) return res.status(403).json({ error: 'Only the funder can request refund' });

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

      const { txSignature } = req.body;
      if (!txSignature) return res.status(400).json({ error: 'txSignature required' });

      const confirmed = await escrowOnchain.confirmTransaction(txSignature);
      if (!confirmed) return res.status(400).json({ error: 'Transaction not confirmed on-chain' });

      escrow.status = 'refunded';
      escrow.refundTxHash = txSignature;
      escrow.refundedAt = new Date().toISOString();
      writeJSON(escrowPath, escrow);

      const jobPath = path.join(DATA_DIR, 'jobs', `${escrow.jobId}.json`);
      const job = readJSON(jobPath);
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

      const onchainState = await escrowOnchain.readEscrowAccount(escrow.escrowPDA);
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

  console.log('[Marketplace Escrow] ✅ On-chain escrow routes mounted (7 endpoints)');
}

module.exports = { registerMarketplaceEscrowOnchain };
