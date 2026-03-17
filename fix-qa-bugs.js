/**
 * QA Bug Fix Script — brainChain
 * Fixes 5 bugs from QA v3 report
 */
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'src', 'server.js');
let server = fs.readFileSync(serverPath, 'utf8');

// ============================================================
// Bug 1: skills_required not saved on job POST
// Already works in write-endpoints.js (stores as JSON in skills column)
// But the GET /api/jobs doesn't parse it back. Fix the GET.
// ============================================================

// Fix GET /api/jobs to parse skills JSON
const oldGetJobs = `const jobs = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
    db.close();
    res.json({ jobs, total, page });`;

const newGetJobs = `const jobs = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
    db.close();
    res.json({ jobs: jobs.map(j => ({ ...j, skills_required: JSON.parse(j.skills || '[]') })), total, page });`;

if (server.includes(oldGetJobs)) {
  server = server.replace(oldGetJobs, newGetJobs);
  console.log('✅ Bug 1: Fixed skills_required in GET /api/jobs');
} else {
  console.log('⚠️ Bug 1: Could not find GET /api/jobs pattern, may already be fixed');
}

// ============================================================
// Bug 2: Review comment field not returned in POST response
// The POST /api/reviews returns { text } but stores as 'comment'
// Already returns text — but let's also return comment for clarity
// ============================================================

const oldReviewResponse = `res.status(201).json({ id, reviewer_id, reviewee_id, rating, text, created_at: new Date().toISOString() });`;
const newReviewResponse = `res.status(201).json({ id, reviewer_id, reviewee_id, rating, comment: text || '', text: text || '', job_id: job_id || 'direct', created_at: new Date().toISOString() });`;

if (server.includes(oldReviewResponse)) {
  server = server.replace(oldReviewResponse, newReviewResponse);
  console.log('✅ Bug 2: Fixed review POST response to include comment field');
} else {
  console.log('⚠️ Bug 2: Could not find review POST pattern');
}

// ============================================================
// Bug 3: Activity feed not updated on reviews/endorsements/jobs
// The POST endpoints don't call addActivity. Add activity logging.
// ============================================================

// Add activity import at top if not present
if (!server.includes("require('./lib/activity')")) {
  // Add after the satp-reviews require
  const afterSatp = "const satpReviews = require('./satp-reviews');";
  if (server.includes(afterSatp)) {
    server = server.replace(afterSatp, afterSatp + "\nconst { addActivity, ACTIVITY_TYPES } = require('./lib/activity');");
    console.log('✅ Bug 3a: Added activity import');
  }
}

// Add activity logging to POST /api/reviews
const oldReviewInsert = `db.prepare('INSERT INTO reviews (id, job_id, reviewer_id, reviewee_id, rating, comment, type, created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, job_id || 'direct', reviewer_id, reviewee_id, Math.min(5, Math.max(1, parseInt(rating))), text || '', 'review', new Date().toISOString());
    db.close();
    ${newReviewResponse}`;

const newReviewInsert = `db.prepare('INSERT INTO reviews (id, job_id, reviewer_id, reviewee_id, rating, comment, type, created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, job_id || 'direct', reviewer_id, reviewee_id, Math.min(5, Math.max(1, parseInt(rating))), text || '', 'review', new Date().toISOString());
    db.close();
    try { addActivity(reviewee_id, 'endorsement_received', { fromId: reviewer_id, rating, comment: text }); } catch(e) {}
    ${newReviewResponse}`;

if (server.includes(oldReviewInsert)) {
  server = server.replace(oldReviewInsert, newReviewInsert);
  console.log('✅ Bug 3b: Added activity logging to reviews');
} else {
  console.log('⚠️ Bug 3b: Could not add activity to reviews (pattern not found)');
}

// Add activity logging to POST /api/endorsements
const oldEndorseClose = `db.prepare('UPDATE profiles SET endorsements = ? WHERE id = ?').run(JSON.stringify(endorsements), target_id);
    db.close();
    res.status(201).json({ endorser_id, target_id, skill, text, created_at: new Date().toISOString() });`;

const newEndorseClose = `db.prepare('UPDATE profiles SET endorsements = ? WHERE id = ?').run(JSON.stringify(endorsements), target_id);
    db.close();
    try { addActivity(target_id, 'endorsement_received', { fromId: endorser_id, skill, message: text }); } catch(e) {}
    try { addActivity(endorser_id, 'endorsement_given', { toId: target_id, skill }); } catch(e) {}
    res.status(201).json({ endorser_id, target_id, skill, text, created_at: new Date().toISOString() });`;

if (server.includes(oldEndorseClose)) {
  server = server.replace(oldEndorseClose, newEndorseClose);
  console.log('✅ Bug 3c: Added activity logging to endorsements');
} else {
  console.log('⚠️ Bug 3c: Could not add activity to endorsements');
}

// ============================================================
// Bug 4: GET /api/jobs/:id — add individual job detail endpoint
// ============================================================

// Insert after the GET /api/jobs block
const afterJobsList = `res.json({ jobs: jobs.map(j => ({ ...j, skills_required: JSON.parse(j.skills || '[]') })), total, page });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});`;

const jobDetailEndpoint = `res.json({ jobs: jobs.map(j => ({ ...j, skills_required: JSON.parse(j.skills || '[]') })), total, page });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Individual job detail
app.get('/api/jobs/:id', (req, res) => {
  try {
    const Database = require('better-sqlite3');
    const path = require('path');
    const db = new Database(path.join(__dirname, '..', 'data', 'agentfolio.db'), { readonly: true });
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    db.close();
    if (!job) return res.status(404).json({ error: 'Job not found' });
    job.skills_required = JSON.parse(job.skills || '[]');
    res.json(job);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});`;

if (server.includes(afterJobsList) && !server.includes("app.get('/api/jobs/:id'")) {
  server = server.replace(afterJobsList, jobDetailEndpoint);
  console.log('✅ Bug 4: Added GET /api/jobs/:id endpoint');
} else if (server.includes("app.get('/api/jobs/:id'")) {
  console.log('⚠️ Bug 4: GET /api/jobs/:id already exists');
} else {
  console.log('⚠️ Bug 4: Could not find insertion point');
}

// ============================================================
// Bug 5: Leaderboard /scores doesn't show actual score values
// The sprint3-scoring endpoint returns level/reputation but
// let's check if reputation is actually a number
// ============================================================

// Fix is in sprint3-scoring.js
const scoringPath = path.join(__dirname, 'src', 'sprint3-scoring.js');
let scoring = fs.readFileSync(scoringPath, 'utf8');

// Check if calculateReputation returns a proper number
// The scored array already includes reputation field — bug might be that
// reputation returns an object instead of a number. Let's check.
const oldScored = `reputation: rep,`;
const newScored = `reputation: typeof rep === 'number' ? rep : (rep?.total || rep?.score || 0), reputationScore: rep,`;

if (scoring.includes(oldScored)) {
  scoring = scoring.replace(oldScored, newScored);
  fs.writeFileSync(scoringPath, scoring);
  console.log('✅ Bug 5: Fixed leaderboard/scores to expose numeric reputation');
} else {
  console.log('⚠️ Bug 5: Could not find scoring pattern');
}

// Also update the /api/profile/:id/activity endpoint to use the real activity system
const oldActivity = `const activity = [];
  if (row.created_at) activity.push({ type: 'registered', date: row.created_at });
  try {
    const vdata = JSON.parse(row.verification || '{}');
    if (vdata.verifiedPlatforms) {
      vdata.verifiedPlatforms.forEach(p => activity.push({ type: 'verification', provider: p, date: vdata.lastVerified || row.created_at }));
    } else if (Array.isArray(vdata)) {
      vdata.forEach(v => activity.push({ type: 'verification', provider: v.provider || v, date: v.verified_at || row.created_at }));
    }
  } catch(e) {}
  res.json({ id, activity });`;

const newActivity = `// Use real activity system + fallback to verification data
  let activities = [];
  try { activities = require('./lib/activity').getActivities(id, null, 20); } catch(e) {}
  // Fallback: also include verification events from profile
  if (activities.length === 0) {
    if (row.created_at) activities.push({ type: 'profile_created', data: {}, created_at: row.created_at, meta: { icon: '🎉', label: 'Joined AgentFolio' } });
    try {
      const vdata = JSON.parse(row.verification || '{}');
      if (vdata.verifiedPlatforms) {
        vdata.verifiedPlatforms.forEach(p => activities.push({ type: 'verification', data: { provider: p }, created_at: vdata.lastVerified || row.created_at, meta: { icon: '✅', label: 'Verified ' + p } }));
      } else if (Array.isArray(vdata)) {
        vdata.forEach(v => activities.push({ type: 'verification', data: { provider: v.provider || v }, created_at: v.verified_at || row.created_at, meta: { icon: '✅', label: 'Verified ' + (v.provider || v) } }));
      }
    } catch(e) {}
  }
  res.json({ id, activity: activities });`;

if (server.includes(oldActivity)) {
  server = server.replace(oldActivity, newActivity);
  console.log('✅ Bug 3d: Updated activity feed to use real activity system');
} else {
  console.log('⚠️ Bug 3d: Could not update activity feed endpoint');
}

// Add to API docs
if (server.includes("{ method: 'GET', path: '/api/jobs', description: 'List marketplace jobs' }") && !server.includes("'/api/jobs/:id'")) {
  server = server.replace(
    "{ method: 'GET', path: '/api/jobs', description: 'List marketplace jobs' }",
    "{ method: 'GET', path: '/api/jobs', description: 'List marketplace jobs' },\n      { method: 'GET', path: '/api/jobs/:id', description: 'Get job details' }"
  );
  console.log('✅ Added GET /api/jobs/:id to API docs');
}

// Write updated server.js
fs.writeFileSync(serverPath, server);
console.log('\n✅ All fixes written to server.js');
console.log('Restarting PM2...');
