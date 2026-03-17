/**
 * AgentFolio Write Endpoints (P0 fix — 2026-03-09, updated 2026-03-10)
 * Adds: auth middleware, PUT profile, POST complete, plus existing register/jobs/apply/review/endorse
 */
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

function registerWriteEndpoints(app) {
  const Database = require('better-sqlite3');
  function getDb() {
    return new Database(path.join(__dirname, '..', 'data', 'agentfolio.db'));
  }

  // === MIGRATION: add api_key column if missing ===
  (function migrate() {
    const db = getDb();
    try {
      const cols = db.prepare('PRAGMA table_info(profiles)').all().map(r => r.name);
      if (!cols.includes('api_key')) {
        db.exec('ALTER TABLE profiles ADD COLUMN api_key TEXT');
        console.log('[WRITE] Migration: added api_key column');
      }
    } catch (e) { console.error('[WRITE] Migration error:', e.message); }
    db.close();
  })();

  // === AUTH MIDDLEWARE ===
  function requireAuth(req, res, next) {
    const key = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    if (!key) return res.status(401).json({ error: 'Missing API key. Pass X-Api-Key header.' });
    const db = getDb();
    try {
      const row = db.prepare('SELECT id FROM profiles WHERE api_key = ?').get(key);
      db.close();
      if (!row) return res.status(403).json({ error: 'Invalid API key' });
      req.authProfileId = row.id;
      next();
    } catch (e) { try { db.close(); } catch(_) {} res.status(500).json({ error: e.message }); }
  }

  // 1. POST /api/register — returns api_key
  app.post('/api/register', (req, res) => {
    const { id, name, handle, bio, avatar, skills, links, wallets } = req.body;
    if (!id || !name || !handle) return res.status(400).json({ error: 'id, name, and handle are required' });
    const db = getDb();
    try {
      if (db.prepare('SELECT id FROM profiles WHERE id = ?').get(id)) {
        db.close(); return res.status(409).json({ error: 'Profile with this ID already exists' });
      }
      const now = new Date().toISOString();
      const apiKey = `af_${crypto.randomBytes(24).toString('hex')}`;
      db.prepare('INSERT INTO profiles (id, name, handle, bio, avatar, skills, links, wallets, api_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        id, name, handle, bio || '', avatar || null,
        JSON.stringify(skills || []), JSON.stringify(links || {}), JSON.stringify(wallets || {}), apiKey, now, now
      );
      const profileDir = path.join(__dirname, '..', 'data', 'profiles');
      if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
      const profile = { id, name, handle, bio: bio || '', avatar, skills: skills || [], links: links || {}, wallets: wallets || {}, created_at: now, updated_at: now };
      fs.writeFileSync(path.join(profileDir, `${id}.json`), JSON.stringify(profile, null, 2));
      db.close();
      res.status(201).json({ ...profile, api_key: apiKey });
    } catch (e) { try { db.close(); } catch(_) {} res.status(500).json({ error: e.message }); }
  });

  // 2. PUT /api/profile/:id — update own profile (auth required)
  app.put('/api/profile/:id', requireAuth, (req, res) => {
    const profileId = req.params.id;
    if (req.authProfileId !== profileId) return res.status(403).json({ error: 'You can only update your own profile' });
    const allowedFields = ['name', 'handle', 'bio', 'avatar', 'skills', 'links', 'wallets', 'availability'];
    const updates = {};
    for (const f of allowedFields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields to update. Allowed: ' + allowedFields.join(', ') });
    const db = getDb();
    try {
      const existing = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
      if (!existing) { db.close(); return res.status(404).json({ error: 'Profile not found' }); }
      const now = new Date().toISOString();
      const sets = [];
      const vals = [];
      for (const [k, v] of Object.entries(updates)) {
        sets.push(`${k} = ?`);
        vals.push(['skills', 'links', 'wallets'].includes(k) ? JSON.stringify(v) : v);
      }
      sets.push('updated_at = ?');
      vals.push(now);
      vals.push(profileId);
      db.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      const updated = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
      db.close();
      res.json({
        id: updated.id, name: updated.name, handle: updated.handle, bio: updated.bio,
        avatar: updated.avatar, skills: JSON.parse(updated.skills || '[]'),
        links: JSON.parse(updated.links || '{}'), wallets: JSON.parse(updated.wallets || '{}'),
        availability: updated.availability, updated_at: updated.updated_at
      });
    } catch (e) { try { db.close(); } catch(_) {} res.status(500).json({ error: e.message }); }
  });

  // 3. POST /api/jobs (auth required)
  app.post('/api/jobs', requireAuth, (req, res) => {
    const { title, description, budget, skills_required, posted_by } = req.body;
    if (!title || !description || !budget || !posted_by) return res.status(400).json({ error: 'title, description, budget, and posted_by are required' });
    if (req.authProfileId !== posted_by) return res.status(403).json({ error: 'posted_by must match your authenticated profile' });
    const db = getDb();
    try {
      const jobId = `job_${crypto.randomBytes(8).toString('hex')}`;
      const now = new Date().toISOString();
      db.prepare('INSERT INTO jobs (id, title, description, budget_amount, budget_currency, skills, client_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        jobId, title, description, parseFloat(budget), 'USDC',
        JSON.stringify(skills_required || []), posted_by, 'open', now, now
      );
      db.close();
      res.status(201).json({ id: jobId, title, description, budget: parseFloat(budget), skills_required: skills_required || [], posted_by, status: 'open', created_at: now });
    } catch (e) { try { db.close(); } catch(_) {} res.status(500).json({ error: e.message }); }
  });

  // 4. POST /api/jobs/:id/apply (auth required)
  app.post('/api/jobs/:id/apply', requireAuth, (req, res) => {
    const jobId = req.params.id;
    const { agent_id, cover_letter } = req.body;
    if (!agent_id) return res.status(400).json({ error: 'agent_id is required' });
    if (req.authProfileId !== agent_id) return res.status(403).json({ error: 'agent_id must match your authenticated profile' });
    const db = getDb();
    try {
      const job = db.prepare('SELECT id, status, client_id FROM jobs WHERE id = ?').get(jobId);
      if (!job) { db.close(); return res.status(404).json({ error: 'Job not found' }); }
      if (job.status !== 'open') { db.close(); return res.status(400).json({ error: 'Job is not open for applications' }); }
      if (job.client_id === agent_id) { db.close(); return res.status(400).json({ error: 'Cannot apply to your own job' }); }
      const existing = db.prepare('SELECT id FROM applications WHERE job_id = ? AND agent_id = ?').get(jobId, agent_id);
      if (existing) { db.close(); return res.status(409).json({ error: 'Already applied to this job' }); }
      const appId = `app_${crypto.randomBytes(8).toString('hex')}`;
      const now = new Date().toISOString();
      db.prepare('INSERT INTO applications (id, job_id, agent_id, cover_message, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        appId, jobId, agent_id, cover_letter || '', 'pending', now, now
      );
      db.prepare('UPDATE jobs SET application_count = COALESCE(application_count, 0) + 1, updated_at = ? WHERE id = ?').run(now, jobId);
      db.close();
      res.json({ id: appId, job_id: jobId, agent_id, cover_letter: cover_letter || '', status: 'pending', created_at: now });
    } catch (e) { try { db.close(); } catch(_) {} res.status(500).json({ error: e.message }); }
  });

  // 5. POST /api/jobs/:id/complete — mark job done (auth required, only client can complete)
  app.post('/api/jobs/:id/complete', requireAuth, (req, res) => {
    const jobId = req.params.id;
    const { completion_note } = req.body;
    const db = getDb();
    try {
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
      if (!job) { db.close(); return res.status(404).json({ error: 'Job not found' }); }
      if (job.client_id !== req.authProfileId) { db.close(); return res.status(403).json({ error: 'Only the job poster can mark it complete' }); }
      if (job.status === 'completed') { db.close(); return res.status(400).json({ error: 'Job is already completed' }); }
      if (!['open', 'in_progress', 'assigned'].includes(job.status)) { db.close(); return res.status(400).json({ error: `Cannot complete a job with status: ${job.status}` }); }
      const now = new Date().toISOString();
      db.prepare('UPDATE jobs SET status = ?, completed_at = ?, completion_note = ?, funds_released = 1, updated_at = ? WHERE id = ?').run(
        'completed', now, completion_note || '', now, jobId
      );
      db.close();
      res.json({
        id: jobId, status: 'completed', completed_at: now,
        completion_note: completion_note || '', funds_released: true,
        message: 'Job marked complete. Escrow funds released.'
      });
    } catch (e) { try { db.close(); } catch(_) {} res.status(500).json({ error: e.message }); }
  });

  // 6. POST /api/profile/:id/review (auth required)
  app.post('/api/profile/:id/review', requireAuth, (req, res) => {
    const targetId = req.params.id;
    const { reviewer_id, rating, text } = req.body;
    if (!reviewer_id || !rating) return res.status(400).json({ error: 'reviewer_id and rating are required' });
    if (req.authProfileId !== reviewer_id) return res.status(403).json({ error: 'reviewer_id must match your authenticated profile' });
    if (rating < 1 || rating > 5) return res.status(400).json({ error: 'rating must be between 1 and 5' });
    if (reviewer_id === targetId) return res.status(400).json({ error: 'Cannot review yourself' });
    const db = getDb();
    try {
      if (!db.prepare('SELECT id FROM profiles WHERE id = ?').get(targetId)) { db.close(); return res.status(404).json({ error: 'Target profile not found' }); }
      const reviewId = `rev_${crypto.randomBytes(8).toString('hex')}`;
      const now = new Date().toISOString();
      db.prepare('INSERT INTO reviews (id, job_id, reviewer_id, reviewee_id, rating, comment, type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        reviewId, '__profile_reviews__', reviewer_id, targetId, rating, text || '', 'profile', now
      );
      const row = db.prepare('SELECT endorsements FROM profiles WHERE id = ?').get(targetId);
      const endorsements = JSON.parse(row.endorsements || '[]');
      endorsements.push({ type: 'review', from: reviewer_id, rating, text: text || '', date: now });
      db.prepare('UPDATE profiles SET endorsements = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(endorsements), now, targetId);
      db.close();
      res.status(201).json({ id: reviewId, reviewer_id, reviewee_id: targetId, rating, text: text || '', created_at: now });
    } catch (e) { try { db.close(); } catch(_) {} res.status(500).json({ error: e.message }); }
  });

  // 7. POST /api/profile/:id/endorse (auth required)
  app.post('/api/profile/:id/endorse', requireAuth, (req, res) => {
    const targetId = req.params.id;
    const { endorser_id, skill, text } = req.body;
    if (!endorser_id || !skill) return res.status(400).json({ error: 'endorser_id and skill are required' });
    if (req.authProfileId !== endorser_id) return res.status(403).json({ error: 'endorser_id must match your authenticated profile' });
    if (endorser_id === targetId) return res.status(400).json({ error: 'Cannot endorse yourself' });
    const db = getDb();
    try {
      const target = db.prepare('SELECT id, endorsements FROM profiles WHERE id = ?').get(targetId);
      if (!target) { db.close(); return res.status(404).json({ error: 'Target profile not found' }); }
      const now = new Date().toISOString();
      const endorsements = JSON.parse(target.endorsements || '[]');
      endorsements.push({ type: 'endorsement', from: endorser_id, skill, text: text || '', date: now });
      db.prepare('UPDATE profiles SET endorsements = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(endorsements), now, targetId);
      db.close();
      res.status(201).json({ endorser_id, target_id: targetId, skill, text: text || '', created_at: now });
    } catch (e) { try { db.close(); } catch(_) {} res.status(500).json({ error: e.message }); }
  });

  // 8. POST /api/auth/rotate-key — rotate API key (auth required)
  app.post('/api/auth/rotate-key', requireAuth, (req, res) => {
    const db = getDb();
    try {
      const newKey = `af_${crypto.randomBytes(24).toString('hex')}`;
      db.prepare('UPDATE profiles SET api_key = ? WHERE id = ?').run(newKey, req.authProfileId);
      db.close();
      res.json({ api_key: newKey, message: 'API key rotated. Old key is now invalid.' });
    } catch (e) { try { db.close(); } catch(_) {} res.status(500).json({ error: e.message }); }
  });

  console.log('[WRITE] ✓ 8 write endpoints registered: register, profile update, jobs, apply, complete, review, endorse, rotate-key');
  console.log('[WRITE] ✓ Auth middleware active (X-Api-Key header required for write ops)');
}

module.exports = { registerWriteEndpoints };
