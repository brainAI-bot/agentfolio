/**
 * Webhook System for AgentFolio
 * Notify external services on agent events
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const WEBHOOKS_FILE = path.join(__dirname, '../../data/webhooks.json');
const WEBHOOK_LOG_FILE = path.join(__dirname, '../../data/webhook-logs.json');

// Supported events
const EVENTS = {
  AGENT_REGISTERED: 'agent.registered',
  AGENT_VERIFIED: 'agent.verified',
  VERIFICATION_TWITTER: 'verification.twitter',
  VERIFICATION_HYPERLIQUID: 'verification.hyperliquid',
  VERIFICATION_SOLANA: 'verification.solana',
  ENDORSEMENT_ADDED: 'endorsement.added',
  PROFILE_UPDATED: 'profile.updated'
};

// Load webhooks from disk
function loadWebhooks() {
  try {
    if (fs.existsSync(WEBHOOKS_FILE)) {
      return JSON.parse(fs.readFileSync(WEBHOOKS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[Webhooks] Load error:', e.message);
  }
  return [];
}

// Save webhooks to disk
function saveWebhooks(webhooks) {
  const dir = path.dirname(WEBHOOKS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(WEBHOOKS_FILE, JSON.stringify(webhooks, null, 2));
}

// Load delivery logs
function loadLogs() {
  try {
    if (fs.existsSync(WEBHOOK_LOG_FILE)) {
      return JSON.parse(fs.readFileSync(WEBHOOK_LOG_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

// Save delivery logs (keep last 500)
function saveLogs(logs) {
  const trimmed = logs.slice(-500);
  fs.writeFileSync(WEBHOOK_LOG_FILE, JSON.stringify(trimmed, null, 2));
}

// Generate webhook secret
function generateSecret() {
  return 'whsec_' + crypto.randomBytes(24).toString('hex');
}

// Generate webhook ID
function generateId() {
  return 'wh_' + crypto.randomBytes(12).toString('hex');
}

// Sign payload with secret (HMAC-SHA256)
function signPayload(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${JSON.stringify(payload)}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');
  return { timestamp, signature: `v1=${signature}` };
}

// Register a new webhook
function registerWebhook(url, events = [], options = {}) {
  if (!url || !url.startsWith('http')) {
    return { error: 'Invalid URL' };
  }
  
  // Validate events
  const validEvents = Object.values(EVENTS);
  const selectedEvents = events.length > 0 
    ? events.filter(e => validEvents.includes(e))
    : validEvents; // Subscribe to all if none specified
  
  if (selectedEvents.length === 0) {
    return { error: 'No valid events specified' };
  }
  
  const webhooks = loadWebhooks();
  
  // Check for duplicate URL
  if (webhooks.find(w => w.url === url && w.active)) {
    return { error: 'Webhook URL already registered' };
  }
  
  const webhook = {
    id: generateId(),
    url,
    events: selectedEvents,
    secret: generateSecret(),
    active: true,
    createdAt: new Date().toISOString(),
    description: options.description || '',
    deliveries: 0,
    failures: 0,
    lastDelivery: null
  };
  
  webhooks.push(webhook);
  saveWebhooks(webhooks);
  
  return { webhook };
}

// List all webhooks (redact secrets by default)
function listWebhooks(showSecrets = false) {
  const webhooks = loadWebhooks();
  return webhooks.map(w => ({
    ...w,
    secret: showSecrets ? w.secret : w.secret.slice(0, 12) + '...'
  }));
}

// Get a specific webhook
function getWebhook(id, showSecret = false) {
  const webhooks = loadWebhooks();
  const webhook = webhooks.find(w => w.id === id);
  if (!webhook) return null;
  
  return {
    ...webhook,
    secret: showSecret ? webhook.secret : webhook.secret.slice(0, 12) + '...'
  };
}

// Delete a webhook
function deleteWebhook(id) {
  const webhooks = loadWebhooks();
  const index = webhooks.findIndex(w => w.id === id);
  
  if (index === -1) {
    return { error: 'Webhook not found' };
  }
  
  webhooks.splice(index, 1);
  saveWebhooks(webhooks);
  
  return { success: true };
}

// Toggle webhook active state
function toggleWebhook(id) {
  const webhooks = loadWebhooks();
  const webhook = webhooks.find(w => w.id === id);
  
  if (!webhook) {
    return { error: 'Webhook not found' };
  }
  
  webhook.active = !webhook.active;
  saveWebhooks(webhooks);
  
  return { webhook };
}

// Dead letter queue (failed deliveries after all retries)
const DEAD_LETTER_FILE = path.join(__dirname, '../../data/webhook-dead-letters.json');

function loadDeadLetters() {
  try {
    if (fs.existsSync(DEAD_LETTER_FILE)) {
      return JSON.parse(fs.readFileSync(DEAD_LETTER_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveDeadLetters(letters) {
  const trimmed = letters.slice(-200);
  fs.writeFileSync(DEAD_LETTER_FILE, JSON.stringify(trimmed, null, 2));
}

function addToDeadLetter(webhook, event, payload, lastError) {
  const letters = loadDeadLetters();
  letters.push({
    id: 'dl_' + crypto.randomBytes(8).toString('hex'),
    webhookId: webhook.id,
    webhookUrl: webhook.url,
    event,
    payload,
    lastError,
    failedAt: new Date().toISOString(),
    retryCount: 3
  });
  saveDeadLetters(letters);
}

function getDeadLetters(webhookId, limit = 20) {
  const letters = loadDeadLetters();
  const filtered = webhookId ? letters.filter(l => l.webhookId === webhookId) : letters;
  return filtered.slice(-limit).reverse();
}

function clearDeadLetters(webhookId) {
  if (!webhookId) {
    saveDeadLetters([]);
    return { cleared: true };
  }
  const letters = loadDeadLetters();
  const remaining = letters.filter(l => l.webhookId !== webhookId);
  saveDeadLetters(remaining);
  return { cleared: true };
}

// Single HTTP delivery attempt
function singleDeliver(webhook, event, payload) {
  const { timestamp, signature } = signPayload(payload, webhook.secret);
  
  const body = JSON.stringify({
    id: 'evt_' + crypto.randomBytes(8).toString('hex'),
    event,
    timestamp: new Date().toISOString(),
    data: payload
  });
  
  const url = new URL(webhook.url);
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
      'X-AgentFolio-Event': event
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

// Deliver with retry + exponential backoff (max 3 attempts: 0s, 2s, 8s)
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

async function deliverWebhook(webhook, event, payload) {
  let lastResult;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1); // 2s, 4s (but we cap at 3 retries)
      await new Promise(r => setTimeout(r, delay));
      console.log(`[Webhooks] Retry ${attempt}/${MAX_RETRIES - 1} for ${webhook.url} (${event})`);
    }
    
    lastResult = await singleDeliver(webhook, event, payload);
    
    if (lastResult.success) return lastResult;
    
    // Don't retry on 4xx (client errors) — only retry on 5xx / network errors
    if (lastResult.statusCode >= 400 && lastResult.statusCode < 500) {
      break;
    }
  }
  
  // All retries exhausted — add to dead letter queue
  addToDeadLetter(webhook, event, payload, lastResult.error || `HTTP ${lastResult.statusCode}`);
  console.log(`[Webhooks] Dead-lettered: ${webhook.url} ${event} after ${MAX_RETRIES} attempts`);
  
  return lastResult;
}

// Update webhook properties
function updateWebhook(id, updates) {
  const webhooks = loadWebhooks();
  const webhook = webhooks.find(w => w.id === id);
  
  if (!webhook) {
    return { error: 'Webhook not found' };
  }
  
  // Allowed fields to update
  if (updates.url !== undefined) {
    if (!updates.url.startsWith('http')) return { error: 'Invalid URL' };
    webhook.url = updates.url;
  }
  if (updates.events !== undefined) {
    const validEvents = Object.values(EVENTS);
    webhook.events = updates.events.filter(e => validEvents.includes(e));
    if (webhook.events.length === 0) return { error: 'No valid events' };
  }
  if (updates.description !== undefined) webhook.description = updates.description;
  if (updates.active !== undefined) webhook.active = !!updates.active;
  
  webhook.updatedAt = new Date().toISOString();
  saveWebhooks(webhooks);
  
  return { webhook };
}

// Trigger webhooks for an event
async function triggerWebhooks(event, payload) {
  const webhooks = loadWebhooks();
  const logs = loadLogs();
  
  // Find webhooks subscribed to this event
  const subscribers = webhooks.filter(w => 
    w.active && w.events.includes(event)
  );
  
  if (subscribers.length === 0) {
    return { delivered: 0, failed: 0 };
  }
  
  let delivered = 0;
  let failed = 0;
  
  // Deliver to all subscribers in parallel
  const results = await Promise.all(
    subscribers.map(async (webhook) => {
      const result = await deliverWebhook(webhook, event, payload);
      
      // Update webhook stats
      webhook.deliveries++;
      webhook.lastDelivery = new Date().toISOString();
      if (!result.success) {
        webhook.failures++;
      }
      
      // Log delivery
      logs.push({
        webhookId: webhook.id,
        event,
        url: webhook.url,
        success: result.success,
        statusCode: result.statusCode,
        error: result.error || null,
        timestamp: new Date().toISOString()
      });
      
      return { webhook, result };
    })
  );
  
  // Save updated webhooks and logs
  saveWebhooks(webhooks);
  saveLogs(logs);
  
  // Count results
  results.forEach(({ result }) => {
    if (result.success) delivered++;
    else failed++;
  });
  
  console.log(`[Webhooks] ${event}: ${delivered} delivered, ${failed} failed`);
  
  return { delivered, failed };
}

// Get recent delivery logs for a webhook
function getWebhookLogs(webhookId, limit = 20) {
  const logs = loadLogs();
  return logs
    .filter(l => l.webhookId === webhookId)
    .slice(-limit)
    .reverse();
}

// Test a webhook with sample payload
async function testWebhook(id) {
  const webhooks = loadWebhooks();
  const webhook = webhooks.find(w => w.id === id);
  
  if (!webhook) {
    return { error: 'Webhook not found' };
  }
  
  const testPayload = {
    test: true,
    message: 'This is a test webhook from AgentFolio',
    timestamp: new Date().toISOString()
  };
  
  const result = await deliverWebhook(webhook, 'test.ping', testPayload);
  
  return {
    webhook: { id: webhook.id, url: webhook.url },
    result
  };
}

module.exports = {
  EVENTS,
  registerWebhook,
  listWebhooks,
  getWebhook,
  deleteWebhook,
  toggleWebhook,
  updateWebhook,
  triggerWebhooks,
  getWebhookLogs,
  testWebhook,
  getDeadLetters,
  clearDeadLetters
};
