// Sprint 3 P0: Missing API Endpoints
// Inject into server.js before the /api/jobs route

const Database = require('better-sqlite3');
const path = require('path');

function getDb() {
  return new Database(path.join(__dirname, '..', 'data', 'agentfolio.db'), { readonly: true });
}

function registerSprint3Routes(app) {

  // 1. GET /api/search?q= — Search profiles by name/description/skills
  app.get('/api/search', (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Missing query parameter q' });
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    try {
      const db = getDb();
      const pattern = `%${q}%`;
      const rows = db.prepare(`
        SELECT id, name, handle, bio, avatar, skills, verification, created_at, updated_at
        FROM profiles
        WHERE name LIKE ? OR handle LIKE ? OR bio LIKE ? OR skills LIKE ?
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `).all(pattern, pattern, pattern, pattern, limit, offset);
      const countRow = db.prepare(`
        SELECT COUNT(*) as total FROM profiles
        WHERE name LIKE ? OR handle LIKE ? OR bio LIKE ? OR skills LIKE ?
      `).get(pattern, pattern, pattern, pattern);
      db.close();

      const profiles = rows.map(r => ({
        ...r,
        skills: JSON.parse(r.skills || '[]'),
        verification: JSON.parse(r.verification || '{}'),
      }));
      res.json({ query: q, total: countRow.total, limit, offset, profiles });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 2. GET /api/agent/:id/avatar — Return avatar URL/data
  app.get('/api/agent/:id/avatar', (req, res) => {
    try {
      const db = getDb();
      const row = db.prepare('SELECT avatar FROM profiles WHERE id = ?').get(req.params.id);
      db.close();
      if (!row) return res.status(404).json({ error: 'Agent not found' });
      if (!row.avatar) return res.status(404).json({ error: 'No avatar set' });
      res.json({ id: req.params.id, avatar: row.avatar });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 3. GET /api/agent/:id/avatar/image — Redirect to actual image URL
  app.get('/api/agent/:id/avatar/image', (req, res) => {
    try {
      const db = getDb();
      const row = db.prepare('SELECT avatar FROM profiles WHERE id = ?').get(req.params.id);
      db.close();
      if (!row) return res.status(404).json({ error: 'Agent not found' });
      if (!row.avatar) return res.status(404).json({ error: 'No avatar set' });
      res.redirect(302, row.avatar);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 4. GET /api/marketplace/stats — Job counts, completion rate, total escrow volume
  app.get('/api/marketplace/stats', (req, res) => {
    try {
      const db = getDb();
      const jobStats = db.prepare(`
        SELECT
          COUNT(*) as total_jobs,
          SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_jobs,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_jobs,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_jobs,
          SUM(CASE WHEN status = 'closed' OR status = 'cancelled' THEN 1 ELSE 0 END) as closed_jobs
        FROM jobs
      `).get();
      const escrowStats = db.prepare(`
        SELECT
          COUNT(*) as total_escrows,
          COALESCE(SUM(amount), 0) as total_volume,
          COALESCE(SUM(CASE WHEN status = 'released' THEN amount ELSE 0 END), 0) as released_volume,
          COALESCE(SUM(platform_fee), 0) as total_fees
        FROM escrows
      `).get();
      const appStats = db.prepare('SELECT COUNT(*) as total_applications FROM applications').get();
      db.close();

      const completionRate = jobStats.total_jobs > 0
        ? ((jobStats.completed_jobs / jobStats.total_jobs) * 100).toFixed(1)
        : '0.0';

      res.json({
        jobs: { ...jobStats, completion_rate: parseFloat(completionRate) },
        escrow: escrowStats,
        applications: appStats,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 5. GET /api/endorsements?agent=:id — Return endorsements for an agent
  app.get('/api/endorsements', (req, res) => {
    const agentId = req.query.agent;
    if (!agentId) return res.status(400).json({ error: 'Missing agent query parameter' });
    try {
      const db = getDb();
      const row = db.prepare('SELECT endorsements, endorsements_given FROM profiles WHERE id = ?').get(agentId);
      if (!row) { db.close(); return res.status(404).json({ error: 'Agent not found' }); }

      // Also get peer_reviews received
      const peerReviews = db.prepare(`
        SELECT pr.*, p.name as reviewer_name, p.handle as reviewer_handle
        FROM peer_reviews pr
        LEFT JOIN profiles p ON p.id = pr.reviewer_id
        WHERE pr.reviewee_id = ?
        ORDER BY pr.created_at DESC
      `).all(agentId);

      db.close();
      res.json({
        agent: agentId,
        endorsements: JSON.parse(row.endorsements || '[]'),
        endorsements_given: JSON.parse(row.endorsements_given || '[]'),
        peer_reviews: peerReviews,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { registerSprint3Routes };
