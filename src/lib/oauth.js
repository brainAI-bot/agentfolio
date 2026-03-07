/**
 * OAuth2 Authentication for AgentFolio
 * 
 * Supports:
 * - Client registration (agents register OAuth apps)
 * - Client Credentials grant (server-to-server auth)
 * - Authorization Code grant (third-party integrations)
 * - Token refresh
 * - Scope-based permissions
 */

const crypto = require('crypto');
const db = require('./database');

// ===== Schema =====

function initOAuthSchema() {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY,
      client_secret_hash TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      redirect_uris TEXT DEFAULT '[]',
      scopes TEXT DEFAULT '["read"]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      active INTEGER DEFAULT 1,
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    );

    CREATE TABLE IF NOT EXISTS oauth_tokens (
      token_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      token_type TEXT NOT NULL DEFAULT 'access',
      scopes TEXT DEFAULT '["read"]',
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      revoked INTEGER DEFAULT 0,
      FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    );

    CREATE TABLE IF NOT EXISTS oauth_auth_codes (
      code_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      scopes TEXT DEFAULT '["read"]',
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id)
    );

    CREATE INDEX IF NOT EXISTS idx_oauth_tokens_client ON oauth_tokens(client_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_tokens_profile ON oauth_tokens(profile_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expires ON oauth_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_oauth_clients_profile ON oauth_clients(profile_id);
  `);
}

// Run schema init
try { initOAuthSchema(); } catch (e) { console.error('[OAuth] Schema init error:', e.message); }

// ===== Constants =====

const VALID_SCOPES = ['read', 'write:own', 'write:marketplace', 'admin'];
const ACCESS_TOKEN_TTL = 3600;      // 1 hour
const REFRESH_TOKEN_TTL = 2592000;  // 30 days
const AUTH_CODE_TTL = 600;          // 10 minutes

// ===== Helpers =====

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function generateId(prefix) {
  return prefix + '_' + crypto.randomBytes(16).toString('hex');
}

function generateSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

function validateScopes(scopes) {
  if (!Array.isArray(scopes)) return ['read'];
  return scopes.filter(s => VALID_SCOPES.includes(s));
}

function expiresAt(ttlSeconds) {
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

// ===== Client Management =====

function registerClient(profileId, { name, description, redirectUris, scopes }) {
  if (!name) throw new Error('Client name is required');
  
  const clientId = generateId('afc');
  const clientSecret = generateSecret();
  const validScopes = validateScopes(scopes || ['read']);
  
  const stmt = db.db.prepare(`
    INSERT INTO oauth_clients (client_id, client_secret_hash, profile_id, name, description, redirect_uris, scopes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    clientId,
    hash(clientSecret),
    profileId,
    name,
    description || '',
    JSON.stringify(redirectUris || []),
    JSON.stringify(validScopes)
  );
  
  return { clientId, clientSecret, scopes: validScopes };
}

function getClient(clientId) {
  const row = db.db.prepare('SELECT * FROM oauth_clients WHERE client_id = ? AND active = 1').get(clientId);
  if (!row) return null;
  return {
    ...row,
    redirect_uris: JSON.parse(row.redirect_uris),
    scopes: JSON.parse(row.scopes)
  };
}

function verifyClientSecret(clientId, clientSecret) {
  const client = db.db.prepare('SELECT client_secret_hash FROM oauth_clients WHERE client_id = ? AND active = 1').get(clientId);
  if (!client) return false;
  return client.client_secret_hash === hash(clientSecret);
}

function listClients(profileId) {
  const rows = db.db.prepare('SELECT client_id, name, description, scopes, created_at FROM oauth_clients WHERE profile_id = ? AND active = 1').all(profileId);
  return rows.map(r => ({ ...r, scopes: JSON.parse(r.scopes) }));
}

function revokeClient(clientId, profileId) {
  const result = db.db.prepare('UPDATE oauth_clients SET active = 0, updated_at = datetime("now") WHERE client_id = ? AND profile_id = ?').run(clientId, profileId);
  // Also revoke all tokens for this client
  db.db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE client_id = ?').run(clientId);
  return result.changes > 0;
}

// ===== Token Management =====

function issueTokenPair(clientId, profileId, scopes) {
  const accessToken = generateId('aft');
  const refreshToken = generateId('afr');
  
  const insertToken = db.db.prepare(`
    INSERT INTO oauth_tokens (token_hash, client_id, profile_id, token_type, scopes, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const validScopes = validateScopes(scopes);
  
  insertToken.run(hash(accessToken), clientId, profileId, 'access', JSON.stringify(validScopes), expiresAt(ACCESS_TOKEN_TTL));
  insertToken.run(hash(refreshToken), clientId, profileId, 'refresh', JSON.stringify(validScopes), expiresAt(REFRESH_TOKEN_TTL));
  
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL,
    refresh_token: refreshToken,
    scope: validScopes.join(' ')
  };
}

function validateToken(token) {
  const row = db.db.prepare(`
    SELECT t.*, c.profile_id as client_owner
    FROM oauth_tokens t
    JOIN oauth_clients c ON t.client_id = c.client_id
    WHERE t.token_hash = ? AND t.token_type = 'access' AND t.revoked = 0 AND c.active = 1
  `).get(hash(token));
  
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  
  return {
    clientId: row.client_id,
    profileId: row.profile_id,
    scopes: JSON.parse(row.scopes),
    expiresAt: row.expires_at
  };
}

function refreshAccessToken(refreshToken) {
  const row = db.db.prepare(`
    SELECT * FROM oauth_tokens
    WHERE token_hash = ? AND token_type = 'refresh' AND revoked = 0
  `).get(hash(refreshToken));
  
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  
  // Revoke the old refresh token (rotation)
  db.db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE token_hash = ?').run(hash(refreshToken));
  
  // Issue new pair
  return issueTokenPair(row.client_id, row.profile_id, JSON.parse(row.scopes));
}

function revokeToken(token) {
  const result = db.db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE token_hash = ?').run(hash(token));
  return result.changes > 0;
}

// ===== Authorization Code Grant =====

function createAuthCode(clientId, profileId, redirectUri, scopes) {
  const code = generateId('afc_code');
  const validScopes = validateScopes(scopes);
  
  db.db.prepare(`
    INSERT INTO oauth_auth_codes (code_hash, client_id, profile_id, redirect_uri, scopes, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(hash(code), clientId, profileId, redirectUri, JSON.stringify(validScopes), expiresAt(AUTH_CODE_TTL));
  
  return code;
}

function exchangeAuthCode(code, clientId, redirectUri) {
  const row = db.db.prepare(`
    SELECT * FROM oauth_auth_codes
    WHERE code_hash = ? AND client_id = ? AND redirect_uri = ? AND used = 0
  `).get(hash(code), clientId, redirectUri);
  
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  
  // Mark as used
  db.db.prepare('UPDATE oauth_auth_codes SET used = 1 WHERE code_hash = ?').run(hash(code));
  
  return issueTokenPair(clientId, row.profile_id, JSON.parse(row.scopes));
}

// ===== Client Credentials Grant =====

function clientCredentialsGrant(clientId, clientSecret, requestedScopes) {
  if (!verifyClientSecret(clientId, clientSecret)) return null;
  
  const client = getClient(clientId);
  if (!client) return null;
  
  // Scopes limited to what client was registered with
  const scopes = requestedScopes 
    ? validateScopes(requestedScopes).filter(s => client.scopes.includes(s))
    : client.scopes;
  
  return issueTokenPair(clientId, client.profile_id, scopes);
}

// ===== Cleanup =====

function cleanupExpiredTokens() {
  const result = db.db.prepare("DELETE FROM oauth_tokens WHERE expires_at < datetime('now')").run();
  const codes = db.db.prepare("DELETE FROM oauth_auth_codes WHERE expires_at < datetime('now')").run();
  return { tokens: result.changes, codes: codes.changes };
}

// Run cleanup on load
try { cleanupExpiredTokens(); } catch (e) {}

// ===== Express-style middleware helper =====

function authenticateOAuth(req) {
  const authHeader = req.headers?.['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  
  const token = authHeader.slice(7);
  // Check if it's an OAuth token (starts with aft_)
  if (!token.startsWith('aft_')) return null;
  
  return validateToken(token);
}

function hasScope(tokenInfo, requiredScope) {
  if (!tokenInfo) return false;
  return tokenInfo.scopes.includes(requiredScope) || tokenInfo.scopes.includes('admin');
}

module.exports = {
  registerClient,
  getClient,
  verifyClientSecret,
  listClients,
  revokeClient,
  issueTokenPair,
  validateToken,
  refreshAccessToken,
  revokeToken,
  createAuthCode,
  exchangeAuthCode,
  clientCredentialsGrant,
  cleanupExpiredTokens,
  authenticateOAuth,
  hasScope,
  VALID_SCOPES
};
