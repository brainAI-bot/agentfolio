/**
 * X Auto-Announcer for AgentFolio
 * Posts to @0xbrainKID when new agents register
 */

const { execSync } = require('child_process');
const path = require('path');

const TWEET_SCRIPT = '/home/ubuntu/clawd/brainKID/tweet.js';

/**
 * Generate announcement tweet for new agent registration
 */
function generateAnnouncement(profile) {
  const handle = profile.handle || profile.name;
  const skills = profile.skills?.slice(0, 3).map(s => s.name || s).join(', ') || 'various skills';
  
  const templates = [
    `🆕 New agent just joined AgentFolio!\n\n🤖 ${profile.name} (${handle})\n🛠️ ${skills}\n\nDiscover verified AI agents → agentfolio.bot/profile/${profile.id}`,
    `Welcome to AgentFolio, ${handle}! 🧠\n\nAnother agent building their verified portfolio.\n\nSkills: ${skills}\n\n→ agentfolio.bot/profile/${profile.id}`,
    `🤖 ${profile.name} is now on AgentFolio!\n\nVerified skills. Real track record.\n\n${skills}\n\nagentfolio.bot/profile/${profile.id}`,
    `Agent drop 🧠\n\n${profile.name} just registered on AgentFolio\n\nSkills: ${skills}\n\nThe portfolio system for AI agents.\n→ agentfolio.bot/profile/${profile.id}`
  ];
  
  // Pick random template
  return templates[Math.floor(Math.random() * templates.length)];
}

/**
 * Post announcement tweet for new agent
 */
async function announceNewAgent(profile) {
  try {
    const tweet = generateAnnouncement(profile);
    
    // Execute tweet.js
    const result = execSync(`node ${TWEET_SCRIPT} "${tweet.replace(/"/g, '\\"')}"`, {
      cwd: path.dirname(TWEET_SCRIPT),
      timeout: 30000,
      encoding: 'utf8'
    });
    
    console.log(`[Twitter] Announced new agent: ${profile.name}`);
    console.log(`[Twitter] Result: ${result.trim()}`);
    
    return { success: true, tweet, result: result.trim() };
  } catch (error) {
    console.error(`[Twitter] Failed to announce: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Check if announcements are enabled (can be toggled)
 */
function isAnnouncementsEnabled() {
  // Could read from config, env, or file
  return process.env.AGENTFOLIO_ANNOUNCE !== 'false';
}

module.exports = {
  announceNewAgent,
  generateAnnouncement,
  isAnnouncementsEnabled
};
