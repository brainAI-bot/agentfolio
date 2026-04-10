/**
 * Badge SVG Route — Embeddable trust badges for AI agents
 * GET /api/badge/:id.svg
 * 
 * Returns an SVG badge showing the agent's trust score and tier.
 * Designed for embedding in READMEs, websites, and social profiles.
 * 
 * Query params:
 *   style=flat|plastic|for-the-badge (default: flat)
 *   label=custom label text (default: "AgentFolio")
 */

const TIER_COLORS = {
  SOVEREIGN: '#FFD700',   // Gold
  ELITE: '#9B59B6',       // Purple
  ESTABLISHED: '#2ECC71', // Green
  PRO: '#2ECC71',         // Green (alias)
  VERIFIED: '#3498DB',    // Blue
  BASIC: '#95A5A6',       // Gray
  REGISTERED: '#95A5A6',  // Gray (alias)
  NEW: '#BDC3C7',         // Light gray
  UNVERIFIED: '#BDC3C7',  // Light gray
};

const TIER_ICONS = {
  SOVEREIGN: '👑',
  ELITE: '⭐',
  ESTABLISHED: '✓',
  PRO: '✓',
  VERIFIED: '✓',
  BASIC: '○',
  REGISTERED: '○',
  NEW: '·',
  UNVERIFIED: '·',
};

function escSvg(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function estimateTextWidth(text, fontSize = 11) {
  // Rough character width estimation for Verdana/DejaVu Sans
  return text.length * fontSize * 0.62 + 10;
}

function generateFlatBadge(label, message, messageColor) {
  const labelWidth = estimateTextWidth(label);
  const messageWidth = estimateTextWidth(message);
  const totalWidth = labelWidth + messageWidth;
  const labelX = labelWidth / 2;
  const messageX = labelWidth + messageWidth / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${escSvg(label)}: ${escSvg(message)}">
  <title>${escSvg(label)}: ${escSvg(message)}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${messageWidth}" height="20" fill="${messageColor}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text aria-hidden="true" x="${labelX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelWidth - 10) * 10}">${escSvg(label)}</text>
    <text x="${labelX}" y="140" transform="scale(.1)" fill="#fff" textLength="${(labelWidth - 10) * 10}">${escSvg(label)}</text>
    <text aria-hidden="true" x="${messageX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(messageWidth - 10) * 10}">${escSvg(message)}</text>
    <text x="${messageX}" y="140" transform="scale(.1)" fill="#fff" textLength="${(messageWidth - 10) * 10}">${escSvg(message)}</text>
  </g>
</svg>`;
}

function registerBadgeRoute(app, deps) {
  const { profileStore, computeScoreWithOnChain, getV3Score } = deps;

  async function renderBadge(req, res) {
    try {
      const agentId = req.params.id;
      const label = req.query.label || 'AgentFolio';
      
      const db = profileStore.getDb();
      const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(agentId);
      
      if (!profile) {
        // Return a "not found" badge instead of 404 (better for embeds)
        const svg = generateFlatBadge(label, 'not found', '#e05d44');
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'no-cache, no-store, max-age=0');
        return res.send(svg);
      }

      // Parse profile data
      let verifications = [];
      try {
        let vData = JSON.parse(profile.verification_data || '[]');
        if (vData && typeof vData === 'object' && !Array.isArray(vData)) {
          vData = Object.entries(vData).map(([p, i]) => ({ platform: p, ...i }));
        }
        verifications = Array.isArray(vData) ? vData : [];
      } catch (_) {}

      let wallets = {}, tags = [], skills = [];
      try { wallets = JSON.parse(profile.wallets || '{}'); } catch (_) {}
      try { tags = JSON.parse(profile.tags || '[]'); } catch (_) {}
      try { skills = JSON.parse(profile.skills || '[]'); } catch (_) {}

      const parsed = { ...profile, verifications, wallets, tags, skills };

      // Get scores
      let trustScore, tier;
      try {
        const v3Data = await getV3Score(agentId);
        if (v3Data) {
          trustScore = v3Data.reputationScore;
          tier = v3Data.verificationLabel.toUpperCase();
        }
      } catch (_) {}

      if (trustScore === undefined) {
        const scoreResult = await computeScoreWithOnChain(parsed);
        trustScore = scoreResult.score;
        tier = scoreResult.level || (trustScore >= 80 ? 'ELITE' : trustScore >= 60 ? 'PRO' : trustScore >= 40 ? 'VERIFIED' : trustScore >= 20 ? 'BASIC' : 'NEW');
      }

      const color = TIER_COLORS[tier] || TIER_COLORS.NEW;
      const message = `${tier} · ${trustScore}`;

      const svg = generateFlatBadge(label, message, color);

      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300'); // 5 min cache
      res.send(svg);
    } catch (err) {
      console.error('[Badge] Error:', err);
      const svg = generateFlatBadge('AgentFolio', 'error', '#e05d44');
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(svg);
    }
  }

  app.get('/api/badge/:id.svg', renderBadge);
  app.get('/api/badge/:id', renderBadge);
}

module.exports = { registerBadgeRoute };
