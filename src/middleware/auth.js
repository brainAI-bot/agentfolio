/**
 * Shared auth middleware for protected routes
 * Supports API key auth (x-api-key or Authorization: Bearer)
 * and profile wallet-signature auth used by the edit page.
 */
const Database = require('better-sqlite3');
const path = require('path');
const bs58raw = require('bs58'); const bs58 = bs58raw.default || bs58raw;
const nacl = require('tweetnacl');

function openDb() {
  return new Database(path.join(__dirname, '../../data/agentfolio.db'), { readonly: true });
}

function extractApiKey(req) {
  const authHeader = String(req.headers['authorization'] || '');
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  return String(req.headers['x-api-key'] || req.query.apiKey || bearer || '').trim();
}

function lookupProfileById(db, profileId) {
  if (!profileId) return null;
  let row = db.prepare('SELECT id, wallets, wallet FROM profiles WHERE id = ?').get(profileId);
  if (!row) row = db.prepare('SELECT id, wallets, wallet FROM profiles WHERE LOWER(name) = LOWER(?)').get(profileId);
  if (!row) row = db.prepare('SELECT id, wallets, wallet FROM profiles WHERE id = ?').get('agent_' + String(profileId).toLowerCase());
  return row || null;
}

function walletMatchesProfile(row, walletAddress) {
  if (!row || !walletAddress) return false;
  const normalized = String(walletAddress).trim();
  if (!normalized) return false;

  try {
    const parsed = typeof row.wallets === 'string' ? JSON.parse(row.wallets || '{}') : (row.wallets || {});
    const candidates = [
      parsed.solana,
      parsed.solana_wallet,
      parsed.wallet,
      row.wallet,
    ].filter(Boolean).map((value) => String(value).trim());
    return candidates.includes(normalized);
  } catch (_) {
    return String(row.wallet || '').trim() === normalized;
  }
}

function requireAuth(req, res, next) {
  const db = openDb();

  try {
    const apiKey = extractApiKey(req);
    if (apiKey) {
      const profile = db.prepare('SELECT id FROM profiles WHERE api_key = ?').get(apiKey);
      if (!profile) {
        return res.status(401).json({ error: 'Invalid API key' });
      }
      req.profileId = profile.id;
      return next();
    }

    const walletSignature = String(req.headers['x-wallet-signature'] || '').trim();
    const walletAddress = String(req.headers['x-wallet-address'] || '').trim();
    const targetProfileId = String(req.headers['x-profile-id'] || req.body?.profileId || req.params?.id || '').trim();

    if (!walletSignature || !walletAddress || !targetProfileId) {
      return res.status(401).json({ error: 'API key or wallet signature required' });
    }

    const profile = lookupProfileById(db, targetProfileId);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found for wallet auth' });
    }
    if (!walletMatchesProfile(profile, walletAddress)) {
      return res.status(403).json({ error: 'Wallet does not control this profile' });
    }

    const sigBytes = Buffer.from(walletSignature, 'base64');
    const msgBytes = Buffer.from(`agentfolio-edit:${profile.id}`);
    const pubBytes = bs58.decode(walletAddress);
    if (!nacl.sign.detached.verify(msgBytes, sigBytes, pubBytes)) {
      return res.status(403).json({ error: 'Invalid wallet signature' });
    }

    req.profileId = profile.id;
    return next();
  } catch (e) {
    return res.status(400).json({ error: `Auth verification failed: ${e.message}` });
  } finally {
    db.close();
  }
}

module.exports = { requireAuth };
