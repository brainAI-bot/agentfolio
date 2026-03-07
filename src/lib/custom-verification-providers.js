/**
 * Custom Verification Providers for AgentFolio
 * 
 * Third parties can register their own verification types and submit
 * verification results for agents. This extends AgentFolio's built-in
 * verifications with arbitrary external proof systems.
 * 
 * Flow:
 * 1. Provider registers via API (name, description, webhook URL, schema)
 * 2. Provider gets approved (auto or manual based on API tier)
 * 3. Provider submits verification results for agent profiles
 * 4. Results appear on agent profiles as custom verifications
 * 
 * Requires Enterprise API key tier for provider registration.
 * Pro tier can submit verifications for approved providers they own.
 */

const crypto = require('crypto');
const { db } = require('./database');
const { loadProfile, saveProfile } = require('./profile');
const { addActivity } = require('./activity');

// ===== Schema =====

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS verification_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      icon_url TEXT,
      website_url TEXT,
      webhook_url TEXT,
      callback_url TEXT,
      owner_api_key TEXT NOT NULL,
      owner_profile_id TEXT,
      schema TEXT DEFAULT '{}',
      required_fields TEXT DEFAULT '[]',
      optional_fields TEXT DEFAULT '[]',
      verification_method TEXT DEFAULT 'api_submit',
      status TEXT DEFAULT 'pending',
      tier TEXT DEFAULT 'standard',
      total_verifications INTEGER DEFAULT 0,
      successful_verifications INTEGER DEFAULT 0,
      failed_verifications INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      approved_at TEXT,
      revoked_at TEXT,
      revoke_reason TEXT
    );
    
    CREATE TABLE IF NOT EXISTS custom_verifications (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      result TEXT DEFAULT '{}',
      proof TEXT DEFAULT '{}',
      metadata TEXT DEFAULT '{}',
      score REAL,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      verified_at TEXT,
      FOREIGN KEY (provider_id) REFERENCES verification_providers(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_cv_provider ON custom_verifications(provider_id);
    CREATE INDEX IF NOT EXISTS idx_cv_profile ON custom_verifications(profile_id);
    CREATE INDEX IF NOT EXISTS idx_cv_status ON custom_verifications(status);
    CREATE INDEX IF NOT EXISTS idx_vp_slug ON verification_providers(slug);
    CREATE INDEX IF NOT EXISTS idx_vp_status ON verification_providers(status);
    CREATE INDEX IF NOT EXISTS idx_vp_owner ON verification_providers(owner_api_key);
  `);
}

// Initialize on load
try { initSchema(); } catch (e) { /* table may already exist */ }

// ===== Provider Management =====

const PROVIDER_STATUSES = ['pending', 'approved', 'suspended', 'revoked'];
const VERIFICATION_METHODS = ['api_submit', 'webhook_callback', 'oauth_flow'];
const PROVIDER_TIERS = ['standard', 'premium', 'enterprise'];

function generateId() {
  return 'vp_' + crypto.randomBytes(12).toString('hex');
}

function generateVerificationId() {
  return 'cv_' + crypto.randomBytes(12).toString('hex');
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

/**
 * Register a new verification provider
 */
function registerProvider({ name, description, iconUrl, websiteUrl, webhookUrl, callbackUrl, ownerApiKey, ownerProfileId, schema, requiredFields, optionalFields, verificationMethod }) {
  if (!name || !ownerApiKey) {
    throw new Error('Name and API key are required');
  }
  
  const slug = slugify(name);
  
  // Check for duplicate slug
  const existing = db.prepare('SELECT id FROM verification_providers WHERE slug = ?').get(slug);
  if (existing) {
    throw new Error(`Provider with slug "${slug}" already exists`);
  }
  
  const id = generateId();
  const method = VERIFICATION_METHODS.includes(verificationMethod) ? verificationMethod : 'api_submit';
  
  db.prepare(`
    INSERT INTO verification_providers (id, name, slug, description, icon_url, website_url, webhook_url, callback_url, owner_api_key, owner_profile_id, schema, required_fields, optional_fields, verification_method, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name, slug, description || '',
    iconUrl || null, websiteUrl || null, webhookUrl || null, callbackUrl || null,
    ownerApiKey, ownerProfileId || null,
    JSON.stringify(schema || {}),
    JSON.stringify(requiredFields || []),
    JSON.stringify(optionalFields || []),
    method,
    'pending'
  );
  
  return getProvider(id);
}

/**
 * Get provider by ID or slug
 */
function getProvider(idOrSlug) {
  const row = db.prepare(
    'SELECT * FROM verification_providers WHERE id = ? OR slug = ?'
  ).get(idOrSlug, idOrSlug);
  
  if (!row) return null;
  return parseProvider(row);
}

function parseProvider(row) {
  return {
    ...row,
    schema: JSON.parse(row.schema || '{}'),
    required_fields: JSON.parse(row.required_fields || '[]'),
    optional_fields: JSON.parse(row.optional_fields || '[]'),
  };
}

/**
 * List providers with optional filters
 */
function listProviders({ status, ownerApiKey, limit = 50, offset = 0 } = {}) {
  let sql = 'SELECT * FROM verification_providers WHERE 1=1';
  const params = [];
  
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (ownerApiKey) {
    sql += ' AND owner_api_key = ?';
    params.push(ownerApiKey);
  }
  
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  
  return db.prepare(sql).all(...params).map(parseProvider);
}

/**
 * Approve a provider
 */
function approveProvider(id) {
  const result = db.prepare(`
    UPDATE verification_providers 
    SET status = 'approved', approved_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND status = 'pending'
  `).run(id);
  
  return result.changes > 0 ? getProvider(id) : null;
}

/**
 * Suspend a provider
 */
function suspendProvider(id, reason) {
  const result = db.prepare(`
    UPDATE verification_providers 
    SET status = 'suspended', revoke_reason = ?, updated_at = datetime('now')
    WHERE id = ? AND status = 'approved'
  `).run(reason || 'Suspended by admin', id);
  
  return result.changes > 0 ? getProvider(id) : null;
}

/**
 * Revoke a provider permanently
 */
function revokeProvider(id, reason) {
  const result = db.prepare(`
    UPDATE verification_providers 
    SET status = 'revoked', revoked_at = datetime('now'), revoke_reason = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(reason || 'Revoked', id);
  
  return result.changes > 0 ? getProvider(id) : null;
}

/**
 * Update provider details (owner only)
 */
function updateProvider(id, ownerApiKey, updates) {
  const provider = getProvider(id);
  if (!provider) throw new Error('Provider not found');
  if (provider.owner_api_key !== ownerApiKey) throw new Error('Not authorized');
  
  const allowed = ['description', 'icon_url', 'website_url', 'webhook_url', 'callback_url', 'schema', 'required_fields', 'optional_fields'];
  const sets = [];
  const params = [];
  
  for (const [key, value] of Object.entries(updates)) {
    const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (!allowed.includes(dbKey)) continue;
    
    sets.push(`${dbKey} = ?`);
    params.push(typeof value === 'object' ? JSON.stringify(value) : value);
  }
  
  if (sets.length === 0) return provider;
  
  sets.push("updated_at = datetime('now')");
  params.push(id);
  
  db.prepare(`UPDATE verification_providers SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getProvider(id);
}

// ===== Verification Submission =====

/**
 * Submit a verification result for a profile
 */
function submitVerification({ providerId, profileId, result, proof, metadata, score, expiresAt, ownerApiKey }) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error('Provider not found');
  if (provider.status !== 'approved') throw new Error('Provider is not approved');
  if (provider.owner_api_key !== ownerApiKey) throw new Error('Not authorized to submit for this provider');
  
  // Validate profile exists
  const profile = loadProfile(profileId);
  if (!profile) throw new Error('Profile not found');
  
  // Validate required fields in result
  const requiredFields = provider.required_fields || [];
  for (const field of requiredFields) {
    if (!result || result[field] === undefined) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  
  const id = generateVerificationId();
  
  db.prepare(`
    INSERT INTO custom_verifications (id, provider_id, profile_id, status, result, proof, metadata, score, expires_at, verified_at)
    VALUES (?, ?, ?, 'verified', ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    id, providerId, profileId,
    JSON.stringify(result || {}),
    JSON.stringify(proof || {}),
    JSON.stringify(metadata || {}),
    score || null,
    expiresAt || null
  );
  
  // Update provider stats
  db.prepare(`
    UPDATE verification_providers 
    SET total_verifications = total_verifications + 1, 
        successful_verifications = successful_verifications + 1,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(providerId);
  
  // Add to profile's verifications
  try {
    const verifications = profile.verifications || {};
    verifications[`custom:${provider.slug}`] = {
      verified: true,
      provider: provider.name,
      providerId: provider.id,
      verificationId: id,
      score: score || null,
      result: result,
      verifiedAt: new Date().toISOString(),
      expiresAt: expiresAt || null
    };
    saveProfile(profileId, { verifications });
  } catch (e) {
    // Non-fatal: verification is still recorded in DB
  }
  
  // Log activity
  try {
    addActivity(profileId, 'custom_verification', {
      provider: provider.name,
      providerSlug: provider.slug,
      verificationId: id,
      score
    });
  } catch (e) { /* non-fatal */ }
  
  return getVerification(id);
}

/**
 * Revoke a verification
 */
function revokeVerification(id, ownerApiKey, reason) {
  const verification = getVerification(id);
  if (!verification) throw new Error('Verification not found');
  
  const provider = getProvider(verification.provider_id);
  if (!provider || provider.owner_api_key !== ownerApiKey) {
    throw new Error('Not authorized');
  }
  
  db.prepare(`
    UPDATE custom_verifications 
    SET status = 'revoked', metadata = json_set(metadata, '$.revoke_reason', ?), updated_at = datetime('now')
    WHERE id = ?
  `).run(reason || 'Revoked by provider', id);
  
  // Update provider stats
  db.prepare(`
    UPDATE verification_providers 
    SET failed_verifications = failed_verifications + 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(verification.provider_id);
  
  // Remove from profile
  try {
    const profile = loadProfile(verification.profile_id);
    if (profile) {
      const verifications = profile.verifications || {};
      const key = Object.keys(verifications).find(k => 
        verifications[k]?.verificationId === id
      );
      if (key) {
        verifications[key].verified = false;
        verifications[key].revokedAt = new Date().toISOString();
        saveProfile(verification.profile_id, { verifications });
      }
    }
  } catch (e) { /* non-fatal */ }
  
  return getVerification(id);
}

// ===== Query =====

function getVerification(id) {
  const row = db.prepare('SELECT * FROM custom_verifications WHERE id = ?').get(id);
  if (!row) return null;
  return {
    ...row,
    result: JSON.parse(row.result || '{}'),
    proof: JSON.parse(row.proof || '{}'),
    metadata: JSON.parse(row.metadata || '{}'),
  };
}

function getProfileVerifications(profileId, { providerId, status, limit = 50 } = {}) {
  let sql = 'SELECT cv.*, vp.name as provider_name, vp.slug as provider_slug, vp.icon_url as provider_icon FROM custom_verifications cv JOIN verification_providers vp ON cv.provider_id = vp.id WHERE cv.profile_id = ?';
  const params = [profileId];
  
  if (providerId) {
    sql += ' AND cv.provider_id = ?';
    params.push(providerId);
  }
  if (status) {
    sql += ' AND cv.status = ?';
    params.push(status);
  }
  
  sql += ' ORDER BY cv.created_at DESC LIMIT ?';
  params.push(limit);
  
  return db.prepare(sql).all(...params).map(row => ({
    ...row,
    result: JSON.parse(row.result || '{}'),
    proof: JSON.parse(row.proof || '{}'),
    metadata: JSON.parse(row.metadata || '{}'),
  }));
}

function getProviderVerifications(providerId, { status, limit = 50, offset = 0 } = {}) {
  let sql = 'SELECT * FROM custom_verifications WHERE provider_id = ?';
  const params = [providerId];
  
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  
  return db.prepare(sql).all(...params).map(row => ({
    ...row,
    result: JSON.parse(row.result || '{}'),
    proof: JSON.parse(row.proof || '{}'),
    metadata: JSON.parse(row.metadata || '{}'),
  }));
}

/**
 * Get stats for a provider
 */
function getProviderStats(providerId) {
  const provider = getProvider(providerId);
  if (!provider) return null;
  
  const profileCount = db.prepare(
    'SELECT COUNT(DISTINCT profile_id) as count FROM custom_verifications WHERE provider_id = ? AND status = ?'
  ).get(providerId, 'verified');
  
  const recentVerifications = db.prepare(
    "SELECT COUNT(*) as count FROM custom_verifications WHERE provider_id = ? AND created_at > datetime('now', '-7 days')"
  ).get(providerId);
  
  return {
    providerId,
    name: provider.name,
    totalVerifications: provider.total_verifications,
    successfulVerifications: provider.successful_verifications,
    failedVerifications: provider.failed_verifications,
    successRate: provider.total_verifications > 0 
      ? (provider.successful_verifications / provider.total_verifications * 100).toFixed(1) + '%'
      : 'N/A',
    uniqueProfiles: profileCount?.count || 0,
    last7Days: recentVerifications?.count || 0,
  };
}

/**
 * List all approved providers (public directory)
 */
function getProviderDirectory() {
  return db.prepare(`
    SELECT id, name, slug, description, icon_url, website_url, verification_method, tier,
           total_verifications, successful_verifications, created_at, approved_at
    FROM verification_providers 
    WHERE status = 'approved' 
    ORDER BY total_verifications DESC
  `).all();
}

/**
 * Clean up expired verifications
 */
function cleanupExpired() {
  const result = db.prepare(`
    UPDATE custom_verifications 
    SET status = 'expired', updated_at = datetime('now')
    WHERE status = 'verified' AND expires_at IS NOT NULL AND expires_at < datetime('now')
  `).run();
  
  return result.changes;
}

module.exports = {
  // Provider management
  registerProvider,
  getProvider,
  listProviders,
  approveProvider,
  suspendProvider,
  revokeProvider,
  updateProvider,
  getProviderDirectory,
  getProviderStats,
  
  // Verification submission
  submitVerification,
  revokeVerification,
  getVerification,
  getProfileVerifications,
  getProviderVerifications,
  cleanupExpired,
  
  // Constants
  PROVIDER_STATUSES,
  VERIFICATION_METHODS,
  PROVIDER_TIERS,
};
