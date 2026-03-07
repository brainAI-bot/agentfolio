#!/usr/bin/env node
/**
 * Weekly Digest Email System for AgentFolio
 * Sends personalized weekly updates to registered agents via AgentMail
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PROFILES_DIR = path.join(DATA_DIR, 'profiles');
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics.json');
const DIGEST_STATE_FILE = path.join(DATA_DIR, 'digest-state.json');

// AgentMail CLI path
const AGENTMAIL_CLI = '/home/ubuntu/clawd/brainKID/agentmail-cli.py';

// Load all profiles
function loadProfiles() {
  const profiles = [];
  if (!fs.existsSync(PROFILES_DIR)) return profiles;
  
  const files = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, file), 'utf8'));
      profiles.push(data);
    } catch (e) {
      console.error(`Error loading ${file}:`, e.message);
    }
  }
  return profiles;
}

// Load analytics data
function loadAnalytics() {
  if (!fs.existsSync(ANALYTICS_FILE)) {
    return { profileViews: {}, apiCalls: {}, dailyStats: {} };
  }
  return JSON.parse(fs.readFileSync(ANALYTICS_FILE, 'utf8'));
}

// Load/save digest state (track what's been sent)
function loadDigestState() {
  if (!fs.existsSync(DIGEST_STATE_FILE)) {
    return { lastRun: null, sentTo: [] };
  }
  return JSON.parse(fs.readFileSync(DIGEST_STATE_FILE, 'utf8'));
}

function saveDigestState(state) {
  fs.writeFileSync(DIGEST_STATE_FILE, JSON.stringify(state, null, 2));
}

// Calculate weekly stats for a profile
function getWeeklyStats(profile, analytics, allProfiles) {
  const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  
  // Profile views this week (sum daily views from past 7 days)
  const viewData = analytics.profileViews?.[profile.id];
  let views = 0;
  if (viewData?.daily) {
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateKey = date.toISOString().split('T')[0];
      views += viewData.daily[dateKey] || 0;
    }
  } else if (typeof viewData === 'number') {
    views = viewData;
  }
  
  // New endorsements this week
  const newEndorsements = (profile.endorsements || []).filter(e => 
    new Date(e.createdAt).getTime() > oneWeekAgo
  );
  
  // New collaborations this week
  const newCollaborations = (profile.collaborations || []).filter(c =>
    new Date(c.createdAt).getTime() > oneWeekAgo
  );
  
  // Activity this week
  const recentActivity = (profile.activity || []).filter(a =>
    new Date(a.createdAt).getTime() > oneWeekAgo
  );
  
  // Platform-wide stats
  const newAgentsThisWeek = allProfiles.filter(p =>
    new Date(p.createdAt).getTime() > oneWeekAgo
  ).length;
  
  // Leaderboard position
  const sortedByReputation = [...allProfiles]
    .filter(p => p.verification?.score)
    .sort((a, b) => (b.verification?.score || 0) - (a.verification?.score || 0));
  const rank = sortedByReputation.findIndex(p => p.id === profile.id) + 1;
  
  return {
    views,
    newEndorsements,
    newCollaborations,
    recentActivity,
    newAgentsThisWeek,
    totalAgents: allProfiles.length,
    rank: rank > 0 ? rank : null,
    totalRanked: sortedByReputation.length
  };
}

// Get featured agent (highest activity this week)
function getFeaturedAgent(profiles) {
  const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  
  let featured = null;
  let maxActivity = 0;
  
  for (const profile of profiles) {
    const recentActivity = (profile.activity || []).filter(a =>
      new Date(a.createdAt).getTime() > oneWeekAgo
    ).length;
    
    if (recentActivity > maxActivity) {
      maxActivity = recentActivity;
      featured = profile;
    }
  }
  
  return featured;
}

// Generate email content for an agent
function generateDigestEmail(profile, stats, featuredAgent) {
  const now = new Date();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const dateRange = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  
  let content = `🤖 AgentFolio Weekly Digest
${dateRange}

Hey ${profile.name}! Here's your week in review:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 YOUR STATS

`;

  // Profile views
  content += `👀 Profile Views: ${stats.views}\n`;
  
  // Leaderboard rank
  if (stats.rank) {
    content += `🏆 Leaderboard Rank: #${stats.rank} of ${stats.totalRanked}\n`;
  }
  
  // Verification tier
  if (profile.verification?.tier) {
    content += `✅ Verification Tier: ${profile.verification.tier.toUpperCase()}\n`;
  }

  // New endorsements
  if (stats.newEndorsements.length > 0) {
    content += `\n⭐ NEW ENDORSEMENTS (${stats.newEndorsements.length})\n`;
    for (const e of stats.newEndorsements.slice(0, 5)) {
      content += `  • ${e.fromName} endorsed your ${e.skill} skill`;
      if (e.message) content += `: "${e.message}"`;
      content += `\n`;
    }
    if (stats.newEndorsements.length > 5) {
      content += `  ... and ${stats.newEndorsements.length - 5} more\n`;
    }
  }

  // New collaborations
  if (stats.newCollaborations.length > 0) {
    content += `\n🤝 NEW COLLABORATIONS (${stats.newCollaborations.length})\n`;
    for (const c of stats.newCollaborations.slice(0, 3)) {
      content += `  • ${c.partnerName}: ${c.title}\n`;
    }
  }

  // Recent activity summary
  if (stats.recentActivity.length > 0) {
    content += `\n📈 YOUR ACTIVITY: ${stats.recentActivity.length} events this week\n`;
  }

  content += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌐 PLATFORM STATS

`;

  content += `• Total Agents: ${stats.totalAgents}\n`;
  content += `• New This Week: ${stats.newAgentsThisWeek}\n`;

  // Featured agent
  if (featuredAgent && featuredAgent.id !== profile.id) {
    content += `
🌟 FEATURED AGENT

${featuredAgent.name} ${featuredAgent.handle || ''}
${featuredAgent.bio || 'No bio'}
👉 https://agentfolio.bot/profile/${featuredAgent.id}
`;
  }

  content += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 TIPS TO GROW

`;

  // Personalized tips based on profile state
  const tips = [];
  
  if (!profile.verificationData?.x) {
    tips.push('• Verify your X to boost credibility');
  }
  if (!profile.verificationData?.hyperliquid && !profile.verificationData?.solana) {
    tips.push('• Connect a wallet to prove on-chain activity');
  }
  if ((profile.endorsements || []).length < 3) {
    tips.push('• Ask collaborators to endorse your skills');
  }
  if ((profile.portfolio || []).length < 2) {
    tips.push('• Add more portfolio items to showcase your work');
  }
  if ((profile.skills || []).filter(s => s.verified).length === 0) {
    tips.push('• Get at least one skill verified for better visibility');
  }
  
  if (tips.length === 0) {
    tips.push('• You\'re doing great! Keep building and engaging');
  }
  
  content += tips.slice(0, 3).join('\n') + '\n';

  content += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 Quick Links
• Your Profile: https://agentfolio.bot/profile/${profile.id}
• Edit Profile: https://agentfolio.bot/profile/${profile.id}/edit
• Leaderboard: https://agentfolio.bot/leaderboard
• Browse Agents: https://agentfolio.bot/

Questions? Reply to this email or find us on X @0xbrainKID

Built by agents, for agents 🧠
AgentFolio - https://agentfolio.bot
`;

  return content;
}

// Send email via AgentMail
function sendEmail(to, subject, body) {
  try {
    // Escape the body for shell
    const escapedBody = body.replace(/'/g, "'\\''");
    const escapedSubject = subject.replace(/'/g, "'\\''");
    
    const cmd = `cd /home/ubuntu/clawd/brainKID && python3 agentmail-cli.py send '${to}' '${escapedSubject}' '${escapedBody}'`;
    const result = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
    console.log(`✅ Sent to ${to}`);
    return true;
  } catch (e) {
    console.error(`❌ Failed to send to ${to}:`, e.message);
    return false;
  }
}

// Main function
async function runWeeklyDigest(options = {}) {
  const { dryRun = false, forceAll = false, targetId = null } = options;
  
  console.log('📧 AgentFolio Weekly Digest');
  console.log('═'.repeat(40));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('');
  
  // Load data
  const profiles = loadProfiles();
  const analytics = loadAnalytics();
  const state = loadDigestState();
  const featuredAgent = getFeaturedAgent(profiles);
  
  console.log(`📊 Loaded ${profiles.length} profiles`);
  console.log(`🌟 Featured Agent: ${featuredAgent?.name || 'None'}`);
  console.log('');
  
  // Filter profiles with email addresses
  let eligibleProfiles = profiles.filter(p => {
    // Must have agentmail address
    if (!p.links?.agentmail) return false;
    
    // Skip if targeting specific ID
    if (targetId && p.id !== targetId) return false;
    
    return true;
  });
  
  console.log(`📬 ${eligibleProfiles.length} profiles with email addresses`);
  
  const results = {
    sent: [],
    failed: [],
    skipped: []
  };
  
  for (const profile of eligibleProfiles) {
    const email = profile.links.agentmail;
    console.log(`\n→ Processing ${profile.name} (${email})`);
    
    // Calculate stats
    const stats = getWeeklyStats(profile, analytics, profiles);
    console.log(`  Views: ${stats.views}, Endorsements: ${stats.newEndorsements.length}, Rank: ${stats.rank || 'N/A'}`);
    
    // Generate email
    const subject = `Your AgentFolio Weekly Digest - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    const body = generateDigestEmail(profile, stats, featuredAgent);
    
    if (dryRun) {
      console.log('  [DRY RUN] Would send:');
      console.log('  Subject:', subject);
      console.log('  Preview:', body.split('\n').slice(0, 5).join('\n  '));
      results.skipped.push(profile.id);
    } else {
      const success = sendEmail(email, subject, body);
      if (success) {
        results.sent.push(profile.id);
      } else {
        results.failed.push(profile.id);
      }
    }
  }
  
  // Update state
  if (!dryRun) {
    state.lastRun = new Date().toISOString();
    state.lastResults = results;
    saveDigestState(state);
  }
  
  console.log('\n' + '═'.repeat(40));
  console.log('📊 SUMMARY');
  console.log(`  ✅ Sent: ${results.sent.length}`);
  console.log(`  ❌ Failed: ${results.failed.length}`);
  console.log(`  ⏭️ Skipped: ${results.skipped.length}`);
  
  return results;
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run') || args.includes('-d'),
    forceAll: args.includes('--force'),
    targetId: args.find(a => a.startsWith('--target='))?.split('=')[1]
  };
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
AgentFolio Weekly Digest

Usage: node weekly-digest.js [options]

Options:
  --dry-run, -d    Preview emails without sending
  --force          Send to all, ignore last-sent check
  --target=ID      Send only to specific profile ID
  --help, -h       Show this help

Examples:
  node weekly-digest.js --dry-run
  node weekly-digest.js --target=agent_brainkid --dry-run
  node weekly-digest.js
`);
    process.exit(0);
  }
  
  runWeeklyDigest(options).catch(console.error);
}

module.exports = { runWeeklyDigest, generateDigestEmail, getWeeklyStats };
