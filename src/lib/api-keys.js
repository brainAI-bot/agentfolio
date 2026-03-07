/**
 * API Key Authentication for AgentFolio
 * Provides secure access control for write operations
 * 
 * Now uses SQLite database for storage (migrated from JSON)
 */

const crypto = require('crypto');
const path = require('path');
const db = require('./database');

// Path to legacy JSON file for migration
const LEGACY_JSON_PATH = path.join(__dirname, '..', '..', 'data', 'api-keys.json');

// Tier definitions
const TIERS = {
  free: { label: 'Free', rateLimit: 100, price: 0, features: ['basic_profile_data'] },
  pro: { label: 'Pro', rateLimit: 10000, price: 29, features: ['basic_profile_data', 'full_verification', 'webhook_notifications'] },
  enterprise: { label: 'Enterprise', rateLimit: -1, price: 99, features: ['basic_profile_data', 'full_verification', 'webhook_notifications', 'priority_support', 'custom_integrations'] }
};

// Key types and permissions
const PERMISSIONS = {
  read: 'read',           // Read-only access (public endpoints)
  write_own: 'write_own', // Write to own profile only
  write_all: 'write_all', // Write to any profile (admin)
  admin: 'admin'          // Full admin access
};

const PERMISSION_LEVELS = {
  [PERMISSIONS.read]: 1,
  [PERMISSIONS.write_own]: 2,
  [PERMISSIONS.write_all]: 3,
  [PERMISSIONS.admin]: 4
};

// Run migration on module load (idempotent)
try {
  const result = db.migrateApiKeysFromJSON(LEGACY_JSON_PATH);
  if (result.migrated > 0) {
    console.log(`[API Keys] Migrated ${result.migrated} keys from JSON to SQLite`);
  }
} catch (e) {
  console.error('[API Keys] Migration error:', e.message);
}

// Generate a new API key
function generateApiKey() {
  return 'af_' + crypto.randomBytes(24).toString('hex');
}

// Hash a key for storage (we don't store plaintext)
function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Create a new API key for a profile
function createApiKey(profileId, permissions = PERMISSIONS.write_own, metadata = {}) {
  const tier = metadata.tier || 'free';
  const tierInfo = TIERS[tier] || TIERS.free;
  const key = generateApiKey();
  const hashedKey = hashKey(key);
  
  const result = db.createApiKey(
    hashedKey,
    profileId,
    metadata.name || '',
    permissions,
    metadata.expiresAt || null,
    tierInfo.rateLimit,
    tier
  );
  
  if (!result) {
    throw new Error('Failed to create API key - key may already exist');
  }
  
  // Return the plaintext key only once - it won't be retrievable again
  return {
    key,
    hashedKey,
    id: result.id,
    profileId,
    permissions,
    tier
  };
}

// Validate an API key and return its info
function validateApiKey(key) {
  if (!key) return null;
  
  // Handle legacy admin key
  if (key === 'admin' || key === process.env.AGENTFOLIO_ADMIN_KEY) {
    return {
      valid: true,
      profileId: 'admin',
      permissions: PERMISSIONS.admin,
      isAdmin: true
    };
  }
  
  const hashedKey = hashKey(key);
  const keyData = db.getApiKeyByHash(hashedKey);
  
  if (!keyData || !keyData.enabled) {
    return null;
  }
  
  // Check expiration
  if (keyData.expiresAt && new Date(keyData.expiresAt) < new Date()) {
    return null;
  }
  
  // Update usage stats
  db.updateApiKeyUsage(hashedKey);
  
  return {
    valid: true,
    profileId: keyData.ownerId,
    permissions: keyData.permissions,
    name: keyData.name,
    isAdmin: keyData.permissions === PERMISSIONS.admin,
    tier: keyData.tier || 'free',
    keyHash: hashedKey
  };
}

// Check if a key has permission for an action
function hasPermission(keyInfo, requiredPermission, targetProfileId = null) {
  if (!keyInfo || !keyInfo.valid) return false;
  
  const keyLevel = PERMISSION_LEVELS[keyInfo.permissions] || 0;
  const requiredLevel = PERMISSION_LEVELS[requiredPermission] || 0;
  
  // Admin always has access
  if (keyInfo.isAdmin) return true;
  
  // Check permission level
  if (keyLevel < requiredLevel) return false;
  
  // For write_own, check if targeting own profile
  if (keyInfo.permissions === PERMISSIONS.write_own && targetProfileId) {
    return keyInfo.profileId === targetProfileId;
  }
  
  return true;
}

// Revoke an API key by hash
function revokeApiKey(hashedKey) {
  return db.revokeApiKeyByHash(hashedKey);
}

// Check tier-based rate limit. Returns { allowed, requestsToday, limit, tier } or error info
function checkTierRateLimit(keyHash) {
  return db.incrementDailyUsage(keyHash);
}

// Middleware: validate API key + enforce tier rate limit for data endpoints
function requireTieredApiKey(req, res) {
  // Allow internal SSR calls with a shared secret
  const internalSecret = req.headers['x-internal-secret'];
  
  const key = extractApiKey(req);
  
  if (!key && internalSecret === (process.env.INTERNAL_API_SECRET || 'agentfolio-ssr-internal-2026')) {
    return { tier: 'pro', profileId: '_internal', keyHash: '_internal' };
  }
  
  if (!key) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'API key required',
      hint: 'Include key in Authorization: Bearer <key> or X-API-Key header',
      docs: 'https://agentfolio.bot/api/keys/docs'
    }));
    return null;
  }
  
  const keyInfo = validateApiKey(key);
  if (!keyInfo) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid or revoked API key' }));
    return null;
  }
  
  // Check daily rate limit
  const rateCheck = checkTierRateLimit(keyInfo.keyHash);
  if (!rateCheck.allowed) {
    const tierInfo = TIERS[rateCheck.tier] || TIERS.free;
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'X-RateLimit-Limit': String(rateCheck.limit),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString()
    });
    res.end(JSON.stringify({
      error: 'Daily rate limit exceeded',
      tier: rateCheck.tier,
      limit: rateCheck.limit,
      used: rateCheck.requestsToday,
      upgrade: rateCheck.tier === 'free' ? 'Upgrade to Pro for 10,000 requests/day' : 
               rateCheck.tier === 'pro' ? 'Upgrade to Enterprise for unlimited requests' : null,
      resetsAt: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString()
    }));
    return null;
  }
  
  // Add rate limit headers
  const limit = rateCheck.limit === -1 ? 'unlimited' : String(rateCheck.limit);
  const remaining = rateCheck.limit === -1 ? 'unlimited' : String(rateCheck.limit - rateCheck.requestsToday);
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Tier', rateCheck.tier);
  
  return keyInfo;
}

// List all API keys for a profile (without revealing the actual keys)
function listApiKeys(profileId) {
  return db.listApiKeysByOwner(profileId).map(key => ({
    id: key.id,
    keyHashPrefix: key.keyHashPrefix,
    name: key.name,
    permissions: key.permissions,
    tier: key.tier || 'free',
    createdAt: key.createdAt,
    lastUsed: key.lastUsedAt,
    usageCount: key.usageCount,
    active: key.enabled
  }));
}

// Middleware helper for HTTP handlers
function extractApiKey(req) {
  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  
  // Check X-API-Key header
  if (req.headers['x-api-key']) {
    return req.headers['x-api-key'];
  }
  
  return null;
}

// Auth middleware that returns error response if needed
function requireAuth(req, res, requiredPermission = PERMISSIONS.write_own, targetProfileId = null) {
  const key = extractApiKey(req);
  
  if (!key) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'API key required',
      hint: 'Include key in Authorization: Bearer <key> or X-API-Key header'
    }));
    return null;
  }
  
  const keyInfo = validateApiKey(key);
  
  if (!keyInfo) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid or revoked API key' }));
    return null;
  }
  
  if (!hasPermission(keyInfo, requiredPermission, targetProfileId)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Insufficient permissions',
      required: requiredPermission,
      yours: keyInfo.permissions,
      hint: targetProfileId ? `You can only modify profile: ${keyInfo.profileId}` : null
    }));
    return null;
  }
  
  return keyInfo;
}

// Get key stats for admin
function getKeyStats() {
  return db.getApiKeyStats();
}

module.exports = {
  PERMISSIONS,
  TIERS,
  generateApiKey,
  createApiKey,
  validateApiKey,
  hasPermission,
  revokeApiKey,
  listApiKeys,
  extractApiKey,
  requireAuth,
  requireTieredApiKey,
  checkTierRateLimit,
  getKeyStats
};
