/**
 * AgentFolio Marketplace — Full Job Flow
 * POST job → Apply → Accept → Escrow → Deliver → Release Payment
 * 
 * Data stored in JSON files (no DB dependency)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const _bs58 = require('bs58');
const bs58 = _bs58.default || _bs58;
let addActivity;
try { addActivity = require('./profile-store').addActivity; } catch { addActivity = () => {}; }
const { syncMarketplaceJobToDb, syncMarketplaceApplicationToDb, syncMarketplaceEscrowToDb } = require('./lib/marketplace-db-sync');
let escrowOnchainLib;
try { escrowOnchainLib = require('./lib/escrow-onchain'); } catch { escrowOnchainLib = null; }
let SATPV3SDK = null;
let satpV3Sdk = null;
const SATP_NETWORK = process.env.SATP_NETWORK || process.env.SOLANA_NETWORK || 'mainnet';
const SATP_RPC_URL = process.env.SOLANA_RPC_URL || process.env.SOLANA_RPC || null;
try {
  const mod = require('../satp-client/src/index');
  SATPV3SDK = mod.SATPV3SDK;
} catch {
  try {
    const mod = require('satp-client');
    SATPV3SDK = mod.SATPV3SDK;
  } catch {
    SATPV3SDK = null;
  }
}

const DATA_DIR = path.join(__dirname, '..', 'data', 'marketplace');
const MARKETPLACE_AUTH_WINDOW_MS = 5 * 60 * 1000;
const WALLET_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function resolveProfileIdForWalletAddress(walletAddress) {
  const wallet = String(walletAddress || '').trim();
  if (!WALLET_ADDRESS_RE.test(wallet)) return null;

  try {
    const profileStore = require('./profile-store');
    const db = profileStore.getDb();
    const row = db.prepare(`
      SELECT id FROM profiles
      WHERE LOWER(wallet) = LOWER(?)
         OR LOWER(claimed_by) = LOWER(?)
         OR LOWER(json_extract(wallets, '$.solana')) = LOWER(?)
         OR LOWER(json_extract(wallets, '$.solana_wallet')) = LOWER(?)
         OR LOWER(json_extract(wallets, '$.wallet')) = LOWER(?)
         OR LOWER(json_extract(verification_data, '$.solana.address')) = LOWER(?)
         OR LOWER(json_extract(verification_data, '$.solana.identifier')) = LOWER(?)
         OR LOWER(json_extract(verification_data, '$.eth.address')) = LOWER(?)
         OR LOWER(json_extract(verification_data, '$.eth.identifier')) = LOWER(?)
         OR LOWER(json_extract(verification_data, '$.ethereum.address')) = LOWER(?)
         OR LOWER(json_extract(verification_data, '$.ethereum.identifier')) = LOWER(?)
      ORDER BY COALESCE(
        julianday(REPLACE(SUBSTR(updated_at, 1, 19), 'T', ' ')),
        julianday(REPLACE(SUBSTR(created_at, 1, 19), 'T', ' ')),
        0
      ) DESC, id DESC
      LIMIT 1
    `).get(wallet, wallet, wallet, wallet, wallet, wallet, wallet, wallet, wallet, wallet, wallet);
    return row ? row.id : null;
  } catch (_) {
    return null;
  }
}

// Helper: resolve wallet address to profile ID
function resolveApplicantId(applicantId) {
  const rawApplicantId = String(applicantId || '').trim();
  if (WALLET_ADDRESS_RE.test(rawApplicantId)) {
    return resolveProfileIdForWalletAddress(rawApplicantId) || rawApplicantId;
  }
  return rawApplicantId;
}

function buildApplicantProfileLookupCandidates(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];

  const candidates = [];
  const push = (next) => {
    const normalized = String(next || '').trim();
    if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
  };

  push(raw);
  push(raw.toLowerCase());

  const withoutAt = raw.replace(/^@/, '');
  push(withoutAt);
  push(withoutAt.toLowerCase());
  push(`@${withoutAt}`);
  push(`@${withoutAt.toLowerCase()}`);

  if (/^agent_/i.test(raw)) {
    const stripped = raw.replace(/^agent_/i, '');
    push(stripped);
    push(stripped.toLowerCase());
    if (/^sm/i.test(stripped)) {
      push(stripped.replace(/^sm/i, ''));
    }
  }

  if (/^sm/i.test(raw)) {
    push(`agent_${raw}`);
    push(`agent_${raw.toLowerCase()}`);
    push(raw.replace(/^sm/i, ''));
  }

  if (/^\d+$/.test(raw)) {
    push(`sm${raw}`);
    push(`agent_sm${raw}`);
  }

  return candidates;
}

function findProfileRowByApplicantToken(db, applicantId, fields = 'id') {
  const resolvedApplicantId = resolveApplicantId(applicantId);
  const candidates = buildApplicantProfileLookupCandidates(resolvedApplicantId);
  for (const candidate of candidates) {
    let row = db.prepare(`SELECT ${fields} FROM profiles WHERE id = ?`).get(candidate);
    if (row) return row;
    row = db.prepare(`SELECT ${fields} FROM profiles WHERE LOWER(id) = ?`).get(String(candidate).toLowerCase());
    if (row) return row;
    row = db.prepare(`SELECT ${fields} FROM profiles WHERE handle = ?`).get(candidate);
    if (row) return row;
    row = db.prepare(`SELECT ${fields} FROM profiles WHERE LOWER(handle) = ?`).get(String(candidate).toLowerCase());
    if (row) return row;
  }

  const raw = String(resolvedApplicantId || '').trim();
  if (!raw) return null;

  let row = db.prepare(`SELECT ${fields} FROM profiles WHERE LOWER(name) = ?`).get(raw.toLowerCase()) || null;
  if (row) return row;

  return db.prepare(`
    SELECT ${fields} FROM profiles
    WHERE LOWER(wallet) = LOWER(?)
       OR LOWER(claimed_by) = LOWER(?)
       OR LOWER(json_extract(wallets, '$.solana')) = LOWER(?)
       OR LOWER(json_extract(wallets, '$.solana_wallet')) = LOWER(?)
       OR LOWER(json_extract(wallets, '$.wallet')) = LOWER(?)
       OR LOWER(json_extract(wallets, '$.ethereum')) = LOWER(?)
       OR LOWER(json_extract(verification_data, '$.solana.address')) = LOWER(?)
       OR LOWER(json_extract(verification_data, '$.solana.identifier')) = LOWER(?)
       OR LOWER(json_extract(verification_data, '$.eth.address')) = LOWER(?)
       OR LOWER(json_extract(verification_data, '$.eth.identifier')) = LOWER(?)
       OR LOWER(json_extract(verification_data, '$.ethereum.address')) = LOWER(?)
       OR LOWER(json_extract(verification_data, '$.ethereum.identifier')) = LOWER(?)
    ORDER BY COALESCE(
      julianday(REPLACE(SUBSTR(updated_at, 1, 19), 'T', ' ')),
      julianday(REPLACE(SUBSTR(created_at, 1, 19), 'T', ' ')),
      0
    ) DESC, id DESC
    LIMIT 1
  `).get(raw, raw, raw, raw, raw, raw, raw, raw, raw, raw, raw, raw) || null;
}

function resolveExistingApplicantProfileId(applicantId) {
  try {
    const profileStore = require('./profile-store');
    const db = profileStore.getDb();
    const row = findProfileRowByApplicantToken(db, applicantId, 'id');
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
  const resolved = resolveExistingApplicantProfileId(raw);
  return resolved || raw;
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
  return !!job && (matchesActor(actorId, job.postedBy) || matchesActor(actorId, job.clientId));
}

function walletMatchesJobPoster(walletAddress, job) {
  return !!job && !!walletAddress && (
    walletMatchesClaimedActor(job.postedBy, walletAddress) ||
    walletMatchesClaimedActor(job.clientId, walletAddress)
  );
}

function isAcceptedWorker(actorId, job) {
  return !!job && (matchesActor(actorId, job.acceptedApplicant) || matchesActor(actorId, job.selectedAgentId));
}

function walletMatchesAcceptedWorker(walletAddress, job) {
  return !!job && !!walletAddress && (
    walletMatchesClaimedActor(job.acceptedApplicant, walletAddress) ||
    walletMatchesClaimedActor(job.selectedAgentId, walletAddress)
  );
}

function buildMarketplaceAuthMessage({ action, jobId = '-', applicationId = '-', escrowId = '-', deliverableId = '-', actorId = '-', walletAddress = '-', timestamp = '-' }) {
  return [
    'agentfolio-marketplace',
    action,
    jobId || '-',
    applicationId || '-',
    escrowId || '-',
    deliverableId || '-',
    actorId || '-',
    walletAddress || '-',
    timestamp || '-',
  ].join(':');
}

function verifyMarketplaceAction(req, { action, job = null, actorId = null, applicationId = '-', escrowId = '-', deliverableId = '-', requirePoster = false, requireWorker = false }) {
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
    applicationId,
    escrowId,
    deliverableId,
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
  if (requirePoster && job && !isJobPoster(effectiveActorId, job) && !isJobPoster(walletAddress, job) && !walletMatchesJobPoster(walletAddress, job)) {
    return { ok: false, status: 403, error: 'Only the job poster can perform this action' };
  }
  if (requireWorker && job && !isAcceptedWorker(effectiveActorId, job) && !isAcceptedWorker(walletAddress, job) && !walletMatchesAcceptedWorker(walletAddress, job)) {
    return { ok: false, status: 403, error: 'Only the accepted worker can perform this action' };
  }

  return {
    ok: true,
    actorId: effectiveActorId,
    walletAddress,
    walletMessage,
    walletTimestamp: timestampNumber,
  };
}

// Ensure data dirs exist
['jobs', 'job-drafts', 'applications', 'escrow', 'deliverables'].forEach(dir => {
  const p = path.join(DATA_DIR, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

function genId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function readJSON(filepath) {
  try { return JSON.parse(fs.readFileSync(filepath, 'utf8')); } catch { return null; }
}

function getJobEscrow(job) {
  if (!job?.escrowId) return null;
  return readJSON(path.join(DATA_DIR, 'escrow', `${job.escrowId}.json`));
}

function getJobDeliverable(job) {
  if (!job?.deliverableId) return null;
  return readJSON(path.join(DATA_DIR, 'deliverables', `${job.deliverableId}.json`));
}

function getSatpV3Sdk() {
  if (!satpV3Sdk && SATPV3SDK) {
    satpV3Sdk = new SATPV3SDK({
      network: SATP_NETWORK,
      ...(SATP_RPC_URL ? { rpcUrl: SATP_RPC_URL } : {}),
    });
  }
  return satpV3Sdk;
}

async function readV3EscrowState(escrowPDA) {
  const sdk = getSatpV3Sdk();
  if (!sdk) throw new Error('SATP V3 escrow verifier unavailable');
  const escrow = await sdk.getEscrow(escrowPDA);
  if (!escrow || escrow.error) {
    throw new Error(escrow?.error || 'Escrow account not found on-chain');
  }
  return escrow;
}

async function getVerifiedFundingState(job, escrow = null) {
  const result = { hasEscrow: false, funded: false, onchain: false, escrow: escrow || null, onchainState: null, reason: null };
  const localEscrow = escrow || getJobEscrow(job);
  result.escrow = localEscrow;

  if (job?.v3EscrowPDA) {
    result.hasEscrow = true;
    result.onchain = true;
    try {
      const onchainState = await readV3EscrowState(job.v3EscrowPDA);
      result.onchainState = onchainState;
      if (onchainState.pda !== job.v3EscrowPDA) {
        result.reason = 'Escrow PDA mismatch';
        return result;
      }
      result.funded = ['Active', 'WorkSubmitted', 'Released', 'Disputed', 'Resolved'].includes(onchainState.status);
      if (!result.funded) result.reason = `V3 escrow is ${onchainState.status || 'not funded'} on-chain`;
      return result;
    } catch (e) {
      result.reason = `Failed to read V3 escrow: ${e.message}`;
      return result;
    }
  }

  const expectedPDA = job?.onchainEscrowPDA || localEscrow?.escrowPDA || null;
  if (expectedPDA || localEscrow?.onchain) {
    result.hasEscrow = true;
    result.onchain = true;
    if (!escrowOnchainLib?.readEscrowAccount) {
      result.reason = 'On-chain escrow verifier unavailable';
      return result;
    }
    try {
      const onchainState = await escrowOnchainLib.readEscrowAccount(job.id);
      result.onchainState = onchainState;
      if (!onchainState?.exists) {
        result.reason = 'Escrow PDA not found on-chain';
        return result;
      }
      if (expectedPDA && onchainState.escrowPDA !== expectedPDA) {
        result.reason = 'Escrow PDA mismatch';
        return result;
      }
      result.funded = ['created', 'agent_accepted', 'work_submitted', 'released', 'auto_released'].includes(onchainState.status);
      if (!result.funded) result.reason = `Escrow is ${onchainState.status || 'not funded'} on-chain`;
      return result;
    } catch (e) {
      result.reason = `Failed to read on-chain escrow: ${e.message}`;
      return result;
    }
  }

  if (localEscrow) {
    result.hasEscrow = true;
    result.reason = 'Escrow funding is not verified on-chain';
    return result;
  }

  if (job?.escrowFunded || job?.fundsLocked) {
    result.hasEscrow = true;
    result.reason = 'Escrow funding flag present without a verifiable escrow record';
    return result;
  }

  result.reason = 'No funded escrow found for this job';
  return result;
}

function hasSubmittedWork(job, fundingState = null) {
  const deliverable = getJobDeliverable(job);
  if (deliverable && (deliverable.status === 'submitted' || deliverable.status === 'approved')) return true;
  return ['work_submitted', 'released', 'auto_released', 'WorkSubmitted', 'Released', 'Resolved'].includes(fundingState?.onchainState?.status);
}

// Enrich application with profile trust/verification data
function enrichApplication(app) {
  if (!app || !app.applicantId) return app;
  try {
    const profileStore = require('./profile-store');
    const db = profileStore.getDb();
    const { computeUnifiedTrustScore } = require('./lib/unified-trust-score');
    const v3ScoreService = require('./v3-score-service');

    const row = findProfileRowByApplicantToken(db, app.applicantId, '*');

    if (row) {
      const vd = JSON.parse(row.verification_data || '{}');
      const badges = [];
      if (vd.solana?.verified) badges.push('solana');
      if (vd.eth?.verified || vd.eth_wallet?.verified || vd.ethereum?.verified) badges.push('eth');
      if (vd.github?.verified) badges.push('github');
      if (vd.x?.verified || vd.twitter?.verified) badges.push('x');
      if (vd.telegram?.verified) badges.push('telegram');
      if (vd.satp?.verified || vd.satp_v3?.verified) badges.push('satp');
      if (vd.agentmail?.verified) badges.push('agentmail');
      if (vd.website?.verified) badges.push('website');
      if (vd.a2a?.verified) badges.push('a2a');
      if (vd.mcp?.verified) badges.push('mcp');

      // Resolve avatar (nft_avatar.image takes priority)
      let resolvedAvatar = row.avatar;
      if (row.nft_avatar) {
        try {
          const nft = JSON.parse(row.nft_avatar);
          if (nft.image || nft.arweaveUrl) resolvedAvatar = (nft.image || nft.arweaveUrl).replace('node1.irys.xyz', 'gateway.irys.xyz');
        } catch {}
      }

      let trustScore = 0;
      let verificationLevel = 0;
      let verificationLevelName = 'Unverified';
      try {
        const cachedV3 = v3ScoreService && v3ScoreService._getFromCache ? v3ScoreService._getFromCache(row.id) : null;
        let fallbackV3 = null;
        if (!cachedV3 && (vd.satp_v3?.verified || vd.satp?.verified)) {
          let persistedVerification = {};
          try { persistedVerification = JSON.parse(row.verification || '{}'); } catch {}
          fallbackV3 = {
            reputationScore: Number(persistedVerification.score || 0) || 0,
            verificationLevel: 1,
            verificationLabel: 'Registered',
            isBorn: Boolean(vd.satp_v3?.verified),
          };
        }
        const unified = computeUnifiedTrustScore(db, row, { v3Score: cachedV3 || fallbackV3 || null });
        trustScore = Number(unified.score || 0) || 0;
        verificationLevel = Number(unified.level || 0) || 0;
        verificationLevelName = unified.levelName || 'Unverified';
      } catch (e) {
        console.warn('[Marketplace] applicant unified score fallback failed:', e.message);
      }

      app.applicantName = row.name;
      app.applicantAvatar = resolvedAvatar;
      app.applicantProfileId = row.id;
      app.trustScore = trustScore;
      app.verificationLevel = verificationLevel;
      app.verificationLevelName = verificationLevelName;
      app.verificationBadges = [...new Set(badges)];
    }
  } catch (e) { console.error('[Marketplace] enrichApplication error:', e.message); }
  return app;
}

// Normalize job.applications to always be an array and hydrate release state from escrow
function syncJobDeliverableSummary(job, deliverable = null) {
  if (!job) return job;
  let resolved = deliverable;
  if (!resolved && job.deliverableId) {
    resolved = readJSON(path.join(DATA_DIR, 'deliverables', `${job.deliverableId}.json`));
  }
  if (resolved) {
    job.deliverableId = resolved.id || job.deliverableId;
    job.deliverableDescription = resolved.description || null;
    job.deliverableStatus = resolved.status || null;
    job.deliverableSubmittedAt = resolved.submittedAt || null;
  } else if (!job.deliverableId) {
    job.deliverableDescription = null;
    job.deliverableStatus = null;
    job.deliverableSubmittedAt = null;
  }
  return job;
}

function hydrateJobEscrowState(job) {
  if (!job) return job;
  if (!Array.isArray(job.applications)) job.applications = [];

  const applicationIds = job.applications
    .map((app) => (typeof app === 'string' ? app : app?.id))
    .filter(Boolean);

  let acceptedApplication = null;
  if (applicationIds.length) {
    for (const applicationId of applicationIds) {
      const candidate = readJSON(path.join(DATA_DIR, 'applications', `${applicationId}.json`));
      if (!candidate) continue;
      if (candidate.status === 'accepted') {
        acceptedApplication = candidate;
        break;
      }
      if (!acceptedApplication && (candidate.applicantId === job.selectedAgentId || candidate.applicantId === job.acceptedApplicant)) {
        acceptedApplication = candidate;
      }
    }
  }

  if (acceptedApplication) {
    if (!job.acceptedApplicationId) job.acceptedApplicationId = acceptedApplication.id;
    if (!job.acceptedApplicant) job.acceptedApplicant = acceptedApplication.applicantId;
    if (!job.selectedAgentId) job.selectedAgentId = acceptedApplication.applicantId;
  }

  const acceptedWorkerId = job.selectedAgentId || job.acceptedApplicant || null;
  if (acceptedWorkerId) {
    if (!job.assignedTo) job.assignedTo = acceptedWorkerId;
    if (!job.assigneeId) job.assigneeId = acceptedWorkerId;
    if (!job.assignee) job.assignee = acceptedWorkerId;
  }

  const awaitingFunding = !!acceptedWorkerId
    && !job.onchainEscrowPDA
    && !job.v3EscrowPDA
    && !job.escrowId
    && !job.escrowFunded
    && !job.fundsLocked
    && !job.fundsReleased;
  if (awaitingFunding && ['open', 'in_progress', 'awaiting_funding'].includes(String(job.status || 'open'))) {
    job.status = 'awaiting_funding';
  } else if (!awaitingFunding && job.status === 'awaiting_funding' && (job.onchainEscrowPDA || job.v3EscrowPDA || job.escrowId || job.escrowFunded || job.fundsLocked)) {
    job.status = 'in_progress';
  }

  if (job.escrowId && !job.fundsReleased) {
    const escrow = readJSON(path.join(DATA_DIR, 'escrow', `${job.escrowId}.json`));
    if (escrow && (escrow.status === 'released' || escrow.status === 'auto_released')) {
      job.fundsReleased = true;
      if (!job.releaseTxHash && escrow.releaseTxHash) job.releaseTxHash = escrow.releaseTxHash;
      if (!job.releasedAt && escrow.releasedAt) job.releasedAt = escrow.releasedAt;
    }
  }

  return syncJobDeliverableSummary(job);
}

function readJob(filepath) {
  return hydrateJobEscrowState(readJSON(filepath));
}

function writeJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

function getAllFiles(dir) {
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => readJSON(path.join(dir, f))).filter(Boolean);
  } catch { return []; }
}

function buildMarketplaceJobRecord({
  id = genId('job'),
  title,
  description,
  budget,
  budgetAmount,
  currency,
  postedBy,
  clientId,
  skills,
  skills_required,
  deadline,
  category,
  budgetType,
  budgetCurrency,
  timeline,
  requirements,
  escrowRequired,
  budgetMax,
  attachments,
  expiresAt,
  status = 'open',
  createdAt = new Date().toISOString(),
}) {
  const resolvedBudget = budget || budgetAmount;
  const resolvedPostedBy = postedBy || clientId;
  return {
    id,
    title,
    description,
    budget: parseFloat(resolvedBudget),
    currency: currency || budgetCurrency || 'USDC',
    postedBy: resolvedPostedBy,
    clientId: resolvedPostedBy,
    category: category || 'other',
    skills: skills || skills_required || [],
    skills_required: skills_required || skills || [],
    budgetType: budgetType || 'fixed',
    budgetAmount: parseFloat(resolvedBudget),
    budgetCurrency: currency || budgetCurrency || 'USDC',
    budgetMax: budgetMax || null,
    timeline: timeline || deadline || null,
    deadline: deadline || null,
    requirements: requirements || '',
    escrowRequired: escrowRequired !== false,
    attachments: attachments || [],
    expiresAt: expiresAt || null,
    status,
    applications: [],
    acceptedApplicant: null,
    selectedAgentId: null,
    escrowId: null,
    createdAt,
    updatedAt: createdAt,
  };
}

// ===== ROUTES =====

function registerRoutes(app) {

  // 1. POST /api/marketplace/jobs — Create a job
  app.post('/api/marketplace/jobs', (req, res) => {
    const { title, description, budget, budgetAmount, currency, postedBy, clientId, skills, skills_required, deadline, category, budgetType, budgetCurrency, timeline, requirements, escrowRequired, budgetMax, attachments, expiresAt } = req.body;
    const resolvedBudget = budget || budgetAmount;
    const resolvedPostedBy = postedBy || clientId;
    if (!title || !description || !resolvedBudget || !resolvedPostedBy) {
      return res.status(400).json({ error: 'title, description, budget, and postedBy (or clientId) are required' });
    }
    if (escrowRequired !== false) {
      return res.status(400).json({
        error: 'Escrow-backed jobs must be created via /api/marketplace/jobs/create-onchain so funding happens before posting.'
      });
    }
    const job = buildMarketplaceJobRecord({
      title,
      description,
      budget,
      budgetAmount,
      currency,
      postedBy,
      clientId,
      skills,
      skills_required,
      deadline,
      category,
      budgetType,
      budgetCurrency,
      timeline,
      requirements,
      escrowRequired,
      budgetMax,
      attachments,
      expiresAt,
      status: 'open',
    });
    writeJSON(path.join(DATA_DIR, 'jobs', `${job.id}.json`), job);
    try { addActivity(resolvedPostedBy, 'job_posted', { jobId: job.id, title }); } catch {}
    res.status(201).json(job);
  });

  // 1b. POST /api/marketplace/jobs/create-onchain — Prepare atomic job posting + escrow funding
  app.post('/api/marketplace/jobs/create-onchain', async (req, res) => {
    try {
      if (!escrowOnchainLib?.buildCreateEscrowTx) {
        return res.status(500).json({ error: 'On-chain escrow builder unavailable' });
      }

      const { title, description, budget, budgetAmount, currency, postedBy, clientId, clientWallet, skills, skills_required, deadline, category, budgetType, budgetCurrency, timeline, requirements, budgetMax, attachments, expiresAt, deadlineUnix } = req.body || {};
      const resolvedBudget = budget || budgetAmount;
      const resolvedPostedBy = postedBy || clientId;
      if (!title || !description || !resolvedBudget || !resolvedPostedBy || !clientWallet) {
        return res.status(400).json({ error: 'title, description, budget, clientId, and clientWallet are required' });
      }

      const auth = verifyMarketplaceAction(req, {
        action: 'create_job_onchain_prepare',
        actorId: resolvedPostedBy,
      });
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
      if (!matchesActor(auth.actorId, resolvedPostedBy) || !matchesActor(auth.walletAddress, clientWallet)) {
        return res.status(403).json({ error: 'Signed wallet does not control the claimed job poster' });
      }

      const draft = buildMarketplaceJobRecord({
        title,
        description,
        budget,
        budgetAmount,
        currency,
        postedBy,
        clientId,
        skills,
        skills_required,
        deadline,
        category,
        budgetType,
        budgetCurrency,
        timeline,
        requirements,
        escrowRequired: true,
        budgetMax,
        attachments,
        expiresAt,
        status: 'draft',
      });
      draft.clientWallet = clientWallet;
      draft.atomicFundingPending = true;
      draft.deadlineUnix = deadlineUnix || Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
      draft.preparedAt = new Date().toISOString();

      const txResult = await escrowOnchainLib.buildCreateEscrowTx(clientWallet, draft.id, parseFloat(resolvedBudget), draft.deadlineUnix);
      if (!txResult?.success || !txResult.transaction || !txResult.escrowPDA) {
        return res.status(500).json({ error: 'Failed to build escrow TX', details: txResult || null });
      }

      draft.pendingEscrowPDA = txResult.escrowPDA;
      draft.pendingVaultPDA = txResult.vaultPDA || null;
      writeJSON(path.join(DATA_DIR, 'job-drafts', `${draft.id}.json`), draft);

      return res.status(201).json({
        jobId: draft.id,
        transaction: txResult.transaction,
        escrowPDA: txResult.escrowPDA,
        vaultPDA: txResult.vaultPDA,
        amount: parseFloat(resolvedBudget),
        deadlineUnix: draft.deadlineUnix,
        message: 'Sign this transaction to fund escrow. The job will only be posted after on-chain confirmation.',
      });
    } catch (e) {
      console.error('[Marketplace] create-onchain prepare error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // 1c. POST /api/marketplace/jobs/create-onchain/confirm — Finalize job after funded escrow tx confirms
  app.post('/api/marketplace/jobs/create-onchain/confirm', async (req, res) => {
    try {
      if (!escrowOnchainLib?.confirmTransaction || !escrowOnchainLib?.readEscrowAccount) {
        return res.status(500).json({ error: 'On-chain escrow verifier unavailable' });
      }

      const { jobId, txSignature, signedTransaction, escrowPDA, clientWallet } = req.body || {};
      if (!jobId || (!txSignature && !signedTransaction) || !escrowPDA || !clientWallet) {
        return res.status(400).json({ error: 'jobId, escrowPDA, clientWallet, and either txSignature or signedTransaction required' });
      }

      const draftPath = path.join(DATA_DIR, 'job-drafts', `${jobId}.json`);
      const draft = readJSON(draftPath);
      const existingJobPath = path.join(DATA_DIR, 'jobs', `${jobId}.json`);
      const existingJob = readJob(existingJobPath);
      if (!draft) {
        if (existingJob?.onchainEscrowPDA === escrowPDA) {
          return res.status(200).json({
            message: 'Job already finalized from funded escrow',
            job: existingJob,
            escrow: existingJob.escrowId ? readJSON(path.join(DATA_DIR, 'escrow', `${existingJob.escrowId}.json`)) : null,
          });
        }
        return res.status(404).json({ error: 'Pending job draft not found' });
      }

      const auth = verifyMarketplaceAction(req, {
        action: 'create_job_onchain_confirm',
        job: draft,
        actorId: draft.clientId,
        escrowId: escrowPDA,
        requirePoster: true,
      });
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
      if (!matchesActor(auth.walletAddress, clientWallet) || !matchesActor(auth.actorId, draft.clientId)) {
        return res.status(403).json({ error: 'Only the job poster can confirm atomic job funding' });
      }

      const confirmResult = await escrowOnchainLib.confirmTransaction(signedTransaction || txSignature);
      const finalTxSignature = confirmResult?.signature || txSignature;
      const onchainState = await escrowOnchainLib.readEscrowAccount(jobId);
      if (!onchainState?.exists) return res.status(400).json({ error: 'Escrow PDA not found on-chain' });
      if (onchainState.escrowPDA !== escrowPDA) return res.status(400).json({ error: 'Escrow PDA mismatch' });
      if (onchainState.status !== 'created') return res.status(400).json({ error: `Escrow is ${onchainState.status || 'not funded'} on-chain` });
      if (onchainState.client !== clientWallet) return res.status(400).json({ error: 'On-chain client wallet mismatch' });

      const fundedAt = new Date().toISOString();
      const job = {
        ...draft,
        status: 'open',
        escrowId: genId('esc'),
        onchainEscrowPDA: escrowPDA,
        escrowFunded: true,
        depositConfirmedAt: fundedAt,
        fundsLocked: true,
        clientWallet,
        updatedAt: fundedAt,
      };
      delete job.atomicFundingPending;
      delete job.pendingEscrowPDA;
      delete job.pendingVaultPDA;
      delete job.preparedAt;
      delete job.deadlineUnix;

      const amount = Number(onchainState.amountUSDC || job.budgetAmount || job.budget || 0);
      const escrow = {
        id: job.escrowId,
        jobId: job.id,
        fundedBy: draft.clientId,
        worker: null,
        amount,
        currency: job.budgetCurrency || job.currency || 'USDC',
        platformFee: amount * 0.05,
        workerPayout: amount * 0.95,
        txHash: finalTxSignature,
        escrowPDA,
        onchain: true,
        status: 'funded',
        fundedAt,
        releasedAt: null,
        refundedAt: null,
      };

      writeJSON(path.join(DATA_DIR, 'jobs', `${job.id}.json`), job);
      writeJSON(path.join(DATA_DIR, 'escrow', `${escrow.id}.json`), escrow);
      try { fs.unlinkSync(draftPath); } catch (_) {}
      try { syncMarketplaceJobToDb(job); } catch (e) { console.warn('[Marketplace] atomic job DB sync failed:', e.message); }
      try { syncMarketplaceEscrowToDb(escrow, job); } catch (e) { console.warn('[Marketplace] atomic escrow DB sync failed:', e.message); }
      try { addActivity(draft.clientId, 'job_posted', { jobId: job.id, title: job.title, escrowPDA }); } catch (_) {}

      return res.status(201).json({
        message: 'Job posted after funded on-chain escrow confirmation',
        job,
        escrow,
        onchainState,
      });
    } catch (e) {
      console.error('[Marketplace] create-onchain confirm error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /api/marketplace/jobs — List all jobs (with hydrated applications)
  app.get('/api/marketplace/jobs', (req, res) => {
    const jobs = getAllFiles(path.join(DATA_DIR, 'jobs')).map(hydrateJobEscrowState);
    const status = req.query.status;
    const normalizedStatus = typeof status === "string" ? status.trim().toLowerCase() : "";
    const filtered = normalizedStatus && normalizedStatus !== "all"
      ? jobs.filter(j => String(j.status || "").toLowerCase() === normalizedStatus)
      : jobs;
    // Hydrate application IDs into full application objects (with profile enrichment)
    const hydrated = filtered.map(job => {
      if (Array.isArray(job.applications)) {
        job.applications = job.applications.map(appId => {
          if (typeof appId === 'string') {
            const app = readJSON(path.join(DATA_DIR, 'applications', `${appId}.json`));
            return enrichApplication(app) || { id: appId, error: 'not_found' };
          }
          return enrichApplication(appId); // already hydrated object
        });
      }
      return job;
    });
    res.json({ jobs: hydrated, total: hydrated.length });
  });

  // GET /api/marketplace/jobs/:id — Get single job (with hydrated applications + profile data)
  app.get('/api/marketplace/jobs/:id', (req, res) => {
    const job = readJob(path.join(DATA_DIR, 'jobs', `${req.params.id}.json`));
    if (!job) return res.status(404).json({ error: 'Job not found' });
    // Hydrate application IDs into full application objects with trust/verification data
    if (Array.isArray(job.applications)) {
      job.applications = job.applications.map(appId => {
        const app = readJSON(path.join(DATA_DIR, 'applications', `${appId}.json`));
        return enrichApplication(app) || { id: appId, error: 'not_found' };
      });
    }
    res.json(job);
  });

  // 2. POST /api/marketplace/jobs/:id/apply (or /applications) — Apply to a job
  const applyHandler = (req, res) => {
    const jobPath = path.join(DATA_DIR, 'jobs', `${req.params.id}.json`);
    const job = readJob(jobPath);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'open') return res.status(400).json({ error: 'Job is not open for applications' });

    let { applicantId, proposal, bidAmount } = req.body;
    if (!applicantId || !proposal) return res.status(400).json({ error: 'applicantId and proposal required' });
    applicantId = resolveExistingApplicantProfileId(applicantId);
    if (!applicantId) return res.status(400).json({ error: 'applicantId must reference an existing profile' });
    if (applicantId === job.postedBy || applicantId === job.clientId) return res.status(400).json({ error: 'Cannot apply to your own job' });

    // Bug fix: Prevent duplicate applications from same agent
    const existingApps = job.applications.map(appId => readJSON(path.join(DATA_DIR, 'applications', `${appId}.json`))).filter(Boolean);
    const alreadyApplied = existingApps.some(a => a.applicantId === applicantId);
    if (alreadyApplied) return res.status(409).json({ error: 'Already applied to this job' });

    const application = {
      id: genId('app'),
      jobId: job.id,
      applicantId,
      proposal,
      bidAmount: bidAmount ? parseFloat(bidAmount) : job.budget,
      status: 'pending', // pending → accepted → rejected
      createdAt: new Date().toISOString()
    };
    writeJSON(path.join(DATA_DIR, 'applications', `${application.id}.json`), application);
    job.applications.push(application.id);
    job.applicationCount = job.applications.length;
    job.updatedAt = new Date().toISOString();
    writeJSON(jobPath, job);
    try { syncMarketplaceJobToDb(job); } catch (e) { console.warn('[Marketplace] job DB sync failed:', e.message); }
    try { syncMarketplaceApplicationToDb(application); } catch (e) { console.warn('[Marketplace] application DB sync failed:', e.message); }
    res.status(201).json(application);
  };
  app.post('/api/marketplace/jobs/:id/apply', applyHandler);
  app.post('/api/marketplace/jobs/:id/applications', applyHandler);

  // GET /api/marketplace/jobs/:id/applications — List applications for a job
  app.get('/api/marketplace/jobs/:id/applications', (req, res) => {
    const job = readJob(path.join(DATA_DIR, 'jobs', `${req.params.id}.json`));
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const apps = job.applications
      .map(appId => {
        const app = typeof appId === 'string'
          ? readJSON(path.join(DATA_DIR, 'applications', `${appId}.json`))
          : appId;
        return enrichApplication(app);
      })
      .filter(Boolean);
    res.json({ applications: apps, total: apps.length });
  });

  // 3. POST /api/marketplace/applications/:id/accept — Accept an application
  const acceptApplication = (req, applicationId, actorId, res) => {
    const appPath = path.join(DATA_DIR, 'applications', `${applicationId}.json`);
    const application = readJSON(appPath);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    if (application.status !== 'pending') return res.status(400).json({ error: 'Application already processed' });

    const jobPath = path.join(DATA_DIR, 'jobs', `${application.jobId}.json`);
    const job = readJob(jobPath);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!actorId) return res.status(400).json({ error: 'acceptedBy required' });

    const auth = verifyMarketplaceAction(req, {
      action: 'accept_application',
      job,
      actorId,
      applicationId: application.id,
      requirePoster: true,
    });
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    actorId = auth.actorId;

    if (job.status !== 'open') {
      return res.status(400).json({ error: `Job is ${job.status}, not open for acceptance` });
    }

    const resolvedApplicantId = resolveExistingApplicantProfileId(application.applicantId);
    if (!resolvedApplicantId) {
      return res.status(400).json({ error: 'Cannot accept application for nonexistent applicant profile' });
    }

    application.applicantId = resolvedApplicantId;
    application.status = 'accepted';
    application.acceptedAt = new Date().toISOString();
    application.acceptedBy = normalizeActorId(actorId) || actorId;
    writeJSON(appPath, application);

    job.applications.forEach(appId => {
      if (appId !== application.id) {
        const other = readJSON(path.join(DATA_DIR, 'applications', `${appId}.json`));
        if (other && other.status === 'pending') {
          other.status = 'rejected';
          other.updatedAt = new Date().toISOString();
          writeJSON(path.join(DATA_DIR, 'applications', `${appId}.json`), other);
          try { syncMarketplaceApplicationToDb(other); } catch (e) { console.warn('[Marketplace] rejected application DB sync failed:', e.message); }
        }
      }
    });

    job.status = job.escrowRequired === false ? 'in_progress' : 'awaiting_funding';
    job.acceptedApplicationId = application.id;
    job.acceptedApplicant = application.applicantId;
    job.selectedAgentId = application.applicantId;
    job.assignedTo = application.applicantId;
    job.assigneeId = application.applicantId;
    job.assignee = application.applicantId;
    job.selectedAt = application.acceptedAt;
    job.acceptedBy = normalizeActorId(actorId) || actorId;
    job.agreedBudget = Number(application.bidAmount || job.agreedBudget || job.budgetAmount || job.budget || 0);
    job.applicationCount = job.applications.length;
    job.updatedAt = new Date().toISOString();
    writeJSON(jobPath, job);

    try { syncMarketplaceApplicationToDb(application); } catch (e) { console.warn('[Marketplace] accepted application DB sync failed:', e.message); }
    try { syncMarketplaceJobToDb(job); } catch (e) { console.warn('[Marketplace] accepted job DB sync failed:', e.message); }

    return res.json({ message: 'Application accepted', application, job });
  };

  app.post('/api/marketplace/applications/:id/accept', (req, res) => {
    const { acceptedBy } = req.body || {};
    return acceptApplication(req, req.params.id, acceptedBy, res);
  });

  app.post('/api/marketplace/jobs/:id/accept', (req, res) => {
    const job = readJob(path.join(DATA_DIR, 'jobs', `${req.params.id}.json`));
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const { applicationId, acceptedBy } = req.body || {};
    if (!applicationId) return res.status(400).json({ error: 'applicationId required' });
    if (!job.applications?.includes(applicationId)) {
      return res.status(400).json({ error: 'Application does not belong to this job' });
    }
    return acceptApplication(req, applicationId, acceptedBy, res);
  });

  // 4. POST /api/marketplace/jobs/:id/escrow — Fund escrow for a job
  app.post('/api/marketplace/jobs/:id/escrow', (req, res) => {
    const jobPath = path.join(DATA_DIR, 'jobs', `${req.params.id}.json`);
    const job = readJSON(jobPath);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'in_progress') return res.status(400).json({ error: 'Job must be in_progress to fund escrow' });
    if (job.escrowId) return res.status(400).json({ error: 'Escrow already funded' });

    const { fundedBy, amount, txHash } = req.body;
    if (!fundedBy || !amount) return res.status(400).json({ error: 'fundedBy and amount required' });

    const auth = verifyMarketplaceAction(req, {
      action: 'fund_escrow',
      job,
      actorId: fundedBy,
      requirePoster: true,
    });
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const actorId = auth.actorId;

    const escrow = {
      id: genId('esc'),
      jobId: job.id,
      fundedBy: normalizeActorId(actorId) || actorId,
      worker: job.acceptedApplicant,
      amount: parseFloat(amount),
      currency: job.currency,
      platformFee: parseFloat(amount) * 0.05, // 5% fee
      workerPayout: parseFloat(amount) * 0.95,
      txHash: txHash || null,
      status: 'funded', // funded → released → refunded → disputed
      fundedAt: new Date().toISOString(),
      releasedAt: null,
      refundedAt: null
    };
    writeJSON(path.join(DATA_DIR, 'escrow', `${escrow.id}.json`), escrow);
    try { syncMarketplaceEscrowToDb(escrow, job); } catch (e) { console.warn('[Marketplace] escrow DB sync failed after funding:', e.message); }

    job.escrowId = escrow.id;
    if (job.selectedAgentId || job.acceptedApplicant) {
      job.status = 'in_progress';
    }
    job.updatedAt = new Date().toISOString();
    writeJSON(jobPath, job);

    try { addActivity(actorId, 'escrow_created', { escrowId: escrow.id, amount: escrow.amount, jobId: job.id }); } catch(e) {}
    res.status(201).json(escrow);
  });

  // GET /api/marketplace/escrow/:id — Get escrow details
  app.get('/api/marketplace/escrow/:id', (req, res) => {
    const escrow = readJSON(path.join(DATA_DIR, 'escrow', `${req.params.id}.json`));
    if (!escrow) return res.status(404).json({ error: 'Escrow not found' });
    res.json(escrow);
  });

  // 5. POST /api/marketplace/jobs/:id/deliver — Submit deliverables
  app.post('/api/marketplace/jobs/:id/deliver', (req, res) => {
    const jobPath = path.join(DATA_DIR, 'jobs', `${req.params.id}.json`);
    const job = readJSON(jobPath);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'in_progress') return res.status(400).json({ error: 'Job must be in_progress' });

    const { submittedBy, deliverableUrl, description, files } = req.body;
    if (!submittedBy || !description) return res.status(400).json({ error: 'submittedBy and description required' });

    const auth = verifyMarketplaceAction(req, {
      action: 'submit_deliverable',
      job,
      actorId: submittedBy,
      requireWorker: true,
    });
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const actorId = auth.actorId;

    const deliverable = {
      id: genId('dlv'),
      jobId: job.id,
      submittedBy: normalizeActorId(actorId) || actorId,
      description,
      deliverableUrl: deliverableUrl || null,
      files: files || [],
      status: 'submitted', // submitted → approved → revision_requested
      submittedAt: new Date().toISOString()
    };
    writeJSON(path.join(DATA_DIR, 'deliverables', `${deliverable.id}.json`), deliverable);

    job.deliverableId = deliverable.id;
    job.updatedAt = new Date().toISOString();
    syncJobDeliverableSummary(job, deliverable);
    writeJSON(jobPath, job);
    try { syncMarketplaceJobToDb(job); } catch (e) { console.warn('[Marketplace] job DB sync failed after deliver:', e.message); }

    res.status(201).json(deliverable);
  });

  // 6. POST /api/marketplace/escrow/:id/release — Release payment
  app.post('/api/marketplace/escrow/:id/release', async (req, res) => {
    const escrowPath = path.join(DATA_DIR, 'escrow', `${req.params.id}.json`);
    const escrow = readJSON(escrowPath);
    if (!escrow) return res.status(404).json({ error: 'Escrow not found' });
    if (escrow.status !== 'funded') return res.status(400).json({ error: 'Escrow not in funded state' });

    const jobPath = path.join(DATA_DIR, 'jobs', `${escrow.jobId}.json`);
    const job = readJSON(jobPath);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { releasedBy, releaseTxHash } = req.body;
    if (!releasedBy) return res.status(400).json({ error: 'releasedBy required' });

    const auth = verifyMarketplaceAction(req, {
      action: 'release_escrow',
      job,
      actorId: releasedBy,
      escrowId: escrow.id,
      requirePoster: true,
    });
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const actorId = auth.actorId;
    if (!matchesActor(actorId, escrow.fundedBy)) {
      return res.status(403).json({ error: 'Only the job poster can release payment' });
    }

    const fundingState = await getVerifiedFundingState(job, escrow);
    if (!fundingState.funded) {
      return res.status(400).json({ error: fundingState.reason || 'Escrow must be verifiably funded before release' });
    }
    if (!hasSubmittedWork(job, fundingState)) {
      return res.status(400).json({ error: 'Worker must submit deliverables before release' });
    }
    if (!releaseTxHash) {
      return res.status(400).json({ error: 'releaseTxHash required for secure escrow release' });
    }
    if (!escrowOnchainLib?.confirmTransaction) {
      return res.status(500).json({ error: 'On-chain release verifier unavailable' });
    }
    try {
      await escrowOnchainLib.confirmTransaction(releaseTxHash);
    } catch (e) {
      return res.status(400).json({ error: `Release transaction not confirmed on-chain: ${e.message}` });
    }
    if (fundingState.onchain) {
      const refreshedFunding = await getVerifiedFundingState(job, escrow);
      if (!['released', 'auto_released'].includes(refreshedFunding.onchainState?.status)) {
        return res.status(400).json({ error: 'Escrow PDA is not released on-chain' });
      }
    }

    escrow.status = 'released';
    escrow.releasedBy = normalizeActorId(actorId) || actorId;
    escrow.releaseTxHash = releaseTxHash;
    escrow.releasedAt = new Date().toISOString();
    writeJSON(escrowPath, escrow);
    try { syncMarketplaceEscrowToDb(escrow, job); } catch (e) { console.warn('[Marketplace] escrow DB sync failed after release:', e.message); }

    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.updatedAt = new Date().toISOString();
    job.fundsReleased = true;
    job.releaseTxHash = releaseTxHash;
    job.releasedAt = escrow.releasedAt || new Date().toISOString();
    writeJSON(jobPath, job);

    if (job.deliverableId) {
      const dlvPath = path.join(DATA_DIR, 'deliverables', `${job.deliverableId}.json`);
      const dlv = readJSON(dlvPath);
      if (dlv) {
        dlv.status = 'approved';
        dlv.approvedAt = new Date().toISOString();
        writeJSON(dlvPath, dlv);
        syncJobDeliverableSummary(job, dlv);
        writeJSON(jobPath, job);
      }
    }
    try { syncMarketplaceJobToDb(job); } catch (e) { console.warn('[Marketplace] job DB sync failed after release:', e.message); }

    res.json({
      message: 'Payment released',
      escrow,
      workerPayout: escrow.workerPayout,
      platformFee: escrow.platformFee
    });
  });

  // POST /api/marketplace/escrow/:id/refund — Refund escrow
  app.post('/api/marketplace/escrow/:id/refund', (req, res) => {
    const escrowPath = path.join(DATA_DIR, 'escrow', `${req.params.id}.json`);
    const escrow = readJSON(escrowPath);
    if (!escrow) return res.status(404).json({ error: 'Escrow not found' });
    if (escrow.status !== 'funded') return res.status(400).json({ error: 'Escrow not in funded state' });

    const { refundedBy, reason } = req.body;
    const jobPath = path.join(DATA_DIR, 'jobs', `${escrow.jobId}.json`);
    const job = readJSON(jobPath);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!refundedBy) return res.status(400).json({ error: 'refundedBy required' });

    const auth = verifyMarketplaceAction(req, {
      action: 'refund_escrow',
      job,
      actorId: refundedBy,
      escrowId: escrow.id,
      requirePoster: true,
    });
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const actorId = auth.actorId;
    if (!matchesActor(actorId, escrow.fundedBy)) {
      return res.status(403).json({ error: 'Only the job poster can refund escrow' });
    }

    escrow.status = 'refunded';
    escrow.refundedBy = normalizeActorId(actorId) || actorId;
    escrow.refundReason = reason || 'No reason provided';
    escrow.refundedAt = new Date().toISOString();
    writeJSON(escrowPath, escrow);
    try { syncMarketplaceEscrowToDb(escrow, job); } catch (e) { console.warn('[Marketplace] escrow DB sync failed after refund:', e.message); }

    job.status = 'closed';
    job.updatedAt = new Date().toISOString();
    writeJSON(jobPath, job);

    res.json({ message: 'Escrow refunded', escrow });
  });

  
  // POST /api/marketplace/jobs/:id/complete — Approve work and release payment
  app.post('/api/marketplace/jobs/:id/complete', async (req, res) => {
    const jobPath = path.join(DATA_DIR, 'jobs', req.params.id + '.json');
    const job = readJSON(jobPath);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status === 'completed') return res.json({ message: 'Already completed', job });
    if (job.status !== 'in_progress') return res.status(400).json({ error: 'Job must be in_progress to complete' });

    const { approvedBy, completionNote, clientId, releaseTxSignature, v3Release } = req.body;
    const requestedActorId = approvedBy || clientId;
    if (!requestedActorId) return res.status(400).json({ error: 'approvedBy or clientId required' });

    const auth = verifyMarketplaceAction(req, {
      action: 'complete_job',
      job,
      actorId: requestedActorId,
      requirePoster: true,
    });
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const actorId = auth.actorId;

    if (!job.acceptedApplicant && !job.selectedAgentId) {
      return res.status(400).json({ error: 'Job has no accepted worker' });
    }

    const fundingState = await getVerifiedFundingState(job);
    if (!fundingState.funded) {
      return res.status(400).json({ error: fundingState.reason || 'Escrow must be verifiably funded before completion' });
    }
    if (!hasSubmittedWork(job, fundingState)) {
      return res.status(400).json({ error: 'Worker must submit deliverables before completion' });
    }
    if (!releaseTxSignature) {
      return res.status(400).json({ error: 'releaseTxSignature required for secure completion' });
    }
    if (!escrowOnchainLib?.confirmTransaction) {
      return res.status(500).json({ error: 'On-chain release verifier unavailable' });
    }
    try {
      await escrowOnchainLib.confirmTransaction(releaseTxSignature);
    } catch (e) {
      return res.status(400).json({ error: `Release transaction not confirmed on-chain: ${e.message}` });
    }
    if (fundingState.onchain) {
      const refreshedFunding = await getVerifiedFundingState(job, fundingState.escrow);
      if (!['released', 'auto_released'].includes(refreshedFunding.onchainState?.status)) {
        return res.status(400).json({ error: 'Escrow PDA is not released on-chain' });
      }
    }

    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.updatedAt = new Date().toISOString();
    job.approvedBy = normalizeActorId(actorId) || actorId;
    job.completionNote = completionNote || '';
    job.fundsReleased = true;
    job.releaseTxHash = releaseTxSignature;
    job.releasedAt = new Date().toISOString();
    if (v3Release) {
      job.v3ReleaseTx = releaseTxSignature;
      job.v3ReleasedAt = new Date().toISOString();
    }
    writeJSON(jobPath, job);

    if (fundingState.escrow) {
      fundingState.escrow.status = 'released';
      fundingState.escrow.releasedBy = normalizeActorId(actorId) || actorId;
      fundingState.escrow.releaseTxHash = releaseTxSignature;
      fundingState.escrow.releasedAt = job.releasedAt;
      writeJSON(path.join(DATA_DIR, 'escrow', `${fundingState.escrow.id}.json`), fundingState.escrow);
      try { syncMarketplaceEscrowToDb(fundingState.escrow, job); } catch (e) { console.warn('[Marketplace] escrow DB sync failed after complete:', e.message); }
    }

    const deliverable = getJobDeliverable(job);
    if (deliverable && deliverable.status === 'submitted') {
      deliverable.status = 'approved';
      deliverable.approvedAt = new Date().toISOString();
      writeJSON(path.join(DATA_DIR, 'deliverables', `${deliverable.id}.json`), deliverable);
      syncJobDeliverableSummary(job, deliverable);
      writeJSON(jobPath, job);
    }
    try { syncMarketplaceJobToDb(job); } catch (e) { console.warn('[Marketplace] job DB sync failed after complete:', e.message); }

    res.json({ success: true, message: 'Work approved! Payment released.', job });
  });

  // POST /api/marketplace/jobs/:id/request-changes — Request revisions
  app.post('/api/marketplace/jobs/:id/request-changes', (req, res) => {
    const jobPath = path.join(DATA_DIR, 'jobs', req.params.id + '.json');
    const job = readJSON(jobPath);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { requestedBy, note } = req.body;
    if (!requestedBy) return res.status(400).json({ error: 'requestedBy required' });

    const auth = verifyMarketplaceAction(req, {
      action: 'request_changes',
      job,
      actorId: requestedBy,
      requirePoster: true,
    });
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const actorId = auth.actorId;

    if (!note) return res.status(400).json({ error: 'Change note required' });
    if (!job.deliverableId) return res.status(400).json({ error: 'No submitted deliverable to revise' });

    const deliverable = getJobDeliverable(job);
    if (!deliverable || deliverable.status !== 'submitted') {
      return res.status(400).json({ error: 'Deliverable not in submitted state' });
    }

    if (!job.changeRequests) job.changeRequests = [];
    job.changeRequests.push({
      requestedBy: normalizeActorId(actorId) || actorId,
      note,
      requestedAt: new Date().toISOString(),
    });
    job.status = 'in_progress';

    deliverable.status = 'revision_requested';
    deliverable.revisionRequestedAt = new Date().toISOString();
    deliverable.revisionReason = note;
    writeJSON(path.join(DATA_DIR, 'deliverables', `${deliverable.id}.json`), deliverable);
    syncJobDeliverableSummary(job, deliverable);
    writeJSON(jobPath, job);
    try { syncMarketplaceJobToDb(job); } catch (e) { console.warn('[Marketplace] job DB sync failed after revision request:', e.message); }

    res.json({ success: true, message: 'Changes requested', changeRequests: job.changeRequests });
  });

  // POST /api/marketplace/jobs/:id/confirm-deposit — Confirm on-chain escrow deposit
  app.post('/api/marketplace/jobs/:id/confirm-deposit', async (req, res) => {
    const jobPath = path.join(DATA_DIR, 'jobs', `${req.params.id}.json`);
    const job = readJSON(jobPath);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!job.escrowId) return res.status(400).json({ error: 'No escrow created for this job' });

    const escrowPath = path.join(DATA_DIR, 'escrow', `${job.escrowId}.json`);
    const escrow = readJSON(escrowPath);
    if (!escrow) return res.status(404).json({ error: 'Escrow record not found' });

    const { txHash, confirmedBy } = req.body;
    if (!txHash) return res.status(400).json({ error: 'txHash required' });
    if (!confirmedBy) return res.status(400).json({ error: 'confirmedBy required' });

    const auth = verifyMarketplaceAction(req, {
      action: 'confirm_deposit',
      job,
      actorId: confirmedBy,
      escrowId: escrow.id,
      requirePoster: true,
    });
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const actorId = auth.actorId;
    if (!matchesActor(actorId, escrow.fundedBy)) {
      return res.status(403).json({ error: 'Only the job poster can confirm escrow funding' });
    }
    if (!escrowOnchainLib?.confirmTransaction || !escrowOnchainLib?.readEscrowAccount) {
      return res.status(500).json({ error: 'On-chain escrow verifier unavailable' });
    }

    try {
      await escrowOnchainLib.confirmTransaction(txHash);
    } catch (e) {
      return res.status(400).json({ error: `Deposit transaction not confirmed on-chain: ${e.message}` });
    }

    let onchainState;
    try {
      onchainState = await escrowOnchainLib.readEscrowAccount(job.id);
    } catch (e) {
      return res.status(400).json({ error: `Failed to read on-chain escrow: ${e.message}` });
    }
    if (!onchainState?.exists) {
      return res.status(400).json({ error: 'Escrow PDA not found on-chain' });
    }
    if (!['created', 'agent_accepted', 'work_submitted', 'released', 'auto_released'].includes(onchainState.status)) {
      return res.status(400).json({ error: `Escrow is ${onchainState.status || 'not funded'} on-chain` });
    }
    if (onchainState.client !== auth.walletAddress) {
      return res.status(403).json({ error: 'Signed wallet does not match the on-chain escrow client' });
    }

    escrow.txHash = txHash;
    escrow.escrowPDA = onchainState.escrowPDA;
    escrow.onchain = true;
    escrow.depositConfirmed = true;
    escrow.depositConfirmedAt = new Date().toISOString();
    escrow.depositConfirmedBy = normalizeActorId(actorId) || actorId;
    writeJSON(escrowPath, escrow);
    try { syncMarketplaceEscrowToDb(escrow, job); } catch (e) { console.warn('[Marketplace] escrow DB sync failed after deposit confirm:', e.message); }

    job.onchainEscrowPDA = onchainState.escrowPDA;
    job.depositConfirmedAt = escrow.depositConfirmedAt;
    job.escrowFunded = true;
    job.fundsLocked = true;
    if (job.selectedAgentId || job.acceptedApplicant) {
      job.status = 'in_progress';
    }
    job.updatedAt = new Date().toISOString();
    writeJSON(jobPath, job);
    try { syncMarketplaceJobToDb(job); } catch (e) { console.warn('[Marketplace] job DB sync failed after deposit confirm:', e.message); }

    res.json({ message: 'Deposit confirmed', escrow, onchain: onchainState });
  });

  // POST /api/marketplace/jobs/:id/v3-escrow-funded — Record V3 on-chain escrow creation
  app.post("/api/marketplace/jobs/:id/v3-escrow-funded", async (req, res) => {
    const jobPath = path.join(DATA_DIR, "jobs", `${req.params.id}.json`);
    const job = readJSON(jobPath);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const { clientId, escrowPDA, txSignature, amount, agentWallet, agentId } = req.body;
    if (!escrowPDA || !txSignature) {
      return res.status(400).json({ error: "escrowPDA and txSignature required" });
    }
    if (!clientId) return res.status(400).json({ error: 'clientId required' });

    const auth = verifyMarketplaceAction(req, {
      action: 'record_v3_escrow',
      job,
      actorId: clientId,
      escrowId: escrowPDA,
      requirePoster: true,
    });
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const actorId = auth.actorId;

    if (!escrowOnchainLib?.confirmTransaction) {
      return res.status(500).json({ error: 'On-chain transaction verifier unavailable' });
    }
    try {
      await escrowOnchainLib.confirmTransaction(txSignature);
    } catch (e) {
      return res.status(400).json({ error: `Escrow funding transaction not confirmed on-chain: ${e.message}` });
    }

    let v3EscrowState;
    try {
      v3EscrowState = await readV3EscrowState(escrowPDA);
    } catch (e) {
      return res.status(400).json({ error: `V3 escrow PDA could not be verified on-chain: ${e.message}` });
    }

    if (v3EscrowState.pda !== escrowPDA) {
      return res.status(400).json({ error: 'V3 escrow PDA mismatch' });
    }
    if (!['Active', 'WorkSubmitted', 'Released', 'Disputed', 'Resolved'].includes(v3EscrowState.status)) {
      return res.status(400).json({ error: `V3 escrow is ${v3EscrowState.status || 'not funded'} on-chain` });
    }
    if (v3EscrowState.client !== auth.walletAddress) {
      return res.status(403).json({ error: 'Signed wallet does not match the on-chain escrow client' });
    }
    if (agentWallet && v3EscrowState.agent !== agentWallet) {
      return res.status(400).json({ error: 'On-chain V3 escrow agent wallet mismatch' });
    }
    if (job.selectedAgentId && agentId && !isAcceptedWorker(agentId, job)) {
      return res.status(400).json({ error: 'V3 escrow agent does not match the accepted worker' });
    }
    if (job.selectedAgentId && agentWallet && !isAcceptedWorker(agentWallet, job)) {
      return res.status(400).json({ error: 'V3 escrow agent wallet does not match the accepted worker' });
    }

    job.v3EscrowPDA = escrowPDA;
    job.v3EscrowTx = txSignature;
    job.v3EscrowAmount = amount || null;
    job.v3EscrowAgentWallet = agentWallet || null;
    job.v3EscrowAgentId = agentId || null;
    job.v3EscrowStatus = v3EscrowState.status;
    job.v3EscrowClientWallet = v3EscrowState.client;
    job.v3EscrowFundedAt = new Date().toISOString();
    job.v3EscrowFundedBy = normalizeActorId(actorId) || actorId;
    job.v3EscrowVerifiedAt = new Date().toISOString();
    job.escrowFunded = true;
    job.fundsLocked = true;
    if (job.selectedAgentId || job.acceptedApplicant) {
      job.status = 'in_progress';
    }
    job.updatedAt = new Date().toISOString();

    writeJSON(jobPath, job);

    try { addActivity(actorId || "system", "v3_escrow_funded", { jobId: job.id, escrowPDA, txSignature, amount }); } catch(e) {}

    res.json({
      message: "V3 escrow recorded on job",
      jobId: job.id,
      escrowPDA,
      txSignature,
      onchainStatus: v3EscrowState.status,
    });
  });


  // POST /api/marketplace/deliverables/:id/revision — Request changes on a deliverable
  app.post('/api/marketplace/deliverables/:id/revision', (req, res) => {
    const dlvPath = path.join(DATA_DIR, 'deliverables', `${req.params.id}.json`);
    const dlv = readJSON(dlvPath);
    if (!dlv) return res.status(404).json({ error: 'Deliverable not found' });
    if (dlv.status !== 'submitted') return res.status(400).json({ error: 'Deliverable not in submitted state' });

    const { requestedBy, reason } = req.body;

    // Verify requestedBy is the job client
    const jobPath = path.join(DATA_DIR, 'jobs', `${dlv.jobId}.json`);
    const job = readJSON(jobPath);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const auth = verifyMarketplaceAction(req, {
      action: 'request_revision',
      job,
      actorId: requestedBy,
      deliverableId: dlv.id,
      requirePoster: true,
    });
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    dlv.status = 'revision_requested';
    dlv.revisionRequestedAt = new Date().toISOString();
    dlv.revisionReason = reason || 'Changes requested';
    writeJSON(dlvPath, dlv);

    syncJobDeliverableSummary(job, dlv);
    job.updatedAt = new Date().toISOString();
    writeJSON(jobPath, job);
    try { syncMarketplaceJobToDb(job); } catch (e) { console.warn('[Marketplace] job DB sync failed after deliverable revision:', e.message); }

    res.json({ message: 'Revision requested', deliverable: dlv });
  });

  // GET /api/marketplace/deliverables/:id — Get deliverable details
  app.get('/api/marketplace/deliverables/:id', (req, res) => {
    const dlv = readJSON(path.join(DATA_DIR, 'deliverables', `${req.params.id}.json`));
    if (!dlv) return res.status(404).json({ error: 'Deliverable not found' });
    res.json(dlv);
  });

  console.log('✓ Marketplace routes registered');
}

module.exports = { registerRoutes };
