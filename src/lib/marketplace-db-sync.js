const fs = require('fs');
const path = require('path');
const db = require('./database');

const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const MARKETPLACE_DIR = path.join(__dirname, '..', '..', 'data', 'marketplace');

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function inferAcceptedApplication(job) {
  const appIds = Array.isArray(job?.applications) ? job.applications : [];
  for (const appId of appIds) {
    const app = readJSON(path.join(MARKETPLACE_DIR, 'applications', `${appId}.json`));
    if (!app) continue;
    if (app.status === 'accepted') return app;
    if (job?.acceptedApplicant && app.applicantId === job.acceptedApplicant) return app;
  }
  return null;
}

function normalizeJob(job = {}) {
  const acceptedApp = inferAcceptedApplication(job);
  const agreedBudgetRaw =
    job.agreedBudget ??
    acceptedApp?.bidAmount ??
    job.budgetAmount ??
    job.budget ??
    0;

  const selectedAt =
    job.selectedAt ??
    acceptedApp?.acceptedAt ??
    null;

  return {
    ...job,
    clientId: job.clientId || job.postedBy || null,
    skills: Array.isArray(job.skills) ? job.skills : (Array.isArray(job.skills_required) ? job.skills_required : []),
    attachments: Array.isArray(job.attachments) ? job.attachments : [],
    budgetType: job.budgetType || 'fixed',
    budgetAmount: Number(job.budgetAmount ?? job.budget ?? 0) || 0,
    budgetCurrency: job.budgetCurrency || job.currency || 'USDC',
    timeline: job.timeline || 'flexible',
    selectedAgentId: job.selectedAgentId || job.acceptedApplicant || acceptedApp?.applicantId || null,
    selectedAt,
    agreedBudget: Number(agreedBudgetRaw || 0) || 0,
    applicationCount: Array.isArray(job.applications) ? job.applications.length : Number(job.applicationCount || 0) || 0,
    escrowRequired: job.escrowRequired !== false,
    escrowFunded: Boolean(job.escrowFunded || job.escrowId || job.onchainEscrowPDA),
    depositConfirmedAt: job.depositConfirmedAt || null,
    fundsLocked: Boolean(job.fundsLocked || ((job.escrowId || job.onchainEscrowPDA) && !job.fundsReleased && !job.fundsRefunded)),
    fundsReleased: Boolean(job.fundsReleased),
    fundsRefunded: Boolean(job.fundsRefunded),
    createdAt: job.createdAt || new Date().toISOString(),
    updatedAt: job.updatedAt || new Date().toISOString(),
  };
}

function syncMarketplaceJobToDb(job = {}) {
  return db.saveJob(normalizeJob(job));
}

function syncMarketplaceApplicationToDb(application = {}) {
  const normalized = {
    id: application.id,
    jobId: application.jobId,
    agentId: application.agentId || application.applicantId,
    coverMessage: application.coverMessage || application.proposal || '',
    proposedBudget: application.proposedBudget ?? application.bidAmount ?? null,
    proposedTimeline: application.proposedTimeline || null,
    portfolioItems: application.portfolioItems || [],
    walletAddress: application.walletAddress || null,
    status: application.status || 'pending',
    statusNote: application.statusNote || null,
    acceptedAt: application.acceptedAt || null,
    createdAt: application.createdAt || new Date().toISOString(),
    updatedAt: application.updatedAt || application.acceptedAt || application.createdAt || new Date().toISOString(),
  };
  return db.saveApplication(normalized);
}

function normalizeEscrow(escrow = {}, jobInput = null) {
  const job = jobInput || (escrow.jobId ? readJSON(path.join(MARKETPLACE_DIR, 'jobs', `${escrow.jobId}.json`)) : null) || {};
  const amount = Number(escrow.amount || 0) || 0;
  const platformFee = Number(escrow.platformFee ?? 0) || 0;
  const fundedAt = escrow.fundedAt || escrow.depositConfirmedAt || escrow.createdAt || new Date().toISOString();
  const updatedAt = escrow.updatedAt || escrow.releasedAt || escrow.refundedAt || fundedAt;
  const clientId = job.clientId || job.postedBy || escrow.clientId || null;
  const agentId = job.selectedAgentId || job.acceptedApplicant || escrow.agentId || escrow.worker || null;
  if (!escrow.id || !(escrow.jobId || job.id) || !clientId) {
    throw new Error(`Cannot sync escrow ${escrow.id || '(missing-id)'} without job/client context`);
  }

  return {
    id: escrow.id,
    jobId: escrow.jobId || job.id,
    clientId,
    clientWallet: escrow.clientWallet || (typeof escrow.fundedBy === 'string' && WALLET_RE.test(escrow.fundedBy) ? escrow.fundedBy : null),
    agentId,
    agentWallet: escrow.agentWallet || (typeof escrow.worker === 'string' && WALLET_RE.test(escrow.worker) ? escrow.worker : null),
    amount,
    currency: escrow.currency || job.budgetCurrency || job.currency || 'USDC',
    platformFee,
    agentPayout: Number(escrow.workerPayout ?? escrow.agentPayout ?? Math.max(amount - platformFee, 0)) || 0,
    status: escrow.status || 'pending',
    depositAddress: escrow.escrowPDA || escrow.depositAddress || null,
    depositTxHash: escrow.txHash || escrow.depositTxHash || null,
    depositConfirmedAt: escrow.fundedAt || escrow.depositConfirmedAt || null,
    releaseTxHash: escrow.releaseTxHash || null,
    releasedAt: escrow.releasedAt || null,
    refundTxHash: escrow.refundTxHash || null,
    refundedAt: escrow.refundedAt || null,
    lockedAt: escrow.lockedAt || escrow.fundedAt || null,
    expiresAt: escrow.expiresAt || null,
    notes: [{
      source: 'marketplace-json-sync',
      onchain: Boolean(escrow.onchain),
      escrowPDA: escrow.escrowPDA || null,
      fundedBy: escrow.fundedBy || null,
      worker: escrow.worker || null,
    }],
    createdAt: fundedAt,
    updatedAt,
  };
}

function syncMarketplaceEscrowToDb(escrow = {}, jobInput = null) {
  return db.saveEscrow(normalizeEscrow(escrow, jobInput));
}

module.exports = {
  syncMarketplaceJobToDb,
  syncMarketplaceApplicationToDb,
  syncMarketplaceEscrowToDb,
  normalizeJob,
  normalizeEscrow,
};
