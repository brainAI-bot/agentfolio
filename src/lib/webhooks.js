/**
 * Webhook System for AgentFolio
 * Notify external services on agent events
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const dns = require('dns');
const net = require('net');
const crypto = require('crypto');
const ipaddr = require('ipaddr.js');
const { signWebhookBody, verifyWebhookSignature, createWebhookReplayCache } = require('./webhook-signing');

const WEBHOOKS_FILE = process.env.AGENTFOLIO_WEBHOOKS_FILE || path.join(__dirname, '../../data/webhooks.json');
const WEBHOOK_LOG_FILE = process.env.AGENTFOLIO_WEBHOOK_LOG_FILE || path.join(__dirname, '../../data/webhook-logs.json');

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
  fs.mkdirSync(path.dirname(WEBHOOK_LOG_FILE), { recursive: true });
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

const PRIVATE_DESTINATIONS = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) PRIVATE_DESTINATIONS.addSubnet(network, prefix, 'ipv4');

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
]) PRIVATE_DESTINATIONS.addSubnet(network, prefix, 'ipv6');

function normalizeAddress(value) {
  const address = String(value || '').replace(/^\[|\]$/g, '').split('%')[0];
  if (!ipaddr.isValid(address)) return null;
  const parsed = ipaddr.parse(address);
  if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) {
    return { address: parsed.toIPv4Address().toString(), family: 'ipv4', mapped: true };
  }
  return { address: parsed.toNormalizedString(), family: parsed.kind(), mapped: false };
}

function isPublicAddress(value) {
  const normalized = normalizeAddress(value);
  if (!normalized || normalized.mapped) return false;
  return !PRIVATE_DESTINATIONS.check(normalized.address, normalized.family);
}

function createSafeLookup(dnsLookup = dns.lookup, isAddressAllowed = isPublicAddress) {
  return (hostname, options, callback) => {
    const lookupOptions = typeof options === 'object' && options !== null ? options : {};
    const done = typeof options === 'function' ? options : callback;
    dnsLookup(hostname, { ...lookupOptions, all: true }, (error, addresses, family) => {
      if (error) return done(error);
      const resolved = (Array.isArray(addresses) ? addresses : [{ address: addresses, family }])
        .map(({ address, family: resolvedFamily }) => ({
          address,
          family: typeof resolvedFamily === 'number' ? resolvedFamily : (net.isIP(address) || 4),
        }));
      if (resolved.length === 0) return done(new Error('Webhook destination did not resolve'));
      if (resolved.some(({ address }) => !isAddressAllowed(address))) {
        return done(new Error('Webhook URL must use a public destination'));
      }
      if (lookupOptions.all) return done(null, resolved);
      return done(null, resolved[0].address, resolved[0].family);
    });
  };
}

function validateWebhookUrl(value) {
  let parsedUrl;
  try { parsedUrl = new URL(value); } catch (_) { parsedUrl = null; }
  if (!parsedUrl || !['http:', 'https:'].includes(parsedUrl.protocol)) return { error: 'Invalid URL' };
  if (parsedUrl.username || parsedUrl.password) return { error: 'Webhook URL must not contain credentials' };
  const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const blockedHostname = hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === 'localtest.me'
    || hostname.endsWith('.localtest.me')
    || (ipaddr.isValid(hostname) && !isPublicAddress(hostname));
  if (blockedHostname) return { error: 'Webhook URL must use a public destination' };
  return { url: parsedUrl.toString() };
}

// Sign payload with secret (HMAC-SHA256)
function signPayload(rawBody, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const body = Buffer.isBuffer(rawBody) || ArrayBuffer.isView(rawBody) || typeof rawBody === 'string'
    ? rawBody
    : JSON.stringify(rawBody);
  return { timestamp, signature: signWebhookBody(body, secret, timestamp) };
}

// Register a new webhook
function registerWebhook(url, events = [], options = {}) {
  const validatedUrl = validateWebhookUrl(url);
  if (validatedUrl.error) return validatedUrl;
  if (!Array.isArray(events)) return { error: 'events must be an array' };
  
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
  if (webhooks.find(w => w.url === validatedUrl.url && w.ownerId === options.ownerId && w.active)) {
    return { error: 'Webhook URL already registered' };
  }
  
  const webhook = {
    id: generateId(),
    url: validatedUrl.url,
    ownerId: options.ownerId || null,
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
function listWebhooks(showSecrets = false, ownerId = null) {
  const webhooks = loadWebhooks().filter(w => !ownerId || w.ownerId === ownerId);
  return webhooks.map(w => ({
    ...w,
    secret: showSecrets ? w.secret : w.secret.slice(0, 12) + '...'
  }));
}

// Get a specific webhook
function getWebhook(id, showSecret = false, ownerId = null) {
  const webhooks = loadWebhooks();
  const webhook = webhooks.find(w => w.id === id && (!ownerId || w.ownerId === ownerId));
  if (!webhook) return null;
  
  return {
    ...webhook,
    secret: showSecret ? webhook.secret : webhook.secret.slice(0, 12) + '...'
  };
}

// Delete a webhook
function deleteWebhook(id, ownerId = null) {
  const webhooks = loadWebhooks();
  const index = webhooks.findIndex(w => w.id === id && (!ownerId || w.ownerId === ownerId));
  
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
const DEAD_LETTER_FILE = process.env.AGENTFOLIO_WEBHOOK_DEAD_LETTER_FILE || path.join(__dirname, '../../data/webhook-dead-letters.json');

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
  fs.mkdirSync(path.dirname(DEAD_LETTER_FILE), { recursive: true });
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
function createDelivery(event, payload, now = new Date()) {
  const deliveryId = 'evt_' + crypto.randomBytes(8).toString('hex');
  const timestamp = Math.floor(now.getTime() / 1000);
  const body = JSON.stringify({
    id: deliveryId,
    event,
    timestamp: now.toISOString(),
    data: payload
  });
  return { deliveryId, timestamp, body };
}

function singleDeliver(webhook, event, delivery, options = {}) {
  const { deliveryId, timestamp, body } = delivery;
  const signature = delivery.signature || signWebhookBody(body, webhook.secret, timestamp);

  const validatedUrl = validateWebhookUrl(webhook.url);
  if (validatedUrl.error) {
    return Promise.resolve({ success: false, statusCode: 0, error: validatedUrl.error });
  }
  
  const url = new URL(validatedUrl.url);
  const isHttps = url.protocol === 'https:';
  const httpModule = isHttps ? https : http;
  
  const requestOptions = {
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
      'X-AgentFolio-Delivery': deliveryId
    },
    timeout: 10000,
    lookup: createSafeLookup(options.dnsLookup, options.isAddressAllowed),
  };
  
  return new Promise((resolve) => {
    const request = options.request || httpModule.request;
    const req = request(requestOptions, (res) => {
      res.resume();
      res.on('end', () => {
        resolve({
          success: res.statusCode >= 200 && res.statusCode < 300,
          statusCode: res.statusCode,
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

async function deliverWebhook(webhook, event, payload, options = {}) {
  let lastResult;
  const delivery = createDelivery(event, payload);
  delivery.signature = signWebhookBody(delivery.body, webhook.secret, delivery.timestamp);
  const baseDelayMs = options.baseDelayMs ?? BASE_DELAY_MS;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, delay));
      console.log(`[Webhooks] Retry ${attempt}/${MAX_RETRIES - 1} for ${webhook.url} (${event})`);
    }
    
    lastResult = await singleDeliver(webhook, event, delivery, options);
    
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
function updateWebhook(id, updates, ownerId = null) {
  const webhooks = loadWebhooks();
  const webhook = webhooks.find(w => w.id === id && (!ownerId || w.ownerId === ownerId));
  
  if (!webhook) {
    return { error: 'Webhook not found' };
  }
  
  // Allowed fields to update
  if (updates.url !== undefined) {
    const validatedUrl = validateWebhookUrl(updates.url);
    if (validatedUrl.error) return validatedUrl;
    webhook.url = validatedUrl.url;
  }
  if (updates.events !== undefined) {
    if (!Array.isArray(updates.events)) return { error: 'events must be an array' };
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
function getWebhookLogs(webhookId, limit = 20, ownerId = null) {
  if (ownerId && !getWebhook(webhookId, false, ownerId)) return null;
  const logs = loadLogs();
  return logs
    .filter(l => l.webhookId === webhookId)
    .slice(-limit)
    .reverse();
}

// Test a webhook with sample payload
async function testWebhook(id, ownerId = null) {
  const webhooks = loadWebhooks();
  const webhook = webhooks.find(w => w.id === id && (!ownerId || w.ownerId === ownerId));
  
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
  clearDeadLetters,
  signPayload,
  signWebhookBody,
  verifyWebhookSignature,
  createWebhookReplayCache,
  createDelivery,
  singleDeliver,
  deliverWebhook,
  createSafeLookup,
  validateWebhookUrl,
};
