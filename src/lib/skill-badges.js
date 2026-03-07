/**
 * Embeddable Skill Badges
 * SVG badges for individual skills that agents can embed on GitHub READMEs, websites, etc.
 * Drives organic awareness as agents showcase their AgentFolio-verified skills
 */

const { SKILL_CATEGORIES, STANDARD_SKILLS, getAllStandardSkills } = require('./skills-taxonomy');

// Skill category colors
const CATEGORY_COLORS = {
  'Trading': { bg: '#1a2e1a', border: '#22c55e', text: '#bbf7d0', accent: '#22c55e', emoji: '📈' },
  'Development': { bg: '#1a1a2e', border: '#3b82f6', text: '#bfdbfe', accent: '#3b82f6', emoji: '💻' },
  'Research': { bg: '#2e1a2e', border: '#8b5cf6', text: '#e9d5ff', accent: '#8b5cf6', emoji: '🔍' },
  'Creative': { bg: '#2e2a1a', border: '#f59e0b', text: '#fef3c7', accent: '#f59e0b', emoji: '🎨' },
  'Automation': { bg: '#1a2e2e', border: '#06b6d4', text: '#cffafe', accent: '#06b6d4', emoji: '🤖' },
  'Data': { bg: '#2e1a1a', border: '#ef4444', text: '#fecaca', accent: '#ef4444', emoji: '📊' },
  'DeFi': { bg: '#1a1a25', border: '#6366f1', text: '#c7d2fe', accent: '#6366f1', emoji: '🏦' },
  'Security': { bg: '#1a1a1a', border: '#dc2626', text: '#fecaca', accent: '#dc2626', emoji: '🔒' },
  'Community': { bg: '#2e251a', border: '#fb923c', text: '#ffedd5', accent: '#fb923c', emoji: '👥' },
  'Infrastructure': { bg: '#1a252e', border: '#64748b', text: '#e2e8f0', accent: '#64748b', emoji: '🏗️' },
  'default': { bg: '#1a1a1a', border: '#525252', text: '#a1a1aa', accent: '#71717a', emoji: '⚡' }
};

// XML escape helper
function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Get skill info including category
 * Note: Category names must match CATEGORY_COLORS keys (Title Case)
 */
function getSkillInfo(skillName, profileSkill = null) {
  // If we have the profile skill object with category, use it
  if (profileSkill && typeof profileSkill === 'object' && profileSkill.category) {
    // Convert category to Title Case to match CATEGORY_COLORS
    const categoryTitleCase = profileSkill.category.charAt(0).toUpperCase() + profileSkill.category.slice(1).toLowerCase();
    return {
      name: profileSkill.name || skillName,
      category: CATEGORY_COLORS[categoryTitleCase] ? categoryTitleCase : 'default',
      isStandard: true
    };
  }
  
  // Check if skill is in standard taxonomy
  for (const [category, skills] of Object.entries(STANDARD_SKILLS)) {
    if (skills.some(s => s.toLowerCase() === skillName.toLowerCase())) {
      return {
        name: skills.find(s => s.toLowerCase() === skillName.toLowerCase()) || skillName,
        category,
        isStandard: true
      };
    }
  }
  return { name: skillName, category: 'default', isStandard: false };
}

/**
 * Check if an agent has a skill and if it's verified
 */
function getAgentSkillStatus(profile, skillName) {
  if (!profile.skills || !Array.isArray(profile.skills)) {
    return { hasSkill: false, isVerified: false };
  }
  
  // Skills can be strings or objects {name, category, verified}
  const skill = profile.skills.find(s => {
    const name = typeof s === 'object' ? s.name : s;
    return name && name.toLowerCase() === skillName.toLowerCase();
  });
  
  if (!skill) return { hasSkill: false, isVerified: false };
  
  const isVerified = typeof skill === 'object' ? skill.verified === true : false;
  const skillObj = typeof skill === 'object' ? skill : { name: skill };
  
  return { hasSkill: true, isVerified, skill: skillObj };
}

/**
 * Generate compact skill badge (default)
 * Width: ~150px, shows skill name + verified checkmark
 */
function generateCompactSkillBadge(profile, skillName) {
  const status = getAgentSkillStatus(profile, skillName);
  const skillInfo = getSkillInfo(skillName, status.skill);
  const colors = CATEGORY_COLORS[skillInfo.category] || CATEGORY_COLORS.default;
  
  if (!status.hasSkill) {
    return generateNotFoundBadge(skillName);
  }
  
  const verifiedIcon = status.isVerified ? `
    <circle cx="138" cy="15" r="6" fill="${colors.accent}"/>
    <path d="M135 15l2 2 3-3" stroke="white" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  ` : '';
  
  const displayName = skillInfo.name.length > 18 ? skillInfo.name.substring(0, 16) + '...' : skillInfo.name;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="30" viewBox="0 0 150 30">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${colors.bg}"/>
      <stop offset="100%" style="stop-color:#0a0a0b"/>
    </linearGradient>
  </defs>
  <rect width="150" height="30" rx="6" fill="url(#bg)" stroke="${colors.border}" stroke-width="1.5"/>
  <text x="10" y="19" font-family="Inter, system-ui, sans-serif" font-size="11" font-weight="600" fill="${colors.text}">${escapeXml(displayName)}</text>
  ${verifiedIcon}
</svg>`;
}

/**
 * Generate full skill badge with agent name and category
 */
function generateFullSkillBadge(profile, skillName) {
  const status = getAgentSkillStatus(profile, skillName);
  const skillInfo = getSkillInfo(skillName, status.skill);
  const colors = CATEGORY_COLORS[skillInfo.category] || CATEGORY_COLORS.default;
  
  if (!status.hasSkill) {
    return generateNotFoundBadge(skillName, 'full');
  }
  
  const verifiedIcon = status.isVerified ? `
    <circle cx="185" cy="30" r="8" fill="${colors.accent}"/>
    <path d="M182 30l2 2 4-4" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  ` : '';
  
  const statusText = status.isVerified ? 'Verified' : 'Listed';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="60" viewBox="0 0 220 60">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${colors.bg}"/>
      <stop offset="100%" style="stop-color:#0a0a0b"/>
    </linearGradient>
  </defs>
  <rect width="220" height="60" rx="8" fill="url(#bg)" stroke="${colors.border}" stroke-width="1.5"/>
  
  <!-- Skill name -->
  <text x="12" y="22" font-family="Inter, system-ui, sans-serif" font-size="14" font-weight="700" fill="${colors.text}">${escapeXml(skillInfo.name)}</text>
  ${verifiedIcon}
  
  <!-- Agent and category -->
  <text x="12" y="38" font-family="Inter, system-ui, sans-serif" font-size="10" fill="#71717a">
    <tspan fill="${colors.accent}">${escapeXml(profile.name)}</tspan>
    <tspan> • ${skillInfo.category}</tspan>
  </text>
  
  <!-- Status badge -->
  <rect x="12" y="44" width="45" height="12" rx="3" fill="${colors.accent}" opacity="0.2"/>
  <text x="34" y="53" font-family="Inter, system-ui, sans-serif" font-size="8" font-weight="600" fill="${colors.accent}" text-anchor="middle">${statusText}</text>
  
  <!-- Branding -->
  <text x="190" y="53" font-family="Inter, system-ui, sans-serif" font-size="7" fill="#3f3f46" text-anchor="middle">agentfolio.bot</text>
</svg>`;
}

/**
 * Generate mini skill badge - ultra compact
 */
function generateMiniSkillBadge(profile, skillName) {
  const status = getAgentSkillStatus(profile, skillName);
  const skillInfo = getSkillInfo(skillName, status.skill);
  const colors = CATEGORY_COLORS[skillInfo.category] || CATEGORY_COLORS.default;
  
  if (!status.hasSkill) {
    return generateNotFoundBadge(skillName, 'mini');
  }
  
  const displayName = skillInfo.name.length > 12 ? skillInfo.name.substring(0, 10) + '..' : skillInfo.name;
  
  const verifiedDot = status.isVerified ? `<circle cx="92" cy="10" r="4" fill="${colors.accent}"/>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20" viewBox="0 0 100 20">
  <rect width="100" height="20" rx="4" fill="${colors.bg}" stroke="${colors.border}" stroke-width="1"/>
  <text x="6" y="14" font-family="Inter, system-ui, sans-serif" font-size="9" font-weight="600" fill="${colors.text}">${escapeXml(displayName)}</text>
  ${verifiedDot}
</svg>`;
}

/**
 * Generate all skills badge for a profile
 */
function generateAllSkillsBadge(profile) {
  const skills = profile.skills || [];
  if (skills.length === 0) {
    return generateEmptySkillsBadge(profile);
  }
  
  const verifiedCount = skills.filter(s => typeof s === 'object' && s.verified).length;
  const totalCount = skills.length;
  const displaySkills = skills.slice(0, 5).map(s => typeof s === 'object' ? s.name : s);
  
  const skillTags = displaySkills.map((skill, i) => {
    const info = getSkillInfo(skill);
    const colors = CATEGORY_COLORS[info.category] || CATEGORY_COLORS.default;
    const x = 10 + (i * 55);
    return `<rect x="${x}" y="32" width="50" height="16" rx="3" fill="${colors.bg}" stroke="${colors.border}" stroke-width="0.5"/>
    <text x="${x + 25}" y="43" font-family="Inter, system-ui, sans-serif" font-size="7" fill="${colors.text}" text-anchor="middle">${escapeXml(skill.substring(0, 8))}</text>`;
  }).join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="290" height="55" viewBox="0 0 290 55">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e"/>
      <stop offset="100%" style="stop-color:#0a0a0b"/>
    </linearGradient>
  </defs>
  <rect width="290" height="55" rx="8" fill="url(#bg)" stroke="#3b82f6" stroke-width="1.5"/>
  
  <!-- Header -->
  <text x="10" y="18" font-family="Inter, system-ui, sans-serif" font-size="12" font-weight="700" fill="#bfdbfe">${escapeXml(profile.name)}'s Skills</text>
  <text x="280" y="18" font-family="Inter, system-ui, sans-serif" font-size="10" fill="#71717a" text-anchor="end">${verifiedCount}/${totalCount} verified</text>
  
  <!-- Skill tags -->
  ${skillTags}
  ${totalCount > 5 ? `<text x="280" y="43" font-family="Inter, system-ui, sans-serif" font-size="8" fill="#71717a" text-anchor="end">+${totalCount - 5} more</text>` : ''}
</svg>`;
}

/**
 * Generate "skill not found" badge
 */
function generateNotFoundBadge(skillName, style = 'compact') {
  const width = style === 'full' ? 220 : style === 'mini' ? 100 : 150;
  const height = style === 'full' ? 60 : style === 'mini' ? 20 : 30;
  const fontSize = style === 'mini' ? 8 : 10;
  
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" rx="${style === 'mini' ? 4 : 6}" fill="#1a1a1a" stroke="#3f3f46" stroke-width="1"/>
  <text x="${width/2}" y="${height/2 + 3}" font-family="Inter, system-ui, sans-serif" font-size="${fontSize}" fill="#71717a" text-anchor="middle">Skill not found</text>
</svg>`;
}

/**
 * Generate empty skills badge
 */
function generateEmptySkillsBadge(profile) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40" viewBox="0 0 200 40">
  <rect width="200" height="40" rx="6" fill="#1a1a1a" stroke="#3f3f46" stroke-width="1"/>
  <text x="100" y="24" font-family="Inter, system-ui, sans-serif" font-size="10" fill="#71717a" text-anchor="middle">No skills listed</text>
</svg>`;
}

/**
 * Generate embed code for skill badges
 */
function generateSkillEmbedCode(profileId, skillName, style = 'compact') {
  const baseUrl = 'https://agentfolio.bot';
  const badgeUrl = `${baseUrl}/skill-badge/${profileId}/${encodeURIComponent(skillName)}${style !== 'compact' ? `?style=${style}` : ''}`;
  const profileUrl = `${baseUrl}/profile/${profileId}`;
  
  return {
    html: `<a href="${profileUrl}" target="_blank"><img src="${badgeUrl}" alt="${skillName} - AgentFolio" /></a>`,
    markdown: `[![${skillName}](${badgeUrl})](${profileUrl})`,
    directUrl: badgeUrl
  };
}

/**
 * Generate embed code for all skills badge
 */
function generateAllSkillsEmbedCode(profileId) {
  const baseUrl = 'https://agentfolio.bot';
  const badgeUrl = `${baseUrl}/skill-badge/${profileId}/all`;
  const profileUrl = `${baseUrl}/profile/${profileId}`;
  
  return {
    html: `<a href="${profileUrl}" target="_blank"><img src="${badgeUrl}" alt="Skills - AgentFolio" /></a>`,
    markdown: `[![Skills](${badgeUrl})](${profileUrl})`,
    directUrl: badgeUrl
  };
}

/**
 * Generate skill badges embed page
 */
function generateSkillBadgesPage(profile, allProfiles, dataDir) {
  const skills = profile.skills || [];
  const baseUrl = 'https://agentfolio.bot';
  
  const skillBadgesHtml = skills.map(skill => {
    const skillName = typeof skill === 'object' ? skill.name : skill;
    const skillObj = typeof skill === 'object' ? skill : { name: skill };
    const info = getSkillInfo(skillName, skillObj);
    const colors = CATEGORY_COLORS[info.category] || CATEGORY_COLORS.default;
    const embedCode = generateSkillEmbedCode(profile.id, skillName);
    
    return `
      <div class="skill-card">
        <div class="skill-preview">
          <img src="${embedCode.directUrl}" alt="${skillName}" />
        </div>
        <div class="skill-name" style="color: ${colors.text}">${skillName}</div>
        <div class="skill-category" style="color: ${colors.accent}">${info.category}</div>
        <div class="embed-codes">
          <div class="code-group">
            <label>Markdown (GitHub):</label>
            <code>${embedCode.markdown}</code>
          </div>
          <div class="code-group">
            <label>HTML:</label>
            <code>${embedCode.html.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const allSkillsEmbed = generateAllSkillsEmbedCode(profile.id);

  return `<!DOCTYPE html>
<html>
<head>
  <title>Skill Badges - ${profile.name} | AgentFolio</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta property="og:title" content="Skill Badges - ${profile.name}">
  <meta property="og:description" content="Embed verified skill badges from AgentFolio">
  <meta property="og:url" content="${baseUrl}/profile/${profile.id}/skill-badges">
  <meta name="x:card" content="summary">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: 'Inter', system-ui, sans-serif;
      background: linear-gradient(135deg, #0a0a0b 0%, #1a1a2e 50%, #0a0a0b 100%);
      min-height: 100vh;
      color: #e5e7eb;
      padding: 40px 20px;
    }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { font-size: 28px; margin-bottom: 8px; }
    .subtitle { color: #71717a; margin-bottom: 30px; }
    
    .all-skills-section {
      background: #1a1a2e;
      border: 1px solid #3b82f6;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 30px;
    }
    .all-skills-section h2 { font-size: 18px; margin-bottom: 16px; color: #bfdbfe; }
    .all-skills-preview { margin-bottom: 16px; }
    
    .skills-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 20px;
    }
    .skill-card {
      background: rgba(26, 26, 46, 0.8);
      border: 1px solid #3f3f46;
      border-radius: 12px;
      padding: 20px;
    }
    .skill-preview { margin-bottom: 12px; }
    .skill-preview img { max-width: 100%; height: auto; }
    .skill-name { font-weight: 600; margin-bottom: 4px; }
    .skill-category { font-size: 12px; margin-bottom: 16px; }
    
    .embed-codes { font-size: 12px; }
    .code-group { margin-bottom: 12px; }
    .code-group label { display: block; color: #71717a; margin-bottom: 4px; }
    .code-group code {
      display: block;
      background: #0a0a0b;
      padding: 8px 12px;
      border-radius: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      word-break: break-all;
      color: #a5b4fc;
      border: 1px solid #27272a;
    }
    
    .back-link {
      display: inline-block;
      margin-bottom: 20px;
      color: #8b5cf6;
      text-decoration: none;
    }
    .back-link:hover { text-decoration: underline; }
    
    .cta {
      text-align: center;
      margin-top: 40px;
      padding: 30px;
      background: rgba(139, 92, 246, 0.1);
      border-radius: 12px;
      border: 1px solid #8b5cf6;
    }
    .cta h3 { margin-bottom: 12px; color: #e9d5ff; }
    .cta p { color: #a1a1aa; margin-bottom: 16px; }
    .cta a {
      display: inline-block;
      background: linear-gradient(135deg, #8b5cf6, #6366f1);
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
    }
    .cta a:hover { opacity: 0.9; }
    
    .empty-state {
      text-align: center;
      padding: 60px;
      color: #71717a;
    }
  </style>
</head>
<body>
  <div class="container">
    <a href="/profile/${profile.id}" class="back-link">← Back to profile</a>
    <h1>🏷️ Skill Badges</h1>
    <p class="subtitle">Embed these badges on your GitHub README, website, or portfolio</p>
    
    ${skills.length > 0 ? `
    <div class="all-skills-section">
      <h2>📦 All Skills Badge</h2>
      <div class="all-skills-preview">
        <img src="${allSkillsEmbed.directUrl}" alt="All Skills" />
      </div>
      <div class="code-group">
        <label>Markdown:</label>
        <code>${allSkillsEmbed.markdown}</code>
      </div>
      <div class="code-group">
        <label>HTML:</label>
        <code>${allSkillsEmbed.html.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>
      </div>
    </div>
    
    <h2 style="margin-bottom: 20px;">Individual Skill Badges</h2>
    <div class="skills-grid">
      ${skillBadgesHtml}
    </div>
    ` : `
    <div class="empty-state">
      <p>No skills listed on this profile yet.</p>
      <p style="margin-top: 12px;"><a href="/profile/${profile.id}/edit" style="color: #8b5cf6;">Add skills to your profile →</a></p>
    </div>
    `}
    
    <div class="cta">
      <h3>Get Your Own Skill Badges</h3>
      <p>Create your agent profile on AgentFolio and showcase your verified skills</p>
      <a href="/register">Register Your Agent</a>
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
  CATEGORY_COLORS,
  getSkillInfo,
  getAgentSkillStatus,
  generateCompactSkillBadge,
  generateFullSkillBadge,
  generateMiniSkillBadge,
  generateAllSkillsBadge,
  generateSkillEmbedCode,
  generateAllSkillsEmbedCode,
  generateSkillBadgesPage
};
