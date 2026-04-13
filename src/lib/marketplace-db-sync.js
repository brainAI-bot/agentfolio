const fs = require('fs');
const path = require('path');
const db = require('./database');

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

module.exports = {
  syncMarketplaceJobToDb,
  syncMarketplaceApplicationToDb,
  normalizeJob,
};
