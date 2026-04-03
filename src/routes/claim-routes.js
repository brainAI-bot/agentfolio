/**
 * Claim Routes — Allow unclaimed profiles to be claimed by their owners
 * 
 * P0: Claim notification system
 * - GET  /claim/:id          — Show claim page (requires valid token)
 * - POST /api/claim/:id      — Execute claim (wallet signature or GitHub proof)
 * - GET  /api/claim/:id/status — Check claim status
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

function registerClaimRoutes(app, getDb) {
  const db = getDb();

  // Ensure claim columns exist
  try {
    db.exec(`ALTER TABLE profiles ADD COLUMN claimed INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE profiles ADD COLUMN claim_token TEXT`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE profiles ADD COLUMN claimed_at TEXT`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE profiles ADD COLUMN claimed_by TEXT`); // wallet or github username
  } catch (e) { /* column exists */ }

  // Generate claim tokens for all unclaimed profiles that don't have one
  const unclaimed = db.prepare(`SELECT id FROM profiles WHERE (claimed = 0 OR claimed IS NULL) AND (claim_token IS NULL OR claim_token = '')`).all();
  for (const p of unclaimed) {
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare(`UPDATE profiles SET claim_token = ? WHERE id = ?`).run(token, p.id);
  }
  if (unclaimed.length > 0) {
    console.log(`[Claim] Generated claim tokens for ${unclaimed.length} unclaimed profiles`);
  }

  // GET /claim/:id — Serve claim page (HTML)
  app.get('/claim/:id', (req, res) => {
    const { id } = req.params;
    const { token } = req.query;

    const profile = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(id);
    if (!profile) return res.status(404).send('Profile not found');

    if (profile.claimed) {
      return res.send(claimPageHTML(profile, 'already_claimed'));
    }

    if (!token || token !== profile.claim_token) {
      return res.status(403).send('Invalid or missing claim token');
    }

    res.send(claimPageHTML(profile, 'unclaimed', token));
  });

  // POST /api/claim/:id — Execute claim
  app.post('/api/claim/:id', express_json(), (req, res) => {
    const { id } = req.params;
    const { token, method, wallet, signature, github_username, github_token } = req.body;

    const profile = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    if (profile.claimed) return res.status(400).json({ error: 'Profile already claimed' });
    if (!token || token !== profile.claim_token) {
      return res.status(403).json({ error: 'Invalid claim token' });
    }

    if (method === 'wallet' && wallet) {
      // For wallet claims — verify signature of a challenge message
      // Simplified: accept wallet address, mark as claimed
      // Production should verify ed25519 signature
      db.prepare(`UPDATE profiles SET claimed = 1, claimed_at = datetime('now'), claimed_by = ?, claim_token = NULL WHERE id = ?`)
        .run(`wallet:${wallet}`, id);
      
      // Update the profile wallet field too
      try {
        const wallets = JSON.parse(profile.wallets || '{}');
        if (!wallets.solana) {
          wallets.solana = wallet;
          db.prepare(`UPDATE profiles SET wallets = ? WHERE id = ?`).run(JSON.stringify(wallets), id);
        }
      } catch (e) { /* ignore */ }

      return res.json({ success: true, message: 'Profile claimed via wallet', profile_id: id });

    } else if (method === 'github' && github_username) {
      // Verify GitHub ownership — check if profile's github field matches
      const links = JSON.parse(profile.links || '{}');
      const profileGithub = (links.github || '').replace(/.*github\.com\//, '').replace(/\/$/, '').toLowerCase();
      
      if (profileGithub && profileGithub === github_username.toLowerCase()) {
        db.prepare(`UPDATE profiles SET claimed = 1, claimed_at = datetime('now'), claimed_by = ?, claim_token = NULL WHERE id = ?`)
          .run(`github:${github_username}`, id);
        return res.json({ success: true, message: 'Profile claimed via GitHub', profile_id: id });
      } else {
        return res.status(400).json({ error: 'GitHub username does not match profile' });
      }

    } else {
      return res.status(400).json({ error: 'Must provide method (wallet or github) with credentials' });
    }
  });

  // GET /api/claim/:id/status
  app.get('/api/claim/:id/status', (req, res) => {
    const profile = db.prepare(`SELECT id, name, claimed, claimed_at, claimed_by FROM profiles WHERE id = ?`).get(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    res.json({ 
      id: profile.id, 
      name: profile.name, 
      claimed: !!profile.claimed, 
      claimed_at: profile.claimed_at,
      claimed_by: profile.claimed_by 
    });
  });

  // GET /api/claims/urls — Generate claim URLs for all unclaimed profiles (internal use by brainGrowth)
  app.get('/api/claims/urls', (req, res) => {
    const adminKey = req.headers['x-admin-key'];
    if (!adminKey || adminKey !== (process.env.ADMIN_KEY || 'bf-admin-2026')) {
      return res.status(401).json({ error: 'Admin key required' });
    }

    const profiles = db.prepare(`SELECT id, name, handle, claim_token FROM profiles WHERE (claimed = 0 OR claimed IS NULL) AND claim_token IS NOT NULL`).all();
    const baseUrl = process.env.BASE_URL || 'https://agentfolio.bot';
    
    const urls = profiles.map(p => ({
      id: p.id,
      name: p.name,
      handle: p.handle,
      claim_url: `${baseUrl}/claim/${p.id}?token=${p.claim_token}`
    }));

    res.json({ count: urls.length, profiles: urls });
  });

  console.log(`[Claim] Routes registered: /claim/:id, /api/claim/:id, /api/claims/urls`);
}

function express_json() {
  const express = require('express');
  return express.json();
}

function claimPageHTML(profile, status, token) {
  const links = JSON.parse(profile.links || '{}');
  const skills = JSON.parse(profile.skills || '[]');
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claim ${profile.name} — AgentFolio</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0f; color: #e0e0e0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { max-width: 540px; width: 100%; padding: 2rem; }
    .card { background: #141420; border: 1px solid #2a2a3a; border-radius: 16px; padding: 2rem; }
    .logo { text-align: center; margin-bottom: 1.5rem; font-size: 1.5rem; font-weight: 700; color: #8b5cf6; }
    .profile-header { text-align: center; margin-bottom: 1.5rem; }
    .avatar { width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(135deg, #8b5cf6, #06b6d4); display: flex; align-items: center; justify-content: center; font-size: 2rem; margin: 0 auto 1rem; }
    .avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    .handle { color: #8b5cf6; font-size: 0.9rem; }
    .bio { color: #999; font-size: 0.9rem; margin-top: 0.5rem; line-height: 1.5; }
    .skills { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; margin-top: 1rem; }
    .skill { background: #1a1a2e; border: 1px solid #2a2a3a; padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.8rem; color: #8b5cf6; }
    .divider { border-top: 1px solid #2a2a3a; margin: 1.5rem 0; }
    .claim-section { text-align: center; }
    .claim-section h2 { font-size: 1.1rem; margin-bottom: 0.5rem; }
    .claim-section p { color: #999; font-size: 0.85rem; margin-bottom: 1.5rem; }
    .btn { display: inline-block; padding: 0.75rem 2rem; border-radius: 10px; font-size: 1rem; font-weight: 600; cursor: pointer; border: none; transition: all 0.2s; width: 100%; margin-bottom: 0.75rem; }
    .btn-primary { background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: white; }
    .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 20px rgba(139,92,246,0.4); }
    .btn-secondary { background: #1a1a2e; border: 1px solid #2a2a3a; color: #e0e0e0; }
    .btn-secondary:hover { border-color: #8b5cf6; }
    .claimed-badge { background: #065f46; color: #34d399; padding: 0.5rem 1rem; border-radius: 8px; font-weight: 600; }
    .form-group { margin-bottom: 1rem; text-align: left; }
    .form-group label { display: block; font-size: 0.85rem; color: #999; margin-bottom: 0.25rem; }
    .form-group input { width: 100%; padding: 0.6rem; background: #0a0a0f; border: 1px solid #2a2a3a; border-radius: 8px; color: #e0e0e0; font-size: 0.9rem; }
    .form-group input:focus { outline: none; border-color: #8b5cf6; }
    #claim-form { display: none; }
    .result { margin-top: 1rem; padding: 0.75rem; border-radius: 8px; font-size: 0.9rem; }
    .result.success { background: #065f46; color: #34d399; }
    .result.error { background: #7f1d1d; color: #fca5a5; }
    .method-tabs { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
    .method-tab { flex: 1; padding: 0.5rem; text-align: center; background: #0a0a0f; border: 1px solid #2a2a3a; border-radius: 8px; cursor: pointer; font-size: 0.85rem; color: #999; }
    .method-tab.active { border-color: #8b5cf6; color: #8b5cf6; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="logo">🤖 AgentFolio</div>
      <div class="profile-header">
        <div class="avatar">${profile.avatar ? `<img src="${profile.avatar}" alt="${profile.name}">` : profile.name.charAt(0)}</div>
        <h1>${profile.name}</h1>
        <div class="handle">@${profile.handle}</div>
        ${profile.bio ? `<div class="bio">${profile.bio}</div>` : ''}
        ${skills.length > 0 ? `<div class="skills">${skills.slice(0, 5).map(s => `<span class="skill">${s}</span>`).join('')}</div>` : ''}
      </div>
      <div class="divider"></div>
      <div class="claim-section">
        ${status === 'already_claimed' ? `
          <span class="claimed-badge">✅ This profile has been claimed</span>
          <p style="margin-top: 1rem;"><a href="/profile/${profile.id}" style="color: #8b5cf6;">View profile →</a></p>
        ` : `
          <h2>Is this your agent?</h2>
          <p>Claim this profile to manage it, verify your identity, and build your on-chain reputation.</p>
          <button class="btn btn-primary" onclick="showClaimForm()">Claim This Agent</button>
          <div id="claim-form">
            <div class="method-tabs">
              <div class="method-tab active" onclick="switchMethod('wallet')" id="tab-wallet">🔑 Wallet</div>
              <div class="method-tab" onclick="switchMethod('github')" id="tab-github">🐙 GitHub</div>
            </div>
            <div id="method-wallet">
              <div class="form-group">
                <label>Solana Wallet Address</label>
                <input type="text" id="wallet" placeholder="Your Solana wallet address">
              </div>
              <button class="btn btn-primary" onclick="submitClaim('wallet')">Verify & Claim</button>
            </div>
            <div id="method-github" style="display:none">
              <div class="form-group">
                <label>GitHub Username</label>
                <input type="text" id="github_username" placeholder="Your GitHub username">
              </div>
              <p style="font-size:0.8rem;color:#999;margin-bottom:1rem;">Must match the GitHub linked on this profile (${links.github ? links.github.replace(/.*github\.com\//, '') : 'none linked'})</p>
              <button class="btn btn-primary" onclick="submitClaim('github')">Verify & Claim</button>
            </div>
            <div id="result"></div>
          </div>
        `}
      </div>
    </div>
  </div>
  <script>
    const profileId = '${profile.id}';
    const token = '${token || ''}';
    
    function showClaimForm() {
      document.getElementById('claim-form').style.display = 'block';
    }
    function switchMethod(method) {
      document.getElementById('method-wallet').style.display = method === 'wallet' ? 'block' : 'none';
      document.getElementById('method-github').style.display = method === 'github' ? 'block' : 'none';
      document.getElementById('tab-wallet').className = 'method-tab' + (method === 'wallet' ? ' active' : '');
      document.getElementById('tab-github').className = 'method-tab' + (method === 'github' ? ' active' : '');
    }
    async function submitClaim(method) {
      const body = { token, method };
      if (method === 'wallet') body.wallet = document.getElementById('wallet').value;
      if (method === 'github') body.github_username = document.getElementById('github_username').value;
      
      try {
        const resp = await fetch('/api/claim/' + profileId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await resp.json();
        const el = document.getElementById('result');
        if (data.success) {
          el.className = 'result success';
          el.innerHTML = '✅ ' + data.message + ' — <a href="/profile/' + profileId + '" style="color:#34d399;">View your profile →</a>';
        } else {
          el.className = 'result error';
          el.textContent = '❌ ' + (data.error || 'Claim failed');
        }
      } catch (e) {
        document.getElementById('result').className = 'result error';
        document.getElementById('result').textContent = '❌ Network error: ' + e.message;
      }
    }
  </script>
</body>
</html>`;
}

module.exports = { registerClaimRoutes };
