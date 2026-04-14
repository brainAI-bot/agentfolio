/**
 * AgentFolio Marketplace — Full Job Flow
 * POST job → Apply → Accept → Escrow → Deliver → Release Payment
 * 
 * Data stored in JSON files (no DB dependency)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let addActivity;
try { addActivity = require('./profile-store').addActivity; } catch { addActivity = () => {}; }
const { syncMarketplaceJobToDb, syncMarketplaceApplicationToDb } = require('./lib/marketplace-db-sync');
let escrowOnchainLib;
try { escrowOnchainLib = require('./lib/escrow-onchain'); } catch { escrowOnchainLib = null; }

const DATA_DIR = path.join(__dirname, '..', 'data', 'marketplace');

// Helper: resolve wallet address to profile ID
function resolveApplicantId(applicantId) {
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(applicantId)) {
    try {
      const profileStore = require('./profile-store');
      const db = profileStore.getDb();
      const profiles = db.prepare('SELECT id, name, verification_data, wallets FROM profiles').all();
      for (const p of profiles) {
        try {
          const vd = JSON.parse(p.verification_data || '{}');
          if (vd.solana && vd.solana.address === applicantId && vd.solana.verified) return p.id;
          const w = JSON.parse(p.wallets || '{}');
          if (w.solana === applicantId) return p.id;
        } catch (_) {}
      }
    } catch (_) {}
  }
  return applicantId;
}

function resolveExistingApplicantProfileId(applicantId) {
  const resolvedApplicantId = resolveApplicantId(applicantId);
  try {
    const profileStore = require('./profile-store');
    const db = profileStore.getDb();

    let row = db.prepare('SELECT id FROM profiles WHERE id = ?').get(resolvedApplicantId);
    if (!row && typeof resolvedApplicantId === 'string' && !resolvedApplicantId.startsWith('agent_')) {
      row = db.prepare('SELECT id FROM profiles WHERE id = ?').get('agent_' + resolvedApplicantId.toLowerCase());
    }
    if (!row && typeof resolvedApplicantId === 'string') {
      row = db.prepare('SELECT id FROM profiles WHERE LOWER(name) = ?').get(resolvedApplicantId.toLowerCase());
    }

    return row ? row.id : null;
  } catch (_) {
    return null;
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

function isAcceptedWorker(actorId, job) {
  return !!job && (matchesActor(actorId, job.acceptedApplicant) || matchesActor(actorId, job.selectedAgentId));
}

// Ensure data dirs exist
['jobs', 'applications', 'escrow', 'deliverables'].forEach(dir => {
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

async function getVerifiedFundingState(job, escrow = null) {
  const result = { hasEscrow: false, funded: false, onchain: false, escrow: escrow || null, onchainState: null, reason: null };
  const localEscrow = escrow || getJobEscrow(job);
  result.escrow = localEscrow;

  const expectedPDA = job?.onchainEscrowPDA || job?.v3EscrowPDA || localEscrow?.escrowPDA || null;
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
    result.funded = localEscrow.status === 'funded' && !!(localEscrow.txHash || localEscrow.depositConfirmed);
    if (!result.funded) result.reason = 'Escrow is not verified as funded';
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
  return ['work_submitted', 'released', 'auto_released'].includes(fundingState?.onchainState?.status);
}

// Enrich application with profile trust/verification data
function enrichApplication(app) {
  if (!app || !app.applicantId) return app;
  try {
    const profileStore = require('./profile-store');
    const db = profileStore.getDb();
    
    // Try exact match, then lowercase with agent_ prefix, then case-insensitive name
    let row = db.prepare('SELECT id, name, avatar, nft_avatar, verification_data FROM profiles WHERE id = ?').get(app.applicantId);
    if (!row) {
      row = db.prepare('SELECT id, name, avatar, nft_avatar, verification_data FROM profiles WHERE id = ?').get('agent_' + app.applicantId.toLowerCase());
    }
    if (!row) {
      row = db.prepare('SELECT id, name, avatar, nft_avatar, verification_data FROM profiles WHERE LOWER(name) = ?').get(app.applicantId.toLowerCase());
    }
    
    if (row) {
      const levelNames = ['Unverified', 'Registered', 'Verified', 'Established', 'Trusted', 'Sovereign'];
      const vd = JSON.parse(row.verification_data || '{}');
      const badges = [];
      if (vd.solana?.verified) badges.push('solana');
      if (vd.github?.verified) badges.push('github');
      if (vd.x?.verified) badges.push('x');
      if (vd.satp?.verified) badges.push('satp');
      if (vd.agentmail?.verified) badges.push('agentmail');
      
      // Resolve avatar (nft_avatar.image takes priority)
      let resolvedAvatar = row.avatar;
      if (row.nft_avatar) {
        try {
          const nft = JSON.parse(row.nft_avatar);
          if (nft.image || nft.arweaveUrl) resolvedAvatar = (nft.image || nft.arweaveUrl).replace('node1.irys.xyz', 'gateway.irys.xyz');
        } catch {}
      }
      
      // P0: DB trust score reads removed — v3 on-chain only
      let trustScore = 0;
      let verificationLevel = 0;
      let verificationLevelName = 'Unverified';
      try {
        // trustRow DB lookup removed (P0)
        if (trustRow) {
          trustScore = trustRow.overall_score || 0;
          // level can be a number or a string label
          const lvl = trustRow.level;
          if (typeof lvl === 'number') {
            verificationLevel = lvl;
            verificationLevelName = levelNames[lvl] || 'Unverified';
          } else if (typeof lvl === 'string') {
            // Map string labels to numbers
            const labelMap = { 'UNVERIFIED': 0, 'REGISTERED': 1, 'VERIFIED': 2, 'ESTABLISHED': 3, 'TRUSTED': 4, 'SOVEREIGN': 5 };
            verificationLevel = labelMap[lvl.toUpperCase()] ?? 0;
            verificationLevelName = levelNames[verificationLevel] || lvl;
          }
        }
      } catch {}
      
      app.applicantName = row.name;
      app.applicantAvatar = resolvedAvatar;
      app.applicantProfileId = row.id;
      app.trustScore = trustScore;
      app.verificationLevel = verificationLevel;
      app.verificationLevelName = verificationLevelName;
      app.verificationBadges = badges;
    }
  } catch (e) { console.error('[Marketplace] enrichApplication error:', e.message); }
  return app;
}

// Normalize job.applications to always be an array and hydrate release state from escrow
function hydrateJobEscrowState(job) {
  if (!job) return job;
  if (!Array.isArray(job.applications)) job.applications = [];

  if (job.escrowId && !job.fundsReleased) {
    const escrow = readJSON(path.join(DATA_DIR, 'escrow', `${job.escrowId}.json`));
    if (escrow && (escrow.status === 'released' || escrow.status === 'auto_released')) {
      job.fundsReleased = true;
      if (!job.releaseTxHash && escrow.releaseTxHash) job.releaseTxHash = escrow.releaseTxHash;
      if (!job.releasedAt && escrow.releasedAt) job.releasedAt = escrow.releasedAt;
    }
  }

  return job;
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
    const job = {
      id: genId('job'),
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
      status: 'open',
      applications: [],
      acceptedApplicant: null,
      selectedAgentId: null,
      escrowId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    writeJSON(path.join(DATA_DIR, 'jobs', `${job.id}.json`), job);
    try { addActivity(resolvedPostedBy, 'job_posted', { jobId: job.id, title }); } catch {}
    res.status(201).json(job);
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
    const apps = job.applications.map(appId => readJSON(path.join(DATA_DIR, 'applications', `${appId}.json`))).filter(Boolean);
    res.json({ applications: apps, total: apps.length });
  });

  // 3. POST /api/marketplace/applications/:id/accept — Accept an application
  const acceptApplication = (applicationId, actorId, res) => {
    const appPath = path.join(DATA_DIR, 'applications', `${applicationId}.json`);
    const application = readJSON(appPath);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    if (application.status !== 'pending') return res.status(400).json({ error: 'Application already processed' });

    const jobPath = path.join(DATA_DIR, 'jobs', `${application.jobId}.json`);
    const job = readJob(jobPath);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!actorId) return res.status(400).json({ error: 'acceptedBy required' });
    if (!isJobPoster(actorId, job)) {
      return res.status(403).json({ error: 'Only the job poster can accept applications' });
    }
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

    job.status = 'in_progress';
    job.acceptedApplicant = application.applicantId;
    job.selectedAgentId = application.applicantId;
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
    return acceptApplication(req.params.id, acceptedBy, res);
  });

  app.post('/api/marketplace/jobs/:id/accept', (req, res) => {
    const job = readJob(path.join(DATA_DIR, 'jobs', `${req.params.id}.json`));
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const { applicationId, acceptedBy } = req.body || {};
    if (!applicationId) return res.status(400).json({ error: 'applicationId required' });
    if (!job.applications?.includes(applicationId)) {
      return res.status(400).json({ error: 'Application does not belong to this job' });
    }
    return acceptApplication(applicationId, acceptedBy, res);
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
    if (!isJobPoster(fundedBy, job)) {
      return res.status(403).json({ error: 'Only the job poster can fund escrow' });
    }

    const escrow = {
      id: genId('esc'),
      jobId: job.id,
      fundedBy: normalizeActorId(fundedBy) || fundedBy,
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

    job.escrowId = escrow.id;
    job.updatedAt = new Date().toISOString();
    writeJSON(jobPath, job);

    try { addActivity(fundedBy, 'escrow_created', { escrowId: escrow.id, amount: escrow.amount, jobId: job.id }); } catch(e) {}
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
    if (!isAcceptedWorker(submittedBy, job)) return res.status(403).json({ error: 'Only the accepted worker can submit deliverables' });

    const deliverable = {
      id: genId('dlv'),
      jobId: job.id,
      submittedBy: normalizeActorId(submittedBy) || submittedBy,
      description,
      deliverableUrl: deliverableUrl || null,
      files: files || [],
      status: 'submitted', // submitted → approved → revision_requested
      submittedAt: new Date().toISOString()
    };
    writeJSON(path.join(DATA_DIR, 'deliverables', `${deliverable.id}.json`), deliverable);

    job.deliverableId = deliverable.id;
    job.updatedAt = new Date().toISOString();
    writeJSON(jobPath, job);

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
    if (!isJobPoster(releasedBy, job) || !matchesActor(releasedBy, escrow.fundedBy)) {
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
    escrow.releasedBy = normalizeActorId(releasedBy) || releasedBy;
    escrow.releaseTxHash = releaseTxHash;
    escrow.releasedAt = new Date().toISOString();
    writeJSON(escrowPath, escrow);

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
        writeJSON(dlvPath, dlv);
      }
    }

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
    if (!isJobPoster(refundedBy, job) || !matchesActor(refundedBy, escrow.fundedBy)) {
      return res.status(403).json({ error: 'Only the job poster can refund escrow' });
    }

    escrow.status = 'refunded';
    escrow.refundedBy = normalizeActorId(refundedBy) || refundedBy;
    escrow.refundReason = reason || 'No reason provided';
    escrow.refundedAt = new Date().toISOString();
    writeJSON(escrowPath, escrow);

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
    const actorId = approvedBy || clientId;
    if (!actorId) return res.status(400).json({ error: 'approvedBy or clientId required' });
    if (!isJobPoster(actorId, job)) {
      return res.status(403).json({ error: 'Only the job poster can approve work and release payment' });
    }
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
    }

    const deliverable = getJobDeliverable(job);
    if (deliverable && deliverable.status === 'submitted') {
      deliverable.status = 'approved';
      deliverable.approvedAt = new Date().toISOString();
      writeJSON(path.join(DATA_DIR, 'deliverables', `${deliverable.id}.json`), deliverable);
    }

    res.json({ success: true, message: 'Work approved! Payment released.', job });
  });

  // POST /api/marketplace/jobs/:id/request-changes — Request revisions
  app.post('/api/marketplace/jobs/:id/request-changes', (req, res) => {
    const jobPath = path.join(DATA_DIR, 'jobs', req.params.id + '.json');
    const job = readJSON(jobPath);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { requestedBy, note } = req.body;
    if (!requestedBy) return res.status(400).json({ error: 'requestedBy required' });
    if (!isJobPoster(requestedBy, job)) {
      return res.status(403).json({ error: 'Only the job poster can request changes' });
    }
    if (!note) return res.status(400).json({ error: 'Change note required' });
    if (!job.deliverableId) return res.status(400).json({ error: 'No submitted deliverable to revise' });

    const deliverable = getJobDeliverable(job);
    if (!deliverable || deliverable.status !== 'submitted') {
      return res.status(400).json({ error: 'Deliverable not in submitted state' });
    }

    if (!job.changeRequests) job.changeRequests = [];
    job.changeRequests.push({
      requestedBy: normalizeActorId(requestedBy) || requestedBy,
      note,
      requestedAt: new Date().toISOString(),
    });
    job.status = 'in_progress';
    writeJSON(jobPath, job);

    deliverable.status = 'revision_requested';
    deliverable.revisionRequestedAt = new Date().toISOString();
    deliverable.revisionReason = note;
    writeJSON(path.join(DATA_DIR, 'deliverables', `${deliverable.id}.json`), deliverable);

    res.json({ success: true, message: 'Changes requested', changeRequests: job.changeRequests });
  });

  // POST /api/marketplace/jobs/:id/confirm-deposit — Confirm on-chain escrow deposit
  app.post('/api/marketplace/jobs/:id/confirm-deposit', (req, res) => {
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
    if (!isJobPoster(confirmedBy, job) || !matchesActor(confirmedBy, escrow.fundedBy)) {
      return res.status(403).json({ error: 'Only the job poster can confirm escrow funding' });
    }

    escrow.txHash = txHash;
    escrow.depositConfirmed = true;
    escrow.depositConfirmedAt = new Date().toISOString();
    escrow.depositConfirmedBy = normalizeActorId(confirmedBy) || confirmedBy;
    writeJSON(escrowPath, escrow);

    res.json({ message: 'Deposit confirmed', escrow });
  });

  // POST /api/marketplace/jobs/:id/v3-escrow-funded — Record V3 on-chain escrow creation
  app.post("/api/marketplace/jobs/:id/v3-escrow-funded", (req, res) => {
    const jobPath = path.join(DATA_DIR, "jobs", `${req.params.id}.json`);
    const job = readJSON(jobPath);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const { clientId, escrowPDA, txSignature, amount, agentWallet, agentId } = req.body;
    if (!escrowPDA || !txSignature) {
      return res.status(400).json({ error: "escrowPDA and txSignature required" });
    }
    if (!clientId) return res.status(400).json({ error: 'clientId required' });
    if (!isJobPoster(clientId, job)) {
      return res.status(403).json({ error: 'Only the job poster can record funded escrow' });
    }

    job.v3EscrowPDA = escrowPDA;
    job.v3EscrowTx = txSignature;
    job.v3EscrowAmount = amount || null;
    job.v3EscrowAgentWallet = agentWallet || null;
    job.v3EscrowAgentId = agentId || null;
    job.v3EscrowFundedAt = new Date().toISOString();
    job.v3EscrowFundedBy = normalizeActorId(clientId) || clientId;
    job.escrowFunded = true;
    job.updatedAt = new Date().toISOString();

    writeJSON(jobPath, job);

    try { addActivity(clientId || "system", "v3_escrow_funded", { jobId: job.id, escrowPDA, txSignature, amount }); } catch(e) {}

    res.json({
      message: "V3 escrow recorded on job",
      jobId: job.id,
      escrowPDA,
      txSignature,
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
    if (!isJobPoster(requestedBy, job)) {
      return res.status(403).json({ error: 'Only the job poster can request revisions' });
    }

    dlv.status = 'revision_requested';
    dlv.revisionRequestedAt = new Date().toISOString();
    dlv.revisionReason = reason || 'Changes requested';
    writeJSON(dlvPath, dlv);

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
