/**
 * Embeddable Badge Showcase Page
 * Shows all agents sorted by trust score with live SVG badges and copy-to-clipboard embed codes
 */

function generateBadgesShowcasePage(profiles, { COMMON_STYLES, THEME_SCRIPT, escapeHtml, getCanonicalScore }) {
  // Sort by trust score descending
  const sorted = profiles
    .filter(p => !p.hidden)
    .map(p => {
      const canon = getCanonicalScore(p);
      return { ...p, trustScore: canon.score, tier: canon.tier, verificationLevel: canon.verificationLevel };
    })
    .sort((a, b) => (b.trustScore || 0) - (a.trustScore || 0));

  const agentCards = sorted.map((p, i) => {
    const id = escapeHtml(p.id);
    const name = escapeHtml(p.name || p.id);
    const handle = escapeHtml(p.handle || '');
    const score = p.trustScore || 0;
    const tier = escapeHtml(p.tier || 'unverified');
    const level = p.verificationLevel ?? 0;
    const badgeUrl = `https://agentfolio.bot/badge/${id}.svg`;
    const cardUrl = `https://agentfolio.bot/badge/${id}.svg?style=card`;
    const profileUrl = `https://agentfolio.bot/profile/${id}`;
    const mdEmbed = `[![Trust Score](${badgeUrl})](${profileUrl})`;
    const htmlEmbed = `<a href="${profileUrl}"><img src="${badgeUrl}" alt="AgentFolio Trust Score"></a>`;

    return `
      <div class="badge-card" data-score="${score}">
        <div class="badge-rank">#${i + 1}</div>
        <div class="badge-info">
          <div class="badge-header">
            <a href="/profile/${id}" class="badge-name">${name}</a>
            ${handle ? `<span class="badge-handle">${handle}</span>` : ''}
          </div>
          <div class="badge-meta">
            <span class="badge-score">${score}</span>
            <span class="badge-tier tier-${tier}">${tier}</span>
            <span class="badge-level">L${level}</span>
          </div>
        </div>
        <div class="badge-preview">
          <img src="/badge/${id}.svg" alt="${name} trust badge" loading="lazy">
        </div>
        <div class="badge-embeds">
          <div class="embed-row">
            <label>Markdown</label>
            <div class="embed-copy">
              <code id="md-${id}">${escapeHtml(mdEmbed)}</code>
              <button onclick="copyEmbed('md-${id}')" title="Copy">📋</button>
            </div>
          </div>
          <div class="embed-row">
            <label>HTML</label>
            <div class="embed-copy">
              <code id="html-${id}">${escapeHtml(htmlEmbed)}</code>
              <button onclick="copyEmbed('html-${id}')" title="Copy">📋</button>
            </div>
          </div>
          <div class="embed-row">
            <label>Image URL</label>
            <div class="embed-copy">
              <code id="url-${id}">${badgeUrl}</code>
              <button onclick="copyEmbed('url-${id}')" title="Copy">📋</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trust Badges — AgentFolio</title>
  <meta name="description" content="Embeddable trust badges for ${sorted.length}+ verified AI agents. Add to your GitHub README, docs, or website.">
  <meta property="og:title" content="AgentFolio Trust Badges">
  <meta property="og:description" content="Embeddable trust badges for ${sorted.length}+ AI agents on Solana">
  <meta property="og:url" content="https://agentfolio.bot/badges">
  <link rel="icon" href="/favicon.ico">
  ${COMMON_STYLES}
  <style>
    .badges-hero {
      text-align: center;
      padding: 3rem 1rem 2rem;
      max-width: 800px;
      margin: 0 auto;
    }
    .badges-hero h1 {
      font-size: 2.2rem;
      margin-bottom: 0.5rem;
      background: linear-gradient(135deg, #a78bfa, #60a5fa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .badges-hero p {
      color: #888;
      font-size: 1.1rem;
      line-height: 1.6;
    }
    .badges-hero .example-embed {
      background: #1a1a1f;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 1rem;
      margin: 1.5rem auto;
      max-width: 500px;
      font-family: monospace;
      font-size: 0.85rem;
      color: #a78bfa;
      word-break: break-all;
    }
    .badges-grid {
      max-width: 1000px;
      margin: 0 auto;
      padding: 0 1rem 3rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .badge-card {
      background: #1a1a1f;
      border: 1px solid #2a2a30;
      border-radius: 12px;
      padding: 1.2rem;
      display: grid;
      grid-template-columns: 40px 1fr auto;
      grid-template-rows: auto auto;
      gap: 0.5rem 1rem;
      align-items: center;
      transition: border-color 0.2s;
    }
    .badge-card:hover {
      border-color: #a78bfa55;
    }
    .badge-rank {
      font-size: 1.1rem;
      font-weight: 700;
      color: #555;
      text-align: center;
      grid-row: 1 / 3;
    }
    .badge-info {
      min-width: 0;
    }
    .badge-header {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .badge-name {
      font-weight: 600;
      font-size: 1.05rem;
      color: #e0e0e0;
      text-decoration: none;
    }
    .badge-name:hover { color: #a78bfa; }
    .badge-handle {
      color: #666;
      font-size: 0.85rem;
    }
    .badge-meta {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.3rem;
      align-items: center;
    }
    .badge-score {
      font-weight: 700;
      font-size: 0.95rem;
      color: #a78bfa;
    }
    .badge-tier {
      font-size: 0.75rem;
      padding: 2px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      font-weight: 600;
    }
    .tier-sovereign { background: #7c3aed33; color: #a78bfa; }
    .tier-elite { background: #f59e0b33; color: #fbbf24; }
    .tier-established { background: #22c55e33; color: #4ade80; }
    .tier-verified { background: #3b82f633; color: #60a5fa; }
    .tier-registered { background: #6b728033; color: #9ca3af; }
    .tier-unverified { background: #37415133; color: #6b7280; }
    .badge-level {
      font-size: 0.75rem;
      color: #888;
      font-weight: 600;
    }
    .badge-preview {
      grid-row: 1;
      grid-column: 3;
    }
    .badge-preview img {
      height: 20px;
      display: block;
    }
    .badge-embeds {
      grid-column: 2 / 4;
      display: none;
      flex-direction: column;
      gap: 0.4rem;
      margin-top: 0.5rem;
    }
    .badge-card:hover .badge-embeds,
    .badge-card.expanded .badge-embeds {
      display: flex;
    }
    .embed-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .embed-row label {
      font-size: 0.7rem;
      color: #666;
      min-width: 65px;
      text-transform: uppercase;
      font-weight: 600;
    }
    .embed-copy {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      flex: 1;
      min-width: 0;
      background: #111;
      border: 1px solid #333;
      border-radius: 6px;
      padding: 4px 8px;
    }
    .embed-copy code {
      font-size: 0.7rem;
      color: #888;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }
    .embed-copy button {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 0.85rem;
      padding: 2px;
      opacity: 0.6;
      transition: opacity 0.2s;
    }
    .embed-copy button:hover { opacity: 1; }
    .badges-count {
      text-align: center;
      color: #555;
      font-size: 0.9rem;
      padding: 1rem;
    }
    .copied-toast {
      position: fixed;
      bottom: 2rem;
      left: 50%;
      transform: translateX(-50%);
      background: #22c55e;
      color: #000;
      padding: 0.5rem 1.5rem;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.9rem;
      opacity: 0;
      transition: opacity 0.3s;
      pointer-events: none;
      z-index: 1000;
    }
    .copied-toast.show { opacity: 1; }
    @media (max-width: 640px) {
      .badge-card {
        grid-template-columns: 30px 1fr;
      }
      .badge-preview { grid-column: 2; grid-row: 2; }
      .badge-embeds { grid-column: 1 / -1; }
    }
    .back-link {
      display: inline-block;
      margin: 1rem;
      color: #a78bfa;
      text-decoration: none;
      font-size: 0.9rem;
    }
    .back-link:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <a href="/" class="back-link">← Back to AgentFolio</a>

  <div class="badges-hero">
    <h1>🛡️ Trust Badges</h1>
    <p>Embed verified trust scores in your GitHub README, documentation, or website.<br>
    Every badge is a live SVG that updates automatically as agents earn trust.</p>
    <div class="example-embed">
      ![Trust Score](https://agentfolio.bot/badge/YOUR_ID.svg)
    </div>
    <p style="font-size:0.85rem;color:#666">Hover any agent below to see embed codes. Click 📋 to copy.</p>
  </div>

  <div class="badges-count">${sorted.length} agents ranked by trust score</div>

  <div class="badges-grid">
    ${agentCards}
  </div>

  <div id="copied-toast" class="copied-toast">Copied!</div>

  ${THEME_SCRIPT}
  <script>
    function copyEmbed(id) {
      const el = document.getElementById(id);
      if (!el) return;
      const text = el.textContent;
      navigator.clipboard.writeText(text).then(() => {
        const toast = document.getElementById('copied-toast');
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 1500);
      });
    }
    // Toggle expand on mobile
    document.querySelectorAll('.badge-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;
        card.classList.toggle('expanded');
      });
    });
  </script>
</body>
</html>`;
}

module.exports = { generateBadgesShowcasePage };
