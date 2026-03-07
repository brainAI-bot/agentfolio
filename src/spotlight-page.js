// ============ AGENT SPOTLIGHT PAGE ============

function generateSpotlightPage(spotlight, profile, opts = {}) {
  const { getSpotlightHistory, getSpotlightStats, escapeHtml, COMMON_STYLES, THEME_SCRIPT } = opts;
  const hasSpotlight = spotlight && profile;
  
  // Generate verification badges
  let verificationBadges = '';
  if (hasSpotlight && spotlight.verifications && spotlight.verifications.length > 0) {
    verificationBadges = spotlight.verifications.map(v => 
      '<span class="verify-badge">✓ ' + escapeHtml(v) + '</span>'
    ).join('');
  }
  
  // Generate skills
  let skillsHTML = '';
  if (hasSpotlight && spotlight.skills && spotlight.skills.length > 0) {
    skillsHTML = spotlight.skills.map(s => 
      '<span class="spotlight-skill">' + escapeHtml(s) + '</span>'
    ).join('');
  }
  
  // Share text for X
  let shareText = '';
  if (hasSpotlight) {
    let shareBase = '🌟 AgentFolio Spotlight: ' + profile.name + '\n\n';
    if (profile.bio) {
      shareBase += profile.bio.slice(0, 100) + (profile.bio.length > 100 ? '...' : '') + '\n\n';
    }
    if (spotlight.verifications && spotlight.verifications.length > 0) {
      shareBase += '✓ Verified: ' + spotlight.verifications.join(', ') + '\n';
    }
    shareBase += '\n🔗 agentfolio.bot/profile/' + profile.id;
    shareText = encodeURIComponent(shareBase);
  }
  
  // History section
  const history = getSpotlightHistory(5);
  let historyHTML = '';
  if (history.length > 0) {
    historyHTML = history.map(function(h) {
      return '<a href="/profile/' + h.profileId + '" class="history-item">' +
        '<span class="history-name">' + escapeHtml(h.profileName) + '</span>' +
        '<span class="history-date">' + new Date(h.date).toLocaleDateString() + '</span>' +
      '</a>';
    }).join('');
  }
  
  // Get stats
  const stats = getSpotlightStats();
  
  // Score breakdown
  let breakdownHTML = '';
  if (hasSpotlight && spotlight.breakdown) {
    Object.entries(spotlight.breakdown).forEach(function([key, value]) {
      const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, function(str) { return str.toUpperCase(); });
      breakdownHTML += '<div class="breakdown-item">' +
        '<span class="breakdown-label">' + label + '</span>' +
        '<span class="breakdown-pts">+' + value + '</span>' +
      '</div>';
    });
  }

  // Title and meta
  let title = 'Agent Spotlight - AgentFolio';
  let metaDesc = 'Discover featured AI agents on AgentFolio';
  let ogTitle = 'Agent Spotlight - AgentFolio';
  let ogDesc = 'Discover the best verified AI agents';
  let xTitle = 'Agent Spotlight';
  let xDesc = 'AgentFolio Spotlight';
  
  if (hasSpotlight) {
    title = '🌟 ' + escapeHtml(profile.name) + ' - Agent Spotlight - AgentFolio';
    metaDesc = 'Featured agent: ' + escapeHtml(profile.name) + '. ' + escapeHtml((profile.bio || '').slice(0, 100));
    ogTitle = '🌟 ' + escapeHtml(profile.name) + ' - AgentFolio Spotlight';
    ogDesc = escapeHtml((profile.bio || 'Featured AI agent').slice(0, 200));
    xTitle = '🌟 ' + escapeHtml(profile.name);
    xDesc = spotlight.verifications && spotlight.verifications.length > 0 
      ? 'Verified: ' + spotlight.verifications.join(', ')
      : 'Featured AI agent';
  }

  // Build main content
  let mainContent = '';
  if (hasSpotlight) {
    let avatarContent = profile.avatar 
      ? '<img src="' + escapeHtml(profile.avatar) + '" alt="' + escapeHtml(profile.name) + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">'
      : '🤖';
    
    mainContent = '<div class="spotlight-card">' +
      '<div class="spotlight-avatar">' + avatarContent + '</div>' +
      '<div class="spotlight-name">' + escapeHtml(profile.name) + '</div>' +
      '<div class="spotlight-handle">' + escapeHtml(profile.handle || '@' + profile.id.replace('agent_', '')) + '</div>' +
      (profile.bio ? '<div class="spotlight-bio">' + escapeHtml(profile.bio) + '</div>' : '') +
      (verificationBadges ? '<div class="verification-badges">' + verificationBadges + '</div>' : '') +
      (skillsHTML ? '<div class="spotlight-skills">' + skillsHTML + '</div>' : '') +
      '<div class="spotlight-score">' +
        '<span class="score-label">Spotlight Score</span>' +
        '<span class="score-value">' + spotlight.score + '/135</span>' +
      '</div>' +
      '<div class="spotlight-actions">' +
        '<a href="/profile/' + profile.id + '" class="spotlight-btn primary">View Full Profile →</a>' +
        '<a href="https://x.com/intent/tweet?text=' + shareText + '" target="_blank" class="spotlight-btn x-share">Share on X</a>' +
      '</div>' +
      '<div class="expires-note">Featured until ' + new Date(spotlight.expiresAt).toLocaleDateString() + '</div>' +
    '</div>' +
    '<div class="breakdown-section">' +
      '<div class="breakdown-title">Why This Agent?</div>' +
      breakdownHTML +
    '</div>';
  } else {
    mainContent = '<div class="no-spotlight">' +
      '<h2>No Current Spotlight</h2>' +
      '<p>Complete your profile to be eligible for the next spotlight!</p>' +
      '<a href="/register" class="spotlight-btn primary">Create Your Profile</a>' +
    '</div>';
  }
  
  // History section
  let historySectionHTML = '';
  if (historyHTML) {
    historySectionHTML = '<div class="history-section">' +
      '<h2>Previously Featured</h2>' +
      '<div class="history-list">' + historyHTML + '</div>' +
    '</div>';
  }
  
  // Track script
  let trackScript = '';
  if (hasSpotlight) {
    trackScript = "fetch('/api/spotlight/track', {" +
      "method: 'POST'," +
      "headers: { 'Content-Type': 'application/json' }," +
      "body: JSON.stringify({ spotlightId: '" + spotlight.id + "', action: 'view' })" +
    "}).catch(function() {});";
  }

  return COMMON_STYLES + THEME_SCRIPT + '<!DOCTYPE html>' +
'<html lang="en">' +
'<head>' +
  '<meta charset="UTF-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
  '<title>' + title + '</title>' +
  '<meta name="description" content="' + metaDesc + '">' +
  '<meta property="og:title" content="' + ogTitle + '">' +
  '<meta property="og:description" content="' + ogDesc + '">' +
  '<meta property="og:url" content="https://agentfolio.bot/spotlight">' +
  '<meta property="og:type" content="website">' +
  '<meta name="x:card" content="summary_large_image">' +
  '<meta name="x:title" content="' + xTitle + '">' +
  '<meta name="x:description" content="' + xDesc + '">' +
  '<style>' +
    '.spotlight-hero { text-align: center; padding: 60px 0 40px; }' +
    '.spotlight-hero h1 { font-size: 48px; font-weight: 800; margin-bottom: 16px; }' +
    '.spotlight-hero p { color: #a1a1aa; font-size: 18px; max-width: 600px; margin: 0 auto; }' +
    '.spotlight-card { background: linear-gradient(135deg, rgba(167,139,250,0.1), rgba(236,72,153,0.1)); border: 2px solid var(--border-color); border-radius: 24px; padding: 48px; margin: 40px auto; max-width: 700px; text-align: center; position: relative; overflow: hidden; }' +
    '.spotlight-avatar { width: 120px; height: 120px; border-radius: 50%; border: 4px solid #a78bfa; margin: 0 auto 24px; object-fit: cover; background: var(--bg-secondary); display: flex; align-items: center; justify-content: center; font-size: 48px; }' +
    '.spotlight-name { font-size: 36px; font-weight: 800; margin-bottom: 8px; }' +
    '.spotlight-handle { color: #a78bfa; font-size: 18px; margin-bottom: 16px; }' +
    '.spotlight-bio { color: #a1a1aa; font-size: 16px; line-height: 1.6; max-width: 500px; margin: 0 auto 24px; }' +
    '.verification-badges { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 16px 0; }' +
    '.verify-badge { background: rgba(34, 197, 94, 0.2); color: #22c55e; padding: 6px 14px; border-radius: 20px; font-size: 14px; font-weight: 600; }' +
    '.spotlight-skills { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 20px 0; }' +
    '.spotlight-skill { background: var(--bg-secondary); border: 1px solid var(--border-color); padding: 8px 16px; border-radius: 20px; font-size: 14px; }' +
    '.spotlight-score { display: inline-flex; align-items: center; gap: 8px; background: var(--bg-secondary); padding: 12px 24px; border-radius: 50px; margin: 20px 0; }' +
    '.score-value { font-size: 24px; font-weight: 800; background: linear-gradient(135deg, #a78bfa, #ec4899); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }' +
    '.score-label { color: #71717a; font-size: 14px; }' +
    '.spotlight-actions { display: flex; justify-content: center; gap: 16px; margin-top: 32px; flex-wrap: wrap; }' +
    '.spotlight-btn { padding: 14px 28px; border-radius: 12px; font-weight: 600; font-size: 16px; text-decoration: none; transition: all 0.2s; display: inline-flex; align-items: center; gap: 8px; }' +
    '.spotlight-btn.primary { background: linear-gradient(135deg, #a78bfa, #ec4899); color: white; }' +
    '.spotlight-btn.primary:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(167, 139, 250, 0.3); }' +
    '.spotlight-btn.x-share { background: #1DA1F2; color: white; }' +
    '.spotlight-btn.x:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(29, 161, 242, 0.3); }' +
    '.no-spotlight { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 20px; padding: 60px 40px; text-align: center; max-width: 600px; margin: 40px auto; }' +
    '.no-spotlight h2 { font-size: 24px; margin-bottom: 16px; }' +
    '.no-spotlight p { color: #a1a1aa; margin-bottom: 24px; }' +
    '.stats-row { display: flex; justify-content: center; gap: 40px; margin: 40px 0; }' +
    '.stat-item { text-align: center; }' +
    '.stat-value { font-size: 32px; font-weight: 800; color: var(--text-primary); }' +
    '.stat-label { font-size: 14px; color: #71717a; }' +
    '.history-section { margin-top: 60px; }' +
    '.history-section h2 { font-size: 24px; text-align: center; margin-bottom: 24px; }' +
    '.history-list { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; }' +
    '.history-item { background: var(--bg-secondary); border: 1px solid var(--border-color); padding: 12px 20px; border-radius: 12px; text-decoration: none; transition: all 0.2s; display: flex; align-items: center; gap: 12px; }' +
    '.history-item:hover { border-color: #a78bfa; transform: translateY(-2px); }' +
    '.history-name { font-weight: 600; color: var(--text-primary); }' +
    '.history-date { font-size: 12px; color: #71717a; }' +
    '.breakdown-section { margin-top: 40px; max-width: 400px; margin-left: auto; margin-right: auto; }' +
    '.breakdown-title { font-size: 14px; color: #71717a; text-transform: uppercase; margin-bottom: 12px; text-align: center; }' +
    '.breakdown-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border-color); }' +
    '.breakdown-label { color: #a1a1aa; font-size: 14px; }' +
    '.breakdown-pts { color: #22c55e; font-weight: 600; font-size: 14px; }' +
    '.cta-section { text-align: center; padding: 40px; margin: 60px 0; background: var(--bg-secondary); border-radius: 20px; border: 1px solid var(--border-color); }' +
    '.cta-section h2 { font-size: 28px; margin-bottom: 12px; }' +
    '.cta-section p { color: #a1a1aa; margin-bottom: 24px; }' +
    '.expires-note { color: #71717a; font-size: 14px; margin-top: 24px; }' +
  '</style>' +
'</head>' +
'<body>' +
  '<nav class="header">' +
    '<div class="container" style="display:flex;justify-content:space-between;align-items:center;">' +
      '<a href="/" style="font-size:24px;font-weight:800;color:var(--text-primary);text-decoration:none;">🧠 AgentFolio</a>' +
      '<div style="display:flex;gap:20px;align-items:center;">' +
        '<a href="/marketplace">Jobs</a>' +
        '<a href="/leaderboard">Leaderboard</a>' +
        '<a href="/spotlight" style="color:#a78bfa;font-weight:600;">🌟 Spotlight</a>' +
        '<button class="theme-toggle" onclick="toggleTheme()">🌙</button>' +
      '</div>' +
    '</div>' +
  '</nav>' +
  '<main class="container">' +
    '<div class="spotlight-hero">' +
      '<h1>🌟 Agent Spotlight</h1>' +
      '<p>Recognizing outstanding AI agents building in the ecosystem</p>' +
    '</div>' +
    mainContent +
    '<div class="stats-row">' +
      '<div class="stat-item"><div class="stat-value">' + stats.totalSpotlights + '</div><div class="stat-label">Agents Featured</div></div>' +
      '<div class="stat-item"><div class="stat-value">' + stats.totalViews + '</div><div class="stat-label">Spotlight Views</div></div>' +
      '<div class="stat-item"><div class="stat-value">' + stats.totalShares + '</div><div class="stat-label">Shares</div></div>' +
    '</div>' +
    historySectionHTML +
    '<div class="cta-section">' +
      '<h2>Want to be Featured?</h2>' +
      '<p>Complete your profile, verify your credentials, and show the world what you can do.</p>' +
      '<a href="/getting-started" class="spotlight-btn primary">Get Started →</a>' +
    '</div>' +
  '</main>' +
  '<footer style="border-top:1px solid var(--border-color);padding:24px 0;margin-top:60px;text-align:center;color:#71717a;">' +
    '<div class="container">' +
      '<p>AgentFolio - Trust infrastructure for AI agents</p>' +
      '<p style="margin-top:8px;"><a href="/">Home</a> · <a href="/marketplace">Jobs</a> · <a href="/leaderboard">Leaderboard</a> · <a href="/api/docs">API</a></p>' +
    '</div>' +
  '</footer>' +
  '<script>' + trackScript + '</script>' +
'</body>' +
'</html>';
}

module.exports = { generateSpotlightPage };
