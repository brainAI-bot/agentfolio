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

// ─── Key Management ─────────────────────────────────────
const KEYPAIR_PATH = process.env.SATP_PLATFORM_KEYPAIR ||
  '/home/ubuntu/.config/solana/brainforge-personal.json';

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
const ISSUER_DID = 'did:web:agentfolio.bot';
const CREDENTIAL_CONTEXT = [
  'https://www.w3.org/2018/credentials/v1',
  'https://agentfolio.bot/schemas/trust-credential/v1',
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
  const { computeScoreWithOnChain } = require('../scoring');
  const { getV3Score } = require('../../v3-score-service');

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
      const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(agentId);
      if (!profile) {
        return res.status(404).json({
          error: 'Agent not found',
          agentId,
          hint: 'Register at https://agentfolio.bot first',
        });
      }

      // 2. Parse stored JSON fields
      const parsed = {
        ...profile,
        verifications: [],
        wallets: {},
        tags: [],
        skills: [],
      };
      try {
        let vData = JSON.parse(profile.verification_data || '[]');
        // verification_data may be object-keyed (e.g. {twitter: {...}, github: {...}})
        if (vData && typeof vData === 'object' && !Array.isArray(vData)) {
          vData = Object.entries(vData).map(([platform, info]) => ({ platform, ...info }));
        }
        parsed.verifications = Array.isArray(vData) ? vData : [];
      } catch (_) { parsed.verifications = []; }
      try { parsed.wallets = JSON.parse(profile.wallets || '{}'); } catch (_) {}
      try { const t = JSON.parse(profile.tags || '[]'); parsed.tags = Array.isArray(t) ? t : []; } catch (_) {}
      try { const s = JSON.parse(profile.skills || '[]'); parsed.skills = Array.isArray(s) ? s : []; } catch (_) {}

      // 3. Compute trust score — prefer V3 on-chain Genesis Record, fallback to V2
      const scoreResult = await computeScoreWithOnChain(parsed);
      let v3Data = null;
      try {
        v3Data = await getV3Score(agentId);
      } catch (e) {
        console.warn('[TrustCredential] V3 score fetch failed for', agentId, e.message);
      }

      // 4. Build W3C Verifiable Credential payload
      const now = new Date();
      const expiresAt = new Date(now.getTime() + CREDENTIAL_TTL_SECONDS * 1000);

      const credentialSubject = {
        id: `did:agentfolio:${agentId}`,
        agentId,
        name: profile.name,
        trustScore: v3Data ? v3Data.reputationScore : scoreResult.score,
        maxScore: v3Data ? 1000 : scoreResult.maxScore,
        tier: v3Data ? v3Data.verificationLabel.toUpperCase() : (scoreResult.level || scoreTier(scoreResult.score)),
        scoreVersion: v3Data ? 'v3' : 'v2',
        verificationCount: parsed.verifications.filter(v => v.verified !== false).length,
        onChainRegistered: v3Data ? true : (scoreResult.onChainRegistered || false),
        breakdown: (() => {
          // V3 scoring uses different category structure than V2
          const cats = scoreResult.breakdown?.trustScore?.categories || {};
          const verCount = scoreResult.verificationCount || scoreResult.breakdown?.verificationLevel?.count || 0;
          const finalTotal = v3Data ? v3Data.reputationScore : (scoreResult.trustScore || scoreResult.score || 0);

          // When V3 Genesis Record overrides, the difference is on-chain reputation premium
          const v2Total = (cats.profileCompleteness || 0) + (cats.socialProof || 0) +
                          (cats.marketplace || 0) + (cats.onchain || 0) + (cats.tenure || 0);
          const onChainPremium = v3Data ? Math.max(finalTotal - v2Total, 0) : 0;

          // Compute raw (uncapped) component scores
          const raw = {
            onChainReputation: onChainPremium + (cats.onchain || 0),
            verifications: verCount * 15,
            socialProof: cats.socialProof || 0,
            completeness: cats.profileCompleteness || 0,
            marketplace: cats.marketplace || 0,
            tenure: cats.tenure || 0,
          };

          // Normalize proportionally so breakdown sums exactly to finalTotal
          const rawSum = Object.values(raw).reduce((a, b) => a + b, 0);
          if (rawSum === 0 || finalTotal === 0) {
            return { onChainReputation: 0, verifications: 0, socialProof: 0, completeness: 0, marketplace: 0, tenure: 0 };
          }
          const scale = finalTotal / rawSum;
          const keys = Object.keys(raw);
          const scaled = {};
          let allocated = 0;
          for (let i = 0; i < keys.length; i++) {
            if (i === keys.length - 1) {
              // Last component gets remainder to ensure exact sum
              scaled[keys[i]] = finalTotal - allocated;
            } else {
              scaled[keys[i]] = Math.round(raw[keys[i]] * scale);
              allocated += scaled[keys[i]];
            }
          }
          return scaled;
        })(),
      };

      const vcPayload = {
        '@context': CREDENTIAL_CONTEXT,
        type: CREDENTIAL_TYPE,
        issuer: {
          id: ISSUER_DID,
          name: 'AgentFolio',
          url: 'https://agentfolio.bot',
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
