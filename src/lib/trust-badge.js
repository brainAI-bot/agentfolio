/**
 * Trust Badge — Premium embeddable verification badges
 * Routes: /badge/:id (HTML), /badge/:id.svg (SVG), /badge/:id.js (JS embed)
 */

const { calculateReputation, getTierInfo, getReputationTier } = require('./reputation');

const TIER_STYLES = {
  elite:       { glow: '#f59e0b', bg1: '#1c1408', bg2: '#0d0a04', border: '#f59e0b', text: '#fef3c7', accent: '#f59e0b', label: 'Elite' },
  verified:    { glow: '#22c55e', bg1: '#081c08', bg2: '#040d04', border: '#22c55e', text: '#bbf7d0', accent: '#22c55e', label: 'Verified' },
  established: { glow: '#3b82f6', bg1: '#08101c', bg2: '#04080d', border: '#3b82f6', text: '#bfdbfe', accent: '#3b82f6', label: 'Established' },
  emerging:    { glow: '#8b5cf6', bg1: '#14081c', bg2: '#0a040d', border: '#8b5cf6', text: '#e9d5ff', accent: '#8b5cf6', label: 'Emerging' },
  newcomer:    { glow: '#525252', bg1: '#141414', bg2: '#0a0a0a', border: '#525252', text: '#a1a1aa', accent: '#71717a', label: 'Newcomer' }
};

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function getKeyStat(profile) {
  const proofs = profile.verification?.proofs || {};
  const verifiedCount = Object.values(proofs).filter(Boolean).length;
  const skills = (profile.skills || []).length;
  const projects = (profile.portfolio || []).length;
  const endorsements = (profile.endorsements || []).length;
  
  // Pick the most impressive stat
  if (verifiedCount > 0) return `${verifiedCount} verification${verifiedCount > 1 ? 's' : ''}`;
  if (projects > 0) return `${projects} project${projects > 1 ? 's' : ''}`;
  if (skills > 0) return `${skills} skill${skills > 1 ? 's' : ''}`;
  if (endorsements > 0) return `${endorsements} endorsement${endorsements > 1 ? 's' : ''}`;
  return 'Registered';
}

/**
 * Premium SVG trust badge — shields.io style but better
 */
function generateTrustBadgeSVG(profile, allProfiles, dataDir) {
  const rep = calculateReputation(profile, allProfiles, dataDir);
  const tierName = getReputationTier(rep.score);
  const s = TIER_STYLES[tierName] || TIER_STYLES.newcomer;
  const keyStat = getKeyStat(profile);
  const name = esc(profile.name || 'Agent');
  const profileUrl = `https://agentfolio.bot/profile/${profile.id}`;

  // Measure text widths (approx 6.5px per char at 11px font)
  const nameW = Math.max(name.length * 7, 50);
  const statW = Math.max(keyStat.length * 6.2, 40);
  const tierW = Math.max(s.label.length * 6.5, 40);
  const totalW = nameW + statW + tierW + 70; // padding

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalW}" height="28" viewBox="0 0 ${totalW} 28">
  <defs>
    <linearGradient id="tbg1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${s.bg1}"/>
      <stop offset="100%" stop-color="${s.bg2}"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="1.5" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>
  
  <!-- Background -->
  <rect width="${totalW}" height="28" rx="6" fill="url(#tbg1)" stroke="${s.border}" stroke-width="1" stroke-opacity="0.6"/>
  
  <!-- Shield icon -->
  <g transform="translate(8, 5)" filter="url(#glow)">
    <path d="M9 1L2 4.5V10c0 4.5 3 8.7 7 9.5 4-0.8 7-5 7-9.5V4.5L9 1z" fill="none" stroke="${s.accent}" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M6.5 10l2 2 3.5-4" fill="none" stroke="${s.accent}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  
  <!-- Agent name -->
  <text x="28" y="18" font-family="Inter, -apple-system, system-ui, sans-serif" font-size="11" font-weight="700" fill="${s.text}">${name}</text>
  
  <!-- Divider -->
  <line x1="${nameW + 32}" y1="5" x2="${nameW + 32}" y2="23" stroke="${s.border}" stroke-width="0.5" stroke-opacity="0.4"/>
  
  <!-- Key stat -->
  <text x="${nameW + 40}" y="18" font-family="Inter, -apple-system, system-ui, sans-serif" font-size="10" fill="${s.accent}">${esc(keyStat)}</text>
  
  <!-- Tier pill -->
  <rect x="${nameW + statW + 48}" y="6" width="${tierW + 12}" height="16" rx="8" fill="${s.accent}" fill-opacity="0.2"/>
  <text x="${nameW + statW + 54 + tierW / 2}" y="18" font-family="Inter, -apple-system, system-ui, sans-serif" font-size="9" font-weight="700" fill="${s.accent}" text-anchor="middle">${s.label}</text>
</svg>`;
}

/**
 * Full-size premium badge card (SVG, 320x100)
 */
function generateTrustCardSVG(profile, allProfiles, dataDir) {
  const rep = calculateReputation(profile, allProfiles, dataDir);
  const tierName = getReputationTier(rep.score);
  const s = TIER_STYLES[tierName] || TIER_STYLES.newcomer;
  const keyStat = getKeyStat(profile);
  const name = esc(profile.name || 'Agent');
  const handle = esc(profile.handle || '');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="100" viewBox="0 0 320 100">
  <defs>
    <linearGradient id="cbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${s.bg1}"/>
      <stop offset="100%" stop-color="${s.bg2}"/>
    </linearGradient>
    <filter id="cglow">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  
  <!-- Card bg with glow border -->
  <rect width="320" height="100" rx="12" fill="url(#cbg)"/>
  <rect width="320" height="100" rx="12" fill="none" stroke="${s.border}" stroke-width="1.5" stroke-opacity="0.5"/>
  
  <!-- Subtle glow effect top-left -->
  <ellipse cx="60" cy="20" rx="80" ry="40" fill="${s.glow}" opacity="0.06"/>
  
  <!-- Shield icon -->
  <g transform="translate(16, 20)" filter="url(#cglow)">
    <path d="M20 2L4 10v12c0 10 6.8 19.4 16 21.3C29.2 43.4 36 34 36 24V10L20 2z" fill="${s.accent}" fill-opacity="0.15" stroke="${s.accent}" stroke-width="2"/>
    <path d="M14 22l5 5 9-10" fill="none" stroke="${s.accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  
  <!-- Agent name -->
  <text x="64" y="38" font-family="Inter, -apple-system, system-ui, sans-serif" font-size="16" font-weight="700" fill="${s.text}">${name}</text>
  
  <!-- Handle -->
  <text x="64" y="54" font-family="Inter, -apple-system, system-ui, sans-serif" font-size="11" fill="#71717a">${handle}</text>
  
  <!-- Stats row -->
  <text x="64" y="72" font-family="Inter, -apple-system, system-ui, sans-serif" font-size="10" fill="${s.accent}">
    <tspan font-weight="600">${rep.score}</tspan><tspan fill="#52525b"> pts</tspan>
    <tspan dx="8">•</tspan>
    <tspan dx="8">${esc(keyStat)}</tspan>
  </text>
  
  <!-- Tier pill -->
  <rect x="240" y="14" width="${Math.max(s.label.length * 8 + 16, 60)}" height="24" rx="12" fill="${s.accent}" fill-opacity="0.2" stroke="${s.accent}" stroke-width="0.5" stroke-opacity="0.3"/>
  <text x="${240 + Math.max(s.label.length * 8 + 16, 60) / 2}" y="30" font-family="Inter, -apple-system, system-ui, sans-serif" font-size="10" font-weight="700" fill="${s.accent}" text-anchor="middle">${s.label}</text>
  
  <!-- Branding -->
  <text x="240" y="72" font-family="Inter, -apple-system, system-ui, sans-serif" font-size="8" fill="#3f3f46">Verified on</text>
  <text x="240" y="84" font-family="Inter, -apple-system, system-ui, sans-serif" font-size="9" font-weight="600" fill="#52525b">agentfolio.bot</text>
</svg>`;
}

/**
 * HTML badge page (for iframe embed)
 */
function generateTrustBadgeHTML(profile, allProfiles, dataDir) {
  const rep = calculateReputation(profile, allProfiles, dataDir);
  const tierName = getReputationTier(rep.score);
  const s = TIER_STYLES[tierName] || TIER_STYLES.newcomer;
  const keyStat = getKeyStat(profile);
  const profileUrl = `https://agentfolio.bot/profile/${profile.id}`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(profile.name)} — AgentFolio Trust Badge</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:transparent;font-family:'Inter',system-ui,sans-serif}
  .badge-card{
    display:inline-flex;align-items:center;gap:14px;
    background:linear-gradient(135deg,${s.bg1},${s.bg2});
    border:1px solid ${s.border}66;
    border-radius:14px;padding:14px 20px;
    text-decoration:none;color:${s.text};
    transition:all .25s;position:relative;overflow:hidden;
    box-shadow:0 0 20px ${s.glow}15;
  }
  .badge-card:hover{
    border-color:${s.border};
    box-shadow:0 0 30px ${s.glow}30;
    transform:translateY(-1px);
  }
  .badge-card::before{
    content:'';position:absolute;top:-50%;left:-50%;
    width:200%;height:200%;
    background:radial-gradient(circle at 30% 30%,${s.glow}08,transparent 60%);
    pointer-events:none;
  }
  .shield{
    width:36px;height:36px;flex-shrink:0;
    display:flex;align-items:center;justify-content:center;
  }
  .shield svg{filter:drop-shadow(0 0 4px ${s.glow}40)}
  .info{flex:1;min-width:0}
  .name{font-size:14px;font-weight:700;line-height:1.3}
  .meta{font-size:11px;color:#71717a;margin-top:2px}
  .meta .stat{color:${s.accent};font-weight:600}
  .tier{
    padding:4px 10px;border-radius:10px;
    background:${s.accent}20;border:1px solid ${s.accent}30;
    font-size:10px;font-weight:700;color:${s.accent};
    white-space:nowrap;
  }
  .brand{
    position:absolute;bottom:3px;right:10px;
    font-size:7px;color:#3f3f4680;
  }
</style>
</head>
<body>
<a class="badge-card" href="${profileUrl}" target="_blank" rel="noopener">
  <div class="shield">
    <svg width="28" height="28" viewBox="0 0 40 46" fill="none">
      <path d="M20 2L4 10v12c0 10 6.8 19.4 16 21.3C29.2 43.4 36 34 36 24V10L20 2z" fill="${s.accent}20" stroke="${s.accent}" stroke-width="2.5"/>
      <path d="M14 22l5 5 9-10" stroke="${s.accent}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </div>
  <div class="info">
    <div class="name">${esc(profile.name)}</div>
    <div class="meta"><span class="stat">${rep.score} pts</span> · ${esc(keyStat)}</div>
  </div>
  <div class="tier">${s.label}</div>
  <span class="brand">agentfolio.bot</span>
</a>
</body>
</html>`;
}

/**
 * JavaScript embed snippet
 */
function generateTrustBadgeJS(profile) {
  const profileId = profile.id;
  return `(function(){
  var d=document,f=d.createElement('iframe');
  f.src='https://agentfolio.bot/badge/${profileId}';
  f.style.cssText='border:none;width:340px;height:70px;overflow:hidden;background:transparent';
  f.setAttribute('scrolling','no');
  f.setAttribute('title','AgentFolio Trust Badge');
  f.setAttribute('loading','lazy');
  var s=d.currentScript;
  if(s&&s.parentNode)s.parentNode.insertBefore(f,s);
  else d.body.appendChild(f);
})();`;
}

/**
 * "Get Your Badge" section HTML for the profile page
 */
function generateBadgeSection(profileId) {
  const base = 'https://agentfolio.bot';
  return `
    <div class="section" id="trust-badge-section">
      <div class="section-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Trust Badge</div>
      <div style="background:#18181b;border:1px solid #27272a;border-radius:16px;padding:24px;margin-bottom:16px">
        <p style="color:#a1a1aa;font-size:14px;margin-bottom:20px">Embed your AgentFolio trust badge on your website to show your verification status.</p>
        
        <div style="margin-bottom:24px">
          <div style="font-size:13px;font-weight:600;color:#a78bfa;margin-bottom:10px">Preview</div>
          <div style="background:#09090b;border-radius:10px;padding:20px;display:flex;justify-content:center">
            <iframe src="${base}/badge/${profileId}" style="border:none;width:340px;height:70px;overflow:hidden" scrolling="no"></iframe>
          </div>
        </div>

        <div style="display:grid;gap:16px">
          <div>
            <div style="font-size:12px;font-weight:600;color:#71717a;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">HTML / Website</div>
            <div style="background:#09090b;border:1px solid #27272a;border-radius:8px;padding:12px;font-family:monospace;font-size:12px;color:#22c55e;word-break:break-all;cursor:pointer" onclick="navigator.clipboard.writeText(this.textContent);this.style.color='#a78bfa';setTimeout(()=>this.style.color='#22c55e',1200)">&lt;script src="${base}/badge/${profileId}.js"&gt;&lt;/script&gt;</div>
          </div>
          <div>
            <div style="font-size:12px;font-weight:600;color:#71717a;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Markdown / README</div>
            <div style="background:#09090b;border:1px solid #27272a;border-radius:8px;padding:12px;font-family:monospace;font-size:12px;color:#22c55e;word-break:break-all;cursor:pointer" onclick="navigator.clipboard.writeText(this.textContent);this.style.color='#a78bfa';setTimeout(()=>this.style.color='#22c55e',1200)">[![AgentFolio](${base}/badge/${profileId}.svg)](${base}/profile/${profileId})</div>
          </div>
          <div>
            <div style="font-size:12px;font-weight:600;color:#71717a;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Direct Image</div>
            <div style="background:#09090b;border:1px solid #27272a;border-radius:8px;padding:12px;font-family:monospace;font-size:12px;color:#22c55e;word-break:break-all;cursor:pointer" onclick="navigator.clipboard.writeText(this.textContent);this.style.color='#a78bfa';setTimeout(()=>this.style.color='#22c55e',1200)">&lt;img src="${base}/badge/${profileId}.svg" alt="AgentFolio Badge"&gt;</div>
          </div>
          <div>
            <div style="font-size:12px;font-weight:600;color:#71717a;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">iFrame</div>
            <div style="background:#09090b;border:1px solid #27272a;border-radius:8px;padding:12px;font-family:monospace;font-size:12px;color:#22c55e;word-break:break-all;cursor:pointer" onclick="navigator.clipboard.writeText(this.textContent);this.style.color='#a78bfa';setTimeout(()=>this.style.color='#22c55e',1200)">&lt;iframe src="${base}/badge/${profileId}" style="border:none;width:340px;height:70px" scrolling="no"&gt;&lt;/iframe&gt;</div>
          </div>
        </div>
        <p style="color:#52525b;font-size:11px;margin-top:12px">Click any code block to copy. Badge updates automatically.</p>
      </div>
    </div>`;
}

module.exports = {
  generateTrustBadgeSVG,
  generateTrustCardSVG,
  generateTrustBadgeHTML,
  generateTrustBadgeJS,
  generateBadgeSection,
  TIER_STYLES
};
