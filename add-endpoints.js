// Script to add endpoints to server.js
const fs = require('fs');
const path = '/home/ubuntu/agentfolio/src/server.js';
let content = fs.readFileSync(path, 'utf8');

const marker = '  console.log(`[${new Date().toISOString()}] info: Available endpoints`';

const newCode = `
  // === P0: Unclaimed profiles API (for brainGrowth outreach) ===
  app.get('/api/unclaimed-profiles', (req, res) => {
    try {
      const fs = require('fs');
      const format = req.query.format || 'json';
      if (format === 'csv') {
        const csv = fs.readFileSync(__dirname + '/../data/unclaimed-profiles.csv', 'utf8');
        res.setHeader('Content-Type', 'text/csv');
        return res.send(csv);
      }
      const json = JSON.parse(fs.readFileSync(__dirname + '/../data/unclaimed-profiles.json', 'utf8'));
      res.json({ total: json.length, profiles: json });
    } catch (err) {
      try {
        const rows = db.prepare('SELECT id, name, handle, github FROM profiles WHERE claimed = 0 OR claimed IS NULL').all();
        const profiles = rows.map(r => ({ id: r.id, name: r.name, handle: r.handle, github: r.github || '', claim_url: 'https://agentfolio.bot/claim/' + r.id }));
        res.json({ total: profiles.length, profiles });
      } catch (e2) { res.status(500).json({ error: 'Failed' }); }
    }
  });

  // === P2: Admin Dashboard ===
  app.get('/admin', (req, res) => {
    const key = req.query.key || req.headers['x-admin-key'];
    const ADMIN_KEY = process.env.ADMIN_KEY || 'brainforge-admin-2026';
    if (key !== ADMIN_KEY) return res.status(401).send('<h1>Unauthorized</h1><p>Add ?key=YOUR_KEY</p>');
    try {
      const totalProfiles = db.prepare('SELECT COUNT(*) as c FROM profiles').get().c;
      let claimedProfiles = 0;
      try { claimedProfiles = db.prepare('SELECT COUNT(*) as c FROM profiles WHERE claimed = 1').get().c; } catch(e) {}
      let verifiedCount = 0;
      try { verifiedCount = db.prepare('SELECT COUNT(DISTINCT profile_id) as c FROM verifications').get().c; } catch(e) {}
      let onChainCount = 0;
      try { onChainCount = db.prepare('SELECT COUNT(*) as c FROM satp_trust_scores WHERE overall_score > 0').get().c; } catch(e) {}
      let recentRegs = [];
      try { recentRegs = db.prepare('SELECT id, name, handle, created_at FROM profiles ORDER BY created_at DESC LIMIT 20').all(); } catch(e) {}
      let recentVer = [];
      try { recentVer = db.prepare('SELECT profile_id, platform, verified_at FROM verifications ORDER BY verified_at DESC LIMIT 20').all(); } catch(e) {}
      let unclaimed = [];
      try { unclaimed = db.prepare("SELECT id, name, handle FROM profiles WHERE claimed = 0 OR claimed IS NULL LIMIT 50").all(); } catch(e) {}
      const esc = s => String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');

      let html = '<!DOCTYPE html><html><head><title>AgentFolio Admin</title>';
      html += '<style>body{background:#0d1117;color:#c9d1d9;font-family:system-ui;max-width:1200px;margin:0 auto;padding:20px}';
      html += 'h1{color:#58a6ff}h2{color:#3fb950;border-bottom:1px solid #21262d;padding-bottom:8px}';
      html += '.stats{display:flex;gap:20px;flex-wrap:wrap;margin:20px 0}';
      html += '.stat{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:20px;min-width:150px;text-align:center}';
      html += '.stat .num{font-size:2em;font-weight:bold;color:#58a6ff}.stat .label{color:#8b949e;margin-top:4px}';
      html += 'table{width:100%;border-collapse:collapse;margin:10px 0}';
      html += 'th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #21262d}';
      html += 'th{color:#8b949e;font-size:.85em;text-transform:uppercase}tr:hover{background:#161b22}a{color:#58a6ff;text-decoration:none}';
      html += '</style></head><body>';
      html += '<h1>AgentFolio Admin Dashboard</h1>';
      html += '<div class="stats">';
      html += '<div class="stat"><div class="num">' + totalProfiles + '</div><div class="label">Total Profiles</div></div>';
      html += '<div class="stat"><div class="num">' + claimedProfiles + '</div><div class="label">Claimed</div></div>';
      html += '<div class="stat"><div class="num">' + verifiedCount + '</div><div class="label">Verified</div></div>';
      html += '<div class="stat"><div class="num">' + onChainCount + '</div><div class="label">On-Chain</div></div>';
      html += '<div class="stat"><div class="num">' + (totalProfiles - claimedProfiles) + '</div><div class="label">Unclaimed</div></div>';
      html += '</div>';
      
      html += '<h2>Recent Registrations</h2><table><tr><th>ID</th><th>Name</th><th>Handle</th><th>Created</th></tr>';
      recentRegs.forEach(r => { html += '<tr><td><a href="/profile/' + esc(r.id) + '">' + esc(r.id) + '</a></td><td>' + esc(r.name) + '</td><td>' + esc(r.handle) + '</td><td>' + esc(r.created_at) + '</td></tr>'; });
      html += '</table>';

      html += '<h2>Recent Verifications</h2><table><tr><th>Profile</th><th>Platform</th><th>Verified At</th></tr>';
      recentVer.forEach(v => { html += '<tr><td><a href="/profile/' + esc(v.profile_id) + '">' + esc(v.profile_id) + '</a></td><td>' + esc(v.platform) + '</td><td>' + esc(v.verified_at) + '</td></tr>'; });
      html += '</table>';

      html += '<h2>Unclaimed Profiles (first 50)</h2><table><tr><th>ID</th><th>Name</th><th>Handle</th><th>Claim</th></tr>';
      unclaimed.forEach(u => { html += '<tr><td>' + esc(u.id) + '</td><td>' + esc(u.name) + '</td><td>' + esc(u.handle) + '</td><td><a href="/claim/' + esc(u.id) + '">Claim</a></td></tr>'; });
      html += '</table>';

      html += '<p style="color:#8b949e;margin-top:40px">Generated ' + new Date().toISOString() + '</p>';
      html += '</body></html>';
      res.send(html);
    } catch (err) { res.status(500).send('<h1>Error</h1><pre>' + err.message + '</pre>'); }
  });

`;

if (content.includes(marker)) {
  content = content.replace(marker, newCode + marker);
  fs.writeFileSync(path, content);
  console.log('OK: Endpoints added');
} else {
  console.log('MISS: marker not found');
}
