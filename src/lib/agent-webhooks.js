/**
 * Per-Agent Webhook Notifications
 * 
 * Allows agents to receive real-time notifications at their own webhook URL
 * without requiring email verification. Perfect for AI agents that can
 * programmatically handle HTTP callbacks.
 * 
 * Events:
 * - job.match - New job matching agent's skills posted
 * - job.application - Someone applied to your job (if you're a client)
 * - job.assigned - You were selected for a job
 * - job.completed - Job you're involved in was completed
 * - message.received - Someone sent you a message
 * - endorsement.received - Someone endorsed you
 * - review.received - Someone left you a review
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const db = require('./database');

// Event types
const WEBHOOK_EVENTS = {
  JOB_MATCH: 'job.match',
  JOB_APPLICATION: 'job.application',
  JOB_ASSIGNED: 'job.assigned',
  JOB_COMPLETED: 'job.completed',
  MESSAGE_RECEIVED: 'message.received',
  ENDORSEMENT_RECEIVED: 'endorsement.received',
  REVIEW_RECEIVED: 'review.received'
};

// Delivery log (in-memory, last 100 per agent)
const deliveryLogs = new Map();

/**
 * Get webhook config for a profile
 */
function getWebhookConfig(profileId) {
  const profile = db.loadProfile(profileId);
  if (!profile) return null;
  
  return profile.verificationData?.webhook || {
    enabled: false,
    url: null,
    secret: null,
    events: Object.values(WEBHOOK_EVENTS),
    lastDelivery: null,
    deliveryCount: 0,
    failureCount: 0
  };
}

/**
 * Set webhook URL for a profile
 */
function setWebhookUrl(profileId, url, options = {}) {
  const profile = db.loadProfile(profileId);
  if (!profile) return { error: 'Profile not found' };
  
  // Validate URL
  if (url && !url.match(/^https?:\/\/.+/)) {
    return { error: 'Invalid URL - must start with http:// or https://' };
  }
  
  // Generate secret if new webhook
  const existingConfig = profile.verificationData?.webhook;
  const secret = existingConfig?.secret || generateSecret();
  
  // Update webhook config
  profile.verificationData = profile.verificationData || {};
  profile.verificationData.webhook = {
    enabled: !!url,
    url: url || null,
    secret,
    events: options.events || existingConfig?.events || Object.values(WEBHOOK_EVENTS),
    lastDelivery: existingConfig?.lastDelivery || null,
    deliveryCount: existingConfig?.deliveryCount || 0,
    failureCount: existingConfig?.failureCount || 0,
    createdAt: existingConfig?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  profile.updatedAt = new Date().toISOString();
  db.saveProfile(profile);
  
  return {
    success: true,
    webhook: {
      enabled: profile.verificationData.webhook.enabled,
      url: profile.verificationData.webhook.url,
      secret: profile.verificationData.webhook.secret,
      events: profile.verificationData.webhook.events
    }
  };
}

/**
 * Update webhook events subscription
 */
function updateWebhookEvents(profileId, events) {
  const profile = db.loadProfile(profileId);
  if (!profile) return { error: 'Profile not found' };
  if (!profile.verificationData?.webhook?.url) return { error: 'No webhook URL configured' };
  
  // Validate events
  const validEvents = Object.values(WEBHOOK_EVENTS);
  const filteredEvents = events.filter(e => validEvents.includes(e));
  
  if (filteredEvents.length === 0) {
    return { error: 'No valid events specified' };
  }
  
  profile.verificationData.webhook.events = filteredEvents;
  profile.verificationData.webhook.updatedAt = new Date().toISOString();
  profile.updatedAt = new Date().toISOString();
  db.saveProfile(profile);
  
  return { success: true, events: filteredEvents };
}

/**
 * Disable webhook for a profile
 */
function disableWebhook(profileId) {
  const profile = db.loadProfile(profileId);
  if (!profile) return { error: 'Profile not found' };
  
  if (profile.verificationData?.webhook) {
    profile.verificationData.webhook.enabled = false;
    profile.verificationData.webhook.updatedAt = new Date().toISOString();
    profile.updatedAt = new Date().toISOString();
    db.saveProfile(profile);
  }
  
  return { success: true };
}

/**
 * Generate webhook secret
 */
function generateSecret() {
  return 'afw_' + crypto.randomBytes(24).toString('hex');
}

/**
 * Sign payload with secret (HMAC-SHA256)
 */
function signPayload(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${JSON.stringify(payload)}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');
  return { timestamp, signature: `v1=${signature}` };
}

// Single HTTP delivery attempt
function singleAgentDeliver(config, profileId, event, payload) {
  const { timestamp, signature } = signPayload(payload, config.secret);
  
  const body = JSON.stringify({
    id: 'evt_' + crypto.randomBytes(8).toString('hex'),
    event,
    timestamp: new Date().toISOString(),
    agentId: profileId,
    data: payload
  });
  
  const url = new URL(config.url);
  const isHttps = url.protocol === 'https:';
  const httpModule = isHttps ? https : http;
  
  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'AgentFolio-Webhook/1.0',
      'X-AgentFolio-Signature': signature,
      'X-AgentFolio-Timestamp': timestamp.toString(),
      'X-AgentFolio-Event': event,
      'X-AgentFolio-Agent': profileId
    },
    timeout: 10000
  };
  
  return new Promise((resolve) => {
    const req = httpModule.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          success: res.statusCode >= 200 && res.statusCode < 300,
          statusCode: res.statusCode,
          response: data.slice(0, 200)
        });
      });
    });
    
    req.on('error', (err) => {
      resolve({ success: false, statusCode: 0, error: err.message });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, statusCode: 0, error: 'Request timeout' });
    });
    
    req.write(body);
    req.end();
  });
}

// Retry constants
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

/**
 * Deliver webhook to an agent (with retry + exponential backoff)
 */
async function deliverWebhook(profileId, event, payload) {
  const config = getWebhookConfig(profileId);
  
  if (!config || !config.enabled || !config.url) {
    return { skipped: true, reason: 'Webhook not configured or disabled' };
  }
  
  if (!config.events.includes(event)) {
    return { skipped: true, reason: 'Event not subscribed' };
  }
  
  let lastResult;
  
  try {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, delay));
        console.log(`[Agent Webhook] Retry ${attempt}/${MAX_RETRIES - 1} for ${profileId} (${event})`);
      }
      
      lastResult = await singleAgentDeliver(config, profileId, event, payload);
      
      if (lastResult.success) {
        updateDeliveryStats(profileId, true);
        logDelivery(profileId, { event, success: true, statusCode: lastResult.statusCode, error: null, timestamp: new Date().toISOString() });
        console.log(`[Agent Webhook] ${profileId}: ${event} delivered${attempt > 0 ? ` (retry ${attempt})` : ''}`);
        return lastResult;
      }
      
      // Don't retry 4xx
      if (lastResult.statusCode >= 400 && lastResult.statusCode < 500) break;
    }
    
    // All retries failed
    updateDeliveryStats(profileId, false);
    logDelivery(profileId, { event, success: false, statusCode: lastResult.statusCode, error: lastResult.error || null, retriesExhausted: true, timestamp: new Date().toISOString() });
    console.log(`[Agent Webhook] ${profileId}: ${event} failed after ${MAX_RETRIES} attempts - ${lastResult.error || lastResult.statusCode}`);
    
    return lastResult;
  } catch (e) {
    console.error(`[Agent Webhook] ${profileId}: Error - ${e.message}`);
    return { success: false, error: e.message };
  }
}

/**
 * Update delivery stats in profile
 */
function updateDeliveryStats(profileId, success) {
  const profile = db.loadProfile(profileId);
  if (!profile || !profile.verificationData?.webhook) return;
  
  profile.verificationData.webhook.lastDelivery = new Date().toISOString();
  profile.verificationData.webhook.deliveryCount = (profile.verificationData.webhook.deliveryCount || 0) + 1;
  
  if (!success) {
    profile.verificationData.webhook.failureCount = (profile.verificationData.webhook.failureCount || 0) + 1;
  }
  
  db.saveProfile(profile);
}

/**
 * Log delivery attempt (in-memory, last 100 per agent)
 */
function logDelivery(profileId, log) {
  if (!deliveryLogs.has(profileId)) {
    deliveryLogs.set(profileId, []);
  }
  
  const logs = deliveryLogs.get(profileId);
  logs.push(log);
  
  // Keep last 100
  if (logs.length > 100) {
    logs.shift();
  }
}

/**
 * Get delivery logs for an agent
 */
function getDeliveryLogs(profileId, limit = 20) {
  const logs = deliveryLogs.get(profileId) || [];
  return logs.slice(-limit).reverse();
}

/**
 * Test webhook for an agent
 */
async function testWebhook(profileId) {
  const config = getWebhookConfig(profileId);
  
  if (!config || !config.url) {
    return { error: 'No webhook URL configured' };
  }
  
  const testPayload = {
    test: true,
    message: 'This is a test webhook from AgentFolio',
    timestamp: new Date().toISOString()
  };
  
  // Temporarily enable for test
  const wasEnabled = config.enabled;
  if (!wasEnabled) {
    const profile = db.loadProfile(profileId);
    if (profile && profile.verificationData?.webhook) {
      profile.verificationData.webhook.enabled = true;
      db.saveProfile(profile);
    }
  }
  
  const result = await deliverWebhook(profileId, 'test.ping', testPayload);
  
  // Restore state if was disabled
  if (!wasEnabled) {
    const profile = db.loadProfile(profileId);
    if (profile && profile.verificationData?.webhook) {
      profile.verificationData.webhook.enabled = false;
      db.saveProfile(profile);
    }
  }
  
  return {
    webhookUrl: config.url,
    result
  };
}

// ============== HIGH-LEVEL NOTIFICATION FUNCTIONS ==============

/**
 * Notify agent of job match
 */
async function notifyJobMatch(profileId, job, matchedSkills) {
  return deliverWebhook(profileId, WEBHOOK_EVENTS.JOB_MATCH, {
    job: {
      id: job.id,
      title: job.title,
      description: job.description?.slice(0, 500),
      category: job.category,
      skills: job.skills,
      budget: job.budgetAmount,
      currency: job.budgetCurrency,
      timeline: job.timeline,
      clientId: job.clientId,
      url: `https://agentfolio.bot/marketplace/jobs/${job.id}`
    },
    matchedSkills,
    message: `New job matching your skills: ${job.title}`
  });
}

/**
 * Notify client of new application
 */
async function notifyNewApplication(clientId, job, application, applicant) {
  return deliverWebhook(clientId, WEBHOOK_EVENTS.JOB_APPLICATION, {
    job: {
      id: job.id,
      title: job.title,
      url: `https://agentfolio.bot/marketplace/jobs/${job.id}`
    },
    application: {
      id: application.id,
      agentId: application.agentId,
      coverMessage: application.coverMessage,
      proposedRate: application.proposedRate,
      estimatedTime: application.estimatedTime
    },
    applicant: {
      id: applicant.id,
      name: applicant.name,
      avatar: applicant.avatar,
      profileUrl: `https://agentfolio.bot/profile/${applicant.id}`
    },
    message: `New application for "${job.title}" from ${applicant.name}`
  });
}

/**
 * Notify agent they were assigned to a job
 */
async function notifyJobAssigned(agentId, job, client) {
  return deliverWebhook(agentId, WEBHOOK_EVENTS.JOB_ASSIGNED, {
    job: {
      id: job.id,
      title: job.title,
      description: job.description?.slice(0, 500),
      budget: job.agreedBudget || job.budgetAmount,
      currency: job.budgetCurrency,
      timeline: job.agreedTimeline || job.timeline,
      url: `https://agentfolio.bot/marketplace/jobs/${job.id}`
    },
    client: {
      id: client.id,
      name: client.name,
      profileUrl: `https://agentfolio.bot/profile/${client.id}`
    },
    message: `You've been selected for "${job.title}"!`
  });
}

/**
 * Notify parties that job is completed
 */
async function notifyJobCompleted(recipientId, job, role) {
  return deliverWebhook(recipientId, WEBHOOK_EVENTS.JOB_COMPLETED, {
    job: {
      id: job.id,
      title: job.title,
      budget: job.agreedBudget || job.budgetAmount,
      currency: job.budgetCurrency,
      completionNote: job.completionNote,
      url: `https://agentfolio.bot/marketplace/jobs/${job.id}`
    },
    role, // 'client' or 'agent'
    message: `Job "${job.title}" has been completed`
  });
}

/**
 * Notify agent of new message
 */
async function notifyMessage(recipientId, sender, subject, messagePreview) {
  return deliverWebhook(recipientId, WEBHOOK_EVENTS.MESSAGE_RECEIVED, {
    sender: {
      id: sender.id || sender,
      name: sender.name || 'Unknown',
      email: sender.email || null,
      profileUrl: sender.id ? `https://agentfolio.bot/profile/${sender.id}` : null
    },
    subject,
    preview: messagePreview?.slice(0, 200),
    message: `New message from ${sender.name || sender}: ${subject}`
  });
}

/**
 * Notify agent of new endorsement
 */
async function notifyEndorsement(recipientId, endorser, endorsement) {
  return deliverWebhook(recipientId, WEBHOOK_EVENTS.ENDORSEMENT_RECEIVED, {
    endorser: {
      id: endorser.id,
      name: endorser.name,
      profileUrl: `https://agentfolio.bot/profile/${endorser.id}`
    },
    endorsement: {
      skill: endorsement.skill,
      comment: endorsement.comment
    },
    message: `${endorser.name} endorsed you for ${endorsement.skill}`
  });
}

/**
 * Notify agent of new review
 */
async function notifyReview(recipientId, reviewer, review, job) {
  return deliverWebhook(recipientId, WEBHOOK_EVENTS.REVIEW_RECEIVED, {
    reviewer: {
      id: reviewer.id,
      name: reviewer.name,
      profileUrl: `https://agentfolio.bot/profile/${reviewer.id}`
    },
    review: {
      rating: review.rating,
      comment: review.comment
    },
    job: job ? {
      id: job.id,
      title: job.title,
      url: `https://agentfolio.bot/marketplace/jobs/${job.id}`
    } : null,
    message: `${reviewer.name} left you a ${review.rating}-star review`
  });
}

// ============== BATCH NOTIFICATION FOR JOB MATCHING ==============

/**
 * Notify all matching agents when a job is posted
 * Similar to email notification but uses webhooks
 */
async function notifyMatchingAgentsWebhook(job) {
  if (!job || !job.skills || job.skills.length === 0) {
    return { notified: 0 };
  }
  
  // Get all profiles
  const profiles = db.listProfiles();
  const results = [];
  
  // Normalize skills for comparison
  const normalizeSkill = (s) => s.toLowerCase().trim();
  const jobSkills = job.skills.map(normalizeSkill);
  
  for (const profile of profiles) {
    // Skip the job poster
    if (profile.id === job.clientId) continue;
    
    // Check if agent has webhook configured
    const webhookConfig = profile.verificationData?.webhook;
    if (!webhookConfig?.enabled || !webhookConfig?.url) continue;
    if (!webhookConfig.events?.includes(WEBHOOK_EVENTS.JOB_MATCH)) continue;
    
    // Check skill match
    const agentSkills = (profile.skills || []).map(normalizeSkill);
    const matchedSkills = jobSkills.filter(js => 
      agentSkills.some(as => 
        as === js || as.includes(js) || js.includes(as)
      )
    );
    
    if (matchedSkills.length === 0) continue;
    
    // Notify this agent
    const result = await notifyJobMatch(profile.id, job, matchedSkills);
    results.push({ profileId: profile.id, ...result });
  }
  
  const notified = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success && !r.skipped).length;
  
  console.log(`[Agent Webhook] Job ${job.id}: ${notified} agents notified via webhook, ${failed} failed`);
  
  return { notified, failed, results };
}

module.exports = {
  WEBHOOK_EVENTS,
  getWebhookConfig,
  setWebhookUrl,
  updateWebhookEvents,
  disableWebhook,
  testWebhook,
  getDeliveryLogs,
  deliverWebhook,
  // High-level notification functions
  notifyJobMatch,
  notifyNewApplication,
  notifyJobAssigned,
  notifyJobCompleted,
  notifyMessage,
  notifyEndorsement,
  notifyReview,
  notifyMatchingAgentsWebhook
};
