/**
 * AgentFolio Marketplace
 * Job posting, applications, and matching for AI agents
 * 
 * Uses SQLite database for storage (see database.js)
 * 
 * Escrow Integration:
 * - Jobs with budget > 0 require escrow deposit
 * - Funds locked when agent selected
 * - Released on completion, refunded on cancellation
 */

const crypto = require('crypto');
const db = require('./database');
const escrow = require('./escrow');

// Job statuses
const JOB_STATUS = {
  DRAFT: 'draft',
  OPEN: 'open',
  AGENT_ACCEPTED: 'agent_accepted',              // NEW
  IN_PROGRESS: 'in_progress',
  WORK_SUBMITTED: 'work_submitted',              // NEW
  COMPLETED: 'completed',
  AUTO_RELEASED: 'auto_released',                // NEW
  CANCELLED: 'cancelled',
  CANCELLED_WITH_COMPENSATION: 'cancelled_with_compensation', // NEW
  DISPUTED: 'disputed'
};

// Application statuses
const APP_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn'
};

// Job categories
const JOB_CATEGORIES = {
  trading: { name: 'Trading & Finance', icon: '📈' },
  development: { name: 'Development', icon: '💻' },
  research: { name: 'Research & Analysis', icon: '🔍' },
  creative: { name: 'Creative & Content', icon: '🎨' },
  automation: { name: 'Automation & Bots', icon: '🤖' },
  data: { name: 'Data & Analytics', icon: '📊' },
  other: { name: 'Other', icon: '📦' }
};

// Budget types
const BUDGET_TYPES = {
  FIXED: 'fixed',
  HOURLY: 'hourly',
  BOUNTY: 'bounty'
};

// Timeline options
const TIMELINES = {
  asap: 'ASAP',
  '1_week': '1 Week',
  '2_weeks': '2 Weeks',
  '1_month': '1 Month',
  flexible: 'Flexible'
};

// Generate unique ID
function generateId(prefix = 'job') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

// Verify profile exists
function verifyProfile(profileId) {
  return !!db.loadProfile(profileId);
}

// Create new job
function createJob(data) {
  // Require verified AgentFolio profile to post jobs
  if (!verifyProfile(data.clientId)) {
    return { error: 'Must have a verified AgentFolio profile to post jobs. Register at /submit first.' };
  }
  
  const budgetAmount = data.budgetAmount || 0;
  const requiresEscrow = budgetAmount > 0;
  
  const job = {
    id: generateId('job'),
    clientId: data.clientId,
    title: data.title,
    description: data.description,
    category: data.category || 'other',
    skills: data.skills || [],
    budgetType: data.budgetType || BUDGET_TYPES.FIXED,
    budgetAmount: budgetAmount,
    budgetCurrency: data.budgetCurrency || 'USDC',
    budgetMax: data.budgetMax || null,
    timeline: data.timeline || 'flexible',
    status: requiresEscrow ? JOB_STATUS.DRAFT : JOB_STATUS.OPEN,
    attachments: data.attachments || [],
    requirements: data.requirements || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: data.expiresAt || null,
    selectedAgentId: null,
    applicationCount: 0,
    viewCount: 0,
    escrowId: null,
    escrowRequired: requiresEscrow,
    escrowFunded: false,
    escrowType: data.escrowType || (requiresEscrow ? 'custodial' : null),
    clientWallet: data.clientWallet || null
  };
  
  const savedJob = db.saveJob(job);
  
  // Create escrow if budget > 0
  if (requiresEscrow && !savedJob.error) {
    const escrowRecord = escrow.createEscrow(savedJob.id, {
      clientId: data.clientId,
      clientWallet: data.clientWallet || null,
      amount: budgetAmount,
      currency: data.budgetCurrency || 'USDC',
      expiresAt: data.expiresAt,
      burnPct: data.burnPct || 0
    });
    
    savedJob.escrowId = escrowRecord.id;
    db.saveJob(savedJob);
  }
  
  return savedJob;
}

// Confirm escrow deposit and open job
function confirmJobDeposit(jobId, txHash) {
  const job = loadJob(jobId);
  if (!job) return { error: 'Job not found' };
  if (!job.escrowId) return { error: 'No escrow for this job' };
  if (job.status !== JOB_STATUS.DRAFT) {
    return { error: 'Job not awaiting deposit' };
  }
  
  // Confirm the escrow deposit
  const escrowResult = escrow.confirmDeposit(job.escrowId, txHash);
  if (escrowResult.error) return escrowResult;
  
  // Open the job
  job.status = JOB_STATUS.OPEN;
  job.escrowFunded = true;
  job.depositConfirmedAt = new Date().toISOString();
  job.updatedAt = new Date().toISOString();
  
  return db.saveJob(job);
}

// Load single job
function loadJob(jobId) {
  return db.loadJob(jobId);
}

// Update job
function updateJob(jobId, updates) {
  const job = loadJob(jobId);
  if (!job) return null;
  
  // Only allow certain fields to be updated
  const allowedUpdates = ['title', 'description', 'category', 'skills', 'budgetAmount', 
                          'budgetMax', 'timeline', 'requirements', 'attachments', 'expiresAt'];
  
  allowedUpdates.forEach(field => {
    if (updates[field] !== undefined) {
      job[field] = updates[field];
    }
  });
  
  job.updatedAt = new Date().toISOString();
  return db.saveJob(job);
}

// Cancel job — tiered cancellation
// Tier 1: Agent never responded → full refund, 0 fees
// Tier 2: Agent accepted but not started → 10% compensation to agent
// Tier 3: Work submitted, client ghosts → handled by auto-release timer
function cancelJob(jobId, reason = '') {
  const job = loadJob(jobId);
  if (!job) return null;
  
  let escrowResult = null;
  
  // Tier 1: Draft/Open — agent never responded, full refund
  if ([JOB_STATUS.DRAFT, JOB_STATUS.OPEN].includes(job.status)) {
    if (job.escrowId && job.escrowFunded) {
      escrowResult = escrow.refundClient(job.escrowId, reason || 'Agent never responded');
      if (escrowResult.error) return escrowResult;
    }
    job.status = JOB_STATUS.CANCELLED;
    job.cancelledAt = new Date().toISOString();
    job.cancelReason = reason;
    job.cancellationType = 'no_response';
    job.updatedAt = new Date().toISOString();
    job.fundsRefunded = !!(escrowResult && !escrowResult.error);
    return { job: db.saveJob(job), escrow: escrowResult };
  }
  
  // Tier 2: Agent accepted but not started → 10% compensation
  if (job.status === JOB_STATUS.AGENT_ACCEPTED) {
    if (job.escrowId) {
      escrowResult = escrow.cancelWithCompensation(job.escrowId, reason || 'Client cancelled after agent accepted');
      if (escrowResult.error) return escrowResult;
    }
    job.status = JOB_STATUS.CANCELLED_WITH_COMPENSATION;
    job.cancelledAt = new Date().toISOString();
    job.cancelReason = reason;
    job.cancellationType = 'pre_start';
    job.updatedAt = new Date().toISOString();
    return { job: db.saveJob(job), escrow: escrowResult };
  }
  
  // Cannot cancel jobs that are in progress or submitted
  if ([JOB_STATUS.IN_PROGRESS, JOB_STATUS.WORK_SUBMITTED].includes(job.status)) {
    return { error: 'Cannot cancel job in progress. File a dispute instead.' };
  }
  
  return { error: 'Cannot cancel job in current status: ' + job.status };
}

// List jobs with filters
function listJobs(filters = {}) {
  let jobs = db.loadJobs(filters);
  
  // Apply additional filters not handled by database
  
  // Filter by status (default: open)
  if (filters.status) {
    jobs = jobs.filter(j => j.status === filters.status);
  } else if (filters.status !== 'all') {
    jobs = jobs.filter(j => j.status === JOB_STATUS.OPEN);
  }
  
  // Filter by category
  if (filters.category) {
    jobs = jobs.filter(j => j.category === filters.category);
  }
  
  // Filter by skills (any match)
  if (filters.skills && filters.skills.length > 0) {
    jobs = jobs.filter(j => 
      j.skills.some(s => filters.skills.includes(s.toLowerCase()))
    );
  }
  
  // Filter by budget range
  if (filters.minBudget) {
    jobs = jobs.filter(j => j.budgetAmount >= filters.minBudget);
  }
  if (filters.maxBudget) {
    jobs = jobs.filter(j => j.budgetAmount <= filters.maxBudget);
  }
  
  // Search in title/description
  if (filters.search && typeof filters.search === 'string') {
    const searchLower = filters.search.toLowerCase();
    jobs = jobs.filter(j => 
      (j.title || '').toLowerCase().includes(searchLower) ||
      (j.description || '').toLowerCase().includes(searchLower)
    );
  }
  
  // Sort
  const sortField = filters.sortBy || 'createdAt';
  const sortDir = filters.sortDir === 'asc' ? 1 : -1;
  jobs.sort((a, b) => {
    if (sortField === 'budgetAmount') {
      return (a.budgetAmount - b.budgetAmount) * sortDir;
    }
    return ((a[sortField] || '') > (b[sortField] || '') ? 1 : -1) * sortDir;
  });
  
  // Pagination
  const page = filters.page || 1;
  const limit = filters.limit || 20;
  const start = (page - 1) * limit;
  
  return {
    jobs: jobs.slice(start, start + limit),
    total: jobs.length,
    page,
    pages: Math.ceil(jobs.length / limit)
  };
}

// Start work on job (agent_accepted → in_progress)
function startJobWork(jobId) {
  const job = loadJob(jobId);
  if (!job) return { error: 'Job not found' };
  if (job.status !== JOB_STATUS.AGENT_ACCEPTED) return { error: 'Job must be in agent_accepted status' };
  
  if (job.escrowId) {
    const result = escrow.startWork(job.escrowId);
    if (result.error) return result;
  }
  
  job.status = JOB_STATUS.IN_PROGRESS;
  job.workStartedAt = new Date().toISOString();
  job.updatedAt = new Date().toISOString();
  return db.saveJob(job);
}

// Submit work (triggers 24h auto-release timer)
function submitJobWork(jobId, data = {}) {
  const job = loadJob(jobId);
  if (!job) return { error: 'Job not found' };
  if (![JOB_STATUS.AGENT_ACCEPTED, JOB_STATUS.IN_PROGRESS].includes(job.status)) {
    return { error: 'Job must be in progress or agent_accepted to submit work' };
  }
  
  let escrowResult = null;
  if (job.escrowId) {
    escrowResult = escrow.submitWork(job.escrowId);
    if (escrowResult.error) return escrowResult;
  }
  
  job.status = JOB_STATUS.WORK_SUBMITTED;
  job.workSubmittedAt = new Date().toISOString();
  job.submissionNote = data.note || '';
  job.submissionUrl = data.url || null;
  job.updatedAt = new Date().toISOString();
  
  const savedJob = db.saveJob(job);
  return { job: savedJob, escrow: escrowResult };
}

// Complete job (releases escrow to agent)
async function completeJob(jobId, data = {}) {
  const job = loadJob(jobId);
  if (!job) return { error: 'Job not found' };
  if (![JOB_STATUS.IN_PROGRESS, JOB_STATUS.WORK_SUBMITTED, JOB_STATUS.AGENT_ACCEPTED].includes(job.status)) {
    return { error: 'Job is not in a completable state' };
  }
  
  // Release escrow if exists (now on-chain!)
  let escrowResult = null;
  if (job.escrowId) {
    escrowResult = await escrow.releaseFunds(job.escrowId, data.txHash || null);
    if (escrowResult.error) return escrowResult;
  }
  
  job.status = JOB_STATUS.COMPLETED;
  job.completedAt = new Date().toISOString();
  job.completionNote = data.note || '';
  job.updatedAt = new Date().toISOString();
  job.fundsReleased = !!job.escrowId;
  job.releaseTxHash = escrowResult?.releaseTxHash || null;
  
  const savedJob = db.saveJob(job);
  return { job: savedJob, escrow: escrowResult };
}

// Open dispute on a job
function disputeJob(jobId, disputeData) {
  const job = loadJob(jobId);
  if (!job) return { error: 'Job not found' };
  if (![JOB_STATUS.IN_PROGRESS, JOB_STATUS.WORK_SUBMITTED, JOB_STATUS.AGENT_ACCEPTED].includes(job.status)) {
    return { error: 'Can only dispute active jobs (in_progress, work_submitted, or agent_accepted)' };
  }
  if (!job.escrowId) {
    return { error: 'No escrow to dispute' };
  }
  
  // Open escrow dispute
  const result = escrow.openDispute(job.escrowId, disputeData);
  if (result.error) return result;
  
  job.status = JOB_STATUS.DISPUTED;
  job.disputedAt = new Date().toISOString();
  job.disputeId = result.dispute.id;
  job.updatedAt = new Date().toISOString();
  
  const savedJob = db.saveJob(job);
  return { job: savedJob, dispute: result.dispute, escrow: result.escrow };
}

// Increment view count
function incrementJobViews(jobId) {
  db.incrementJobViews(jobId);
  return loadJob(jobId);
}

// Create application
function createApplication(jobId, data) {
  const job = loadJob(jobId);
  if (!job) return { error: 'Job not found' };
  if (job.status !== JOB_STATUS.OPEN) return { error: 'Job is not accepting applications' };
  
  // Block applications if escrow is required but not funded
  if (job.escrowRequired && !job.escrowFunded) {
    return { error: 'Cannot apply — escrow has not been funded yet. The client must fund the escrow first.' };
  }
  
  // Require verified AgentFolio profile to apply
  if (!verifyProfile(data.agentId)) {
    return { error: 'Must have a verified AgentFolio profile to apply. Register at /submit first.' };
  }
  
  // Check if agent already applied
  if (db.hasApplied(jobId, data.agentId)) {
    return { error: 'You have already applied to this job' };
  }
  
  // If team application, verify team membership
  let teamId = null;
  if (data.teamId) {
    try {
      const teams = require('./teams');
      const memberRole = teams.getMemberRole(data.teamId, data.agentId);
      if (!memberRole) {
        return { error: 'You must be a member of this team to apply on their behalf' };
      }
      // Only owner/admin can apply for team
      if (memberRole !== 'owner' && memberRole !== 'admin') {
        return { error: 'Only team owner or admin can submit applications for the team' };
      }
      teamId = data.teamId;
    } catch (e) {
      console.error('[Marketplace] Team verification failed:', e.message);
    }
  }
  
  // FIX: Auto-fetch wallet from agent profile if not provided
  let walletAddress = data.walletAddress || null;
  if (!walletAddress) {
    const agentProfile = db.loadProfile(data.agentId);
    if (agentProfile) {
      // Try wallets.solana first, then verificationData.solana.address
      if (agentProfile.wallets?.solana) {
        walletAddress = agentProfile.wallets.solana;
      } else if (agentProfile.verificationData?.solana?.address) {
        walletAddress = agentProfile.verificationData.solana.address;
      }
    }
  }
  
  const application = {
    id: generateId('app'),
    jobId,
    agentId: data.agentId,
    teamId, // null for individual, team_id for team applications
    // FIX: Accept both coverMessage and coverLetter field names for API compatibility
    coverMessage: data.coverMessage || data.coverLetter || data.proposal || '',
    proposedBudget: data.proposedBudget || job.budgetAmount,
    proposedTimeline: data.proposedTimeline || job.timeline,
    portfolioItems: data.portfolioItems || [],
    walletAddress: walletAddress, // Solana wallet for payment (auto-fetched from profile if not provided)
    status: APP_STATUS.PENDING,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  db.saveApplication(application);
  
  // Update job application count
  job.applicationCount = db.getApplicationCount(jobId);
  db.saveJob(job);
  
  return application;
}

// Get application by ID
function getApplication(jobId, appId) {
  return db.getApplication(jobId, appId);
}

// Load applications for a job
function loadApplications(jobId) {
  return db.loadApplications(jobId);
}

// Update application status
function updateApplicationStatus(jobId, appId, status, note = '') {
  const applications = loadApplications(jobId);
  const app = applications.find(a => a.id === appId);
  if (!app) return { error: 'Application not found' };
  
  app.status = status;
  app.statusNote = note;
  app.updatedAt = new Date().toISOString();
  
  db.saveApplication(app);
  return app;
}

// Select winner (accept application)
function selectWinner(jobId, appId, agentWallet = null) {
  const job = loadJob(jobId);
  if (!job) return { error: 'Job not found' };
  if (job.status !== JOB_STATUS.OPEN) return { error: 'Job is not open' };
  
  // Block selection if escrow is required but not funded
  if (job.escrowRequired && !job.escrowFunded) {
    return { error: 'Cannot accept agent — escrow has not been funded yet. Fund the escrow first.' };
  }
  
  const applications = loadApplications(jobId);
  const winningApp = applications.find(a => a.id === appId);
  if (!winningApp) return { error: 'Application not found' };
  
  // Use wallet from application if not provided
  const wallet = agentWallet || winningApp.walletAddress;
  
  // Lock escrow if exists
  if (job.escrowId) {
    if (!wallet) {
      return { error: 'Agent wallet address required for escrow jobs. Agent must provide Solana wallet.' };
    }
    const escrowResult = escrow.lockFunds(job.escrowId, winningApp.agentId, wallet);
    if (escrowResult.error) return escrowResult;
  }
  
  // Accept the winning application
  winningApp.status = APP_STATUS.ACCEPTED;
  winningApp.acceptedAt = new Date().toISOString();
  winningApp.updatedAt = new Date().toISOString();
  db.saveApplication(winningApp);
  
  // Reject all other pending applications
  for (const app of applications) {
    if (app.id !== appId && app.status === APP_STATUS.PENDING) {
      app.status = APP_STATUS.REJECTED;
      app.statusNote = 'Another applicant was selected';
      app.updatedAt = new Date().toISOString();
      db.saveApplication(app);
    }
  }
  
  // Update job status — agent_accepted (new) or in_progress (backward compat)
  job.status = JOB_STATUS.AGENT_ACCEPTED;
  job.selectedAgentId = winningApp.agentId;
  job.selectedAt = new Date().toISOString();
  job.agreedBudget = winningApp.proposedBudget;
  job.agreedTimeline = winningApp.proposedTimeline;
  job.updatedAt = new Date().toISOString();
  job.fundsLocked = !!job.escrowId;
  db.saveJob(job);
  
  return { job, application: winningApp };
}

// Get applications by agent
function getAgentApplications(agentId, status = null) {
  const applications = db.getAgentApplications(agentId);
  const result = [];
  
  for (const app of applications) {
    if (status && app.status !== status) continue;
    
    const job = loadJob(app.jobId);
    if (job) {
      result.push({ ...app, job });
    }
  }
  
  return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// Create review
function createReview(data) {
  const job = loadJob(data.jobId);
  if (!job) return { error: 'Job not found' };
  if (job.status !== JOB_STATUS.COMPLETED) return { error: 'Can only review completed jobs' };
  
  // Check if already reviewed
  if (db.reviewExists(data.jobId, data.reviewerId, data.revieweeId)) {
    return { error: 'You have already reviewed this job' };
  }
  
  const review = {
    id: generateId('review'),
    jobId: data.jobId,
    reviewerId: data.reviewerId,
    revieweeId: data.revieweeId,
    rating: Math.min(5, Math.max(1, data.rating || 5)),
    comment: data.comment || '',
    type: data.type, // 'client_to_agent' or 'agent_to_client'
    createdAt: new Date().toISOString()
  };
  
  db.saveReview(review);
  return review;
}

// Load reviews for a profile
function loadReviews(profileId) {
  return db.loadReviews(profileId);
}

// Load reviews for a specific job
function getJobReviews(jobId) {
  return db.getJobReviews(jobId);
}

// Get marketplace stats for a profile
function getMarketplaceStats(profileId) {
  const allJobs = db.loadJobs({});
  
  // Jobs as client
  const clientJobs = allJobs.filter(j => j.clientId === profileId);
  const clientCompleted = clientJobs.filter(j => j.status === JOB_STATUS.COMPLETED);
  
  // Jobs as agent
  const agentJobs = allJobs.filter(j => j.selectedAgentId === profileId);
  const agentCompleted = agentJobs.filter(j => j.status === JOB_STATUS.COMPLETED);
  
  // Reviews received
  const ratingInfo = db.getAverageRating(profileId);
  
  // Total earned (sum of agreed budgets for completed jobs as agent)
  const totalEarned = agentCompleted.reduce((sum, j) => sum + (j.agreedBudget || 0), 0);
  
  return {
    asClient: {
      jobsPosted: clientJobs.length,
      jobsCompleted: clientCompleted.length,
      totalSpent: clientCompleted.reduce((sum, j) => sum + (j.agreedBudget || 0), 0)
    },
    asAgent: {
      jobsWon: agentJobs.length,
      jobsCompleted: agentCompleted.length,
      totalEarned,
      completionRate: agentJobs.length > 0 
        ? Math.round((agentCompleted.length / agentJobs.length) * 100) 
        : null
    },
    reviews: {
      count: ratingInfo.count,
      averageRating: ratingInfo.average
    }
  };
}

// Get escrow status for a job
function getJobEscrowStatus(jobId) {
  return escrow.getEscrowStatus(jobId);
}

// Get deposit instructions for a job
function getJobDepositInstructions(jobId) {
  const job = loadJob(jobId);
  if (!job || !job.escrowId) return null;
  return escrow.getDepositInstructions(job.escrowId);
}

// ===== BOUNTY BOARD =====

// Create a bounty submission
function createBountySubmission(jobId, data) {
  const job = loadJob(jobId);
  if (!job) return { error: 'Bounty not found' };
  if (job.budgetType !== BUDGET_TYPES.BOUNTY) return { error: 'This job is not a bounty' };
  if (job.status !== JOB_STATUS.OPEN) return { error: 'Bounty is not accepting submissions' };
  
  if (!verifyProfile(data.agentId)) {
    return { error: 'Must have a verified AgentFolio profile to submit. Register at /submit first.' };
  }
  
  // Check if already submitted
  if (db.hasSubmittedBounty(jobId, data.agentId)) {
    return { error: 'You have already submitted to this bounty' };
  }
  
  // Check max submissions
  const maxSubs = job.maxSubmissions || 50;
  const currentCount = db.getBountySubmissionCount(jobId);
  if (currentCount >= maxSubs) {
    return { error: 'Maximum submissions reached for this bounty' };
  }
  
  // Check deadline
  if (job.submissionDeadline && new Date(job.submissionDeadline) < new Date()) {
    return { error: 'Submission deadline has passed' };
  }
  
  const submission = {
    id: generateId('bsub'),
    jobId,
    agentId: data.agentId,
    title: data.title || 'Untitled submission',
    description: data.description || '',
    submissionUrl: data.submissionUrl || null,
    attachments: data.attachments || [],
    status: 'pending',
    score: null,
    judgeNotes: null,
    isWinner: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  db.saveBountySubmission(submission);
  
  // Update submission count on job
  job.submissionCount = db.getBountySubmissionCount(jobId);
  job.updatedAt = new Date().toISOString();
  db.saveJob(job);
  
  return submission;
}

// Score a bounty submission
function scoreBountySubmission(submissionId, data) {
  const sub = db.getBountySubmission(submissionId);
  if (!sub) return { error: 'Submission not found' };
  
  const job = loadJob(sub.jobId);
  if (!job) return { error: 'Bounty not found' };
  
  // Only client can score
  if (data.judgerId !== job.clientId) {
    return { error: 'Only the bounty poster can score submissions' };
  }
  
  sub.score = Math.min(100, Math.max(0, data.score));
  sub.judgeNotes = data.notes || sub.judgeNotes;
  sub.status = 'reviewed';
  sub.updatedAt = new Date().toISOString();
  
  db.saveBountySubmission(sub);
  return sub;
}

// Select bounty winner and release escrow
async function selectBountyWinner(jobId, submissionId, data = {}) {
  const job = loadJob(jobId);
  if (!job) return { error: 'Bounty not found' };
  if (job.budgetType !== BUDGET_TYPES.BOUNTY) return { error: 'Not a bounty job' };
  if (![JOB_STATUS.OPEN, JOB_STATUS.IN_PROGRESS].includes(job.status)) {
    return { error: 'Bounty is not in a judgeable state' };
  }
  
  if (data.judgerId !== job.clientId) {
    return { error: 'Only the bounty poster can select a winner' };
  }
  
  const sub = db.getBountySubmission(submissionId);
  if (!sub) return { error: 'Submission not found' };
  if (sub.jobId !== jobId) return { error: 'Submission does not belong to this bounty' };
  
  // Get agent wallet
  const agentProfile = db.loadProfile(sub.agentId);
  const wallet = agentProfile?.wallets?.solana || agentProfile?.verificationData?.solana?.address || data.agentWallet;
  
  // Mark as winner
  sub.isWinner = true;
  sub.status = 'winner';
  sub.score = sub.score || 100;
  sub.updatedAt = new Date().toISOString();
  db.saveBountySubmission(sub);
  
  // Mark all others as not-selected
  const allSubs = db.loadBountySubmissions(jobId);
  for (const s of allSubs) {
    if (s.id !== submissionId && s.status !== 'rejected') {
      s.status = 'not_selected';
      s.updatedAt = new Date().toISOString();
      db.saveBountySubmission(s);
    }
  }
  
  // Lock and release escrow if exists
  let escrowResult = null;
  if (job.escrowId) {
    if (wallet) {
      const lockResult = escrow.lockFunds(job.escrowId, sub.agentId, wallet);
      if (lockResult.error) return lockResult;
      escrowResult = await escrow.releaseFunds(job.escrowId, data.txHash || null);
      if (escrowResult.error) return escrowResult;
    }
  }
  
  // Complete the job
  job.status = JOB_STATUS.COMPLETED;
  job.selectedAgentId = sub.agentId;
  job.completedAt = new Date().toISOString();
  job.completionNote = `Bounty winner: ${sub.title}`;
  job.updatedAt = new Date().toISOString();
  job.fundsReleased = !!escrowResult;
  
  const savedJob = db.saveJob(job);
  return { job: savedJob, submission: sub, escrow: escrowResult };
}

// List bounties (convenience filter)
function listBounties(filters = {}) {
  // Get all jobs from DB directly, then filter
  const allJobs = db.loadJobs({});
  let bountyJobs = allJobs.filter(j => j.budgetType === BUDGET_TYPES.BOUNTY);
  
  // Apply status filter
  if (filters.status && filters.status !== 'all') {
    bountyJobs = bountyJobs.filter(j => j.status === filters.status);
  }
  
  // Apply category filter
  if (filters.category) {
    bountyJobs = bountyJobs.filter(j => j.category === filters.category);
  }
  
  // Apply search
  if (filters.search) {
    const q = filters.search.toLowerCase();
    bountyJobs = bountyJobs.filter(j => 
      (j.title || '').toLowerCase().includes(q) || (j.description || '').toLowerCase().includes(q)
    );
  }
  
  // Sort
  bountyJobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  // Paginate
  const page = filters.page || 1;
  const limit = filters.limit || 20;
  const start = (page - 1) * limit;
  
  return {
    jobs: bountyJobs.slice(start, start + limit),
    total: bountyJobs.length,
    page,
    pages: Math.ceil(bountyJobs.length / limit)
  };
}

// Get bounty leaderboard (agents with most bounty wins)
function getBountyLeaderboard(limit = 20) {
  const allSubs = db.prepare ? null : []; // need raw query
  // Use direct DB query
  const rows = require('./database').runTransaction(() => {
    const stmt = db.prepare || require('./database');
    return [];
  });
  // Simpler approach: get all winning submissions
  const jobs = listBounties({ status: 'all' }).jobs.filter(j => j.status === 'completed');
  const winsByAgent = {};
  
  for (const job of jobs) {
    if (job.selectedAgentId) {
      if (!winsByAgent[job.selectedAgentId]) {
        winsByAgent[job.selectedAgentId] = { agentId: job.selectedAgentId, wins: 0, totalPrize: 0 };
      }
      winsByAgent[job.selectedAgentId].wins++;
      winsByAgent[job.selectedAgentId].totalPrize += job.budgetAmount || 0;
    }
  }
  
  return Object.values(winsByAgent)
    .sort((a, b) => b.wins - a.wins || b.totalPrize - a.totalPrize)
    .slice(0, limit);
}

module.exports = {
  // Constants
  JOB_STATUS,
  APP_STATUS,
  JOB_CATEGORIES,
  BUDGET_TYPES,
  TIMELINES,
  
  // Jobs
  createJob,
  loadJob,
  updateJob,
  cancelJob,
  listJobs,
  startJobWork,
  submitJobWork,
  completeJob,
  incrementJobViews,
  confirmJobDeposit,
  disputeJob,
  
  // Applications
  createApplication,
  getApplication,
  loadApplications,
  updateApplicationStatus,
  selectWinner,
  getAgentApplications,
  
  // Reviews
  createReview,
  loadReviews,
  getJobReviews,
  
  // Stats
  getMarketplaceStats,
  
  // Escrow
  getJobEscrowStatus,
  getJobDepositInstructions,
  
  // Bounties
  createBountySubmission,
  scoreBountySubmission,
  selectBountyWinner,
  listBounties,
  getBountyLeaderboard
};
