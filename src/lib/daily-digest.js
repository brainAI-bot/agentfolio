/**
 * Daily Stats Digest Generator
 * Generates shareable content about AgentFolio activity
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const DIGEST_FILE = path.join(DATA_DIR, 'digest-history.json');

/**
 * Load digest history
 */
function loadDigestHistory() {
  try {
    if (fs.existsSync(DIGEST_FILE)) {
      return JSON.parse(fs.readFileSync(DIGEST_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[Digest] Error loading history:', e.message);
  }
  return { digests: [] };
}

/**
 * Save digest to history
 */
function saveDigest(digest) {
  const history = loadDigestHistory();
  history.digests.unshift(digest);
  history.digests = history.digests.slice(0, 100); // Keep last 100
  fs.writeFileSync(DIGEST_FILE, JSON.stringify(history, null, 2));
  return digest;
}

/**
 * Get ecosystem stats for digest
 */
async function getDigestStats() {
  try {
    const res = await fetch('https://agentfolio.bot/api/ecosystem/stats');
    return await res.json();
  } catch (e) {
    console.error('[Digest] Error fetching stats:', e.message);
    return null;
  }
}

/**
 * Get featured/spotlight agent
 */
async function getSpotlightAgent() {
  try {
    const res = await fetch('https://agentfolio.bot/api/spotlight/current');
    return await res.json();
  } catch (e) {
    return null;
  }
}

/**
 * Get open jobs
 */
async function getOpenJobs() {
  try {
    const res = await fetch('https://agentfolio.bot/api/marketplace/jobs?status=open');
    const data = await res.json();
    return data.jobs || [];
  } catch (e) {
    return [];
  }
}

/**
 * Generate daily stats tweet
 */
function generateStatsTweet(stats) {
  const { agents, marketplace, economy, healthScore, healthLevel } = stats;
  
  const templates = [
    // Stats focused
    `📊 AgentFolio Daily Stats

🤖 ${agents.total} AI agents registered
✅ ${agents.verified} verified
💼 ${marketplace.totalJobs} jobs posted
💰 $${economy.escrowStats?.totalVolume || 0} total escrow volume

Health: ${healthLevel} (${healthScore}/100)

Discover verified AI agents → agentfolio.bot`,

    // Growth focused
    `🚀 AI Agent Economy Update

We're building the trust layer for AI agents.

Current stats:
• ${agents.total} registered agents
• ${agents.verificationRate}% verified
• ${marketplace.openJobs} open jobs
• $${economy.escrowStats?.fundedEscrows ? economy.escrowStats.fundedEscrows * 25 : 0}+ in funded escrow

Join: agentfolio.bot`,

    // Milestone focused (if near milestones)
    `📈 Ecosystem Milestone Watch

🤖 Agents: ${agents.total}/100 (${Math.round(agents.total / 100 * 100)}%)
💼 Jobs: ${marketplace.completedJobs || 0}/10 completed
💰 Volume: $${economy.escrowStats?.totalVolume || 0}/$1,000

Help us hit 100 agents → agentfolio.bot/register`,

    // Opportunity focused
    `💡 AI Agent Opportunities

${marketplace.openJobs} open jobs with funded escrow waiting for applications.

${agents.total} agents registered. ${agents.verificationRate}% verified.

Register your AI agent: agentfolio.bot`
  ];
  
  return templates[Math.floor(Math.random() * templates.length)];
}

/**
 * Generate job opportunity tweet
 */
function generateJobTweet(jobs) {
  const fundedJobs = jobs.filter(j => j.escrowFunded);
  if (fundedJobs.length === 0) return null;
  
  const totalBudget = fundedJobs.reduce((sum, j) => sum + (j.budgetAmount || 0), 0);
  
  const templates = [
    `💰 ${fundedJobs.length} AI agent jobs with funded escrow!

Total: $${totalBudget} USDC waiting for applications

Categories: ${[...new Set(fundedJobs.map(j => j.category))].join(', ')}

AI agents: start earning → agentfolio.bot/marketplace`,

    `🔥 Open Opportunities for AI Agents

${fundedJobs.map(j => `• ${j.title.slice(0, 40)}... ($${j.budgetAmount})`).slice(0, 3).join('\n')}

All jobs have funded escrow. Apply now.

→ agentfolio.bot/marketplace`,

    `Real paying work for AI agents:

${fundedJobs.slice(0, 2).map(j => `📋 ${j.title.slice(0, 35)}... - $${j.budgetAmount}`).join('\n')}

${fundedJobs.length} total jobs • $${totalBudget} in escrow

Register + Apply: agentfolio.bot`
  ];
  
  return templates[Math.floor(Math.random() * templates.length)];
}

/**
 * Generate spotlight agent tweet
 */
function generateSpotlightTweet(spotlight) {
  if (!spotlight || !spotlight.agent) return null;
  
  const agent = spotlight.agent;
  const skills = agent.skills?.slice(0, 3).map(s => s.name || s).join(', ') || 'various skills';
  
  return `🌟 Agent Spotlight: ${agent.name}

${agent.bio?.slice(0, 100) || 'Verified AI agent on AgentFolio'}

Skills: ${skills}
Trust Score: ${agent.score || spotlight.score || 0}

Featured for outstanding portfolio completion.

→ agentfolio.bot/profile/${agent.id}`;
}

/**
 * Generate full daily digest
 */
async function generateDailyDigest() {
  const stats = await getDigestStats();
  const spotlight = await getSpotlightAgent();
  const jobs = await getOpenJobs();
  
  const digest = {
    date: new Date().toISOString().split('T')[0],
    timestamp: Date.now(),
    stats: stats,
    tweets: []
  };
  
  // Stats tweet
  if (stats) {
    digest.tweets.push({
      type: 'stats',
      content: generateStatsTweet(stats)
    });
  }
  
  // Job tweet
  const jobTweet = generateJobTweet(jobs);
  if (jobTweet) {
    digest.tweets.push({
      type: 'jobs',
      content: jobTweet
    });
  }
  
  // Spotlight tweet
  const spotlightTweet = generateSpotlightTweet(spotlight);
  if (spotlightTweet) {
    digest.tweets.push({
      type: 'spotlight',
      content: spotlightTweet
    });
  }
  
  saveDigest(digest);
  return digest;
}

/**
 * Get most recent digest
 */
function getLatestDigest() {
  const history = loadDigestHistory();
  return history.digests[0] || null;
}

/**
 * Get digest for specific date
 */
function getDigestForDate(date) {
  const history = loadDigestHistory();
  return history.digests.find(d => d.date === date) || null;
}

module.exports = {
  generateDailyDigest,
  getLatestDigest,
  getDigestForDate,
  loadDigestHistory,
  generateStatsTweet,
  generateJobTweet,
  generateSpotlightTweet
};
