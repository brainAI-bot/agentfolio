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
      
      // Get trust score from satp_trust_scores table
      let trustScore = 0;
      let verificationLevel = 0;
      let verificationLevelName = 'Unverified';
      try {
        const trustRow = db.prepare('SELECT overall_score, level FROM satp_trust_scores WHERE agent_id = ?').get(row.id);
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

// Normalize job.applications to always be an array
function readJob(filepath) {
  const job = readJSON(filepath);
  if (job && !Array.isArray(job.applications)) job.applications = [];
  return job;
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
      currency: currency || budgetCurrency || 'SOL',
      postedBy: resolvedPostedBy,
      clientId: resolvedPostedBy,
      category: category || 'other',
      skills: skills || skills_required || [],
      skills_required: skills_required || skills || [],
      budgetType: budgetType || 'fixed',
      budgetAmount: parseFloat(resolvedBudget),
      budgetCurrency: currency || budgetCurrency || 'SOL',
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
    const jobs = getAllFiles(path.join(DATA_DIR, 'jobs'));
    const status = req.query.status;
    const filtered = status ? jobs.filter(j => j.status === status) : jobs;
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
    applicantId = resolveApplicantId(applicantId);  // resolve wallet -> profile ID
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
    job.updatedAt = new Date().toISOString();
    writeJSON(jobPath, job);
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
  app.post('/api/marketplace/applications/:id/accept', (req, res) => {
    const appPath = path.join(DATA_DIR, 'applications', `${req.params.id}.json`);
    const application = readJSON(appPath);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    if (application.status !== 'pending') return res.status(400).json({ error: 'Application already processed' });

    const jobPath = path.join(DATA_DIR, 'jobs', `${application.jobId}.json`);
    const job = readJob(jobPath);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    // Bug fix: Only job poster can accept applications
    const { acceptedBy } = req.body || {};
    if (!acceptedBy || (acceptedBy !== job.postedBy && acceptedBy !== job.clientId)) {
      return res.status(403).json({ error: 'Only the job poster can accept applications' });
    }

    // Bug fix: Prevent accepting on non-open jobs (race condition)
    if (job.status !== 'open') {
      return res.status(400).json({ error: `Job is ${job.status}, not open for acceptance` });
    }

    // Accept this application, reject others
    application.status = 'accepted';
    application.acceptedAt = new Date().toISOString();
    writeJSON(appPath, application);

    job.applications.forEach(appId => {
      if (appId !== application.id) {
        const other = readJSON(path.join(DATA_DIR, 'applications', `${appId}.json`));
        if (other && other.status === 'pending') {
          other.status = 'rejected';
          writeJSON(path.join(DATA_DIR, 'applications', `${appId}.json`), other);
        }
      }
    });

    job.status = 'in_progress';
    job.acceptedApplicant = application.applicantId;
    job.updatedAt = new Date().toISOString();
    writeJSON(jobPath, job);

    res.json({ message: 'Application accepted', application, job });
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

    const escrow = {
      id: genId('esc'),
      jobId: job.id,
      fundedBy,
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
    if (submittedBy !== job.acceptedApplicant) return res.status(403).json({ error: 'Only the accepted worker can submit deliverables' });

    const deliverable = {
      id: genId('dlv'),
      jobId: job.id,
      submittedBy,
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
  app.post('/api/marketplace/escrow/:id/release', (req, res) => {
    const escrowPath = path.join(DATA_DIR, 'escrow', `${req.params.id}.json`);
    const escrow = readJSON(escrowPath);
    if (!escrow) return res.status(404).json({ error: 'Escrow not found' });
    if (escrow.status !== 'funded') return res.status(400).json({ error: 'Escrow not in funded state' });

    const { releasedBy, releaseTxHash } = req.body;
    if (!releasedBy) return res.status(400).json({ error: 'releasedBy required' });
    if (releasedBy !== escrow.fundedBy) return res.status(403).json({ error: 'Only the funder can release payment' });

    escrow.status = 'released';
    escrow.releasedBy = releasedBy;
    escrow.releaseTxHash = releaseTxHash || null;
    escrow.releasedAt = new Date().toISOString();
    writeJSON(escrowPath, escrow);

    // Mark job completed
    const jobPath = path.join(DATA_DIR, 'jobs', `${escrow.jobId}.json`);
    const job = readJSON(jobPath);
    if (job) {
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.updatedAt = new Date().toISOString();
      writeJSON(jobPath, job);
    }

    // Update deliverable
    if (job && job.deliverableId) {
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
    escrow.status = 'refunded';
    escrow.refundedBy = refundedBy;
    escrow.refundReason = reason || 'No reason provided';
    escrow.refundedAt = new Date().toISOString();
    writeJSON(escrowPath, escrow);

    const jobPath = path.join(DATA_DIR, 'jobs', `${escrow.jobId}.json`);
    const job = readJSON(jobPath);
    if (job) {
      job.status = 'closed';
      job.updatedAt = new Date().toISOString();
      writeJSON(jobPath, job);
    }

    res.json({ message: 'Escrow refunded', escrow });
  });

  
  // POST /api/marketplace/jobs/:id/complete — Approve work and release payment
  app.post('/api/marketplace/jobs/:id/complete', (req, res) => {
    const jobPath = path.join(DATA_DIR, 'jobs', req.params.id + '.json');
    const job = readJSON(jobPath);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status === 'completed') return res.json({ message: 'Already completed', job });
    
    const { approvedBy, completionNote, clientId, releaseTxSignature, v3Release } = req.body;
    
    // Mark as completed
    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.approvedBy = approvedBy || clientId || 'unknown';
    job.completionNote = completionNote || '';
    job.fundsReleased = true;
    if (v3Release && releaseTxSignature) {
      job.v3ReleaseTx = releaseTxSignature;
      job.v3ReleasedAt = new Date().toISOString();
    }
    writeJSON(jobPath, job);
    
    res.json({ success: true, message: 'Work approved! Payment released.', job });
  });

  // POST /api/marketplace/jobs/:id/request-changes — Request revisions
  app.post('/api/marketplace/jobs/:id/request-changes', (req, res) => {
    const jobPath = path.join(DATA_DIR, 'jobs', req.params.id + '.json');
    const job = readJSON(jobPath);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    
    const { requestedBy, note } = req.body;
    if (!note) return res.status(400).json({ error: 'Change note required' });
    
    // Add change request to job history
    if (!job.changeRequests) job.changeRequests = [];
    job.changeRequests.push({
      requestedBy: requestedBy || 'unknown',
      note,
      requestedAt: new Date().toISOString(),
    });
    job.status = 'in_progress'; // Back to in_progress for revisions
    job.deliverableId = null; // Clear deliverable so worker can resubmit
    writeJSON(jobPath, job);
    
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

    escrow.txHash = txHash;
    escrow.depositConfirmed = true;
    escrow.depositConfirmedAt = new Date().toISOString();
    escrow.depositConfirmedBy = confirmedBy || null;
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

    // Store V3 escrow data on the job
    job.v3EscrowPDA = escrowPDA;
    job.v3EscrowTx = txSignature;
    job.v3EscrowAmount = amount || null;
    job.v3EscrowAgentWallet = agentWallet || null;
    job.v3EscrowAgentId = agentId || null;
    job.v3EscrowFundedAt = new Date().toISOString();
    job.v3EscrowFundedBy = clientId || null;
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
    if (requestedBy !== job.postedBy && requestedBy !== job.clientId) {
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
