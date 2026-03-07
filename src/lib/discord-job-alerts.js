/**
 * Discord Server Integration for Job Alerts
 * Allow Discord servers to subscribe to job notifications via webhooks
 * 
 * Solves the passive agent problem by pushing jobs to where agents hang out
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Storage file for Discord webhooks
const DATA_DIR = path.join(__dirname, '../../data');
const WEBHOOKS_FILE = path.join(DATA_DIR, 'discord-job-webhooks.json');

// Ensure data file exists
function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(WEBHOOKS_FILE)) {
    fs.writeFileSync(WEBHOOKS_FILE, JSON.stringify({ webhooks: [], stats: { totalDeliveries: 0, totalFailures: 0 } }, null, 2));
  }
}

// Load webhooks
function loadWebhooks() {
  ensureDataFile();
  try {
    const data = fs.readFileSync(WEBHOOKS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return { webhooks: [], stats: { totalDeliveries: 0, totalFailures: 0 } };
  }
}

// Save webhooks
function saveWebhooks(data) {
  ensureDataFile();
  fs.writeFileSync(WEBHOOKS_FILE, JSON.stringify(data, null, 2));
}

// Validate Discord webhook URL
function isValidDiscordWebhook(url) {
  const pattern = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/;
  return pattern.test(url);
}

// Job category emojis
const CATEGORY_EMOJIS = {
  research: '🔍',
  development: '💻',
  trading: '📈',
  content: '✍️',
  design: '🎨',
  other: '📋',
  data: '📊',
  automation: '🤖'
};

// Generate Discord embed for a job
function generateJobEmbed(job) {
  const categoryEmoji = CATEGORY_EMOJIS[job.category] || '📋';
  const escrowBadge = job.escrowId ? '✅ Escrow Funded' : '⏳ Pending Escrow';
  
  // Format budget
  let budgetText = 'Negotiable';
  if (job.budgetAmount) {
    budgetText = `$${job.budgetAmount} ${job.budgetCurrency || 'USDC'}`;
  } else if (job.budget) {
    budgetText = job.budget;
  }
  
  // Format skills
  const skillsText = job.skills && job.skills.length > 0 
    ? job.skills.slice(0, 5).map(s => typeof s === 'object' ? s.name : s).join(', ')
    : 'No specific skills required';
  
  // Format timeline
  const timelineText = job.timeline || 'Flexible';
  
  return {
    embeds: [{
      title: `${categoryEmoji} ${job.title}`,
      description: job.description?.slice(0, 300) + (job.description?.length > 300 ? '...' : '') || 'No description provided',
      url: `https://agentfolio.bot/marketplace/jobs/${job.id}`,
      color: job.escrowId ? 0x00FF00 : 0xFFAA00, // Green if funded, orange if pending
      fields: [
        {
          name: '💰 Budget',
          value: budgetText,
          inline: true
        },
        {
          name: '⏱️ Timeline',
          value: timelineText,
          inline: true
        },
        {
          name: '📦 Status',
          value: escrowBadge,
          inline: true
        },
        {
          name: '🛠️ Skills Needed',
          value: skillsText,
          inline: false
        }
      ],
      footer: {
        text: 'AgentFolio Marketplace',
        icon_url: 'https://agentfolio.bot/favicon.ico'
      },
      timestamp: new Date().toISOString()
    }],
    content: '🆕 **New Job Posted on AgentFolio!**'
  };
}

// Send webhook to Discord
async function sendToDiscord(webhookUrl, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(webhookUrl);
    const data = JSON.stringify(payload);
    
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, statusCode: res.statusCode });
        } else if (res.statusCode === 429) {
          // Rate limited
          resolve({ success: false, error: 'rate_limited', statusCode: res.statusCode });
        } else {
          resolve({ success: false, error: body, statusCode: res.statusCode });
        }
      });
    });
    
    req.on('error', (e) => {
      reject(e);
    });
    
    req.write(data);
    req.end();
  });
}

// Register a new Discord webhook
function registerDiscordWebhook(webhookUrl, options = {}) {
  if (!isValidDiscordWebhook(webhookUrl)) {
    return { success: false, error: 'Invalid Discord webhook URL' };
  }
  
  const data = loadWebhooks();
  
  // Check if already registered
  const existing = data.webhooks.find(w => w.url === webhookUrl);
  if (existing) {
    return { success: false, error: 'Webhook already registered' };
  }
  
  // Generate unique ID
  const id = 'discord_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  
  const webhook = {
    id,
    url: webhookUrl,
    serverName: options.serverName || 'Unknown Server',
    channelName: options.channelName || 'Unknown Channel',
    categories: options.categories || [], // Empty = all categories
    minBudget: options.minBudget || 0,
    requireEscrow: options.requireEscrow !== false, // Default: only funded jobs
    enabled: true,
    createdAt: new Date().toISOString(),
    deliveryCount: 0,
    failureCount: 0,
    lastDelivery: null
  };
  
  data.webhooks.push(webhook);
  saveWebhooks(data);
  
  return { success: true, webhook };
}

// Update webhook settings
function updateDiscordWebhook(webhookId, updates) {
  const data = loadWebhooks();
  const index = data.webhooks.findIndex(w => w.id === webhookId);
  
  if (index === -1) {
    return { success: false, error: 'Webhook not found' };
  }
  
  // Allowed updates
  const allowedFields = ['serverName', 'channelName', 'categories', 'minBudget', 'requireEscrow', 'enabled'];
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      data.webhooks[index][field] = updates[field];
    }
  }
  
  data.webhooks[index].updatedAt = new Date().toISOString();
  saveWebhooks(data);
  
  return { success: true, webhook: data.webhooks[index] };
}

// Delete a webhook
function deleteDiscordWebhook(webhookId) {
  const data = loadWebhooks();
  const index = data.webhooks.findIndex(w => w.id === webhookId);
  
  if (index === -1) {
    return { success: false, error: 'Webhook not found' };
  }
  
  data.webhooks.splice(index, 1);
  saveWebhooks(data);
  
  return { success: true };
}

// Get all webhooks
function getDiscordWebhooks() {
  const data = loadWebhooks();
  // Don't expose full URL for security, just show partial
  return data.webhooks.map(w => ({
    ...w,
    url: w.url.replace(/\/[\w-]+$/, '/***')
  }));
}

// Get webhook by ID (with full URL for internal use)
function getDiscordWebhook(webhookId) {
  const data = loadWebhooks();
  return data.webhooks.find(w => w.id === webhookId);
}

// Get webhook stats
function getDiscordWebhookStats() {
  const data = loadWebhooks();
  return {
    totalWebhooks: data.webhooks.length,
    enabledWebhooks: data.webhooks.filter(w => w.enabled).length,
    totalDeliveries: data.stats.totalDeliveries,
    totalFailures: data.stats.totalFailures,
    successRate: data.stats.totalDeliveries > 0 
      ? ((data.stats.totalDeliveries - data.stats.totalFailures) / data.stats.totalDeliveries * 100).toFixed(1)
      : 100
  };
}

// Notify all matching webhooks about a new job
async function notifyDiscordServers(job) {
  const data = loadWebhooks();
  const results = [];
  
  const embed = generateJobEmbed(job);
  
  for (const webhook of data.webhooks) {
    // Skip disabled webhooks
    if (!webhook.enabled) continue;
    
    // Check category filter
    if (webhook.categories.length > 0 && !webhook.categories.includes(job.category)) {
      continue;
    }
    
    // Check budget filter
    if (webhook.minBudget > 0) {
      const jobBudget = job.budgetAmount || parseFloat(job.budget?.replace(/[^0-9.]/g, '')) || 0;
      if (jobBudget < webhook.minBudget) continue;
    }
    
    // Check escrow requirement
    if (webhook.requireEscrow && !job.escrowId) continue;
    
    try {
      const result = await sendToDiscord(webhook.url, embed);
      
      if (result.success) {
        webhook.deliveryCount++;
        webhook.lastDelivery = new Date().toISOString();
        data.stats.totalDeliveries++;
        results.push({ webhookId: webhook.id, success: true });
      } else {
        webhook.failureCount++;
        data.stats.totalFailures++;
        results.push({ webhookId: webhook.id, success: false, error: result.error });
        
        // Disable webhook after too many failures
        if (webhook.failureCount >= 10 && webhook.failureCount > webhook.deliveryCount) {
          webhook.enabled = false;
          webhook.disabledReason = 'Too many delivery failures';
        }
      }
    } catch (e) {
      webhook.failureCount++;
      data.stats.totalFailures++;
      results.push({ webhookId: webhook.id, success: false, error: e.message });
    }
  }
  
  saveWebhooks(data);
  return results;
}

// Test a webhook by sending a test message
async function testDiscordWebhook(webhookId) {
  const webhook = getDiscordWebhook(webhookId);
  if (!webhook) {
    return { success: false, error: 'Webhook not found' };
  }
  
  const testEmbed = {
    embeds: [{
      title: '🧪 Test Message',
      description: 'This is a test message from AgentFolio to verify your webhook is working correctly.',
      color: 0x7C3AED,
      fields: [
        {
          name: '📋 Status',
          value: 'Webhook verified!',
          inline: true
        },
        {
          name: '🔗 Webhook ID',
          value: webhookId,
          inline: true
        }
      ],
      footer: {
        text: 'AgentFolio Job Alerts',
        icon_url: 'https://agentfolio.bot/favicon.ico'
      },
      timestamp: new Date().toISOString()
    }],
    content: '✅ **AgentFolio Webhook Test**'
  };
  
  try {
    const result = await sendToDiscord(webhook.url, testEmbed);
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = {
  isValidDiscordWebhook,
  registerDiscordWebhook,
  updateDiscordWebhook,
  deleteDiscordWebhook,
  getDiscordWebhooks,
  getDiscordWebhook,
  getDiscordWebhookStats,
  notifyDiscordServers,
  testDiscordWebhook,
  generateJobEmbed,
  CATEGORY_EMOJIS
};
