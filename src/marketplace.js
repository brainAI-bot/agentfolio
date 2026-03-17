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
    const { title, description, budget, budgetAmount, currency, postedBy, skills, skills_required, deadline } = req.body;
    const resolvedBudget = budget || budgetAmount;
    if (!title || !description || !resolvedBudget || !postedBy) {
      return res.status(400).json({ error: 'title, description, budget, and postedBy are required' });
    }
    const job = {
      id: genId('job'),
      title,
      description,
      budget: parseFloat(resolvedBudget),
      currency: currency || 'USDC',
      postedBy,
      skills: skills || skills_required || [],
      skills_required: skills_required || skills || [],
      deadline: deadline || null,
      status: 'open', // open → in_progress → completed → closed
      applications: [],
      acceptedApplicant: null,
      escrowId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    writeJSON(path.join(DATA_DIR, 'jobs', `${job.id}.json`), job);
    try { addActivity(postedBy, 'job_posted', { jobId: job.id, title }); } catch {}
    res.status(201).json(job);
  });

  // GET /api/marketplace/jobs — List all jobs (with hydrated applications)
  app.get('/api/marketplace/jobs', (req, res) => {
    const jobs = getAllFiles(path.join(DATA_DIR, 'jobs'));
    const status = req.query.status;
    const filtered = status ? jobs.filter(j => j.status === status) : jobs;
    // Hydrate application IDs into full application objects for each job
    const hydrated = filtered.map(job => {
      if (Array.isArray(job.applications)) {
        job.applications = job.applications.map(appId => {
          if (typeof appId === 'string') {
            const app = readJSON(path.join(DATA_DIR, 'applications', `${appId}.json`));
            return app || { id: appId, error: 'not_found' };
          }
          return appId; // already hydrated
        });
      }
      return job;
    });
    res.json({ jobs: hydrated, total: hydrated.length });
  });

  // GET /api/marketplace/jobs/:id — Get single job (with hydrated applications)
  app.get('/api/marketplace/jobs/:id', (req, res) => {
    const job = readJSON(path.join(DATA_DIR, 'jobs', `${req.params.id}.json`));
    if (!job) return res.status(404).json({ error: 'Job not found' });
    // Hydrate application IDs into full application objects
    if (Array.isArray(job.applications)) {
      job.applications = job.applications.map(appId => {
        const app = readJSON(path.join(DATA_DIR, 'applications', `${appId}.json`));
        return app || { id: appId, error: 'not_found' };
      });
    }
    res.json(job);
  });

  // 2. POST /api/marketplace/jobs/:id/apply (or /applications) — Apply to a job
  const applyHandler = (req, res) => {
    const jobPath = path.join(DATA_DIR, 'jobs', `${req.params.id}.json`);
    const job = readJSON(jobPath);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'open') return res.status(400).json({ error: 'Job is not open for applications' });

    const { applicantId, proposal, bidAmount } = req.body;
    if (!applicantId || !proposal) return res.status(400).json({ error: 'applicantId and proposal required' });
    if (applicantId === job.postedBy) return res.status(400).json({ error: 'Cannot apply to your own job' });

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
    const job = readJSON(path.join(DATA_DIR, 'jobs', `${req.params.id}.json`));
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
    const job = readJSON(jobPath);
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

  console.log('✓ Marketplace routes registered');
}

module.exports = { registerRoutes };
