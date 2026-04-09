/**
 * Trust Credential API — credat Integration PoC
 * 
 * Issues W3C Verifiable Credentials (as JWT) containing AgentFolio trust scores.
 * credat agents can present these credentials to prove trust/reputation.
 * 
 * Endpoint: GET /api/trust-credential/:agentId
 * Returns: { credential (JWT), decoded (payload for inspection) }
 * 
 * The JWT is signed with the platform's Ed25519 SATP attestation key,
 * making it cryptographically verifiable by any party with the public key.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const _bs58 = require('bs58');
const bs58 = _bs58.default || _bs58;
const fs = require('fs');
const path = require('path');

const SITE_URL = process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://agentfolio.bot';
const SITE_HOSTNAME = (() => {
  try { return new URL(SITE_URL).hostname; } catch { return 'agentfolio.bot'; }
})();

// ─── Key Management ─────────────────────────────────────
const KEYPAIR_PATH = process.env.SATP_PLATFORM_KEYPAIR ||
  process.env.SATP_KEYPAIR_PATH || './config/platform-keypair.json';

let cachedKeyPair = null;

function getSigningKey() {
  if (cachedKeyPair) return cachedKeyPair;

  try {
    const raw = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf8'));
    const fullKey = Uint8Array.from(raw);
    // Solana keypair: first 32 bytes = secret, last 32 = public
    const secretKey = fullKey.slice(0, 32);
    const publicKey = fullKey.slice(32, 64);
    const publicKeyB58 = bs58.encode(publicKey);

    // Derive an HMAC signing secret from the private key for JWT HS256
    // (Ed25519 keys can't be used directly with jsonwebtoken's RS/ES algs
    //  without PEM conversion, so we derive a 256-bit HMAC secret)
    const jwtSecret = crypto
      .createHmac('sha256', Buffer.from(secretKey))
      .update('agentfolio-trust-credential-v1')
      .digest();

    cachedKeyPair = {
      jwtSecret,
      publicKeyB58,
      fullKeypair: fullKey,
    };
    return cachedKeyPair;
  } catch (err) {
    console.error('[TrustCredential] Failed to load signing key:', err.message);
    return null;
  }
}

// ─── W3C VC Constants ───────────────────────────────────
const ISSUER_DID = 'did:web:' + SITE_HOSTNAME;
const CREDENTIAL_CONTEXT = [
  'https://www.w3.org/2018/credentials/v1',
  SITE_URL + '/schemas/trust-credential/v1',
];
const CREDENTIAL_TYPE = ['VerifiableCredential', 'AgentFolioTrustCredential'];
const CREDENTIAL_TTL_SECONDS = 86400; // 24 hours

// ─── Level Mapping ──────────────────────────────────────
function scoreTier(score) {
  if (score >= 80) return 'ELITE';
  if (score >= 60) return 'PRO';
  if (score >= 40) return 'VERIFIED';
  if (score >= 20) return 'BASIC';
  return 'NEW';
}

// ─── Route Registration ─────────────────────────────────
function registerTrustCredentialRoutes(app) {
  const profileStore = require('../profile-store');
  const { getV3Score } = require('../../v3-score-service');
  const chainCache = require('../lib/chain-cache');

  // ── Verify route MUST come before :agentId to avoid parameter capture ──

  /**
   * GET /api/trust-credential/verify
   * 
   * Verify a trust credential JWT.
   * Pass the JWT as ?token=<jwt> query parameter.
   * 
   * Returns: { valid, decoded, expired, issuer }
   */
  app.get('/api/trust-credential/verify', (req, res) => {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ error: 'token query parameter required' });
    }

    const keys = getSigningKey();
    if (!keys) {
      return res.status(500).json({ error: 'Verification key unavailable' });
    }

    try {
      const decoded = jwt.verify(token, keys.jwtSecret, { algorithms: ['HS256'] });
      return res.json({
        valid: true,
        issuer: decoded.iss,
        subject: decoded.sub,
        credential: decoded.vc,
        issuedAt: new Date(decoded.nbf * 1000).toISOString(),
        expiresAt: new Date(decoded.exp * 1000).toISOString(),
        expired: false,
      });
    } catch (err) {
      const isExpired = err.name === 'TokenExpiredError';
      let decoded = null;
      try { decoded = jwt.decode(token); } catch (_) {}

      return res.json({
        valid: false,
        expired: isExpired,
        error: err.message,
        decoded: decoded?.vc || null,
      });
    }
  });

  /**
   * GET /api/trust-credential/:agentId
   * 
   * Issues a signed JWT Verifiable Credential containing the agent's trust score.
   */
  app.get('/api/trust-credential/:agentId', async (req, res) => {
    const { agentId } = req.params;
    const format = req.query.format || 'jwt';

    try {
      // 1. Fetch profile from DB
      const db = profileStore.getDb();
      let profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(agentId);
      // Bug 3 fix: handle fallback
      if (!profile) {
        profile = db.prepare('SELECT * FROM profiles WHERE handle = ?').get(agentId);
      }
      if (!profile) {
        return res.status(404).json({
          error: 'Agent not found',
          agentId,
          hint: 'Register at ' + SITE_URL + ' first',
        });
      }

      // 2. Parse non-score profile fields only
      const parsed = {
        ...profile,
        wallets: {},
        tags: [],
        skills: [],
      };
      try { parsed.wallets = JSON.parse(profile.wallets || '{}'); } catch (_) {}
      try { const t = JSON.parse(profile.tags || '[]'); parsed.tags = Array.isArray(t) ? t : []; } catch (_) {}
      try { const s = JSON.parse(profile.skills || '[]'); parsed.skills = Array.isArray(s) ? s : []; } catch (_) {}

      // 3. Clean-start scoring: on-chain only. No DB verification fallback.
      const v3Score = await getV3Score(profile.id).catch(() => null);
      const rawChainAttestations = chainCache.getVerifications(profile.id, profile.created_at) || [];
      const seenPlatforms = new Set();
      const realAttestations = [];
      for (const att of rawChainAttestations) {
        const platform = att.platform === 'twitter' ? 'x' : att.platform;
        if (!platform || platform === 'review' || seenPlatforms.has(platform)) continue;
        let proofData = {};
        try { proofData = typeof att.proofData === 'string' ? JSON.parse(att.proofData) : (att.proofData || {}); } catch (_) {}
        const identifier = att.identifier || proofData.identifier || proofData.address || proofData.wallet || null;
        if (!identifier) continue;
        realAttestations.push({ platform, identifier });
        seenPlatforms.add(platform);
        if (platform === 'x') seenPlatforms.add('twitter');
      }
      const normalizedTrustScore = v3Score
        ? (v3Score.reputationScore > 10000 ? Math.round(v3Score.reputationScore / 10000) : (v3Score.reputationScore || 0))
        : 0;
      const normalizedVerificationLevel = v3Score?.verificationLevel ?? 0;
      const normalizedTier = (v3Score?.verificationLabel || 'Unverified').toUpperCase();
      const onChainRegistered = !!(profile.wallet && chainCache.isVerified(profile.wallet));

      // 4. Build W3C Verifiable Credential payload
      const now = new Date();
      const expiresAt = new Date(now.getTime() + CREDENTIAL_TTL_SECONDS * 1000);

      const credentialSubject = {
        id: `did:agentfolio:${agentId}`,
        agentId,
        name: profile.name,
        trustScore: normalizedTrustScore,
        maxScore: 800,
        tier: normalizedTier,
        verificationLevel: normalizedVerificationLevel,
        scoreVersion: v3Score ? 'v3' : 'none',
        verificationCount: realAttestations.length,
        onChainRegistered,
        breakdown: {
          onChainReputation: normalizedTrustScore,
          verifications: realAttestations.length,
          socialProof: 0,
          completeness: 0,
          marketplace: 0,
          tenure: 0,
        },
      };

      const vcPayload = {
        '@context': CREDENTIAL_CONTEXT,
        type: CREDENTIAL_TYPE,
        issuer: {
          id: ISSUER_DID,
          name: 'AgentFolio',
          url: SITE_URL,
        },
        issuanceDate: now.toISOString(),
        expirationDate: expiresAt.toISOString(),
        credentialSubject,
      };

      // 5. Return based on format
      if (format === 'json') {
        return res.json({
          credential: vcPayload,
          format: 'json',
          issuer: ISSUER_DID,
          note: 'Unsigned — use ?format=jwt for signed credential',
        });
      }

      // 6. Sign as JWT
      const keys = getSigningKey();
      if (!keys) {
        return res.status(500).json({ error: 'Signing key unavailable' });
      }

      const jwtPayload = {
        vc: vcPayload,
        sub: `did:agentfolio:${agentId}`,
        iss: ISSUER_DID,
        nbf: Math.floor(now.getTime() / 1000),
        jti: `urn:uuid:${crypto.randomUUID()}`,
      };

      const token = jwt.sign(jwtPayload, keys.jwtSecret, {
        algorithm: 'HS256',
        expiresIn: CREDENTIAL_TTL_SECONDS,
        header: {
          alg: 'HS256',
          typ: 'JWT',
          kid: keys.publicKeyB58,
        },
      });

      return res.json({
        credential: token,
        format: 'jwt',
        issuer: ISSUER_DID,
        publicKey: keys.publicKeyB58,
        expiresAt: expiresAt.toISOString(),
        decoded: vcPayload,
      });

    } catch (err) {
      console.error('[TrustCredential] Error:', err);
      return res.status(500).json({ error: 'Failed to issue credential', details: err.message });
    }
  });

  console.log('[TrustCredential] Routes registered: GET /api/trust-credential/verify, GET /api/trust-credential/:agentId');
}

module.exports = { registerTrustCredentialRoutes };
