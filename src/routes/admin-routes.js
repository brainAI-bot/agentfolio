/**
 * Admin Routes — Profile management for outreach automation
 * 
 * P1: Admin API
 * - DELETE /api/admin/profile/:id       — Delete a profile
 * - GET    /api/admin/profiles/unclaimed — List unclaimed profiles
 * - POST   /api/admin/profile/:id/notify — Mark profile as notified
 * 
 * All routes require X-Admin-Key header
 */

function registerAdminRoutes(app, getDb) {
  const db = getDb();

  // Ensure notified columns exist
  try { db.exec(`ALTER TABLE profiles ADD COLUMN notified INTEGER DEFAULT 0`); } catch (e) { }
  try { db.exec(`ALTER TABLE profiles ADD COLUMN notified_at TEXT`); } catch (e) { }
  try { db.exec(`ALTER TABLE profiles ADD COLUMN notified_via TEXT`); } catch (e) { }

  function adminAuth(req, res, next) {
    const key = req.headers['x-admin-key'];
    if (!key || key !== (process.env.ADMIN_KEY || 'bf-admin-2026')) {
      return res.status(401).json({ error: 'Unauthorized — X-Admin-Key required' });
    }
    next();
  }

  // DELETE /api/admin/profile/:id
  app.delete('/api/admin/profile/:id', adminAuth, (req, res) => {
    const { id } = req.params;
    const profile = db.prepare(`SELECT id, name FROM profiles WHERE id = ?`).get(id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    // Delete related data
    try { db.prepare(`DELETE FROM endorsements WHERE profile_id = ?`).run(id); } catch (e) { }
    try { db.prepare(`DELETE FROM reviews WHERE profile_id = ? OR reviewee_id = ?`).run(id, id); } catch (e) { }
    db.prepare(`DELETE FROM profiles WHERE id = ?`).run(id);

    console.log(`[Admin] Deleted profile: ${id} (${profile.name})`);
    res.json({ success: true, deleted: id, name: profile.name });
  });

  // GET /api/admin/profiles/unclaimed
  app.get('/api/admin/profiles/unclaimed', adminAuth, (req, res) => {
    const { notified, limit } = req.query;
    
    let sql = `SELECT id, name, handle, bio, claimed, claim_token, notified, notified_at, notified_via, created_at FROM profiles WHERE (claimed = 0 OR claimed IS NULL)`;
    const params = [];

    if (notified === 'false' || notified === '0') {
      sql += ` AND (notified = 0 OR notified IS NULL)`;
    } else if (notified === 'true' || notified === '1') {
      sql += ` AND notified = 1`;
    }

    sql += ` ORDER BY created_at DESC`;
    if (limit) {
      sql += ` LIMIT ?`;
      params.push(parseInt(limit));
    }

    const profiles = db.prepare(sql).all(...params);
    const baseUrl = process.env.BASE_URL || 'https://agentfolio.bot';

    const enriched = profiles.map(p => ({
      ...p,
      claimed: !!p.claimed,
      notified: !!p.notified,
      claim_url: p.claim_token ? `${baseUrl}/claim/${p.id}?token=${p.claim_token}` : null
    }));

    res.json({ count: enriched.length, profiles: enriched });
  });

  // POST /api/admin/profile/:id/notify
  app.post('/api/admin/profile/:id/notify', adminAuth, (req, res) => {
    const { id } = req.params;
    const { via } = req.body || {};
    
    const profile = db.prepare(`SELECT id, name, notified FROM profiles WHERE id = ?`).get(id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    db.prepare(`UPDATE profiles SET notified = 1, notified_at = datetime('now'), notified_via = ? WHERE id = ?`)
      .run(via || 'github_issue', id);

    console.log(`[Admin] Marked notified: ${id} (${profile.name}) via ${via || 'github_issue'}`);
    res.json({ success: true, id, name: profile.name, notified: true, via: via || 'github_issue' });
  });

  // GET /api/admin/stats — Quick claim/notify stats
  app.get('/api/admin/stats', adminAuth, (req, res) => {
    const total = db.prepare(`SELECT COUNT(*) as c FROM profiles`).get().c;
    const claimed = db.prepare(`SELECT COUNT(*) as c FROM profiles WHERE claimed = 1`).get().c;
    const notified = db.prepare(`SELECT COUNT(*) as c FROM profiles WHERE notified = 1`).get().c;
    const unclaimed_unnotified = db.prepare(`SELECT COUNT(*) as c FROM profiles WHERE (claimed = 0 OR claimed IS NULL) AND (notified = 0 OR notified IS NULL)`).get().c;
    
    res.json({ total, claimed, notified, unclaimed_unnotified, claim_rate: total > 0 ? ((claimed / total) * 100).toFixed(1) + '%' : '0%' });
  });

  console.log(`[Admin] Routes registered: /api/admin/profile/:id, /api/admin/profiles/unclaimed, /api/admin/stats`);
}

module.exports = { registerAdminRoutes };
