'use strict';

const crypto = require('node:crypto');
const nacl = require('tweetnacl');
const rateLimit = require('express-rate-limit');
const { PublicKey } = require('@solana/web3.js');

const SATP_IDENTITY_PROGRAM = new PublicKey('97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq');
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CHALLENGE_ROUTE = '/api/marketplace/auth/challenge';
const REGISTERED_CHALLENGE_ROUTE = Symbol.for('agentfolio.marketplaceChallengeRoute');
const marketplaceChallengeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'MARKETPLACE_RATE_LIMIT', error: 'Too many marketplace challenge requests' },
});

function marketplaceApiKeyFromRequest(req) {
  const headerKey = req.headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) return headerKey.trim();
  const authorization = String(req.headers.authorization || '');
  const bearer = authorization.match(/^Bearer\s+(.+)$/i);
  return bearer ? bearer[1].trim() : '';
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function pushWalletCandidate(candidates, value, chainHint = '') {
  if (typeof value === 'string') {
    const candidate = value.trim();
    if (candidate) candidates.push(candidate);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) pushWalletCandidate(candidates, entry, chainHint);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const chain = String(value.chain || value.network || value.type || chainHint).toLowerCase();
  if (!chain || chain.includes('sol')) {
    pushWalletCandidate(candidates, value.address || value.walletAddress || value.publicKey || value.wallet, chain);
  }
}

function profileWallet(profile) {
  if (!profile) return null;
  const wallets = parseJson(profile.wallets);
  const verification = parseJson(profile.verification_data);
  const candidates = [];

  // Preserve source priority while rejecting EVM addresses and malformed Solana keys.
  pushWalletCandidate(candidates, profile.wallet);
  if (Array.isArray(wallets)) pushWalletCandidate(candidates, wallets);
  else {
    pushWalletCandidate(candidates, wallets.solana, 'solana');
    pushWalletCandidate(candidates, wallets.sol, 'solana');
    pushWalletCandidate(candidates, wallets.solana_wallet, 'solana');
    pushWalletCandidate(candidates, wallets.wallet, 'solana');
    pushWalletCandidate(candidates, wallets.wallets);
  }
  pushWalletCandidate(candidates, verification.solana, 'solana');
  if (verification.wallets && typeof verification.wallets === 'object') {
    pushWalletCandidate(candidates, verification.wallets.solana, 'solana');
    pushWalletCandidate(candidates, verification.wallets.sol, 'solana');
    if (Array.isArray(verification.wallets)) pushWalletCandidate(candidates, verification.wallets);
  }
  pushWalletCandidate(candidates, verification.walletAddress, verification.chain);
  pushWalletCandidate(candidates, verification.wallet, verification.chain);

  for (const candidate of candidates) {
    try {
      const key = new PublicKey(candidate);
      if (key.toBase58() === candidate) return candidate;
    } catch (_) { /* try the next declared wallet */ }
  }
  return null;
}

function identityPda(walletAddress) {
  const wallet = new PublicKey(walletAddress);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('identity'), wallet.toBuffer()],
    SATP_IDENTITY_PROGRAM,
  )[0].toBase58();
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function bodyWithoutChallenge(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const copy = { ...body };
  delete copy.walletChallenge;
  return copy;
}

function bodyDigest(body) {
  return crypto.createHash('sha256').update(canonicalJson(body || {})).digest('hex');
}

function initializeMarketplaceWalletChallengeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS marketplace_wallet_challenges (
      id TEXT PRIMARY KEY,
      nonce TEXT NOT NULL UNIQUE,
      action TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      http_method TEXT NOT NULL,
      route_path TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      identity_pda TEXT NOT NULL,
      body_digest TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_marketplace_wallet_challenges_expiry
      ON marketplace_wallet_challenges(expires_at);
  `);
}

function buildChallenge({ id, nonce, action, resourceId, method, routePath, actorId, walletAddress, identityPDA, digest, issuedAt, expiresAt }) {
  return [
    'AgentFolio Marketplace Wallet Challenge v2',
    `challengeId:${id}`,
    `nonce:${nonce}`,
    `issuedAt:${issuedAt}`,
    `expiresAt:${expiresAt}`,
    `action:${action}`,
    `resource:${resourceId}`,
    `method:${method}`,
    `path:${routePath}`,
    `actor:${actorId}`,
    `wallet:${walletAddress}`,
    `satpIdentityPDA:${identityPDA}`,
    `bodySHA256:${digest}`,
  ].join('\n');
}

function challengeFromRequest(req) {
  if (req.body?.walletChallenge) return req.body.walletChallenge;
  const encoded = req.headers['x-marketplace-wallet-challenge'];
  if (!encoded || Array.isArray(encoded)) return null;
  try { return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); } catch (_) { return null; }
}

function actorFromRequest(req) {
  return String(
    req.body?.actorId
    || req.body?.clientId
    || req.body?.applicantId
    || req.body?.submittedBy
    || req.body?.requestedBy
    || req.body?.approvedBy
    || req.headers['x-marketplace-actor']
    || '',
  ).trim();
}

function cleanBoundString(value, field, maxLength = 1000) {
  const result = String(value || '').trim();
  if (!result || result.length > maxLength) throw new Error(`${field} is required`);
  return result;
}

function issueChallenge(db, input, now = new Date()) {
  initializeMarketplaceWalletChallengeSchema(db);
  const actorId = cleanBoundString(input.actorId, 'actorId', 200);
  const action = cleanBoundString(input.action, 'action', 100);
  const resourceId = cleanBoundString(input.resourceId, 'resourceId', 500);
  const method = cleanBoundString(input.method, 'method', 10).toUpperCase();
  const routePath = cleanBoundString(input.path, 'path', 2000);
  if (!['GET', 'POST'].includes(method)) throw new Error('method must be GET or POST');
  if (!routePath.startsWith('/api/') || routePath.includes('?') || routePath.includes('#')) {
    throw new Error('path must be an exact API route path without query or fragment');
  }
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(actorId);
  const walletAddress = profileWallet(profile);
  if (!profile || !walletAddress) {
    const error = new Error('Actor wallet authority not found');
    error.status = 403;
    throw error;
  }
  const identityPDA = identityPda(walletAddress);
  const issuedAt = now.toISOString();
  db.prepare('DELETE FROM marketplace_wallet_challenges WHERE expires_at <= ?').run(issuedAt);
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString();
  const id = `mwc_${crypto.randomUUID()}`;
  const nonce = crypto.randomBytes(32).toString('base64url');
  const digest = bodyDigest(input.body || {});
  const message = buildChallenge({ id, nonce, action, resourceId, method, routePath, actorId, walletAddress, identityPDA, digest, issuedAt, expiresAt });
  db.prepare(`
    INSERT INTO marketplace_wallet_challenges (
      id, nonce, action, resource_id, http_method, route_path, actor_id,
      wallet_address, identity_pda, body_digest, issued_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, nonce, action, resourceId, method, routePath, actorId, walletAddress, identityPDA, digest, issuedAt, expiresAt);
  return { challengeId: id, nonce, action, resourceId, method, path: routePath, actorId, walletAddress, identityPDA, bodyDigest: digest, issuedAt, expiresAt, message };
}

function registerMarketplaceAuthChallengeRoute(app, { getDb, closeDb = false } = {}) {
  if (typeof getDb !== 'function') throw new TypeError('getDb is required');
  if (app[REGISTERED_CHALLENGE_ROUTE]) return;
  app[REGISTERED_CHALLENGE_ROUTE] = true;
  const schemaDb = getDb();
  initializeMarketplaceWalletChallengeSchema(schemaDb);
  if (closeDb) schemaDb.close();
  app.post(CHALLENGE_ROUTE, marketplaceChallengeLimiter, (req, res) => {
    const db = getDb();
    try {
      return res.status(201).json(issueChallenge(db, req.body || {}));
    } catch (error) {
      return res.status(error.status || 400).json({ code: error.status === 403 ? 'AUTH_INVALID' : 'INVALID_CHALLENGE_REQUEST', error: error.message });
    } finally {
      if (closeDb) db.close();
    }
  });
}

function createMarketplaceAuth({ getDb, closeDb = false, actorProperty = 'marketplaceActorId' }) {
  if (typeof getDb !== 'function') throw new TypeError('getDb is required');

  return ({ action, resourceId }) => (req, res, next) => {
    const db = getDb();
    try {
      // Marketplace credentials are headers-only. Query-string API keys leak
      // through logs, caches, referrers, and browser history.
      const apiKey = marketplaceApiKeyFromRequest(req);
      if (apiKey) {
        const profile = db.prepare('SELECT id FROM profiles WHERE api_key = ?').get(apiKey);
        if (!profile) return res.status(403).json({ code: 'AUTH_INVALID', error: 'Invalid API key' });
        req[actorProperty] = profile.id;
        return next();
      }

      const actorId = actorFromRequest(req);
      const challenge = challengeFromRequest(req);
      if (!actorId || !challenge?.challengeId) {
        return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'API key or signed wallet challenge required' });
      }
      initializeMarketplaceWalletChallengeSchema(db);
      const row = db.prepare('SELECT * FROM marketplace_wallet_challenges WHERE id = ?').get(String(challenge.challengeId));
      if (!row) return res.status(401).json({ code: 'AUTH_INVALID', error: 'Unknown wallet challenge' });

      const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(actorId);
      const walletAddress = profileWallet(profile);
      if (!profile || !walletAddress) {
        return res.status(403).json({ code: 'AUTH_INVALID', error: 'Actor wallet authority not found' });
      }
      const resolvedAction = String(typeof action === 'function' ? action(req) : action || '').trim();
      const rawResource = typeof resourceId === 'function' ? resourceId(req, actorId) : resourceId;
      const resolvedResource = rawResource === null || rawResource === undefined ? '' : String(rawResource).trim();
      if (!resolvedAction || !resolvedResource) {
        return res.status(401).json({ code: 'AUTH_INVALID', error: 'Marketplace action requires an exact resource identifier' });
      }
      const digest = bodyDigest(bodyWithoutChallenge(req.body));
      const expectedMessage = buildChallenge({
        id: row.id, nonce: row.nonce, action: row.action, resourceId: row.resource_id,
        method: row.http_method, routePath: row.route_path, actorId: row.actor_id,
        walletAddress: row.wallet_address, identityPDA: row.identity_pda,
        digest: row.body_digest, issuedAt: row.issued_at, expiresAt: row.expires_at,
      });
      if (row.actor_id !== actorId
        || row.action !== resolvedAction
        || row.resource_id !== resolvedResource
        || row.http_method !== req.method.toUpperCase()
        || row.route_path !== req.path
        || row.body_digest !== digest
        || row.wallet_address !== walletAddress
        || row.identity_pda !== identityPda(walletAddress)
        || challenge.walletAddress !== row.wallet_address
        || challenge.identityPDA !== row.identity_pda
        || challenge.message !== expectedMessage) {
        return res.status(401).json({ code: 'AUTH_INVALID', error: 'Wallet challenge does not match this exact marketplace request' });
      }
      let signature;
      try { signature = Buffer.from(String(challenge.signature || ''), 'base64'); } catch (_) { signature = null; }
      if (!signature || signature.length !== nacl.sign.signatureLength
        || !nacl.sign.detached.verify(Buffer.from(expectedMessage), signature, new PublicKey(walletAddress).toBytes())) {
        return res.status(401).json({ code: 'AUTH_INVALID', error: 'Invalid wallet challenge signature' });
      }

      const consumedAt = new Date().toISOString();
      const consumed = db.prepare(`
        UPDATE marketplace_wallet_challenges SET consumed_at = ?
        WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
      `).run(consumedAt, row.id, consumedAt);
      if (consumed.changes !== 1) {
        return res.status(401).json({ code: 'AUTH_CHALLENGE_USED_OR_EXPIRED', error: 'Wallet challenge was already used or has expired' });
      }
      req[actorProperty] = actorId;
      return next();
    } catch (error) {
      return res.status(500).json({ code: 'AUTH_FAILURE', error: error.message });
    } finally {
      if (closeDb) db.close();
    }
  };
}

module.exports = {
  CHALLENGE_TTL_MS,
  bodyDigest,
  buildChallenge,
  createMarketplaceAuth,
  initializeMarketplaceWalletChallengeSchema,
  issueChallenge,
  profileWallet,
  registerMarketplaceAuthChallengeRoute,
};
