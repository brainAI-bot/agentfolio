/**
 * Shared API-key authentication for protected routes.
 */
const Database = require('better-sqlite3');
const path = require('path');

function defaultGetDb() {
  return new Database(path.join(__dirname, '../../data/agentfolio.db'), { readonly: true });
}

function apiKeyFromRequest(req) {
  return req.headers['x-api-key']
    || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    || req.query?.apiKey;
}

function createRequireAuth({
  getDb = defaultGetDb,
  closeDb = true,
  actorProperty = 'profileId',
  missingStatus = 401,
  invalidStatus = 401,
  missingBody = { error: 'API key required' },
  invalidBody = { error: 'Invalid API key' },
  failureBody = (error) => ({ error: error.message }),
} = {}) {
  return function requireApiKey(req, res, next) {
    const apiKey = apiKeyFromRequest(req);
    if (!apiKey) return res.status(missingStatus).json(missingBody);

    let db;
    try {
      db = getDb();
      const profile = db.prepare('SELECT id FROM profiles WHERE api_key = ?').get(apiKey);
      if (!profile) return res.status(invalidStatus).json(invalidBody);
      req[actorProperty] = profile.id;
      return next();
    } catch (error) {
      return res.status(500).json(failureBody(error));
    } finally {
      if (closeDb && db) db.close();
    }
  };
}

const requireAuth = createRequireAuth();

module.exports = { apiKeyFromRequest, createRequireAuth, requireAuth };
