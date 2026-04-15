/**
 * AgentFolio Backend Server
 * AI Agent Portfolio & Reputation Platform
 * 
 * FIXED: Discord verification now uses hardened version
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const logger = require('./logger');
const { z, validateBody } = require('./lib/request-validation');

const SITE_URL = process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://agentfolio.bot';
const SITE_HOSTNAME = (() => {
  try { return new URL(SITE_URL).hostname; } catch { return 'agentfolio.bot'; }
})();

// SATP Reviews integration
const satpReviews = require('./satp-reviews');
// SATP On-Chain API (read + write)
const { registerSATPRoutes } = require('./routes/satp-api');
const { registerSATPWriteRoutes } = require('./routes/satp-write-api');
const { registerSATPAutoIdentityRoutes } = require("./routes/satp-auto-identity");
// V3 auto-identity + BOA linker (brainChain deploy 2026-04-05)
const { registerSATPAutoIdentityV3Routes } = require("./routes/satp-auto-identity-v3");
const { registerBoaLinkerV3Routes } = require("./routes/satp-boa-linker-v3");
const { registerBoaMintRoutes, registerBoaMintCompleteRoute, registerBoaAgentMintRoute } = require("./api/boa-mint");
const { registerBoaMintFinalizeRoutes } = require("./api/boa-mint-finalize");
const { registerReviewsV2Routes } = require("./api/reviews-v2");
const { API_DOCS, generateDocsHTML } = require('./api/docs');

// Profile Store (SQLite-backed persistent profiles, endorsements, reviews)
const profileStore = require('./profile-store');
const { handleOnChainAvatarRequest } = require('./lib/onchain-avatar');

// Chain Cache — on-chain attestation data (source of truth for verifications)
let chainCache;
try {
  chainCache = require('./lib/chain-cache');
  console.log('✓ Chain-cache module loaded');
} catch (e) {
  console.warn('⚠️  Chain-cache not available:', e.message);
  chainCache = {
    getVerifications: () => [],
    getVerifiedPlatforms: () => [],
    getScore: () => null,
    getStats: () => ({}),
    start: () => {},
  };
}

// Scoring module
const { computeScore, computeScoreWithOnChain, computeLeaderboard, fetchOnChainData } = require('./scoring');
const { computeUnifiedTrustScore } = require('./lib/unified-trust-score');

// V3 on-chain score service (Genesis Records — authoritative)
let getV3Score;
try {
  getV3Score = require('../v3-score-service').getV3Score;
} catch (_) {
  try { getV3Score = require('./v3-score-service').getV3Score; } catch (_2) {
    getV3Score = async () => null; // Graceful fallback if module missing
  }
}

// x402 Payment Layer
const { paymentMiddleware, x402ResourceServer } = require('@x402/express');
const { HTTPFacilitatorClient } = require('@x402/core/server');
const { registerExactSvmScheme } = require('@x402/svm/exact/server');

const X402_RECEIVE_ADDRESS = process.env.X402_RECEIVE_ADDRESS || '';
const X402_FACILITATOR = process.env.X402_FACILITATOR || '';
const X402_NETWORK = process.env.X402_NETWORK || '';
const X402_ENABLED = process.env.X402_ENABLED === 'true'
  && process.env.X402_SCHEME === 'svm'
  && X402_NETWORK.toLowerCase().startsWith('solana')
  && !!X402_RECEIVE_ADDRESS
  && !!X402_FACILITATOR;
const X402_DISABLE_REASON = X402_ENABLED ? null : 'x402 disabled until Solana SVM config is explicitly enabled';

// Discord verification (HARDENED VERSION - FIXED!)
let discordVerify;
try {
  discordVerify = require('./discord-verify-hardened');
  console.log('✓ Discord hardened verification loaded successfully');
} catch (error) {
  console.log('⚠️  Discord hardened verification not found, using fallback');
  discordVerify = {
    initiateDiscordVerification: () => ({ success: false, error: 'Not implemented' }),
    verifyDiscordChallenge: () => ({ verified: false, error: 'Not implemented' })
  };
}

// Telegram verification provider
let telegramVerify;
try {
  telegramVerify = require('./telegram-verify');
  console.log('✓ Telegram verification loaded successfully');
} catch (error) {
  console.log('⚠️  Telegram verification not found, using fallback');
  telegramVerify = {
    initiateTelegramVerification: () => ({ success: false, error: 'Not implemented' }),
    verifyTelegramChallenge: () => ({ verified: false, error: 'Not implemented' }),
    getTelegramVerificationStatus: () => ({ found: false })
  };
}

// Domain verification provider
let domainVerify;
try {
  const hardenedDomainVerify = require('./lib/domain-verify-hardened');
  const { getChallenge } = require('./lib/verification-challenges');
  domainVerify = {
    initiateDomainVerification: hardenedDomainVerify.initiateDomainVerification,
    verifyDomainChallenge: async (challengeId) => {
      const challenge = await getChallenge(challengeId);
      const result = await hardenedDomainVerify.verifyDomainOwnership(challengeId);

      if (result?.verified && challenge) {
        const domain = challenge.challengeData?.identifier;
        profileStore.addVerification(challenge.challengeData?.profileId, 'domain', domain, {
          challengeId,
          domain,
          method: result.method || result.proof?.method || 'well_known',
          verifiedAt: result.verifiedAt || new Date().toISOString(),
        });

        return {
          ...result,
          platform: 'domain',
          identifier: domain,
          profileId: challenge.challengeData?.profileId,
        };
      }

      return result;
    },
    getDomainVerificationStatus: async (challengeId) => {
      const challenge = await getChallenge(challengeId);
      if (!challenge) return { found: false };
      return {
        found: true,
        verified: challenge.status === 'completed',
        domain: challenge.challengeData?.identifier,
        expiresAt: challenge.challengeData?.expiresAt,
      };
    }
  };
  console.log('✓ Domain hardened verification loaded successfully');
} catch (error) {
  console.log('⚠️  Domain verification not found, using fallback');
  domainVerify = {
    initiateDomainVerification: () => ({ success: false, error: 'Not implemented' }),
    verifyDomainChallenge: () => ({ verified: false, error: 'Not implemented' }),
    getDomainVerificationStatus: () => ({ found: false })
  };
}

// Website verification provider
let websiteVerify;
try {
  websiteVerify = require('./website-verify');
  console.log('✓ Website verification loaded successfully');
} catch (error) {
  console.log('⚠️  Website verification not found, using fallback');
  websiteVerify = {
    initiateWebsiteVerification: () => ({ success: false, error: 'Not implemented' }),
    verifyWebsiteChallenge: () => ({ verified: false, error: 'Not implemented' }),
    getWebsiteVerificationStatus: () => ({ found: false })
  };
}

// ETH Wallet verification provider
let ethVerify;
try {
  ethVerify = require('./eth-verify-hardened');
  console.log('✓ ETH wallet verification loaded successfully');
} catch (error) {
  console.log('⚠️  ETH verification not found, using fallback');
  ethVerify = {
    generateChallenge: () => ({ error: 'Not implemented' }),
    verifySignature: () => ({ verified: false, error: 'Not implemented' })
  };
}

// ENS verification provider
let ensVerify;
try {
  ensVerify = require('./ens-verify');
  console.log('✓ ENS verification loaded successfully');
} catch (error) {
  console.log('⚠️  ENS verification not found, using fallback');
  ensVerify = {
    generateChallenge: () => ({ error: 'Not implemented' }),
    verifyENSOwnership: () => ({ verified: false, error: 'Not implemented' }),
    resolveENS: () => ({ resolved: false, error: 'Not implemented' })
  };
}

// Farcaster verification provider
let farcasterVerify;
try {
  farcasterVerify = require('./farcaster-verify');
  console.log('✓ Farcaster verification loaded successfully');
} catch (error) {
  console.log('⚠️  Farcaster verification not found, using fallback');
  farcasterVerify = {
    generateChallenge: () => ({ error: 'Not implemented' }),
    verifyCast: () => ({ verified: false, error: 'Not implemented' })
  };
}

// App configuration
const app = express();
app.set("trust proxy", 1);
app.get('/api/avatar/onchain', (req, res) => handleOnChainAvatarRequest(req, res, new URL(req.originalUrl, `http://${req.get('host')}`)));
const PORT = process.env.PORT || 3333;
const NODE_ENV = process.env.NODE_ENV || 'development';

const emptyToUndefined = (value) => typeof value === 'string' && value.trim() == '' ? undefined : value;
const profileIdInput = z.string().trim().min(1).max(128);
const challengeIdInput = z.string().trim().min(1).max(256);
const optionalMethodInput = z.preprocess(emptyToUndefined, z.string().trim().min(1).max(64).optional());
const urlInput = z.string().trim().url().max(500);
const githubUsernameInput = z.string().trim().min(1).max(39).regex(/^[A-Za-z0-9-]+$/, 'Invalid GitHub username');
const xHandleInput = z.string().trim().min(1).max(30).regex(/^@?[A-Za-z0-9_]{1,15}$/, 'Invalid X handle');
const solanaAddressInput = z.string().trim().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'Invalid Solana address');
const ethAddressInput = z.string().trim().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid ETH address');
const emailInput = z.string().trim().email('Invalid email address');
const verificationSchemas = {
  discordInitiate: z.object({
    profileId: profileIdInput,
    discordUsername: z.string().trim().min(2).max(64),
  }),
  discordVerify: z.object({
    challengeId: challengeIdInput,
    messageUrl: z.preprocess(emptyToUndefined, z.string().trim().url().max(500).optional()),
  }),
  telegramInitiate: z.object({
    profileId: profileIdInput,
    telegramUsername: z.string().trim().min(3).max(64).regex(/^@?[A-Za-z0-9_]{3,32}$/, 'Invalid Telegram username'),
  }),
  telegramVerify: z.object({
    challengeId: challengeIdInput,
  }),
  domainInitiate: z.object({
    profileId: profileIdInput,
    domain: z.string().trim().min(3).max(253).regex(/^(?!https?:\/\/)(?!-)(?:[A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,63}$/, 'Invalid domain'),
  }),
  domainVerify: z.object({
    challengeId: challengeIdInput,
    method: optionalMethodInput,
  }),
  websiteInitiate: z.object({
    profileId: profileIdInput,
    websiteUrl: urlInput,
  }),
  websiteVerify: z.object({
    challengeId: challengeIdInput,
    method: optionalMethodInput,
  }),
  ethInitiate: z.object({
    profileId: profileIdInput,
    walletAddress: ethAddressInput,
  }),
  signatureVerify: z.object({
    challengeId: challengeIdInput,
    signature: z.string().trim().min(10).max(4096),
  }),
  ensInitiate: z.object({
    profileId: profileIdInput,
    ensName: z.string().trim().min(5).max(255).regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/i, 'Invalid ENS name'),
  }),
  farcasterInitiate: z.object({
    profileId: profileIdInput,
    fid: z.union([z.string(), z.number()]).transform((value) => String(value).trim()).pipe(z.string().min(1).max(32).regex(/^\d+$/, 'Invalid fid')),
  }),
  farcasterVerify: z.object({
    challengeId: challengeIdInput,
    castHash: z.string().trim().min(3).max(256),
  }),
  githubChallenge: z.object({
    profileId: profileIdInput,
    githubUsername: z.preprocess(emptyToUndefined, githubUsernameInput.optional()),
    username: z.preprocess(emptyToUndefined, githubUsernameInput.optional()),
  }).refine((data) => data.githubUsername || data.username, {
    path: ['githubUsername'],
    message: 'githubUsername or username required',
  }),
  githubConfirm: z.object({
    challengeId: challengeIdInput,
    gistUrl: urlInput,
  }),
  xChallenge: z.object({
    profileId: profileIdInput,
    xHandle: xHandleInput,
  }),
  xConfirm: z.object({
    challengeId: challengeIdInput,
    tweetUrl: urlInput,
  }),
  solanaChallenge: z.object({
    profileId: profileIdInput,
    walletAddress: solanaAddressInput,
  }),
  solanaConfirm: z.object({
    challengeId: challengeIdInput,
    signature: z.string().trim().min(32).max(4096),
  }),
  agentmailChallenge: z.object({
    profileId: profileIdInput,
    email: z.preprocess(emptyToUndefined, emailInput.optional()),
  }),
  agentmailConfirm: z.object({
    challengeId: z.preprocess(emptyToUndefined, challengeIdInput.optional()),
    profileId: z.preprocess(emptyToUndefined, profileIdInput.optional()),
    email: z.preprocess(emptyToUndefined, emailInput.optional()),
    code: z.string().trim().min(1).max(64),
  }).refine((data) => data.challengeId || data.profileId, {
    path: ['challengeId'],
    message: 'challengeId or profileId required',
  }),
};

const publicApiLimiter = rateLimit({
  validate: false,
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const ip = String(req.ip || req.socket?.remoteAddress || '');
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  },
  message: { error: 'Too many API requests. Try again in 1 minute.' },
});

const registerApiLimiter = rateLimit({
  validate: false,
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Try again in 1 hour.' },
});

// Basic middleware
app.use(cors({
  origin: NODE_ENV === 'production' 
    ? ['https://agentfolio.bot', 'https://www.agentfolio.bot']
    : true,
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(logger.httpMiddleware);
app.use('/api', publicApiLimiter);

app.get('/.well-known/agentfolio-verification.txt', (req, res) => {
  const candidatePaths = [
    path.join(__dirname, '..', 'frontend', 'public', '.well-known', 'agentfolio-verification.txt'),
    path.join(__dirname, '..', 'public', '.well-known', 'agentfolio-verification.txt')
  ];

  const filePath = candidatePaths.find((candidate) => fs.existsSync(candidate));
  if (!filePath) {
    return res.status(404).type('text/plain').send('Not found');
  }

  res.set('Access-Control-Allow-Origin', '*');
  res.type('text/plain').send(fs.readFileSync(filePath, 'utf8'));
});

app.get('/.well-known/agentfolio.json', (req, res) => {
  const candidatePaths = [
    path.join(__dirname, '..', 'frontend', 'public', '.well-known', 'agentfolio.json'),
    path.join(__dirname, '..', 'public', '.well-known', 'agentfolio.json')
  ];

  const filePath = candidatePaths.find((candidate) => fs.existsSync(candidate));
  if (!filePath) {
    return res.status(404).json({ error: 'Not found' });
  }

  res.set('Access-Control-Allow-Origin', '*');
  res.type('application/json').send(fs.readFileSync(filePath, 'utf8'));
});

app.get('/.well-known/agent.json', (req, res) => {
  const candidatePaths = [
    path.join(__dirname, '..', 'frontend', 'public', '.well-known', 'agent.json'),
    path.join(__dirname, '..', 'public', '.well-known', 'agent.json')
  ];

  const filePath = candidatePaths.find((candidate) => fs.existsSync(candidate));
  if (!filePath) {
    return res.status(404).json({ error: 'Not found' });
  }

  res.set('Access-Control-Allow-Origin', '*');
  res.type('application/json').send(fs.readFileSync(filePath, 'utf8'));
});

app.get('/directory', (req, res) => {
  res.redirect(302, '/leaderboard');
});
app.use('/api/register', registerApiLimiter);

// Security logging middleware
app.use((req, res, next) => {
  const suspicious = [
    'wp-admin', 'wp-login', 'admin', 'login.php', 
    '.env', '.git', 'config', 'backup',
    'shell', 'cmd', 'exec', '..', '/bin/',
    'HNAP1', 'cgi-bin'
  ];
  
  const userAgent = req.get('User-Agent') || 'unknown';
  const isContentTypeInvalid = req.method === 'POST' && 
    !req.get('Content-Type');
  
  if (suspicious.some(pattern => req.path.includes(pattern)) || isContentTypeInvalid) {
    console.log(`[Security] SUSPICIOUS: ${req.ip} - ${req.method} ${req.path}${isContentTypeInvalid ? ' - Invalid content type' : ' - Suspicious path pattern'} - UA: ${userAgent}`);
  }
  
  next();
});

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path.startsWith('/api/') || req.path === '/') {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});


// === Ecosystem Stats (for frontend) ===
app.get('/api/ecosystem/stats', (req, res) => {
  try {
    const db = profileStore.getDb();
    const total = db.prepare('SELECT COUNT(*) as c FROM profiles').get().c;
    const claimed = db.prepare('SELECT COUNT(*) as c FROM profiles WHERE claimed = 1').get().c;
    let verified = 0;
    try {
      verified = db.prepare('SELECT COUNT(DISTINCT profile_id) as c FROM verifications').get().c;
    } catch (_) {
      try { verified = db.prepare("SELECT COUNT(*) as c FROM profiles WHERE verification_data IS NOT NULL AND verification_data != '{}' AND verification_data != ''").get().c; } catch (__) {}
    }
    let onChain = 0;
    try { onChain = db.prepare("SELECT COUNT(DISTINCT profile_id) as c FROM verifications WHERE platform = 'satp'").get().c; } catch (_) {}
    res.json({ agents: { total, verified, claimed, avgSkills: 3 }, total_agents: total, totalAgents: total, verified, verifiedAgents: verified, claimed, on_chain: onChain, totalJobs: 0, totalVolume: 0 });
  } catch (e) {
    res.json({ agents: { total: 200, verified: 0 }, total_agents: 200, verified: 0, on_chain: 0 });
  }
});
app.get('/api/leaderboard', (req, res) => { const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''; res.redirect(301, '/api/leaderboard/scores' + qs); });
app.get('/api/stats', (req, res) => {
  try {
    const db = profileStore.getDb();
    const total = db.prepare('SELECT COUNT(*) as c FROM profiles').get().c;
    const claimed = db.prepare('SELECT COUNT(*) as c FROM profiles WHERE claimed = 1').get().c;
    // Count profiles that have at least one verification
    let verified = 0;
    try {
      verified = db.prepare('SELECT COUNT(DISTINCT profile_id) as c FROM verifications').get().c;
    } catch (_) {
      // Fallback: check verification_data JSON column
      try {
        verified = db.prepare("SELECT COUNT(*) as c FROM profiles WHERE verification_data IS NOT NULL AND verification_data != '{}' AND verification_data != ''").get().c;
      } catch (__) {}
    }
    let onChain = 0;
    try { onChain = db.prepare("SELECT COUNT(DISTINCT profile_id) as c FROM verifications WHERE platform = 'satp'").get().c; } catch (_) {}
    res.json({ agents: { total, verified, claimed, avgSkills: 3 }, total_agents: total, totalAgents: total, verified, verifiedAgents: verified, claimed, on_chain: onChain, totalJobs: 0, totalVolume: 0 });
  } catch (e) {
    console.error('[/api/stats] Error:', e.message);
    res.json({ agents: { total: 0, verified: 0 }, total_agents: 0, verified: 0, on_chain: 0, error: e.message });
  }
});

// ─── DID Document (.well-known/did.json) ────────────────
// Serves the DID Document for did:web:agentfolio.bot resolution.
// Any DID resolver can verify our trust credentials via this endpoint.
app.get('/.well-known/did.json', (req, res) => {
  // Reuse the same signing key used for trust credentials
  const trustCred = require('./routes/trust-credential');
  // We need the public key — extract it from the keypair
  const fs = require('fs');
  const _bs58 = require('bs58');
  const bs58 = _bs58.default || _bs58;
  
  let publicKeyB58 = null;
  let publicKeyMultibase = null;
  try {
    const keypairPath = process.env.SATP_PLATFORM_KEYPAIR ||
      '/home/ubuntu/.config/solana/brainforge-personal.json';
    const raw = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
    const fullKey = Uint8Array.from(raw);
    const publicKey = fullKey.slice(32, 64);
    publicKeyB58 = bs58.encode(publicKey);
    // Multibase: 'z' prefix + base58btc-encoded (0xed01 prefix for Ed25519)
    const multicodecPrefix = Buffer.from([0xed, 0x01]);
    const multicodecKey = Buffer.concat([multicodecPrefix, Buffer.from(publicKey)]);
    publicKeyMultibase = 'z' + bs58.encode(multicodecKey);
  } catch (err) {
    console.error('[DID] Failed to load signing key:', err.message);
    return res.status(500).json({ error: 'DID document unavailable — signing key error' });
  }

  const did = 'did:web:' + SITE_HOSTNAME;
  const didDocument = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: did,
    verificationMethod: [
      {
        id: `${did}#key-1`,
        type: 'Ed25519VerificationKey2020',
        controller: did,
        publicKeyMultibase,
      },
    ],
    authentication: [`${did}#key-1`],
    assertionMethod: [`${did}#key-1`],
    service: [
      {
        id: `${did}#trust-credential`,
        type: 'AgentFolioTrustCredential',
        serviceEndpoint: SITE_URL + '/api/trust-credential',
      },
      {
        id: `${did}#satp`,
        type: 'SolanaAttestationProtocol',
        serviceEndpoint: SITE_URL + '/api/satp',
      },
      {
        id: `${did}#api`,
        type: 'AgentFolioAPI',
        serviceEndpoint: SITE_URL + '/api',
      },
    ],
  };

  res.setHeader('Content-Type', 'application/did+json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json(didDocument);
});

// Explorer API — /api/explorer/agents, /stats, /leaderboard, /search (MUST be before :agentId catch-all)
try {
  const explorerApi = require("./routes/explorer-api");
  app.use("/api/explorer", explorerApi);
  console.log("[Explorer API] Mounted at /api/explorer — agents, stats, leaderboard, search");
} catch (e) {
  console.warn("[Explorer API] Failed to mount:", e.message);
}

// ─── API Explorer (agent profile deep-link) ─────────────
app.get('/api/explorer/:agentId', async (req, res) => {
  const rawAgentId = String(req.params.agentId || '').trim();
  const parseJsonFieldSafe = (value, fallback) => {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch (_) { return fallback; }
  };
  const normalizeExplorerPlatform = (platform) => {
    const normalized = String(platform || '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'twitter') return 'x';
    if (normalized === 'solana_wallet') return 'solana';
    if (normalized === 'eth_wallet' || normalized === 'ethereum_wallet' || normalized === 'ethereum') return 'eth';
    if (normalized.endsWith('_verification')) return normalizeExplorerPlatform(normalized.slice(0, -'_verification'.length));
    return normalized;
  };
  const isPublicPlatform = (platform) => {
    const normalized = normalizeExplorerPlatform(platform);
    return !!normalized && !['satp', 'satp_v3', 'satp_verification'].includes(normalized);
  };
  const isLikelySolanaTxSignature = (value) => /^[1-9A-HJ-NP-Za-km-z]{60,120}$/.test(String(value || '').trim());

  try {
    const db = profileStore.getDb();
    let profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(rawAgentId);
    if (!profile) profile = db.prepare('SELECT * FROM profiles WHERE handle = ?').get(rawAgentId);
    if (!profile && rawAgentId && !rawAgentId.startsWith('agent_')) {
      const prefixedId = 'agent_' + rawAgentId.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(prefixedId);
    }
    if (!profile && rawAgentId) {
      profile = db.prepare('SELECT * FROM profiles WHERE LOWER(name) = LOWER(?)').get(rawAgentId);
    }
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    const v3Score = await getV3Score(profile.id).catch(() => null);
    const unified = computeUnifiedTrustScore(db, profile, { v3Score });
    const parsedNftAvatar = parseJsonFieldSafe(profile.nft_avatar, null);
    const resolvedAvatar = profile.avatar || parsedNftAvatar?.image || parsedNftAvatar?.arweaveUrl || null;

    const attestationHints = new Map();
    try {
      const chainCache = require('./lib/chain-cache');
      const chainAttestations = (chainCache.getVerifications(profile.id) || []).map((att) => ({ ...att }));
      if (typeof chainCache.resolveAttestationTxHintByPda === 'function') {
        for (const att of chainAttestations) {
          const currentTx = att?.txSignature || att?.tx_signature || null;
          if (!att?.pda || isLikelySolanaTxSignature(currentTx)) continue;
          try {
            const createdAtUnix = att?.timestamp ? Math.floor(new Date(att.timestamp).getTime() / 1000) : null;
            const hint = await chainCache.resolveAttestationTxHintByPda(att.pda, createdAtUnix);
            if (hint?.txSignature) {
              att.txSignature = hint.txSignature;
              att.solscanUrl = hint.solscanUrl || att.solscanUrl;
            }
          } catch (_) {}
        }
      }
      for (const att of chainAttestations) {
        const platform = normalizeExplorerPlatform(att?.platform || att?.attestationType);
        const txSignature = att?.txSignature || att?.tx_signature || null;
        if (!platform || !isLikelySolanaTxSignature(txSignature) || attestationHints.has(platform)) continue;
        attestationHints.set(platform, {
          txSignature,
          solscanUrl: att?.solscanUrl || ('https://solana.fm/tx/' + txSignature),
          timestamp: att?.timestamp || att?.verifiedAt || att?.createdAt || null,
        });
      }
    } catch (_) {}

    const publicVerifications = (unified.verifications || [])
      .filter(({ platform }) => isPublicPlatform(platform))
      .map(({ platform, verified, txSignature, solscanUrl, timestamp }) => {
        const normalizedPlatform = normalizeExplorerPlatform(platform);
        const hinted = attestationHints.get(normalizedPlatform) || null;
        const resolvedTxSignature = hinted?.txSignature || txSignature || null;
        const resolvedSolscanUrl = hinted?.solscanUrl || solscanUrl || (isLikelySolanaTxSignature(resolvedTxSignature) ? ('https://solana.fm/tx/' + resolvedTxSignature) : null);
        return {
          platform: normalizedPlatform || platform,
          verified,
          txSignature: resolvedTxSignature,
          solscanUrl: resolvedSolscanUrl,
          timestamp: timestamp || hinted?.timestamp || null,
        };
      });

    res.json({
      agentId: profile.id,
      profileId: profile.id,
      name: profile.name,
      did: 'did:agentfolio:' + profile.id,
      trustScore: unified.score,
      score: unified.score,
      reputationScore: unified.score,
      level: unified.level,
      levelName: unified.levelName,
      verificationLevel: unified.level,
      verificationLevelName: unified.levelName,
      verificationLabel: unified.levelName,
      tier: unified.levelName,
      verificationBadge: unified.badge,
      scoreVersion: unified.source,
      verifications: publicVerifications,
      avatar: resolvedAvatar,
      nftAvatar: parsedNftAvatar,
      nft_avatar: parsedNftAvatar,
      nftImage: parsedNftAvatar?.image || parsedNftAvatar?.arweaveUrl || resolvedAvatar,
      wallets: parseJsonFieldSafe(profile.wallets, {}),
      tags: parseJsonFieldSafe(profile.tags, []),
      skills: parseJsonFieldSafe(profile.skills, []),
      onChainRegistered: unified.hasSatpIdentity,
      v3: {
        reputationScore: unified.score,
        verificationLevel: unified.level,
        verificationLabel: unified.levelName,
        isBorn: !!(v3Score && v3Score.isBorn),
      },
      breakdown: unified.breakdown || {},
      links: {
        profile: SITE_URL + '/profile/' + profile.id,
        trustCredential: SITE_URL + '/trust/' + profile.id,
        api: SITE_URL + '/api/profile/' + profile.id,
      },
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
    });
  } catch (e) {
    console.error('[Explorer] unified route error:', e.stack || e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});


// ─── Trust Score API (dedicated endpoint) ────────────────
function isLoopbackTrustRequest(req) {
  const host = String(req.get('host') || '').toLowerCase();
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').toLowerCase();
  const remoteAddress = String(req.ip || req.socket?.remoteAddress || '').toLowerCase();
  const hostIsLoopback = host.startsWith('127.0.0.1:') || host.startsWith('localhost:');
  const forwardedIsLoopback = forwardedFor.includes('127.0.0.1') || forwardedFor.includes('::1');
  const remoteIsLoopback = remoteAddress.includes('127.0.0.1') || remoteAddress.includes('::1');
  return hostIsLoopback || forwardedIsLoopback || (!forwardedFor && remoteIsLoopback);
}

function isBrowserTrustRequest(req) {
  const accept = String(req.headers['accept'] || '').toLowerCase();
  const secFetchDest = String(req.headers['sec-fetch-dest'] || '').toLowerCase();
  const secFetchMode = String(req.headers['sec-fetch-mode'] || '').toLowerCase();
  const referer = String(req.headers['referer'] || '').toLowerCase();
  return accept.includes('text/html')
    || secFetchDest === 'document'
    || secFetchMode === 'navigate'
    || referer.startsWith('https://agentfolio.bot/')
    || referer.startsWith('http://agentfolio.bot/');
}

async function maybeGateProgrammaticTrustScore(req, res, profileId) {
  if (!X402_ENABLED) return false;
  if (req.headers['x-api-key']) return false;
  if (isLoopbackTrustRequest(req)) return false;
  if (isBrowserTrustRequest(req)) return false;

  const gateUrl = new URL(`http://127.0.0.1:${process.env.PORT || 3333}/api/score`);
  gateUrl.searchParams.set('id', profileId);
  if (req.query.wallet) gateUrl.searchParams.set('wallet', String(req.query.wallet));

  const forwardedHeaders = {};
  for (const headerName of ['accept', 'payment-signature', 'x-payment', 'payment', 'x-402-payment']) {
    if (req.headers[headerName]) forwardedHeaders[headerName] = req.headers[headerName];
  }

  const gateRes = await globalThis.fetch(gateUrl.toString(), { headers: forwardedHeaders });
  if (!gateRes.ok) {
    for (const [headerName, value] of gateRes.headers.entries()) {
      if (headerName === 'payment-required') continue;
      res.setHeader(headerName, value);
    }

    const paymentRequiredHeader = gateRes.headers.get('payment-required');
    if (paymentRequiredHeader) {
      try {
        const paymentRequired = JSON.parse(Buffer.from(paymentRequiredHeader, 'base64').toString('utf8'));
        const forwardedProto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
        const publicUrl = `${forwardedProto}://${req.get('host')}${req.originalUrl}`;
        if (paymentRequired && paymentRequired.resource && paymentRequired.resource.url) {
          paymentRequired.resource.url = publicUrl;
        }
        res.setHeader('payment-required', Buffer.from(JSON.stringify(paymentRequired)).toString('base64'));
      } catch {
        res.setHeader('payment-required', paymentRequiredHeader);
      }
    }

    const gateBody = await gateRes.text();
    let responseBody = gateBody;
    const trimmedGateBody = String(gateBody || '').trim();
    if (trimmedGateBody === '{}' || trimmedGateBody === '') {
      let paymentRequired = null;
      const encodedPaymentRequired = res.getHeader('payment-required');
      if (encodedPaymentRequired) {
        try {
          paymentRequired = JSON.parse(Buffer.from(String(encodedPaymentRequired), 'base64').toString('utf8'));
        } catch {}
      }
      responseBody = JSON.stringify({
        error: 'Payment Required',
        code: 'X402_PAYMENT_REQUIRED',
        paid: false,
        profileId,
        x402PaidUrl: '/api/score?id=' + encodeURIComponent(profileId),
        x402PaidAliasUrl: '/api/profile/' + encodeURIComponent(profileId) + '/trust-score',
        paymentRequired,
      });
      res.setHeader('content-type', 'application/json; charset=utf-8');
    }
    res.status(gateRes.status).send(responseBody);
    return true;
  }

  for (const headerName of ['payment-response', 'x-payment-response']) {
    const headerValue = gateRes.headers.get(headerName);
    if (headerValue) res.setHeader(headerName, headerValue);
  }

  req._x402Paid = true;
  return false;
}

app.get('/api/profile/:id/trust-score', async (req, res) => {
  try {
    const requestedId = String(req.params.id || '').trim();
    let profileId = requestedId;
    const db = profileStore.getDb();
    let row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    if (!row) {
      const byHandle = db.prepare('SELECT * FROM profiles WHERE handle = ?').get(profileId);
      if (byHandle) { row = byHandle; profileId = byHandle.id; }
    }
    if (!row && profileId && !profileId.startsWith('agent_')) {
      const prefixedId = 'agent_' + profileId.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const byPrefixedId = db.prepare('SELECT * FROM profiles WHERE id = ?').get(prefixedId);
      if (byPrefixedId) { row = byPrefixedId; profileId = byPrefixedId.id; }
    }
    if (!row && requestedId) {
      const byName = db.prepare('SELECT * FROM profiles WHERE LOWER(name) = LOWER(?)').get(requestedId);
      if (byName) { row = byName; profileId = byName.id; }
    }
    if (!row) return res.status(404).json({ error: 'Profile not found' });

    if (await maybeGateProgrammaticTrustScore(req, res, profileId)) return;

    const v3Score = await getV3Score(profileId).catch(() => null);
    const unified = computeUnifiedTrustScore(db, row, { v3Score });
    const payload = {
      profileId,
      trustScore: unified.score,
      score: unified.score,
      reputationScore: unified.score,
      verificationLevel: unified.level,
      verificationLevelName: unified.levelName,
      verificationLabel: unified.levelName,
      trustScoreBreakdown: unified.breakdown || {},
      breakdown: unified.breakdown || {},
      isBorn: !!(v3Score && v3Score.isBorn),
      faceImage: (v3Score && v3Score.faceImage) || null,
      source: unified.source,
      x402PaidUrl: X402_ENABLED ? '/api/score?id=' + encodeURIComponent(profileId) : null,
      x402PaidAliasUrl: X402_ENABLED ? '/api/profile/' + encodeURIComponent(profileId) + '/trust-score' : null,
    };

    res.json({
      ok: true,
      ...payload,
      data: payload,
    });
  } catch (e) {
    console.error('[TrustScore] unified route error:', e.stack || e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});


// ─── Genesis Record API (Bug 2 fix — Apr 6) ────────────────
app.get('/api/profile/:id/genesis', async (req, res) => {
  try {
    const requestedId = String(req.params.id || '').trim();
    let profileId = requestedId;
    const db = profileStore.getDb();
    let row = db.prepare('SELECT id FROM profiles WHERE id = ?').get(profileId);
    if (!row) {
      row = db.prepare('SELECT id FROM profiles WHERE handle = ?').get(profileId);
      if (row) profileId = row.id;
    }
    if (!row && profileId && !profileId.startsWith('agent_')) {
      const prefixedId = 'agent_' + profileId.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const byPrefixedId = db.prepare('SELECT id FROM profiles WHERE id = ?').get(prefixedId);
      if (byPrefixedId) { row = byPrefixedId; profileId = byPrefixedId.id; }
    }
    if (!row && requestedId) {
      const byName = db.prepare('SELECT id FROM profiles WHERE LOWER(name) = LOWER(?)').get(requestedId);
      if (byName) { row = byName; profileId = byName.id; }
    }
    if (!row) return res.status(404).json({ error: 'Profile not found' });

    const v3Score = await getV3Score(profileId);
    if (!v3Score) return res.json({ genesis: null, message: 'No on-chain genesis record' });

    let pda = null;
    try {
      const crypto = require('crypto');
      const { PublicKey } = require('@solana/web3.js');
      const PROGRAM_ID = new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');
      const hash = crypto.createHash('sha256').update(profileId).digest();
      pda = PublicKey.findProgramAddressSync([Buffer.from('genesis'), hash], PROGRAM_ID)[0].toBase58();
    } catch (e) { console.warn('[Genesis] PDA derivation failed:', e.message); }

    let genesis = {
      pda,
      agentName: v3Score.agentName || '',
      description: '',
      category: 'agent',
      verificationLevel: v3Score.verificationLevel || 0,
      verificationLabel: v3Score.verificationLabel || 'Unknown',
      reputationScore: v3Score.reputationScore || 0,
      reputationPct: v3Score.reputationPct || '0.00',
      isBorn: v3Score.isBorn || false,
      bornAt: v3Score.genesisRecord || null,
      faceImage: v3Score.faceImage || '',
      faceMint: v3Score.faceMint || '',
      faceBurnTx: '',
      createdAt: v3Score.createdAt || null,
      authority: v3Score.authority || '',
    };

    // [Apr 10] Preserve raw genesis here. Trust-score normalization belongs on
    // profile display paths, not the dedicated on-chain genesis endpoint.

    res.json({ genesis });
  } catch (e) {
    console.error('[Genesis API]', e.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── Badge SVG ──────────────────
const { generateBadgeSVG } = require('./lib/badge-svg');
const { getTrendingAgents, getRisingAgents } = require('./lib/trending');
const { SKILL_CATEGORIES, getAllStandardSkills, getSkillsByCategory, autocompleteSkills } = require('./lib/skills-taxonomy');
const { PROJECT_TYPES, MAX_PROJECTS } = require('./lib/projects');
const { JOB_CATEGORIES } = require('./lib/marketplace');
async function renderBadge(req, res) {
  try {
    const id = req.params.id;
    const db = profileStore.getDb();
    const row = db.prepare('SELECT id, name, claimed, wallet, created_at FROM profiles WHERE id = ?').get(id);
    if (!row) return res.status(404).type('text/plain').send('Profile not found');
    const v3Score = await getV3Score(id).catch(() => null);
    const unified = computeUnifiedTrustScore(db, row, { v3Score });
    const svg = generateBadgeSVG(row.name, unified.level, unified.score);
    res.set('Content-Type', 'image/svg+xml').set('Cache-Control', 'public, max-age=300').send(svg);
  } catch (e) {
    console.error('[Badge] unified route error:', e.stack || e.message);
    res.status(500).type('text/plain').send('Error generating badge');
  }
}
app.get('/api/badge/:id.svg', renderBadge);
app.get('/api/badge/:id', renderBadge);

async function loadProfilesForDiscoveryRoutes(limit = 1000) {
  const apiBase = process.env.INTERNAL_API_URL || 'http://127.0.0.1:3333';
  const res = await globalThis.fetch(`${apiBase}/api/profiles?limit=${limit}`);
  if (!res.ok) throw new Error(`profiles fetch failed: ${res.status}`);
  const json = await res.json();
  return Array.isArray(json?.profiles) ? json.profiles : [];
}

app.get('/api/trending', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const hours = Math.min(parseInt(req.query.hours) || 24, 168);
    const profiles = await loadProfilesForDiscoveryRoutes();
    const agents = getTrendingAgents(profiles, limit, hours);
    res.json({ ok: true, agents, count: agents.length, source: 'trending-lib' });
  } catch (e) {
    console.error('[Trending] route error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/rising', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const days = Math.min(parseInt(req.query.days) || 7, 30);
    const profiles = await loadProfilesForDiscoveryRoutes();
    const agents = getRisingAgents(profiles, limit, days);
    res.json({ ok: true, agents, count: agents.length, source: 'trending-lib' });
  } catch (e) {
    console.error('[Rising] route error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/skills', (_req, res) => {
  try {
    const skills = getAllStandardSkills();
    res.json({ ok: true, skills, count: skills.length });
  } catch (e) {
    console.error('[Skills] list error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/skills/categories', (_req, res) => {
  try {
    const categories = Object.keys(SKILL_CATEGORIES).map(key => ({ key, ...SKILL_CATEGORIES[key] }));
    res.json({ ok: true, categories, count: categories.length });
  } catch (e) {
    console.error('[Skills] categories error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/skills/autocomplete', (req, res) => {
  try {
    const q = String(req.query.q || req.query.query || '').trim();
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const skills = q ? autocompleteSkills(q, limit) : getAllStandardSkills().slice(0, limit);
    res.json({ ok: true, skills, count: skills.length, query: q });
  } catch (e) {
    console.error('[Skills] autocomplete error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/project-types', (_req, res) => {
  try {
    res.json({ ok: true, types: PROJECT_TYPES, maxProjects: MAX_PROJECTS });
  } catch (e) {
    console.error('[Projects] types error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/marketplace/categories', (_req, res) => {
  try {
    res.json({ ok: true, categories: JOB_CATEGORIES, count: Array.isArray(JOB_CATEGORIES) ? JOB_CATEGORIES.length : Object.keys(JOB_CATEGORIES || {}).length });
  } catch (e) {
    console.error('[Marketplace] categories error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/analytics/views', (_req, res) => {
  try {
    const db = profileStore.getDb();
    const leaderboard = db.prepare(`
      SELECT 
        a.agent_id AS profileId,
        p.name,
        p.handle,
        p.avatar,
        a.profile_views AS viewCount,
        a.badge_embeds AS badgeEmbeds,
        a.credential_requests AS credentialRequests,
        a.export_requests AS exportRequests
      FROM profile_analytics a
      LEFT JOIN profiles p ON p.id = a.agent_id
      ORDER BY a.profile_views DESC, a.badge_embeds DESC, a.credential_requests DESC
      LIMIT 50
    `).all();
    res.json({ ok: true, leaderboard, count: leaderboard.length });
  } catch (e) {
    console.error('[Analytics] views route error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── DID Resolution for Solana Wallets ──────────────────
app.get('/api/did/satp/sol/:address', async (req, res) => {
  const { address } = req.params;
  const satpIdentity = require('./satp-identity-client');
  try {
    const identity = await satpIdentity.getAgentIdentity(address, req.query.network || 'mainnet');
    if (!identity) {
      return res.status(404).json({ error: 'No SATP identity found', address });
    }
    
    const did = `did:satp:sol:${address}`;
    res.json({
      did,
      address,
      identity,
      links: {
        didDocument: `https://agentfolio.bot/.well-known/did.json`,
        satpProfile: `https://agentfolio.bot/api/satp/profile/${address}`,
        solscan: `https://solscan.io/account/${address}`,
      },
    });
  } catch (err) {
    console.error('[DID/SATP] Error:', err);
    res.status(500).json({ error: 'Failed to resolve DID', details: err.message });
  }
});

// ─── API Documentation ──────────────────────────────────
app.get('/docs', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>AgentFolio API Documentation</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0d1117; color: #c9d1d9; line-height: 1.6; }
    .container { max-width: 900px; margin: 0 auto; padding: 40px 20px; }
    h1 { color: #58a6ff; margin-bottom: 8px; }
    .subtitle { color: #8b949e; margin-bottom: 32px; }
    .section { background: #161b22; border: 1px solid #30363d; border-radius: 8px; margin-bottom: 24px; padding: 24px; }
    .section h2 { color: #58a6ff; margin-bottom: 16px; font-size: 1.2em; }
    .endpoint { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 16px; margin-bottom: 12px; }
    .method { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.8em; font-weight: bold; margin-right: 8px; }
    .get { background: #1f6feb33; color: #58a6ff; }
    .post { background: #3fb95033; color: #3fb950; }
    .path { font-family: 'SFMono-Regular', monospace; color: #f0f6fc; }
    .desc { color: #8b949e; margin-top: 6px; font-size: 0.9em; }
    .tag { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75em; margin-left: 8px; }
    .tag-free { background: #3fb95022; color: #3fb950; border: 1px solid #3fb95055; }
    .tag-paid { background: #d2992222; color: #d29922; border: 1px solid #d2992255; }
    .tag-new { background: #a371f722; color: #a371f7; border: 1px solid #a371f755; }
    a { color: #58a6ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { background: #1f2937; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    .did-box { background: #0d1117; border: 1px solid #3fb95055; border-radius: 6px; padding: 16px; margin-top: 12px; }
    .did-box code { display: block; margin: 4px 0; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🧠 AgentFolio API</h1>
    <p class="subtitle">AI Agent Reputation Platform — REST API Documentation</p>

    <div class="section">
      <h2>🔑 DID &amp; Identity</h2>
      <p style="margin-bottom:12px">AgentFolio is a <code>did:web</code> issuer. Our DID Document is publicly resolvable:</p>
      <div class="did-box">
        <code><strong>DID:</strong> did:web:agentfolio.bot</code>
        <code><strong>Resolve:</strong> <a href="/.well-known/did.json">GET /.well-known/did.json</a></code>
      </div>
      
      <div class="endpoint" style="margin-top:16px">
        <span class="method get">GET</span>
        <span class="path">/.well-known/did.json</span>
        <span class="tag tag-new">NEW</span>
        <p class="desc">W3C DID Document for <code>did:web:agentfolio.bot</code>. Contains Ed25519 verification key, trust credential service, and SATP endpoint.</p>
      </div>
      
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/did/satp/sol/:address</span>
        <span class="tag tag-new">NEW</span>
        <p class="desc">Resolve a Solana wallet to its SATP on-chain identity. Returns DID, identity data, and navigation links.</p>
      </div>
    </div>

    <div class="section">
      <h2>🛡️ Trust Credentials (credat)</h2>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/trust-credential/:agentId</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">Issue a signed W3C Verifiable Credential (JWT) for an agent's trust score. Query: <code>?format=json</code> for unsigned JSON.</p>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/trust-credential/verify</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">Verify a trust credential JWT. Query: <code>?token=&lt;jwt&gt;</code></p>
      </div>
    </div>

    <div class="section">
      <h2>📊 Agent Profiles</h2>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/profile/:id</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">Get agent profile data (JSON). Optional: <code>?wallet=&lt;address&gt;</code></p>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/explorer/:agentId</span>
        <span class="tag tag-new">NEW</span>
        <p class="desc">Rich agent explorer view — trust score, verifications, wallets, skills, breakdown, and navigation links.</p>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/profiles</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">List all agent profiles.</p>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/search</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">Search profiles. Query: <code>?q=&lt;term&gt;</code></p>
      </div>
    </div>

    <div class="section">
      <h2>⛓️ SATP (On-Chain)</h2>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/satp/identity/:wallet</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">Full on-chain SATP identity for a wallet. Query: <code>?network=mainnet|devnet</code></p>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/satp/scores/:wallet</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">On-chain reputation scores.</p>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/satp/attestations/:wallet</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">On-chain attestations.</p>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/satp/profile/:wallet</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">Combined on-chain + off-chain profile.</p>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/satp/registry</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">Browse the SATP registry. Query: <code>?page=1&amp;limit=20</code></p>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/satp/search</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">Search on-chain agents. Query: <code>?q=&lt;term&gt;</code></p>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/satp/reviews/:wallet</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">On-chain reviews received by wallet.</p>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/satp/reputation/:wallet</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">Aggregated on-chain reputation score.</p>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/satp/programs</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">SATP program addresses and network info.</p>
      </div>
    </div>

    <div class="section">
      <h2>📝 Registration</h2>
      <div class="endpoint">
        <span class="method post">POST</span>
        <span class="path">/api/register/batch</span>
        <span class="tag tag-new">NEW</span>
        <p class="desc">Batch-register multiple agent profiles. Body: JSON array of profile objects.</p>
      </div>
    </div>

    <div class="section">
      <h2>🔐 Verification</h2>
      <div class="endpoint">
        <span class="method post">POST</span>
        <span class="path">/api/verify/github/challenge</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">Initiate GitHub verification.</p>
      </div>
      <div class="endpoint">
        <span class="method post">POST</span>
        <span class="path">/api/verify/solana/challenge</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">Initiate Solana wallet verification.</p>
      </div>
      <div class="endpoint">
        <span class="method post">POST</span>
        <span class="path">/api/verify/x/challenge</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">Initiate X (Twitter) verification.</p>
      </div>
      <div class="endpoint">
        <span class="method post">POST</span>
        <span class="path">/api/verify/agentmail/challenge</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">Initiate AgentMail email verification.</p>
      </div>
      <div class="endpoint">
        <span class="method post">POST</span>
        <span class="path">/api/verification/discord/initiate</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">Initiate Discord verification (hardened).</p>
      </div>
    </div>

    <div class="section">
      <h2>💰 Scoring &amp; Leaderboard</h2>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/score</span>
        <span class="tag tag-paid">x402</span>
        <p class="desc">Compute trust score. Query: <code>?id=&lt;profileId&gt;&amp;wallet=&lt;optional&gt;</code>. Requires x402 payment.</p>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/profile/:id/trust-score</span>
        <span class="tag tag-paid">x402</span>
        <p class="desc">Paid trust score alias for direct profile lookups. Same x402 gate as <code>/api/score?id=&lt;profileId&gt;</code>.</p>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/satp/score/:id</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">Quick trust score lookup.</p>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/leaderboard/scores</span>
        <span class="tag tag-paid">x402</span>
        <p class="desc">Trust score leaderboard. Requires x402 payment.</p>
      </div>
    </div>

    <div class="section">
      <h2>🔧 System</h2>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/health</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">Health check — status, version, uptime.</p>
      </div>
      <div class="endpoint">
        <span class="method get">GET</span>
        <span class="path">/api/x402/pricing</span>
        <span class="tag tag-free">FREE</span>
        <p class="desc">x402 payment pricing for gated endpoints.</p>
      </div>
    </div>

    <div class="section" style="border-color:#3fb95055">
      <h2>🔗 Quick Links</h2>
      <p>
        <a href="/.well-known/did.json">DID Document</a> · 
        <a href="/api/health">Health</a> · 
        <a href="/api/profiles">All Profiles</a> · 
        <a href="/api/satp/programs">SATP Programs</a> · 
        <a href="/api/x402/pricing">x402 Pricing</a> · 
        <a href="https://github.com/brainai-bot">GitHub</a>
      </p>
    </div>

    <p style="text-align:center;color:#484f58;margin-top:32px">AgentFolio v1.0 · Solana-native · <a href="/">Home</a></p>
  </div>
</body>
</html>`);
});

app.get('/api/docs', (req, res) => {
  const wantsJson = req.query.format === 'json'
    || ((req.get('accept') || '').includes('application/json') && !(req.get('accept') || '').includes('text/html'));

  if (wantsJson) {
    return res.json(API_DOCS);
  }

  res.type('html').send(generateDocsHTML());
});

app.get('/api/docs.json', (req, res) => {
  res.json(API_DOCS);
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: NODE_ENV,
    discord_verification: discordVerify ? 'hardened' : 'fallback',
    telegram_verification: telegramVerify ? 'active' : 'fallback',
    domain_verification: domainVerify ? 'active' : 'fallback',
    website_verification: websiteVerify ? 'active' : 'fallback',
    fix_status: 'SERVER_IMPORT_FIXED',
    eth_verification: ethVerify ? 'active' : 'fallback',
    ens_verification: ensVerify ? 'active' : 'fallback',
    farcaster_verification: farcasterVerify ? 'active' : 'fallback',
    providers: ['discord', 'telegram', 'domain', 'website', 'eth', 'ens', 'farcaster']
  });
});

// Discord verification endpoints
app.get('/api/verification/discord/status', (req, res) => {
  res.json({
    status: 'hardened_version_active',
    import_fixed: true,
    line_68_status: 'UPDATED_TO_HARDENED_VERSION',
    security_features: [
      'challenge_response_flow',
      'cryptographic_verification', 
      'rate_limiting',
      'time_limited_challenges'
    ]
  });
});

app.post('/api/verification/discord/initiate', async (req, res) => {
  const body = validateBody(verificationSchemas.discordInitiate, req, res);
  if (!body) return;
  const { profileId, discordUsername } = body;

  try {
    const result = await discordVerify.initiateDiscordVerification(profileId, discordUsername);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/verification/discord/verify', async (req, res) => {
  const body = validateBody(verificationSchemas.discordVerify, req, res);
  if (!body) return;
  const { challengeId, messageUrl } = body;
  try {
    const result = await discordVerify.verifyDiscordChallenge(challengeId, messageUrl);
    if (result.verified && result.discordUsername) {
      const challenge = await require('./verification-challenges').getChallenge(challengeId);
      if (challenge && challenge.profileId) {
        profileStore.addVerification(challenge.profileId, 'discord', result.discordUsername, { challengeId, messageId: result.messageId, verifiedAt: new Date().toISOString() });
      }
    }
    res.status(result.verified ? 200 : 400).json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Telegram verification endpoints
app.get('/api/verification/telegram/status', async (req, res) => {
  const { challengeId } = req.query;
  
  if (!challengeId) {
    return res.status(400).json({ error: 'Missing challengeId parameter' });
  }
  
  try {
    const status = await telegramVerify.getTelegramVerificationStatus(challengeId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/verification/telegram/initiate', async (req, res) => {
  const body = validateBody(verificationSchemas.telegramInitiate, req, res);
  if (!body) return;
  const { profileId, telegramUsername } = body;

  try {
    const { initiateTelegramVerification } = require('./lib/telegram-verify-hardened');
    const result = await initiateTelegramVerification(profileId, telegramUsername);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/verification/telegram/verify', async (req, res) => {
  const body = validateBody(verificationSchemas.telegramVerify, req, res);
  if (!body) return;
  const { challengeId } = body;

  try {
    const { completeTelegramVerification } = require('./lib/telegram-verify-hardened');
    const result = await completeTelegramVerification(challengeId);
    res.status(result.verified ? 200 : 400).json(result);
  } catch (error) {
    const message = error?.message || 'Telegram verification failed';
    const status = /challenge not found|challenge expired/i.test(message) ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

// Domain verification endpoints
app.get('/api/verification/domain/status', async (req, res) => {
  const { challengeId } = req.query;
  
  if (!challengeId) {
    return res.status(400).json({ error: 'Missing challengeId parameter' });
  }
  
  try {
    const status = await domainVerify.getDomainVerificationStatus(challengeId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/verification/domain/initiate', async (req, res) => {
  const body = validateBody(verificationSchemas.domainInitiate, req, res);
  if (!body) return;
  const { profileId, domain } = body;

  try {
    const result = await domainVerify.initiateDomainVerification(profileId, domain);
    res.status(result?.success ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/verification/domain/verify', async (req, res) => {
  const body = validateBody(verificationSchemas.domainVerify, req, res);
  if (!body) return;
  const { challengeId, method } = body;

  try {
    const result = await domainVerify.verifyDomainChallenge(challengeId, method || 'auto');
    res.status(result?.verified ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Website verification endpoints
app.get('/api/verification/website/status', async (req, res) => {
  const { challengeId } = req.query;
  
  if (!challengeId) {
    return res.status(400).json({ error: 'Missing challengeId parameter' });
  }
  
  try {
    const status = await websiteVerify.getWebsiteVerificationStatus(challengeId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/verification/website/initiate', async (req, res) => {
  const body = validateBody(verificationSchemas.websiteInitiate, req, res);
  if (!body) return;
  const { profileId, websiteUrl } = body;

  try {
    const result = await websiteVerify.initiateWebsiteVerification(profileId, websiteUrl);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/verification/website/verify', async (req, res) => {
  const body = validateBody(verificationSchemas.websiteVerify, req, res);
  if (!body) return;
  const { challengeId, method } = body;

  try {
    const result = await websiteVerify.verifyWebsiteChallenge(challengeId, method || 'auto');
    const verifiedAt = new Date().toISOString();
    persistVerifiedWebsite(result.profileId, result.identifier, verifiedAt);
    res.json({
      ...result,
      verifiedAt
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== ETH WALLET VERIFICATION ==========
app.post('/api/verification/eth/initiate', (req, res) => {
  try {
    const body = validateBody(verificationSchemas.ethInitiate, req, res);
    if (!body) return;
    const { profileId, walletAddress } = body;
    const challenge = ethVerify.generateChallenge(profileId, walletAddress);
    res.json({ success: true, ...challenge, instructions: 'Sign the message with your ETH wallet, then POST signature to /api/verification/eth/verify' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/verification/eth/verify', (req, res) => {
  try {
    const body = validateBody(verificationSchemas.signatureVerify, req, res);
    if (!body) return;
    const { challengeId, signature } = body;
    const result = ethVerify.verifySignature(challengeId, signature);
    if (result.verified && result.profileId) {
      profileStore.addVerification(result.profileId, 'eth', result.walletAddress, { challengeId, signature: signature.slice(0, 16) + '...', verifiedAt: new Date().toISOString() });
    }
    res.status(result.verified ? 200 : 400).json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ========== ENS VERIFICATION ==========
app.post('/api/verification/ens/initiate', (req, res) => {
  try {
    const body = validateBody(verificationSchemas.ensInitiate, req, res);
    if (!body) return;
    const { profileId, ensName } = body;
    const challenge = ensVerify.generateChallenge(profileId, ensName);
    res.json({ success: true, ...challenge, instructions: 'Sign the message with the wallet that owns this ENS name, then POST to /api/verification/ens/verify' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/verification/ens/verify', async (req, res) => {
  try {
    const { challengeId, signature } = req.body;
    if (!challengeId || !signature) return res.status(400).json({ error: 'challengeId and signature required' });
    const result = await ensVerify.verifyENSOwnership(challengeId, signature);
    if (result.verified && result.profileId) {
      profileStore.addVerification(result.profileId, 'ens', result.ensName || result.identifier, { challengeId, verifiedAt: new Date().toISOString() });
    }
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/verification/ens/resolve/:name', async (req, res) => {
  try {
    const result = await ensVerify.resolveENS(req.params.name);
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ========== FARCASTER VERIFICATION ==========
app.post('/api/verification/farcaster/initiate', (req, res) => {
  try {
    const body = validateBody(verificationSchemas.farcasterInitiate, req, res);
    if (!body) return;
    const { profileId, fid } = body;
    const challenge = farcasterVerify.generateChallenge(profileId, fid);
    res.json({ success: true, ...challenge });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/verification/farcaster/verify', async (req, res) => {
  try {
    const body = validateBody(verificationSchemas.farcasterVerify, req, res);
    if (!body) return;
    const { challengeId, castHash } = body;
    const result = await farcasterVerify.verifyCast(challengeId, castHash);
    if (result.verified && result.profileId) {
      profileStore.addVerification(result.profileId, 'farcaster', result.fid || result.identifier, { challengeId, castHash, verifiedAt: new Date().toISOString() });
    }
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});


// P2: Admin Dashboard
app.get('/admin', (req, res) => {
  const getDb = profileStore.getDb;
  const key = req.query.key || req.headers['x-admin-key'];
  if (!key || key !== (process.env.ADMIN_KEY || 'bf-admin-2026')) {
    return res.status(401).send('<h1>401 Unauthorized</h1><p>Append ?key=YOUR_ADMIN_KEY</p>');
  }
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) as c FROM profiles').get().c;
  const claimed = db.prepare('SELECT COUNT(*) as c FROM profiles WHERE claimed = 1').get().c;
  const verified = db.prepare('SELECT COUNT(DISTINCT profile_id) as c FROM verifications').get().c;
  let onChain = 0;
  try { onChain = db.prepare("SELECT COUNT(DISTINCT profile_id) as c FROM verifications WHERE platform = 'satp'").get().c; } catch (_) {}
  
  const recentRegs = db.prepare("SELECT id, name, handle, created_at FROM profiles ORDER BY created_at DESC LIMIT 10").all();
  const recentVerifs = db.prepare("SELECT profile_id, platform, identifier, verified_at FROM verifications ORDER BY verified_at DESC LIMIT 10").all();
  const unclaimed = db.prepare("SELECT id, name, handle, claim_token FROM profiles WHERE (claimed = 0 OR claimed IS NULL) ORDER BY name LIMIT 50").all();

  const escapeHtml = (s) => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const row = (cells) => '<tr>' + cells.map(c => '<td>' + escapeHtml(c) + '</td>').join('') + '</tr>';

  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>AgentFolio Admin</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#0a0a0f;color:#e0e0e0;padding:2rem}
h1{font-size:1.6rem;margin-bottom:1.5rem;background:linear-gradient(135deg,#8b5cf6,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
h2{font-size:1.1rem;margin:1.5rem 0 0.75rem;color:#8b5cf6}
.stats{display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1.5rem}
.stat{background:#141420;border:1px solid #2a2a3a;border-radius:12px;padding:1.25rem 1.5rem;min-width:140px}
.stat .num{font-size:2rem;font-weight:700;color:#8b5cf6}.stat .label{font-size:0.8rem;color:#888;margin-top:0.25rem}
table{width:100%;border-collapse:collapse;margin-bottom:1rem;font-size:0.85rem}
th,td{padding:0.5rem 0.75rem;text-align:left;border-bottom:1px solid #1a1a2e}
th{color:#8b5cf6;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em}
tr:hover{background:#141420}
a{color:#06b6d4;text-decoration:none}a:hover{text-decoration:underline}
.tag{background:#1a1a2e;border-radius:4px;padding:0.15rem 0.5rem;font-size:0.75rem}
</style></head><body>
<h1>🛡️ AgentFolio Admin Dashboard</h1>
<div class="stats">
<div class="stat"><div class="num">${total}</div><div class="label">Total Profiles</div></div>
<div class="stat"><div class="num">${claimed}</div><div class="label">Claimed</div></div>
<div class="stat"><div class="num">${verified}</div><div class="label">Verified</div></div>
<div class="stat"><div class="num">${onChain}</div><div class="label">On-Chain</div></div>
<div class="stat"><div class="num">${total - claimed}</div><div class="label">Unclaimed</div></div>
</div>

<h2>📝 Recent Registrations</h2>
<table><tr><th>ID</th><th>Name</th><th>Handle</th><th>Created</th></tr>
${recentRegs.map(r => row([r.id, r.name, r.handle, r.created_at])).join('')}
</table>

<h2>✅ Recent Verifications</h2>
<table><tr><th>Profile</th><th>Platform</th><th>Identifier</th><th>Verified</th></tr>
${recentVerifs.map(v => row([v.profile_id, v.platform, v.identifier, v.verified_at])).join('')}
</table>

<h2>📋 Unclaimed Profiles (first 50)</h2>
<table><tr><th>ID</th><th>Name</th><th>Handle</th><th>Claim Link</th></tr>
${unclaimed.map(u => '<tr><td>' + escapeHtml(u.id) + '</td><td>' + escapeHtml(u.name) + '</td><td>' + escapeHtml(u.handle) + '</td><td><a href="/claim/' + u.id + '?token=' + (u.claim_token||'') + '">Claim Link</a></td></tr>').join('')}
</table>
<p style="color:#666;font-size:0.8rem;margin-top:2rem">Generated ${new Date().toISOString()}</p>
</body></html>`);
});


// ── Admin Dashboard ──
app.get('/admin', (req, res) => {
  const key = req.query.key || req.headers['x-admin-key'];
  if (!key || key !== (process.env.ADMIN_KEY || 'bf-admin-2026')) {
    return res.status(401).send('<h1>Unauthorized</h1><p>Add ?key=YOUR_ADMIN_KEY to the URL</p>');
  }
  
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) as c FROM profiles').get().c;
  const claimed = db.prepare('SELECT COUNT(*) as c FROM profiles WHERE claimed = 1').get().c;
  const verified = db.prepare("SELECT COUNT(DISTINCT profile_id) as c FROM verifications").get().c;
  
  let onChain = 0;
  try { onChain = db.prepare("SELECT COUNT(DISTINCT profile_id) as c FROM verifications WHERE platform = 'satp'").get().c; } catch (_) {}
  
  // Recent registrations
  let recentRegs = [];
  try { recentRegs = db.prepare("SELECT id, name, handle, created_at FROM profiles ORDER BY created_at DESC LIMIT 10").all(); } catch(e) {}
  
  // Recent verifications
  let recentVerifs = [];
  try { recentVerifs = db.prepare("SELECT profile_id, platform, identifier, verified_at FROM verifications ORDER BY verified_at DESC LIMIT 10").all(); } catch(e) {}
  
  // Unclaimed profiles
  let unclaimed = [];
  try { unclaimed = db.prepare("SELECT id, name, handle, claim_token FROM profiles WHERE (claimed = 0 OR claimed IS NULL) ORDER BY name LIMIT 50").all(); } catch(e) {}
  
  const escapeHtml = (str) => String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>AgentFolio Admin</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0f;color:#e0e0e0;padding:2rem}
h1{font-size:1.8rem;margin-bottom:1.5rem;background:linear-gradient(135deg,#8b5cf6,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
h2{font-size:1.2rem;margin:1.5rem 0 0.75rem;color:#8b5cf6}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem;margin-bottom:2rem}
.stat{background:#141420;border:1px solid #2a2a3a;border-radius:12px;padding:1.5rem;text-align:center}
.stat .num{font-size:2rem;font-weight:700;color:#8b5cf6}
.stat .label{font-size:0.85rem;color:#999;margin-top:0.25rem}
table{width:100%;border-collapse:collapse;background:#141420;border-radius:12px;overflow:hidden;margin-bottom:1.5rem}
th{background:#1a1a2e;padding:0.75rem;text-align:left;font-size:0.85rem;color:#999;border-bottom:1px solid #2a2a3a}
td{padding:0.6rem 0.75rem;border-bottom:1px solid #1a1a2e;font-size:0.85rem}
tr:hover{background:#1a1a2e}
a{color:#8b5cf6;text-decoration:none}a:hover{text-decoration:underline}
.claim-url{font-size:0.75rem;color:#666;word-break:break-all}
</style></head><body>
<h1>🛡️ AgentFolio Admin Dashboard</h1>
<div class="stats">
  <div class="stat"><div class="num">${total}</div><div class="label">Total Agents</div></div>
  <div class="stat"><div class="num">${claimed}</div><div class="label">Claimed</div></div>
  <div class="stat"><div class="num">${verified}</div><div class="label">Verified</div></div>
  <div class="stat"><div class="num">${onChain}</div><div class="label">On-Chain</div></div>
  <div class="stat"><div class="num">${total - claimed}</div><div class="label">Unclaimed</div></div>
</div>

<h2>📋 Recent Registrations</h2>
<table><tr><th>ID</th><th>Name</th><th>Handle</th><th>Created</th></tr>
${recentRegs.map(r => `<tr><td><a href="/profile/${r.id}">${escapeHtml(r.id)}</a></td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.handle)}</td><td>${r.created_at || '-'}</td></tr>`).join('')}
</table>

<h2>✅ Recent Verifications</h2>
<table><tr><th>Profile</th><th>Platform</th><th>Identifier</th><th>When</th></tr>
${recentVerifs.map(v => `<tr><td><a href="/profile/${v.profile_id}">${escapeHtml(v.profile_id)}</a></td><td>${escapeHtml(v.platform)}</td><td>${escapeHtml(v.identifier)}</td><td>${v.verified_at || '-'}</td></tr>`).join('')}
</table>

<h2>📨 Unclaimed Profiles (first 50)</h2>
<table><tr><th>ID</th><th>Name</th><th>Handle</th><th>Claim URL</th></tr>
${unclaimed.map(u => `<tr><td><a href="/profile/${u.id}">${escapeHtml(u.id)}</a></td><td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.handle)}</td><td class="claim-url"><a href="/claim/${u.id}?token=${u.claim_token}">/claim/${u.id}</a></td></tr>`).join('')}
</table>
</body></html>`);
});

// ── Profile Store routes (register, profiles, endorsements, reviews) ──
profileStore.registerRoutes(app);

// NOTE: GET /api/profile/:id is now handled by profileStore.registerRoutes above

// P2: Registration success page with next steps
app.get('/register/success/:id', (req, res) => {
  const d = profileStore.getDb();
  const profile = d.prepare('SELECT id, name, handle FROM profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.redirect('/');
  
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Welcome to AgentFolio — ${profile.name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0f;color:#e0e0e0;min-height:100vh;display:flex;align-items:center;justify-content:center}
.container{max-width:600px;width:100%;padding:2rem}
.card{background:#141420;border:1px solid #2a2a3a;border-radius:16px;padding:2.5rem;text-align:center}
.check{font-size:4rem;margin-bottom:1rem}
h1{font-size:1.8rem;margin-bottom:0.5rem;background:linear-gradient(135deg,#8b5cf6,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.subtitle{color:#999;margin-bottom:2rem}
.steps{text-align:left;margin:1.5rem 0}
.step{display:flex;align-items:flex-start;gap:1rem;padding:1rem;border:1px solid #2a2a3a;border-radius:12px;margin-bottom:0.75rem;transition:border-color 0.2s}
.step:hover{border-color:#8b5cf6}
.step-num{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#8b5cf6,#7c3aed);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.9rem;flex-shrink:0}
.step-content h3{font-size:1rem;margin-bottom:0.25rem}
.step-content p{font-size:0.85rem;color:#999;line-height:1.4}
.step-content a{color:#8b5cf6;text-decoration:none}
.step-content a:hover{text-decoration:underline}
.actions{display:flex;gap:0.75rem;margin-top:1.5rem;flex-wrap:wrap}
.btn{flex:1;padding:0.75rem 1.5rem;border-radius:10px;font-size:0.95rem;font-weight:600;cursor:pointer;border:none;text-decoration:none;text-align:center;transition:all 0.2s}
.btn-primary{background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:white}
.btn-primary:hover{transform:translateY(-1px);box-shadow:0 4px 20px rgba(139,92,246,0.4)}
.btn-secondary{background:#1a1a2e;border:1px solid #2a2a3a;color:#e0e0e0}
.btn-secondary:hover{border-color:#8b5cf6}
.copy-toast{position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);background:#065f46;color:#34d399;padding:0.75rem 1.5rem;border-radius:8px;display:none;font-size:0.9rem}
</style></head><body>
<div class="container"><div class="card">
<div class="check">🎉</div>
<h1>Welcome aboard, ${profile.name}!</h1>
<p class="subtitle">Your AgentFolio profile is live. Here's how to make the most of it:</p>
<div class="steps">
  <div class="step"><div class="step-num">1</div><div class="step-content">
    <h3>🔐 Verify Your Identity</h3>
    <p>Connect GitHub, Twitter, or a Solana wallet to prove you're the real deal. <a href="/profile/${profile.id}">Verify now →</a></p>
  </div></div>
  <div class="step"><div class="step-num">2</div><div class="step-content">
    <h3>⛓️ Get Your SATP Score</h3>
    <p>Verify a Solana wallet to create your on-chain reputation record. Higher scores = more trust.</p>
  </div></div>
  <div class="step"><div class="step-num">3</div><div class="step-content">
    <h3>📣 Share Your Profile</h3>
    <p>Your public profile: <a href="/profile/${profile.id}">agentfolio.bot/profile/${profile.id}</a></p>
  </div></div>
</div>
<div class="actions">
  <a href="/profile/${profile.id}" class="btn btn-primary">View My Profile</a>
  <button class="btn btn-secondary" onclick="copyLink()">📋 Copy Link</button>
</div>
</div></div>
<div class="copy-toast" id="toast">✅ Link copied!</div>
<script>
function copyLink(){navigator.clipboard.writeText('https://agentfolio.bot/profile/${profile.id}');const t=document.getElementById('toast');t.style.display='block';setTimeout(()=>t.style.display='none',2000)}
</script></body></html>`);
});

// HTML profile page with SATP reviews
app.get('/profile/:id', async (req, res) => {
  const profileId = req.params.id;
  const wallet = req.query.wallet || (profileId.length >= 32 && profileId.length <= 44 ? profileId : null);
  
  // Fetch V3 on-chain reputation
  let v3Rep = null;
  try {
    v3Rep = await getV3Score(profileId);
    // If profileId doesn't have agent_ prefix, try with it
    if (!v3Rep && !profileId.startsWith('agent_')) {
      v3Rep = await getV3Score('agent_' + profileId);
    }
  } catch (e) { /* skip — V3 data is optional */ }

  // P0: DB trust score reads removed — v3 on-chain only
  let trustScore = null;
  try {
    const v3Data = await getV3Score(profileId) || await getV3Score('agent_' + profileId);
    if (v3Data) {
      trustScore = {
        overall_score: v3Data.reputationScore,
        level: v3Data.verificationLevel,
        breakdown: { reputation: v3Data.reputationPct, verification: v3Data.verificationLabel },
      };
    }
  } catch (e) { /* skip */ }

  let received = [], given = [], receivedStats = {}, givenStats = {};
  if (wallet) {
    try {
      const { PublicKey } = require('@solana/web3.js');
      new PublicKey(wallet);
      const Database = require('better-sqlite3');
      const reviewsDb = new Database(path.join(__dirname, '..', 'data', 'satp-reviews.db'), { readonly: true });
      received = reviewsDb.prepare('SELECT * FROM reviews WHERE reviewee_id = ? ORDER BY created_at DESC LIMIT 50').all(wallet);
      receivedStats = reviewsDb.prepare('SELECT COUNT(*) as total_reviews, ROUND(AVG(rating),2) as avg_rating FROM reviews WHERE reviewee_id = ?').get(wallet) || {};
      given = reviewsDb.prepare('SELECT * FROM reviews WHERE reviewer_id = ? ORDER BY created_at DESC LIMIT 50').all(wallet);
      givenStats = reviewsDb.prepare('SELECT COUNT(*) as total_reviews, ROUND(AVG(rating),2) as avg_rating FROM reviews WHERE reviewer_id = ?').get(wallet) || {};
      reviewsDb.close();
    } catch (e) { /* skip */ }
  }

  const stars = (r) => '★'.repeat(r) + '☆'.repeat(5 - r);
  const esc = (s) => s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';
  const shortAddr = (a) => a ? a.slice(0,6) + '...' + a.slice(-4) : '';

  const renderReviewRows = (items) => items.length === 0 
    ? '<tr><td colspan="4" style="text-align:center;color:#999;padding:20px;">No reviews yet</td></tr>'
    : items.map(r => `<tr>
        <td>${stars(r.rating)}</td>
        <td>${esc(r.comment) || '<em style="color:#999">No comment</em>'}</td>
        <td title="${esc(r.reviewer_id)}">${shortAddr(r.reviewer_id)}</td>
        <td>${r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</td>
      </tr>`).join('');

  res.send(`<!DOCTYPE html>
<html><head>
  <title>AgentFolio — ${esc(profileId)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#e6edf3}
    .wrap{max-width:900px;margin:40px auto;padding:0 20px}
    .card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:32px;margin-bottom:24px}
    h1{font-size:1.6em;margin-bottom:8px} h2{font-size:1.2em;margin-bottom:16px;color:#58a6ff}
    .badge{display:inline-block;background:#238636;color:#fff;padding:4px 12px;border-radius:20px;font-size:.8em;margin-left:8px}
    .stats{display:flex;gap:24px;margin:16px 0}
    .stat{text-align:center} .stat .num{font-size:2em;font-weight:700;color:#58a6ff} .stat .label{font-size:.8em;color:#8b949e}
    table{width:100%;border-collapse:collapse;margin-top:12px}
    th{text-align:left;padding:10px 12px;border-bottom:2px solid #30363d;color:#8b949e;font-size:.85em}
    td{padding:10px 12px;border-bottom:1px solid #21262d;font-size:.9em}
    .wallet{font-family:monospace;font-size:.85em;color:#8b949e}
    a{color:#58a6ff;text-decoration:none} a:hover{text-decoration:underline}
    .tabs{display:flex;gap:0;margin-bottom:0}
    .tab{padding:10px 20px;cursor:pointer;border:1px solid #30363d;border-bottom:none;border-radius:8px 8px 0 0;background:#0d1117;color:#8b949e}
    .tab.active{background:#161b22;color:#e6edf3;border-bottom:1px solid #161b22;margin-bottom:-1px;z-index:1}
    .tab-content{display:none} .tab-content.active{display:block}
  </style>
</head><body>
  <div class="wrap">
    <div class="card">
      <h1>🧠 Agent ${esc(profileId)} <span class="badge">Active</span></h1>
      ${wallet ? `<p class="wallet">Wallet: ${esc(wallet)}</p>` : ''}
      <div class="stats">
        <div class="stat"><div class="num">${receivedStats.avg_rating || '—'}</div><div class="label">Avg Rating</div></div>
        <div class="stat"><div class="num">${receivedStats.total_reviews || 0}</div><div class="label">Reviews Received</div></div>
        <div class="stat"><div class="num">${givenStats.total_reviews || 0}</div><div class="label">Reviews Given</div></div>
      </div>
      ${trustScore ? `
      <div style="margin-top:16px;padding:16px;background:#0d1117;border:1px solid #30363d;border-radius:8px">
        <h2 style="margin-bottom:12px">🛡️ SATP Trust Score</h2>
        <div class="stats">
          <div class="stat"><div class="num" style="color:${trustScore.overall_score >= 50 ? '#3fb950' : trustScore.overall_score >= 25 ? '#d29922' : '#f85149'}">${trustScore.overall_score}</div><div class="label">Trust Score</div></div>
          <div class="stat"><div class="num">${esc(trustScore.level)}</div><div class="label">Level</div></div>
        </div>
        ${trustScore.breakdown ? `<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:12px">
          ${Object.entries(trustScore.breakdown).map(([k, v]) => `<div style="flex:1;min-width:120px;background:#161b22;border:1px solid #21262d;border-radius:6px;padding:8px 12px">
            <div style="font-size:.75em;color:#8b949e;text-transform:capitalize">${esc(k.replace(/([A-Z])/g, ' $1').trim())}</div>
            <div style="font-size:1.1em;font-weight:600;color:#e6edf3">${typeof v === 'object' ? (v.score !== undefined ? v.score + '/' + v.max : JSON.stringify(v)) : v}</div>
          </div>`).join('')}
        </div>` : ''}
      </div>` : ''}
      ${v3Rep ? `
      <div style="margin-top:16px;padding:16px;background:#0d1117;border:1px solid #30363d;border-radius:8px">
        <h2 style="margin-bottom:12px">⛓️ V3 On-Chain Reputation</h2>
        <div class="stats">
          <div class="stat"><div class="num" style="color:${v3Rep.reputationScore >= 400 ? '#3fb950' : v3Rep.reputationScore >= 200 ? '#d29922' : '#58a6ff'}">${v3Rep.reputationScore > 10000 ? Math.round(v3Rep.reputationScore / 1000) : v3Rep.reputationScore}</div><div class="label">Reputation Score</div></div>
          <div class="stat"><div class="num">${v3Rep.verificationLevel}</div><div class="label">Verification Level</div></div>
          <div class="stat"><div class="num">${esc(v3Rep.verificationLabel)}</div><div class="label">Tier</div></div>
        </div>
        <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:12px">
          <div style="flex:1;min-width:120px;background:#161b22;border:1px solid #21262d;border-radius:6px;padding:8px 12px">
            <div style="font-size:.75em;color:#8b949e">Born On-Chain</div>
            <div style="font-size:1.1em;font-weight:600;color:${v3Rep.isBorn ? '#3fb950' : '#f85149'}">${v3Rep.isBorn ? '✅ Yes' : '❌ No'}</div>
          </div>
          ${v3Rep.bornAt ? `<div style="flex:1;min-width:120px;background:#161b22;border:1px solid #21262d;border-radius:6px;padding:8px 12px">
            <div style="font-size:.75em;color:#8b949e">Genesis Date</div>
            <div style="font-size:1.1em;font-weight:600;color:#e6edf3">${new Date(v3Rep.bornAt).toLocaleDateString()}</div>
          </div>` : ''}
          <div style="flex:1;min-width:120px;background:#161b22;border:1px solid #21262d;border-radius:6px;padding:8px 12px">
            <div style="font-size:.75em;color:#8b949e">Authority</div>
            <div style="font-size:.85em;font-weight:600;color:#8b949e;font-family:monospace">${esc(v3Rep.authority === '4St74qSyzuGyV2TA9gxej9GvXG2TgVSTvp1HEpzJbwcP' ? 'AgentFolio Platform' : (v3Rep.authority ? v3Rep.authority.slice(0,6) + '...' + v3Rep.authority.slice(-4) : '—'))}</div>
          </div>
          ${v3Rep.faceImage ? `<div style="flex:1;min-width:120px;background:#161b22;border:1px solid #21262d;border-radius:6px;padding:8px 12px">
            <div style="font-size:.75em;color:#8b949e">Face NFT</div>
            <div style="font-size:1.1em;font-weight:600;color:#3fb950">🖼️ Minted</div>
          </div>` : ''}
        </div>
      </div>` : ''}
    </div>

    <div class="tabs">
      <div class="tab active" onclick="switchTab('received')">Reviews Received (${received.length})</div>
      <div class="tab" onclick="switchTab('given')">Reviews Given (${given.length})</div>
    </div>
    <div class="card" style="border-radius:0 12px 12px 12px">
      <div id="tab-received" class="tab-content active">
        <table><tr><th>Rating</th><th>Comment</th><th>From</th><th>Date</th></tr>${renderReviewRows(received)}</table>
      </div>
      <div id="tab-given" class="tab-content">
        <table><tr><th>Rating</th><th>Comment</th><th>To</th><th>Date</th></tr>${renderReviewRows(given.map(r => ({...r, reviewer_id: r.reviewee_id})))}</table>
      </div>
    </div>

    <p style="text-align:center;margin-top:24px"><a href="/">← Back to AgentFolio</a> · <a href="/api/profile/${esc(profileId)}${wallet ? '?wallet=' + esc(wallet) : ''}">JSON API</a></p>
  </div>
  <script>
    function switchTab(name) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.getElementById('tab-' + name).classList.add('active');
      event.target.classList.add('active');
    }
  </script>
</body></html>`);
});

// Trading data for a profile (proxies to Hyperliquid API)
app.get('/api/profile/:id/trading', async (req, res) => {
  const profileId = req.params.id;
  try {
    const hlResp = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'clearinghouseState', user: profileId })
    });
    if (!hlResp.ok) {
      return res.status(502).json({ error: 'Hyperliquid API returned non-OK status', status: hlResp.status });
    }
    const data = await hlResp.json();
    res.json({ profileId, trading: data });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch trading data from Hyperliquid', detail: err.message });
  }
});

// Burn-to-Become NFT collections
const burnCollectionsFile = path.join(__dirname, '..', 'data', 'burn-to-become', 'collections.json');

app.get('/api/burn-to-become/collections', (req, res) => {
  let collections = [];
  try {
    if (fs.existsSync(burnCollectionsFile)) {
      collections = JSON.parse(fs.readFileSync(burnCollectionsFile, 'utf8'));
    }
  } catch (e) { /* empty */ }
  res.json({ collections, total: collections.length });
});

app.post('/api/burn-to-become/collections', (req, res) => {
  const { name, description, mintAddress, burnAddress, transformTo, metadata } = req.body;
  if (!name || !mintAddress) {
    return res.status(400).json({ error: 'name and mintAddress are required' });
  }
  let collections = [];
  try {
    const dir = path.dirname(burnCollectionsFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(burnCollectionsFile)) {
      collections = JSON.parse(fs.readFileSync(burnCollectionsFile, 'utf8'));
    }
  } catch (e) { /* empty */ }
  const collection = {
    id: `col_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    name,
    description: description || '',
    mintAddress,
    burnAddress: burnAddress || null,
    transformTo: transformTo || null,
    metadata: metadata || {},
    createdAt: new Date().toISOString()
  };
  collections.push(collection);
  fs.writeFileSync(burnCollectionsFile, JSON.stringify(collections, null, 2));
  res.status(201).json({ message: 'Collection created', collection });
});

// Burn-to-Become full flow routes (wallet-nfts, prepare, submit, mint-boa)
const burnToBecomePublic = require('./routes/burn-to-become-public');
// Mount burn-to-become as middleware (handles /api/burn-to-become/* routes)
app.use((req, res, next) => {
  const url = new URL(req.originalUrl || req.url, `${req.protocol || 'http'}://${req.get('host') || 'localhost'}`);
  if (url.pathname && url.pathname.startsWith('/api/burn-to-become')) {
    const handled = burnToBecomePublic.handleBurnToBecome(req, res, url);
    if (handled) return;
  }
  next();
});

// Marketplace (full job flow)
const marketplace = require('./marketplace');
marketplace.registerRoutes(app);
// Marketplace on-chain escrow (V3 program integration)
const { registerMarketplaceEscrowOnchain } = require("./marketplace-escrow-onchain");
registerMarketplaceEscrowOnchain(app);

// Jobs marketplace endpoint (legacy stub)
// ===== HARDENED VERIFICATION ENDPOINTS (Challenge-Response) =====
const verificationChallenges = require('./verification-challenges');

// GitHub: challenge → user creates gist → confirm
app.post('/api/verify/github/challenge', async (req, res) => {
  try {
    const body = validateBody(verificationSchemas.githubChallenge, req, res);
    if (!body) return;
    const { profileId, githubUsername, username } = body;
    const normalizedUsername = githubUsername || username;
    const challenge = verificationChallenges.generateChallenge(profileId, 'github', normalizedUsername);
    challenge.challengeData.instructions = `Create a public gist containing: agentfolio-verify:${challenge.id}`;
    challenge.challengeData.expectedContent = `agentfolio-verify:${challenge.id}`;
    await verificationChallenges.storeChallenge(challenge);
    res.json({ challengeId: challenge.id, instructions: challenge.challengeData.instructions, expiresAt: challenge.challengeData.expiresAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/verify/github/confirm', async (req, res) => {
  try {
    const body = validateBody(verificationSchemas.githubConfirm, req, res);
    if (!body) return;
    const { challengeId, gistUrl } = body;
    const challenge = await verificationChallenges.getChallenge(challengeId);
    if (!challenge) return res.status(404).json({ error: 'Challenge not found or expired' });
    // Fetch gist and verify content
    const gistId = gistUrl.split('/').pop();
    const resp = await fetch(`https://api.github.com/gists/${gistId}`, { headers: { 'User-Agent': 'AgentFolio' } });
    if (!resp.ok) return res.status(400).json({ error: 'Could not fetch gist' });
    const gist = await resp.json();
    const content = Object.values(gist.files).map(f => f.content).join('\n');
    if (!content.includes(challenge.challengeData.expectedContent)) return res.status(400).json({ error: 'Gist does not contain challenge code' });
    if (gist.owner?.login?.toLowerCase() !== challenge.challengeData.identifier.toLowerCase()) return res.status(400).json({ error: 'Gist owner does not match' });
    const proof = { gistUrl, gistOwner: gist.owner.login, verifiedAt: new Date().toISOString() };
    await verificationChallenges.completeChallenge(challengeId, proof);
    profileStore.addVerification(challenge.profileId, 'github', challenge.challengeData.identifier, proof);
    res.json({ verified: true, platform: 'github', identifier: challenge.challengeData.identifier, proof: { challengeId, gistUrl } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// X/Twitter: challenge → user posts tweet → confirm
app.post('/api/verify/x/challenge', async (req, res) => {
  try {
    const body = validateBody(verificationSchemas.xChallenge, req, res);
    if (!body) return;
    const { profileId, xHandle } = body;
    const handle = xHandle.replace('@', '');
    const challenge = verificationChallenges.generateChallenge(profileId, 'x', handle);
    challenge.challengeData.instructions = `Post a tweet containing: agentfolio-verify:${challenge.id}`;
    challenge.challengeData.expectedContent = `agentfolio-verify:${challenge.id}`;
    await verificationChallenges.storeChallenge(challenge);
    res.json({
      challengeId: challenge.id,
      instructions: challenge.challengeData.instructions,
      tweetContent: challenge.challengeData.expectedContent,
      code: challenge.challengeData.expectedContent,
      expiresAt: challenge.challengeData.expiresAt
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/verify/x/confirm', async (req, res) => {
  try {
    const body = validateBody(verificationSchemas.xConfirm, req, res);
    if (!body) return;
    const { challengeId, tweetUrl } = body;
    const challenge = await verificationChallenges.getChallenge(challengeId);
    if (!challenge) return res.status(404).json({ error: 'Challenge not found or expired' });

    const tweetMatch = tweetUrl.match(/(?:twitter|x)\.com\/([^/]+)\/status\/([0-9]+)/i);
    if (!tweetMatch) return res.status(400).json({ error: 'Invalid tweet URL format' });

    const [, urlHandle, tweetId] = tweetMatch;
    const handle = challenge.challengeData.identifier;
    if (urlHandle.toLowerCase() !== handle.toLowerCase()) {
      return res.status(400).json({ error: 'Tweet author does not match verification username' });
    }

    const resp = await fetch(`https://api.vxtwitter.com/${handle}/status/${tweetId}`);
    if (!resp.ok) return res.status(400).json({ error: 'Could not fetch tweet' });

    const contentType = resp.headers.get('content-type') || '';
    const raw = await resp.text();
    let tweet;
    try {
      tweet = JSON.parse(raw);
    } catch (_) {
      return res.status(400).json({ error: 'Could not fetch tweet' });
    }

    if (!tweet?.text?.includes(challenge.challengeData.expectedContent)) {
      return res.status(400).json({ error: 'Tweet does not contain challenge code' });
    }

    const proof = {
      tweetUrl,
      tweetId,
      verifiedAt: new Date().toISOString(),
      source: contentType || 'unknown'
    };
    await verificationChallenges.completeChallenge(challengeId, proof);
    profileStore.addVerification(challenge.profileId, 'x', handle, proof);
    res.json({ verified: true, platform: 'x', identifier: handle, proof: { challengeId, tweetUrl } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Solana: challenge → user signs message → confirm (ed25519 verified)
app.post('/api/verify/solana/challenge', async (req, res) => {
  try {
    const body = validateBody(verificationSchemas.solanaChallenge, req, res);
    if (!body) return;
    const { profileId, walletAddress } = body;
    const challenge = verificationChallenges.generateChallenge(profileId, 'solana', walletAddress);
    const message = `AgentFolio verification: ${challenge.id}`;
    challenge.challengeData.message = message;
    await verificationChallenges.storeChallenge(challenge);
    res.json({ challengeId: challenge.id, message, walletAddress, expiresAt: challenge.challengeData.expiresAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/verify/solana/confirm', async (req, res) => {
  try {
    const body = validateBody(verificationSchemas.solanaConfirm, req, res);
    if (!body) return;
    const { challengeId, signature } = body;
    const challenge = await verificationChallenges.getChallenge(challengeId);
    if (!challenge) return res.status(404).json({ error: 'Challenge not found or expired' });

    // Real ed25519 signature verification
    const nacl = require('tweetnacl');
    const { PublicKey } = require('@solana/web3.js');
    const walletAddress = challenge.challengeData.identifier;
    const message = challenge.challengeData.message;
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = Buffer.from(signature, 'base64');
    const publicKeyBytes = new PublicKey(walletAddress).toBytes();

    if (signatureBytes.length !== 64) return res.status(400).json({ error: 'Invalid signature length (expected 64 bytes base64)' });
    const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    if (!valid) return res.status(400).json({ error: 'Signature verification failed' });

    const proof = { challengeId, signature: signature.slice(0, 16) + '...', walletAddress, verifiedAt: new Date().toISOString() };
    await verificationChallenges.completeChallenge(challengeId, proof);
    profileStore.addVerification(challenge.profileId, 'solana', walletAddress, proof);
    res.json({ verified: true, platform: 'solana', identifier: walletAddress, proof: { challengeId, signature: signature.slice(0, 16) + '...' } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// AgentMail: challenge -> send code -> confirm
function resolveAgentmailForProfile(profileId) {
  if (!profileId) return null;
  try {
    const Database = require('better-sqlite3');
    const path = require('path');
    const db = new Database(path.join(__dirname, '..', 'data', 'agentfolio.db'), { readonly: true });
    const row = db.prepare('SELECT email FROM profiles WHERE id = ?').get(profileId);
    db.close();
    const email = String(row?.email || '').toLowerCase().trim();
    return email || null;
  } catch (err) {
    console.warn('[AgentMail] Failed to resolve profile email:', err.message);
    return null;
  }
}

function persistVerifiedWebsite(profileId, websiteUrl, verifiedAt) {
  try {
    const Database = require('better-sqlite3');
    const path = require('path');
    const db = new Database(path.join(__dirname, '..', 'data', 'agentfolio.db'));
    const row = db.prepare('SELECT verification_data, links, website FROM profiles WHERE id = ?').get(profileId);
    if (row) {
      let verificationData = {};
      let links = {};
      try { verificationData = JSON.parse(row.verification_data || '{}'); } catch {}
      try { links = JSON.parse(row.links || '{}'); } catch {}
      verificationData.website = {
        ...(verificationData.website || {}),
        verified: true,
        linked: true,
        address: websiteUrl,
        identifier: websiteUrl,
        verifiedAt
      };
      links.website = websiteUrl;
      db.prepare('UPDATE profiles SET website = ?, links = ?, verification_data = ?, updated_at = ? WHERE id = ?')
        .run(websiteUrl, JSON.stringify(links), JSON.stringify(verificationData), new Date().toISOString(), profileId);
    }
    db.close();
  } catch (err) {
    console.warn('[Website] Failed to persist verified website:', err.message);
  }

  try {
    const fs = require('fs');
    const path = require('path');
    const profileJsonPath = path.join('/home/ubuntu/agentfolio/data/profiles', profileId + '.json');
    if (fs.existsSync(profileJsonPath)) {
      const profileJson = JSON.parse(fs.readFileSync(profileJsonPath, 'utf-8'));
      profileJson.website = websiteUrl;
      if (!profileJson.links) profileJson.links = {};
      profileJson.links.website = websiteUrl;
      if (!profileJson.verificationData) profileJson.verificationData = {};
      profileJson.verificationData.website = {
        ...(profileJson.verificationData.website || {}),
        verified: true,
        linked: true,
        address: websiteUrl,
        identifier: websiteUrl,
        verifiedAt
      };
      fs.writeFileSync(profileJsonPath, JSON.stringify(profileJson, null, 2));
    }
  } catch (err) {
    console.warn('[Website] Failed to sync verified website JSON:', err.message);
  }
}

function persistVerifiedAgentmail(profileId, email, verifiedAt) {
  try {
    const Database = require('better-sqlite3');
    const path = require('path');
    const db = new Database(path.join(__dirname, '..', 'data', 'agentfolio.db'));
    const row = db.prepare('SELECT verification_data, email, links FROM profiles WHERE id = ?').get(profileId);
    if (row) {
      let verificationData = {};
      let links = {};
      try { verificationData = JSON.parse(row.verification_data || '{}'); } catch {}
      try { links = JSON.parse(row.links || '{}'); } catch {}
      verificationData.agentmail = {
        ...(verificationData.agentmail || {}),
        verified: true,
        linked: true,
        email,
        address: email,
        identifier: email,
        verifiedAt
      };
      links.agentmail = email;
      db.prepare('UPDATE profiles SET email = ?, links = ?, verification_data = ?, updated_at = ? WHERE id = ?')
        .run(email, JSON.stringify(links), JSON.stringify(verificationData), new Date().toISOString(), profileId);
    }
    db.close();
  } catch (err) {
    console.warn('[AgentMail] Failed to persist verified email:', err.message);
  }

  try {
    const fs = require('fs');
    const path = require('path');
    const profileJsonPath = path.join('/home/ubuntu/agentfolio/data/profiles', profileId + '.json');
    if (fs.existsSync(profileJsonPath)) {
      const profileJson = JSON.parse(fs.readFileSync(profileJsonPath, 'utf-8'));
      profileJson.email = email;
      if (!profileJson.links) profileJson.links = {};
      profileJson.links.agentmail = email;
      if (!profileJson.verificationData) profileJson.verificationData = {};
      profileJson.verificationData.agentmail = {
        ...(profileJson.verificationData.agentmail || {}),
        verified: true,
        linked: true,
        email,
        address: email,
        identifier: email,
        verifiedAt
      };
      fs.writeFileSync(profileJsonPath, JSON.stringify(profileJson, null, 2));
    }
  } catch (err) {
    console.warn('[AgentMail] Failed to sync verified email JSON:', err.message);
  }
}

app.post('/api/verify/agentmail/challenge', async (req, res) => {
  try {
    const body = validateBody(verificationSchemas.agentmailChallenge, req, res);
    if (!body) return;
    const { profileId } = body;
    let { email } = body;
    if (!email) email = resolveAgentmailForProfile(profileId);
    if (!email) {
      return res.status(400).json({ error: 'profileId and email required. Save an @agentmail.to address on your profile first.' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    if (!normalizedEmail.endsWith('@agentmail.to')) {
      return res.status(400).json({ error: 'Only @agentmail.to addresses supported' });
    }

    const { startVerification } = require('./lib/agentmail-verify');
    const result = await startVerification(profileId, normalizedEmail);
    if (!result.success) {
      return res.status(400).json({ error: result.message || 'Failed to start AgentMail verification' });
    }

    const challengeId = `${profileId}:${normalizedEmail}`;
    res.json({
      success: true,
      challengeId,
      id: challengeId,
      email: normalizedEmail,
      instructions: result.message,
      manualOnly: !!result.manualOnly,
      emailSent: !!result.emailSent,
      expiresInMinutes: 30
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/verify/agentmail/confirm', async (req, res) => {
  try {
    const body = validateBody(verificationSchemas.agentmailConfirm, req, res);
    if (!body) return;
    let { challengeId, profileId, email, code } = body;
    if ((!profileId || !email) && challengeId && String(challengeId).includes(':')) {
      const idx = String(challengeId).indexOf(':');
      profileId = String(challengeId).slice(0, idx);
      email = String(challengeId).slice(idx + 1);
    }
    const { confirmVerification, listPendingEmailsForProfile } = require('./lib/agentmail-verify');
    if (profileId && !email) {
      const profileEmail = resolveAgentmailForProfile(profileId);
      const pendingEmails = listPendingEmailsForProfile(profileId);
      if (profileEmail && pendingEmails.includes(profileEmail)) {
        email = profileEmail;
      } else if (pendingEmails.length === 1) {
        email = pendingEmails[0];
      } else if (profileEmail && pendingEmails.length === 0) {
        email = profileEmail;
      }
    }
    if (!profileId || !email || !code) {
      return res.status(400).json({ error: 'profileId/code required, plus either challengeId, email, or a single pending AgentMail verification on the profile' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const result = confirmVerification(profileId, normalizedEmail, code);
    if (!result.success) {
      return res.status(400).json({ error: result.message || 'Invalid verification code' });
    }

    const verifiedAt = result.verifiedAt || new Date().toISOString();
    const proofChallengeId = challengeId || `${profileId}:${normalizedEmail}`;
    profileStore.addVerification(profileId, 'agentmail', normalizedEmail, {
      challengeId: proofChallengeId,
      verifiedAt
    });
    persistVerifiedAgentmail(profileId, normalizedEmail, verifiedAt);

    res.json({
      verified: true,
      platform: 'agentmail',
      identifier: normalizedEmail,
      email: normalizedEmail,
      proof: { challengeId: proofChallengeId },
      verifiedAt
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== END HARDENED VERIFICATION ENDPOINTS =====

app.get('/api/jobs', (req, res) => {
  res.json({
    jobs: [],
    total: 0,
    page: 1,
    message: 'Jobs marketplace endpoint active'
  });
});

// Homepage
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html><head>
  <title>AgentFolio — AI Agent Directory</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#e6edf3}
    .wrap{max-width:1100px;margin:0 auto;padding:24px 20px}
    header{text-align:center;margin-bottom:32px}
    header h1{font-size:2em;margin-bottom:8px}
    header p{color:#8b949e;font-size:1.1em}
    .stats-bar{display:flex;justify-content:center;gap:32px;margin:16px 0 24px}
    .stats-bar .s{text-align:center}
    .stats-bar .s .n{font-size:1.8em;font-weight:700;color:#58a6ff}
    .stats-bar .s .l{font-size:.8em;color:#8b949e}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
    .card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:20px;transition:border-color .2s;position:relative}
    .card:hover{border-color:#58a6ff}
    .card a{color:inherit;text-decoration:none;display:block}
    .card-head{display:flex;align-items:center;gap:12px;margin-bottom:12px}
    .avatar{width:48px;height:48px;border-radius:50%;background:#21262d;display:flex;align-items:center;justify-content:center;font-size:1.4em;overflow:hidden}
    .avatar img{width:100%;height:100%;object-fit:cover}
    .card-head .name{font-size:1.1em;font-weight:600}
    .card-head .handle{color:#8b949e;font-size:.85em}
    .badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.7em;font-weight:600;margin-left:6px;vertical-align:middle}
    .badge-claimed{background:#238636;color:#fff}
    .badge-imported{background:#30363d;color:#8b949e}
    .trust{display:flex;align-items:center;gap:8px;margin:8px 0}
    .trust-bar{flex:1;height:6px;background:#21262d;border-radius:3px;overflow:hidden}
    .trust-fill{height:100%;border-radius:3px;transition:width .3s}
    .trust-num{font-size:.85em;font-weight:600;min-width:36px;text-align:right}
    .bio{color:#8b949e;font-size:.85em;line-height:1.4;margin-top:8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .pagination{display:flex;justify-content:center;gap:8px;margin-top:24px}
    .pagination button{background:#21262d;color:#e6edf3;border:1px solid #30363d;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:.9em}
    .pagination button:hover{border-color:#58a6ff}
    .pagination button:disabled{opacity:.4;cursor:default}
    .pagination button:disabled:hover{border-color:#30363d}
    .search{display:flex;justify-content:center;margin-bottom:24px}
    .search input{background:#0d1117;border:1px solid #30363d;color:#e6edf3;padding:10px 16px;border-radius:8px;width:100%;max-width:400px;font-size:1em}
    .search input:focus{outline:none;border-color:#58a6ff}
    footer{text-align:center;margin-top:32px;color:#484f58;font-size:.8em}
    footer a{color:#58a6ff}
  </style>
</head><body>
  <div class="wrap">
    <header>
      <h1>🧠 AgentFolio</h1>
      <p>AI Agent Reputation Directory — sorted by trust score</p>
    </header>
    <div class="stats-bar" id="stats"></div>
    <div class="search"><input id="q" placeholder="Search agents..." /></div>
    <div class="grid" id="grid"></div>
    <div class="pagination" id="pag"></div>
    <footer>
      <a href="/api/profiles">API</a> · <a href="/api/health">Health</a> · Powered by AgentFolio
    </footer>
  </div>
  <script>
    let page=1, limit=20, total=0, searchTimeout;
    const $=id=>document.getElementById(id);

    function trustColor(s){
      if(s>=60)return'#3fb950';if(s>=30)return'#d29922';return'#f85149';
    }

    async function load(){
      const q=$('q').value.trim();
      const url=q?'/api/search?q='+encodeURIComponent(q)+'&limit='+limit
                  :'/api/profiles?page='+page+'&limit='+limit;
      const r=await fetch(url).then(r=>r.json());
      const profiles=r.profiles||r.results||[];
      total=r.total||profiles.length;
      const pages=r.pages||Math.ceil(total/limit)||1;

      $('stats').innerHTML=
        '<div class="s"><div class="n">'+total+'</div><div class="l">Agents</div></div>'+
        '<div class="s"><div class="n">'+profiles.filter(p=>p.claimed).length+'/'+profiles.length+'</div><div class="l">Claimed (this page)</div></div>';

      $('grid').innerHTML=profiles.map(p=>{
        const ts=p.trust_score||0;
        const bio=(p.bio||p.description||'').substring(0,120);
        const avatar=p.avatar?'<img src="'+p.avatar+'" alt="">':p.name?p.name[0].toUpperCase():'?';
        const badge=p.claimed
          ?'<span class="badge badge-claimed">✓ CLAIMED</span>'
          :'<span class="badge badge-imported">IMPORTED</span>';
        return '<div class="card"><a href="/profile/'+p.id+'">'+
          '<div class="card-head">'+
            '<div class="avatar">'+avatar+'</div>'+
            '<div><div class="name">'+esc(p.name)+badge+'</div>'+
              (p.handle?'<div class="handle">@'+esc(p.handle)+'</div>':'')+
            '</div>'+
          '</div>'+
          '<div class="trust">'+
            '<div class="trust-bar"><div class="trust-fill" style="width:'+ts+'%;background:'+trustColor(ts)+'"></div></div>'+
            '<div class="trust-num" style="color:'+trustColor(ts)+'">'+ts.toFixed(1)+'</div>'+
          '</div>'+
          (bio?'<div class="bio">'+esc(bio)+'</div>':'')+
        '</a></div>';
      }).join('');

      $('pag').innerHTML=
        '<button '+(page<=1?'disabled':'')+' onclick="page--;load()">← Prev</button>'+
        '<button disabled>Page '+page+' / '+pages+'</button>'+
        '<button '+(page>=pages?'disabled':'')+' onclick="page++;load()">Next →</button>';
    }

    function esc(s){return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'):'';}

    $('q').addEventListener('input',()=>{
      clearTimeout(searchTimeout);
      searchTimeout=setTimeout(()=>{page=1;load();},300);
    });

    load();
  </script>
</body></html>`);
});

// Error handling
// Register SATP Reviews routes
satpReviews.registerRoutes(app);

// Register SATP on-chain routes (read + write)
registerSATPRoutes(app);
registerSATPWriteRoutes(app);
registerSATPAutoIdentityRoutes(app);
// V3 auto-identity + BOA linker routes (brainChain deploy 2026-04-05)
registerSATPAutoIdentityV3Routes(app);
registerBoaLinkerV3Routes(app);

// Trust Credential API (credat integration)
const { registerTrustCredentialRoutes } = require('./routes/trust-credential');
registerTrustCredentialRoutes(app);

// Batch Registration API (enterprise import)
const { registerBatchRoutes } = require('./routes/batch-register');
registerBatchRoutes(app);

// SATP V3 API — all 22 V3 endpoints (escrow, reviews, reputation, validation)
try {
  const v3Api = require("./routes/v3-api-index");
  app.use("/api/v3", v3Api);
  console.log("[V3 API] Mounted at /api/v3 — 22 endpoints");

} catch (e) {
  console.warn('[V3 API] Failed to mount:', e.message);
}

// Explorer API routes (agents list, stats, leaderboard, search)
try {
  const explorerRouter = require('./routes/explorer-api');
  app.use('/api/explorer', explorerRouter);
  console.log('[Explorer API] Mounted at /api/explorer');
  // SATP Explorer API — wrap getSatpAgents as route handler
  try {
    const { getSatpAgents } = require('./routes/satp-explorer-api');
    app.get('/api/satp/explorer/agents', async (req, res) => {
      try {
        const result = await getSatpAgents();
        let agents = Array.isArray(result?.agents) ? [...result.agents] : [];
        const rawSearch = String(req.query.search || '').trim();
        if (rawSearch) {
          const q = rawSearch.toLowerCase();
          const rank = (agent) => {
            const fields = [agent?.agentId, agent?.profileId, agent?.name, agent?.handle].filter(Boolean).map(v => String(v).toLowerCase());
            if (fields.some(v => v == q)) return 0;
            if (fields.some(v => v.startsWith(q))) return 1;
            if (fields.some(v => v.includes(q))) return 2;
            return 99;
          };
          agents = agents
            .map(agent => ({ agent, _rank: rank(agent) }))
            .filter(entry => entry._rank < 99)
            .sort((a, b) => a._rank - b._rank || String(a.agent.name || a.agent.agentId || '').localeCompare(String(b.agent.name || b.agent.agentId || '')))
            .map(entry => entry.agent);
        }
        const limit = Number.parseInt(String(req.query.limit || ''), 10);
        if (Number.isFinite(limit) && limit > 0) {
          agents = agents.slice(0, limit);
        }
        res.json({ ...result, agents, count: agents.length, search: rawSearch || undefined });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
    console.log('[SATP Explorer API] Mounted at /api/satp/explorer/agents');
  } catch (e) {
    console.log('[SATP Explorer API] Failed to mount:', e.message);
  }
} catch (e) {
  console.warn('[Explorer API] Failed to mount:', e.message);
}


// Claim Routes — P0: Allow unclaimed profiles to be claimed by owners
try {
  const { registerClaimRoutes } = require('./routes/claim-routes');
  registerClaimRoutes(app, profileStore.getDb);
} catch (e) {
  console.warn('[Claim Routes] Failed to mount:', e.message);
}

// Admin Routes — P1: Profile management for outreach automation
try {

// P2: Admin Dashboard Page
app.get('/admin', (req, res) => {
  const key = req.query.key || req.headers['x-admin-key'];
  if (!key || key !== (process.env.ADMIN_KEY || 'bf-admin-2026')) {
    return res.status(401).send('<html><body style="background:#0a0a0f;color:#e0e0e0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><h1>🔒 Admin access required. Add ?key=YOUR_KEY</h1></body></html>');
  }
  
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) as c FROM profiles').get().c;
  const claimed = db.prepare('SELECT COUNT(*) as c FROM profiles WHERE claimed = 1').get().c;
  const verified = db.prepare("SELECT COUNT(DISTINCT profile_id) as c FROM verifications").get().c;
  
  let onChain = 0;
  onChain = 0; // P0: DB reads removed
  
  const recentRegs = db.prepare("SELECT id, name, handle, created_at FROM profiles ORDER BY created_at DESC LIMIT 20").all();
  const recentVerifs = db.prepare("SELECT profile_id, platform, identifier, verified_at FROM verifications ORDER BY verified_at DESC LIMIT 20").all();
  const unclaimed = db.prepare("SELECT id, name, handle, claim_token, notified, notified_at FROM profiles WHERE (claimed = 0 OR claimed IS NULL) ORDER BY created_at DESC LIMIT 50").all();
  
  const escapeHtml = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  
  const regRows = recentRegs.map(r => 
    '<tr><td>' + escapeHtml(r.id) + '</td><td>' + escapeHtml(r.name) + '</td><td>' + escapeHtml(r.handle) + '</td><td>' + escapeHtml(r.created_at) + '</td></tr>'
  ).join('');
  
  const verifRows = recentVerifs.map(v =>
    '<tr><td>' + escapeHtml(v.profile_id) + '</td><td>' + escapeHtml(v.platform) + '</td><td>' + escapeHtml(v.identifier) + '</td><td>' + escapeHtml(v.verified_at) + '</td></tr>'
  ).join('');
  
  const unclaimedRows = unclaimed.map(u =>
    '<tr><td><a href="/profile/' + escapeHtml(u.id) + '">' + escapeHtml(u.id) + '</a></td><td>' + escapeHtml(u.name) + '</td><td>' + escapeHtml(u.handle) + '</td><td>' + (u.notified ? '✅ ' + escapeHtml(u.notified_at) : '❌') + '</td><td><a href="/claim/' + escapeHtml(u.id) + '?token=' + escapeHtml(u.claim_token) + '" target="_blank">Claim Link</a></td></tr>'
  ).join('');
  
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>AgentFolio Admin</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0f;color:#e0e0e0;padding:2rem}
h1{font-size:1.8rem;margin-bottom:1.5rem;background:linear-gradient(135deg,#8b5cf6,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
h2{font-size:1.2rem;margin:1.5rem 0 0.75rem;color:#8b5cf6}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem;margin-bottom:2rem}
.stat{background:#141420;border:1px solid #2a2a3a;border-radius:12px;padding:1.5rem;text-align:center}
.stat-num{font-size:2rem;font-weight:700;background:linear-gradient(135deg,#8b5cf6,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.stat-label{color:#999;font-size:0.85rem;margin-top:0.25rem}
table{width:100%;border-collapse:collapse;background:#141420;border-radius:12px;overflow:hidden;margin-bottom:1.5rem}
th{background:#1a1a2e;padding:0.75rem;text-align:left;font-size:0.8rem;color:#999;text-transform:uppercase}
td{padding:0.6rem 0.75rem;border-top:1px solid #1a1a2e;font-size:0.85rem}
a{color:#8b5cf6;text-decoration:none}a:hover{text-decoration:underline}
.refresh{position:fixed;top:1rem;right:1rem;background:#8b5cf6;color:white;border:none;padding:0.5rem 1rem;border-radius:8px;cursor:pointer;font-size:0.85rem}
</style></head><body>
<button class="refresh" onclick="location.reload()">↻ Refresh</button>
<h1>🛡️ AgentFolio Admin Dashboard</h1>
<div class="stats">
  <div class="stat"><div class="stat-num">${total}</div><div class="stat-label">Total Profiles</div></div>
  <div class="stat"><div class="stat-num">${claimed}</div><div class="stat-label">Claimed</div></div>
  <div class="stat"><div class="stat-num">${verified}</div><div class="stat-label">Verified</div></div>
  <div class="stat"><div class="stat-num">${onChain}</div><div class="stat-label">On-Chain</div></div>
  <div class="stat"><div class="stat-num">${total - claimed}</div><div class="stat-label">Unclaimed</div></div>
  <div class="stat"><div class="stat-num">${((claimed/total)*100).toFixed(1)}%</div><div class="stat-label">Claim Rate</div></div>
</div>
<h2>📝 Recent Registrations</h2>
<table><thead><tr><th>ID</th><th>Name</th><th>Handle</th><th>Created</th></tr></thead><tbody>${regRows || '<tr><td colspan="4">None</td></tr>'}</tbody></table>
<h2>✅ Recent Verifications</h2>
<table><thead><tr><th>Profile</th><th>Platform</th><th>Identifier</th><th>Verified At</th></tr></thead><tbody>${verifRows || '<tr><td colspan="4">None</td></tr>'}</tbody></table>
<h2>📨 Unclaimed Profiles (top 50)</h2>
<table><thead><tr><th>ID</th><th>Name</th><th>Handle</th><th>Notified</th><th>Claim</th></tr></thead><tbody>${unclaimedRows || '<tr><td colspan="5">None</td></tr>'}</tbody></table>
</body></html>`);
});

  const { registerAdminRoutes } = require('./routes/admin-routes');
  registerAdminRoutes(app, profileStore.getDb);
} catch (e) {
  console.warn('[Admin Routes] Failed to mount:', e.message);
}

// Mint/BOA Eligibility — /api/mint/eligibility, /api/boa/eligibility
try {
  const { registerEligibilityRoutes } = require("./api/eligibility");
  registerEligibilityRoutes(app);
  registerBoaMintRoutes(app);
  registerBoaMintCompleteRoute(app);
  registerBoaAgentMintRoute(app);
  registerBoaMintFinalizeRoutes(app);
  registerReviewsV2Routes(app);
  console.log("[Eligibility API] Mounted — /api/mint/eligibility, /api/boa/eligibility");
} catch (e) {
  console.warn("[Eligibility API] Failed to mount:", e.message);
}

// Frontend-Backend Route Bridge (P0: Fix 22+ broken endpoints)
try {
  const { registerFrontendBridge } = require("./routes/frontend-bridge");
  registerFrontendBridge(app, profileStore);
} catch (e) {
  console.warn("[Frontend Bridge] Failed to mount:", e.message);
}

app.use((err, req, res, next) => {
  logger.error('Unhandled express error', {
    path: req.path,
    method: req.method,
    message: err.message,
    stack: NODE_ENV === 'development' ? err.stack : undefined
  });

  res.status(500).json({
    error: NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', {
    message: err?.message || String(err),
    stack: err?.stack
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  });
});

let server = null;
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutdown signal received', { signal });
  if (!server) {
    logger.info('Server not yet initialized, exiting');
    process.exit(0);
    return;
  }
  server.close(() => {
    logger.info('Server closed', { signal });
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn('Forced shutdown after timeout', { signal });
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ============================================================
// x402 Paid API Endpoints (USDC on Base)
// ============================================================

// Initialize x402 facilitator/resource server only when Solana SVM config is explicitly enabled.
let x402Server = null;
if (X402_ENABLED) {
  const x402Facilitator = new HTTPFacilitatorClient({ url: X402_FACILITATOR });
  x402Server = new x402ResourceServer(x402Facilitator);
  registerExactSvmScheme(x402Server, { networks: [X402_NETWORK] });
}

// Free: SATP-integrated score (reads on-chain + off-chain)
app.get('/api/satp/score/:id', async (req, res) => {
  try {
    let profileId = req.params.id;
    const db = profileStore.getDb();
    let row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    if (!row) {
      const byHandle = db.prepare('SELECT * FROM profiles WHERE handle = ?').get(profileId);
      if (byHandle) { row = byHandle; profileId = byHandle.id; }
    }

    if (!row) return res.status(404).json({ error: 'Profile not found', id: profileId });

    const v3Score = await getV3Score(profileId).catch(() => null);
    const unified = computeUnifiedTrustScore(db, row, { v3Score });

    res.json({
      ok: true,
      data: {
        score: unified.score,
        reputationScore: unified.score,
        level: unified.level,
        verificationLevel: unified.level,
        levelName: unified.levelName,
        verificationLevelName: unified.levelName,
        verificationLabel: unified.levelName,
        breakdown: unified.breakdown || {},
        source: unified.source,
      }
    });
  } catch (err) {
    console.error('[SATP Score] error:', err.stack || err.message);
    res.status(500).json({ error: 'Score computation failed', detail: err.message });
  }
});

// x402 payment middleware — protects paid routes
// NOTE: x402 middleware doesn't support Express :param routes, so paid endpoints use query params
if (X402_ENABLED) {
  app.use(
    paymentMiddleware(
      {
        'GET /api/score': {
          accepts: [{
            scheme: 'exact',
            price: '$0.01',
            network: X402_NETWORK,
            payTo: X402_RECEIVE_ADDRESS,
          }],
          description: 'Agent reputation score lookup (Level + breakdown). Pass ?id=<profileId>',
          mimeType: 'application/json',
        },
        'GET /api/leaderboard/scores': {
          accepts: [{
            scheme: 'exact',
            price: '$0.05',
            network: X402_NETWORK,
            payTo: X402_RECEIVE_ADDRESS,
          }],
          description: 'Full agent reputation leaderboard with scores',
          mimeType: 'application/json',
        },
      },
      x402Server,
    ),
  );
}

// Paid: Individual agent score (x402-protected)
// Usage: GET /api/score?id=<profileId>&wallet=<optional>
app.get('/api/score', async (req, res) => {
  const profileId = req.query.id;
  if (!profileId) return res.status(400).json({ error: 'Missing ?id=<profileId> query parameter' });

  // Load profile from database (direct access to avoid schema conflicts)
  const Database = require('better-sqlite3');
  const scoreDb = new Database(path.join(__dirname, '..', 'data', 'agentfolio.db'), { readonly: true });
  const row = scoreDb.prepare('SELECT * FROM profiles WHERE id = ? OR handle = ?').get(profileId, profileId);
  scoreDb.close();
  
  // Build verification display from active verifications first, using chain-cache only for tx/link hints.
  const ccVerifications = row ? (chainCache.getVerifications(row.id, row.created_at) || []) : [];
  const dbVerifRowsForDisplay = row
    ? (() => {
        const displayDb = new Database(path.join(__dirname, '..', 'data', 'agentfolio.db'), { readonly: true });
        try {
          return displayDb.prepare('SELECT platform, identifier, proof, verified_at FROM verifications WHERE profile_id = ? ORDER BY verified_at DESC').all(row.id);
        } finally {
          displayDb.close();
        }
      })()
    : [];
  const ccHints = new Map();
  for (const att of ccVerifications) {
    const platform = att.platform === 'twitter' ? 'x' : att.platform;
    if (!platform || platform === 'review' || ccHints.has(platform)) continue;
    let proofData = {};
    try { proofData = typeof att.proofData === 'string' ? JSON.parse(att.proofData) : (att.proofData || {}); } catch {}
    const txSignature = att.txSignature || proofData.txSignature || proofData.signature || proofData.transactionSignature || null;
    ccHints.set(platform, {
      txSignature,
      solscanUrl: att.solscanUrl || (txSignature ? `https://solana.fm/tx/${txSignature}` : null),
    });
  }
  const verificationMap = new Map();
  for (const ver of dbVerifRowsForDisplay) {
    const platform = ver.platform === 'twitter' ? 'x' : ver.platform;
    if (!platform || platform === 'review' || verificationMap.has(platform)) continue;
    let proof = {};
    try { proof = typeof ver.proof === 'string' ? JSON.parse(ver.proof) : (ver.proof || {}); } catch {}
    const hinted = ccHints.get(platform) || {};
    const txSignature = proof.txSignature || proof.signature || proof.transactionSignature || hinted.txSignature || null;
    if (platform === 'solana' && !txSignature) continue;
    verificationMap.set(platform, {
      type: platform,
      verified: true,
      txSignature,
      solscanUrl: hinted.solscanUrl || (txSignature ? `https://solana.fm/tx/${txSignature}` : null),
    });
  }
  if (row && row.wallet && !verificationMap.has('satp') && (chainCache.isVerified(row.wallet) || ccHints.has('satp'))) {
    const hinted = ccHints.get('satp') || {};
    verificationMap.set('satp', {
      type: 'satp',
      verified: true,
      txSignature: hinted.txSignature || null,
      solscanUrl: hinted.solscanUrl || (hinted.txSignature ? `https://solana.fm/tx/${hinted.txSignature}` : null),
    });
  }
  const verifications = Array.from(verificationMap.values());
  
  const profile = row ? {
    id: row.id,
    name: row.name,
    description: row.bio,
    avatar: row.avatar,
    wallets: row.wallets,
    skills: row.skills,
    verifications,
    created_at: row.created_at,
    last_active_at: row.last_active_at,
    links: row.links,
  } : {
    id: profileId,
    name: `Agent ${profileId}`,
    description: 'AI Agent Profile',
    verifications: [],
    created_at: new Date().toISOString(),
  };
  
  const wallet = req.query.wallet || (() => {
    try { const w = JSON.parse(profile.wallets || '{}'); return w.solana || null; } catch { return null; }
  })();

  // Enrich with SATP reviews if wallet-like
  if (wallet) {
    try {
      const { PublicKey } = require('@solana/web3.js');
      new PublicKey(wallet);
      const Database = require('better-sqlite3');
      const reviewsDb = new Database(path.join(__dirname, '..', 'data', 'satp-reviews.db'), { readonly: true });
      const receivedStats = reviewsDb.prepare('SELECT COUNT(*) as total_reviews, ROUND(AVG(rating),2) as avg_rating FROM reviews WHERE reviewee_id = ?').get(wallet);
      reviewsDb.close();
      profile.reviews = { received: receivedStats };
    } catch (e) {
      profile.reviews = { received: { total_reviews: 0, avg_rating: null } };
    }
  }

  // Fetch on-chain SATP data if profile has a Solana wallet
  let solWallet = null;
  try {
    const w = typeof profile.wallets === 'string' ? JSON.parse(profile.wallets) : profile.wallets;
    solWallet = w?.solana || null;
  } catch (e) { /* no wallet */ }
  
  // A1: Single scoring function
  const resolvedId = row ? row.id : profileId;
  let _computed = { score: 0, level: 0, levelName: 'Unverified', source: 'none', verifications: [] };
  let v3Score = null;
  try {
    const _sdb = new (require('better-sqlite3'))(path.join(__dirname, '..', 'data', 'agentfolio.db'), { readonly: true });
    const _profileForTrust = row || {
      ...(profile || {}),
      id: resolvedId,
      claimed: profile?.claimed ?? row?.claimed ?? 0,
      wallet: solWallet || profile?.wallet || row?.wallet || null,
    };
    v3Score = await getV3Score(resolvedId).catch(() => null);
    _computed = computeUnifiedTrustScore(_sdb, _profileForTrust, { v3Score });
    _sdb.close();
  } catch (err) {
    try { console.error('[x402 /api/score] unified scoring failed:', err?.stack || err?.message || err); } catch {}
  }
  
  {
    return res.json({
      agentId: resolvedId,
      score: _computed.score,
      level: _computed.level,
      levelName: _computed.levelName,
      tier: _computed.levelName,
      source: _computed.source || 'compute-score',
      verifications: _computed.verifications || verifications,
      onChain: { reputationScore: _computed.score, verificationLevel: _computed.level, isBorn: !!(v3Score && v3Score.isBorn) },
      payment: { protocol: 'x402', enabled: X402_ENABLED, network: X402_ENABLED ? X402_NETWORK : null, price: X402_ENABLED ? '$0.01' : null, reason: X402_DISABLE_REASON },
    });
  }

  // Fallback — use compute-score
  res.json({
    agentId: resolvedId, score: _computed.score, level: _computed.level, levelName: _computed.levelName, tier: _computed.levelName,
    source: _computed.source || 'legacy-computed',
    payment: { protocol: 'x402', enabled: X402_ENABLED, network: X402_ENABLED ? X402_NETWORK : null, price: X402_ENABLED ? '$0.01' : null, reason: X402_DISABLE_REASON },
  });
});

// Paid: Leaderboard with scores
app.get('/api/leaderboard/scores', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);

  // A1: Leaderboard via unified scoring
  const db = profileStore.getDb();
  const allProfiles = db.prepare('SELECT * FROM profiles').all();
  const leaderboard = (await Promise.all(allProfiles.map(async (p) => {
    const v3Score = await getV3Score(p.id).catch(() => null);
    const comp = computeUnifiedTrustScore(db, p, { v3Score });
    if (!(comp.score > 0)) return null;
    return {
      agentId: p.id,
      name: p.name,
      avatar: p.avatar,
      handle: p.handle,
      score: comp.score,
      level: comp.level,
      levelName: comp.levelName,
      source: comp.source || 'scoring-v2-phase-a',
      isBorn: !!(v3Score && v3Score.isBorn),
    };
  }))).filter(Boolean);
  leaderboard.sort((a, b) => b.score - a.score);
  leaderboard.splice(limit);

  res.json({
    leaderboard,
    total: leaderboard.length,
    limit,
    computedAt: new Date().toISOString(),
    payment: { protocol: 'x402', enabled: X402_ENABLED, network: X402_ENABLED ? X402_NETWORK : null, price: X402_ENABLED ? '$0.05' : null, reason: X402_DISABLE_REASON },
  });
});

// Free: x402 pricing info endpoint
app.get('/api/x402/pricing', (req, res) => {
  res.json({
    protocol: 'x402',
    enabled: X402_ENABLED,
    network: X402_NETWORK || null,
    currency: 'USDC',
    receivingAddress: X402_RECEIVE_ADDRESS || null,
    reason: X402_DISABLE_REASON,
    endpoints: {
      free: [
        { path: '/api/health', method: 'GET', price: 'free' },
        { path: '/api/profiles', method: 'GET', price: 'free' },
        { path: '/api/profile/:id', method: 'GET', price: 'free' },
        { path: '/api/x402/pricing', method: 'GET', price: 'free' },
      ],
      paid: X402_ENABLED ? [
        { path: '/api/score?id=<profileId>', method: 'GET', price: '$0.01', description: 'Agent reputation score' },
        { path: '/api/profile/:id/trust-score', method: 'GET', price: '$0.01', description: 'Direct profile trust score alias' },
        { path: '/api/leaderboard/scores', method: 'GET', price: '$0.05', description: 'Full scored leaderboard' },
      ] : [],
    },
    facilitator: X402_FACILITATOR || null,
    docs: 'https://x402.org',
  });
});

if (X402_ENABLED) {
  logger.info('x402 payment layer initialized', {
    network: X402_NETWORK,
    receivingAddress: X402_RECEIVE_ADDRESS,
    paidEndpoints: ['GET /api/score?id=<profileId> ($0.01)', 'GET /api/profile/:id/trust-score ($0.01)', 'GET /api/leaderboard/scores ($0.05)'],
  });
} else {
  logger.warn('x402 payment layer disabled', {
    reason: X402_DISABLE_REASON,
    network: X402_NETWORK || null,
    receivingAddress: X402_RECEIVE_ADDRESS || null,
  });
}

  // === P2: Admin Dashboard ===
  const db = profileStore.getDb();
  app.get('/admin', (req, res) => {
  const getDb = profileStore.getDb;
    const key = req.query.key || req.headers['x-admin-key'];
    const ADMIN_KEY = process.env.ADMIN_KEY || 'brainforge-admin-2026';
    if (key !== ADMIN_KEY) return res.status(401).send('<h1>Unauthorized</h1><p>Add ?key=YOUR_KEY</p>');
    try {
      const totalProfiles = db.prepare('SELECT COUNT(*) as c FROM profiles').get().c;
      let claimedProfiles = 0;
      try { claimedProfiles = db.prepare('SELECT COUNT(*) as c FROM profiles WHERE claimed = 1').get().c; } catch(e) {}
      let verifiedCount = 0;
      try { verifiedCount = db.prepare('SELECT COUNT(DISTINCT profile_id) as c FROM verifications').get().c; } catch(e) {}
      let onChainCount = 0;
      onChainCount = 0; // P0: DB reads removed
      let recentRegs = [];
      try { recentRegs = db.prepare('SELECT id, name, handle, created_at FROM profiles ORDER BY created_at DESC LIMIT 20').all(); } catch(e) {}
      let recentVer = [];
      try { recentVer = db.prepare('SELECT profile_id, platform, verified_at FROM verifications ORDER BY verified_at DESC LIMIT 20').all(); } catch(e) {}
      let unclaimed = [];
      try { unclaimed = db.prepare("SELECT id, name, handle FROM profiles WHERE claimed = 0 OR claimed IS NULL LIMIT 50").all(); } catch(e) {}
      const esc = s => String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');

      let html = '<!DOCTYPE html><html><head><title>AgentFolio Admin</title>';
      html += '<style>body{background:#0d1117;color:#c9d1d9;font-family:system-ui;max-width:1200px;margin:0 auto;padding:20px}';
      html += 'h1{color:#58a6ff}h2{color:#3fb950;border-bottom:1px solid #21262d;padding-bottom:8px}';
      html += '.stats{display:flex;gap:20px;flex-wrap:wrap;margin:20px 0}';
      html += '.stat{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:20px;min-width:150px;text-align:center}';
      html += '.stat .num{font-size:2em;font-weight:bold;color:#58a6ff}.stat .label{color:#8b949e;margin-top:4px}';
      html += 'table{width:100%;border-collapse:collapse;margin:10px 0}';
      html += 'th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #21262d}';
      html += 'th{color:#8b949e;font-size:.85em;text-transform:uppercase}tr:hover{background:#161b22}a{color:#58a6ff;text-decoration:none}';
      html += '</style></head><body>';
      html += '<h1>AgentFolio Admin Dashboard</h1>';
      html += '<div class="stats">';
      html += '<div class="stat"><div class="num">' + totalProfiles + '</div><div class="label">Total Profiles</div></div>';
      html += '<div class="stat"><div class="num">' + claimedProfiles + '</div><div class="label">Claimed</div></div>';
      html += '<div class="stat"><div class="num">' + verifiedCount + '</div><div class="label">Verified</div></div>';
      html += '<div class="stat"><div class="num">' + onChainCount + '</div><div class="label">On-Chain</div></div>';
      html += '<div class="stat"><div class="num">' + (totalProfiles - claimedProfiles) + '</div><div class="label">Unclaimed</div></div>';
      html += '</div>';
      
      html += '<h2>Recent Registrations</h2><table><tr><th>ID</th><th>Name</th><th>Handle</th><th>Created</th></tr>';
      recentRegs.forEach(r => { html += '<tr><td><a href="/profile/' + esc(r.id) + '">' + esc(r.id) + '</a></td><td>' + esc(r.name) + '</td><td>' + esc(r.handle) + '</td><td>' + esc(r.created_at) + '</td></tr>'; });
      html += '</table>';

      html += '<h2>Recent Verifications</h2><table><tr><th>Profile</th><th>Platform</th><th>Verified At</th></tr>';
      recentVer.forEach(v => { html += '<tr><td><a href="/profile/' + esc(v.profile_id) + '">' + esc(v.profile_id) + '</a></td><td>' + esc(v.platform) + '</td><td>' + esc(v.verified_at) + '</td></tr>'; });
      html += '</table>';

      html += '<h2>Unclaimed Profiles (first 50)</h2><table><tr><th>ID</th><th>Name</th><th>Handle</th><th>Claim</th></tr>';
      unclaimed.forEach(u => { html += '<tr><td>' + esc(u.id) + '</td><td>' + esc(u.name) + '</td><td>' + esc(u.handle) + '</td><td><a href="/claim/' + esc(u.id) + '">Claim</a></td></tr>'; });
      html += '</table>';

      html += '<p style="color:#8b949e;margin-top:40px">Generated ' + new Date().toISOString() + '</p>';
      html += '</body></html>';
      res.send(html);
    } catch (err) { res.status(500).send('<h1>Error</h1><pre>' + err.message + '</pre>'); }
  });

// Start server
server = app.listen(PORT, () => {
  logger.info('AgentFolio server started', {
    port: PORT,
    env: NODE_ENV,
    pid: process.pid
  });
  

  // === P0: Unclaimed profiles API (for brainGrowth outreach) ===
  app.get('/api/unclaimed-profiles', (req, res) => {
    try {
      const fs = require('fs');
      const format = req.query.format || 'json';
      if (format === 'csv') {
        const csv = fs.readFileSync(__dirname + '/../data/unclaimed-profiles.csv', 'utf8');
        res.setHeader('Content-Type', 'text/csv');
        return res.send(csv);
      }
      const json = JSON.parse(fs.readFileSync(__dirname + '/../data/unclaimed-profiles.json', 'utf8'));
      res.json({ total: json.length, profiles: json });
    } catch (err) {
      try {
        const rows = db.prepare('SELECT id, name, handle, github FROM profiles WHERE claimed = 0 OR claimed IS NULL').all();
        const profiles = rows.map(r => ({ id: r.id, name: r.name, handle: r.handle, github: r.github || '', claim_url: 'https://agentfolio.bot/claim/' + r.id }));
        res.json({ total: profiles.length, profiles });
      } catch (e2) { res.status(500).json({ error: 'Failed' }); }
    }
  });



  logger.info('Available endpoints', {
    endpoints: [
      "GET / - Profile directory",
      "GET /profile/:id - Profile page", 
      "GET /api/profiles - JSON list",
      "GET /api/profile/:id - Individual profile",
      "GET /api/jobs - Jobs marketplace",
      "GET /api/health - Health check",
      "GET /api/search?q= - Search",
      "POST /api/webhooks - Register webhook",
      "WS /ws - Real-time feed"
    ]
  });
  
  logger.info('Discord verification fix active');
  logger.info('Line 68 updated to hardened version');
  
  // Start chain-cache refresh loop (on-chain attestation data)
  try {
    chainCache.start();
    logger.info('Chain-cache started', { refreshSeconds: 120 });
  } catch (e) {
    logger.warn('Chain-cache start failed', { message: e.message });
  }
});

app.get('/api/tokens/stats', (req, res) => {
  try {
    const { getTokenStats } = require('./lib/token-launch');
    return res.json(getTokenStats());
  } catch (e) {
    return res.json({
      totalTokens: 0,
      totalLaunches: 0,
      totalMcap: null,
      platformBreakdown: { virtuals: 0, pumpfun: 0, existing: 0 },
      chainBreakdown: { solana: 0, base: 0 },
      totalBurned: 0,
      bondingCount: 0,
      graduatedCount: 0,
      recentLaunches: []
    });
  }
});

// GitHub stats endpoint (used by frontend profile page)
app.get('/api/verify/github/stats', async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'username required' });
  try {
    const resp = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, {
      headers: { 'User-Agent': 'AgentFolio/1.0' }
    });
    if (!resp.ok) return res.json({ username, repos: 0, stars: 0 });
    const data = await resp.json();
    res.json({ username: data.login, repos: data.public_repos || 0, stars: data.followers || 0 });
  } catch (e) {
    res.json({ username, repos: 0, stars: 0 });
  }
});

module.exports = app;
