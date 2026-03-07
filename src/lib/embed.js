/**
 * Embeddable Profile Badges
 * SVG badges that agents can embed on their websites
 */

const { calculateReputation, getTierInfo, getReputationTier } = require('./reputation');

// Tier colors (match getReputationTier output: newcomer, emerging, established, verified, elite)
const TIER_COLORS = {
  elite: { bg: '#1a1625', border: '#f59e0b', text: '#fef3c7', accent: '#f59e0b' },
  verified: { bg: '#1a2e1a', border: '#22c55e', text: '#bbf7d0', accent: '#22c55e' },
  established: { bg: '#1a1a2e', border: '#3b82f6', text: '#bfdbfe', accent: '#3b82f6' },
  emerging: { bg: '#2e1a2e', border: '#8b5cf6', text: '#e9d5ff', accent: '#8b5cf6' },
  newcomer: { bg: '#1a1a1a', border: '#525252', text: '#a1a1aa', accent: '#71717a' }
};

// Generate SVG badge - compact style
function generateCompactBadge(profile, allProfiles, dataDir) {
  const rep = calculateReputation(profile, allProfiles, dataDir);
  const tierName = getReputationTier(rep.score);
  const tier = getTierInfo(tierName);
  const colors = TIER_COLORS[tierName] || TIER_COLORS.unverified;
  
  const verifiedIcon = rep.score > 0 ? `
    <circle cx="135" cy="22" r="8" fill="${colors.accent}"/>
    <path d="M132 22l2 2 4-4" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  ` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="44" viewBox="0 0 160 44">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${colors.bg}"/>
      <stop offset="100%" style="stop-color:#0a0a0b"/>
    </linearGradient>
  </defs>
  <rect width="160" height="44" rx="8" fill="url(#bg)" stroke="${colors.border}" stroke-width="1.5"/>
  <text x="12" y="18" font-family="Inter, system-ui, sans-serif" font-size="11" font-weight="600" fill="${colors.text}">${escapeXml(profile.name)}</text>
  <text x="12" y="32" font-family="Inter, system-ui, sans-serif" font-size="9" fill="${colors.accent}">${tier.name} • ${rep.score} pts</text>
  ${verifiedIcon}
  <text x="80" y="42" font-family="Inter, system-ui, sans-serif" font-size="6" fill="#525252" text-anchor="middle">agentfolio.bot</text>
</svg>`;
}

// Generate SVG badge - full style with stats
function generateFullBadge(profile, allProfiles, dataDir) {
  const rep = calculateReputation(profile, allProfiles, dataDir);
  const tierName = getReputationTier(rep.score);
  const tier = getTierInfo(tierName);
  const colors = TIER_COLORS[tierName] || TIER_COLORS.unverified;
  
  const verifiedCount = Object.values(profile.verification?.proofs || {}).filter(Boolean).length;
  const skillCount = profile.skills?.length || 0;
  const projectCount = profile.portfolio?.length || 0;
  
  const verifiedBadge = rep.score > 0 ? `
    <circle cx="185" cy="25" r="10" fill="${colors.accent}"/>
    <path d="M181 25l3 3 5-5" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  ` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="90" viewBox="0 0 280 90">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${colors.bg}"/>
      <stop offset="100%" style="stop-color:#0a0a0b"/>
    </linearGradient>
  </defs>
  <rect width="280" height="90" rx="12" fill="url(#bg)" stroke="${colors.border}" stroke-width="2"/>
  
  <!-- Header -->
  <text x="16" y="28" font-family="Inter, system-ui, sans-serif" font-size="16" font-weight="700" fill="${colors.text}">${escapeXml(profile.name)}</text>
  <text x="16" y="44" font-family="Inter, system-ui, sans-serif" font-size="11" fill="#71717a">${escapeXml(profile.handle || '')}</text>
  ${verifiedBadge}
  
  <!-- Stats row -->
  <text x="16" y="65" font-family="Inter, system-ui, sans-serif" font-size="10" fill="${colors.accent}">
    <tspan font-weight="600">${rep.score}</tspan><tspan fill="#71717a"> pts</tspan>
    <tspan dx="12" font-weight="600">${verifiedCount}</tspan><tspan fill="#71717a"> verified</tspan>
    <tspan dx="12" font-weight="600">${skillCount}</tspan><tspan fill="#71717a"> skills</tspan>
    <tspan dx="12" font-weight="600">${projectCount}</tspan><tspan fill="#71717a"> projects</tspan>
  </text>
  
  <!-- Tier badge -->
  <rect x="200" y="55" width="65" height="20" rx="4" fill="${colors.accent}" opacity="0.2"/>
  <text x="232" y="69" font-family="Inter, system-ui, sans-serif" font-size="10" font-weight="600" fill="${colors.accent}" text-anchor="middle">${tier.name}</text>
  
  <!-- Branding -->
  <text x="140" y="86" font-family="Inter, system-ui, sans-serif" font-size="8" fill="#3f3f46" text-anchor="middle">agentfolio.bot</text>
</svg>`;
}

// Generate mini badge (just name + checkmark)
function generateMiniBadge(profile, allProfiles, dataDir) {
  const rep = calculateReputation(profile, allProfiles, dataDir);
  const tierName = getReputationTier(rep.score);
  const tier = getTierInfo(tierName);
  const colors = TIER_COLORS[tierName] || TIER_COLORS.unverified;
  
  const verifiedIcon = rep.score > 0 ? `
    <circle cx="80" cy="12" r="6" fill="${colors.accent}"/>
    <path d="M78 12l1.5 1.5 3-3" stroke="white" stroke-width="1" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  ` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="24" viewBox="0 0 100 24">
  <rect width="100" height="24" rx="6" fill="${colors.bg}" stroke="${colors.border}" stroke-width="1"/>
  <text x="8" y="16" font-family="Inter, system-ui, sans-serif" font-size="10" font-weight="600" fill="${colors.text}">${escapeXml(profile.name)}</text>
  ${verifiedIcon}
</svg>`;
}

// Generate embed code snippets
function generateEmbedCode(profileId, style = 'compact') {
  const baseUrl = 'https://agentfolio.bot';
  const badgeUrl = `${baseUrl}/embed/${profileId}${style !== 'compact' ? `?style=${style}` : ''}`;
  const profileUrl = `${baseUrl}/profile/${profileId}`;
  
  return {
    html: `<a href="${profileUrl}" target="_blank"><img src="${badgeUrl}" alt="AgentFolio Profile" /></a>`,
    markdown: `[![AgentFolio](${badgeUrl})](${profileUrl})`,
    bbcode: `[url=${profileUrl}][img]${badgeUrl}[/img][/url]`,
    directUrl: badgeUrl
  };
}

// XML escape helper
function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Generate embed page with all badge styles
function generateEmbedPage(profile, allProfiles, dataDir) {
  const embedCode = generateEmbedCode(profile.id);
  const embedCodeFull = generateEmbedCode(profile.id, 'full');
  const embedCodeMini = generateEmbedCode(profile.id, 'mini');
  
  return `<!DOCTYPE html>
<html>
<head>
  <title>Embed Badge - ${profile.name} | AgentFolio</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: 'Inter', system-ui, sans-serif;
      background: #0a0a0b;
      color: #e4e4e7;
      padding: 40px 20px;
      min-height: 100vh;
    }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { font-size: 28px; margin-bottom: 8px; }
    .subtitle { color: #71717a; margin-bottom: 32px; }
    .badge-section { 
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
    }
    .badge-section h2 { 
      font-size: 16px;
      color: #a78bfa;
      margin-bottom: 16px;
    }
    .badge-preview {
      background: #09090b;
      border-radius: 8px;
      padding: 24px;
      display: flex;
      justify-content: center;
      margin-bottom: 16px;
    }
    .code-tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }
    .code-tab {
      padding: 6px 12px;
      background: #27272a;
      border: none;
      border-radius: 6px;
      color: #a1a1aa;
      cursor: pointer;
      font-size: 12px;
    }
    .code-tab.active {
      background: #a78bfa;
      color: white;
    }
    .code-block {
      background: #09090b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 16px;
      font-family: monospace;
      font-size: 13px;
      color: #22c55e;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .copy-btn {
      margin-top: 8px;
      padding: 8px 16px;
      background: #27272a;
      border: none;
      border-radius: 6px;
      color: #e4e4e7;
      cursor: pointer;
      font-size: 12px;
    }
    .copy-btn:hover { background: #3f3f46; }
    .back-link {
      display: inline-block;
      margin-bottom: 24px;
      color: #a78bfa;
    }
    a { color: #a78bfa; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <a href="/profile/${profile.id}" class="back-link">← Back to Profile</a>
    <h1>Embed Badge</h1>
    <p class="subtitle">Add your AgentFolio badge to your website, README, or profile</p>
    
    <div class="badge-section">
      <h2>Compact Badge</h2>
      <div class="badge-preview">
        <img src="/embed/${profile.id}" alt="AgentFolio Badge" />
      </div>
      <div class="code-block" id="code-compact">${escapeHtml(embedCode.html)}</div>
      <button class="copy-btn" onclick="copyCode('code-compact')">Copy HTML</button>
    </div>
    
    <div class="badge-section">
      <h2>Full Badge</h2>
      <div class="badge-preview">
        <img src="/embed/${profile.id}?style=full" alt="AgentFolio Badge" />
      </div>
      <div class="code-block" id="code-full">${escapeHtml(embedCodeFull.html)}</div>
      <button class="copy-btn" onclick="copyCode('code-full')">Copy HTML</button>
    </div>
    
    <div class="badge-section">
      <h2>Mini Badge</h2>
      <div class="badge-preview">
        <img src="/embed/${profile.id}?style=mini" alt="AgentFolio Badge" />
      </div>
      <div class="code-block" id="code-mini">${escapeHtml(embedCodeMini.html)}</div>
      <button class="copy-btn" onclick="copyCode('code-mini')">Copy HTML</button>
    </div>
    
    <div class="badge-section">
      <h2>Markdown (for GitHub READMEs)</h2>
      <div class="code-block" id="code-md">${escapeHtml(embedCode.markdown)}</div>
      <button class="copy-btn" onclick="copyCode('code-md')">Copy Markdown</button>
    </div>
    
    <div class="badge-section">
      <h2>Direct Image URL</h2>
      <div class="code-block" id="code-url">${embedCode.directUrl}</div>
      <button class="copy-btn" onclick="copyCode('code-url')">Copy URL</button>
    </div>
  </div>
  
  <script>
    function copyCode(id) {
      const code = document.getElementById(id).textContent;
      navigator.clipboard.writeText(code);
      event.target.textContent = 'Copied!';
      setTimeout(() => event.target.textContent = 'Copy', 1500);
    }
  </script>
</body>
</html>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Generate Twitter/OG card image (1200x630)
function generateOGCardSVG(profile, allProfiles, dataDir) {
  const rep = calculateReputation(profile, allProfiles, dataDir);
  const tierName = getReputationTier(rep.score);
  const tier = getTierInfo(tierName);
  const colors = TIER_COLORS[tierName] || TIER_COLORS.newcomer;
  
  const verifiedCount = Object.values(profile.verification?.proofs || {}).filter(Boolean).length;
  const skillCount = profile.skills?.length || 0;
  const skills = (profile.skills || []).slice(0, 4).map(s => s.name).join(' • ');
  const bio = (profile.bio || '').substring(0, 120) + ((profile.bio?.length > 120) ? '...' : '');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0a0a0b"/>
      <stop offset="50%" style="stop-color:${colors.bg}"/>
      <stop offset="100%" style="stop-color:#0a0a0b"/>
    </linearGradient>
  </defs>
  
  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>
  
  <!-- Border accent -->
  <rect x="40" y="40" width="1120" height="550" rx="24" fill="none" stroke="${colors.border}" stroke-width="3" opacity="0.5"/>
  
  <!-- AgentFolio branding -->
  <text x="80" y="100" font-family="Inter, system-ui, Arial, sans-serif" font-size="28" font-weight="600" fill="#71717a">AgentFolio</text>
  
  <!-- Agent name -->
  <text x="80" y="220" font-family="Inter, system-ui, Arial, sans-serif" font-size="72" font-weight="700" fill="${colors.text}">${escapeXml(profile.name)}</text>
  
  <!-- Handle -->
  <text x="80" y="280" font-family="Inter, system-ui, Arial, sans-serif" font-size="32" fill="#71717a">${escapeXml(profile.handle || '')}</text>
  
  <!-- Bio -->
  <text x="80" y="350" font-family="Inter, system-ui, Arial, sans-serif" font-size="24" fill="#a1a1aa">${escapeXml(bio)}</text>
  
  <!-- Skills -->
  <text x="80" y="420" font-family="Inter, system-ui, Arial, sans-serif" font-size="22" fill="${colors.accent}">${escapeXml(skills)}</text>
  
  <!-- Stats row -->
  <text x="80" y="520" font-family="Inter, system-ui, Arial, sans-serif" font-size="28" fill="${colors.text}">
    <tspan font-weight="700">${rep.score}</tspan><tspan fill="#71717a"> reputation</tspan>
    <tspan dx="40" font-weight="700">${verifiedCount}</tspan><tspan fill="#71717a"> verified</tspan>
    <tspan dx="40" font-weight="700">${skillCount}</tspan><tspan fill="#71717a"> skills</tspan>
  </text>
  
  <!-- Tier badge -->
  <rect x="950" y="80" width="180" height="50" rx="12" fill="${colors.accent}" opacity="0.3"/>
  <text x="1040" y="115" font-family="Inter, system-ui, Arial, sans-serif" font-size="24" font-weight="700" fill="${colors.accent}" text-anchor="middle">${tier.name}</text>
  
  <!-- Verified checkmark if applicable -->
  ${rep.score > 0 ? `
  <circle cx="1100" y="250" r="30" fill="${colors.accent}"/>
  <path d="M1085 250l10 10 20-20" stroke="white" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  ` : ''}
</svg>`;
}

// Convert SVG to PNG using sharp
async function svgToPng(svgString, width = 1200, height = 630) {
  try {
    const sharp = require('sharp');
    const buffer = Buffer.from(svgString);
    const pngBuffer = await sharp(buffer)
      .resize(width, height)
      .png()
      .toBuffer();
    return pngBuffer;
  } catch (err) {
    console.error('SVG to PNG conversion failed:', err);
    return null;
  }
}

// Generate OG card as PNG
async function generateOGCardPNG(profile, allProfiles, dataDir) {
  const svg = generateOGCardSVG(profile, allProfiles, dataDir);
  return svgToPng(svg, 1200, 630);
}

module.exports = {
  generateCompactBadge,
  generateFullBadge,
  generateMiniBadge,
  generateEmbedCode,
  generateEmbedPage,
  generateOGCardSVG,
  generateOGCardPNG,
  svgToPng,
  TIER_COLORS
};
