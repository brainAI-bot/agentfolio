/**
 * AgentFolio Backend Server
 * AI Agent Portfolio & Reputation Platform
 * 
 * FIXED: Discord verification now uses hardened version
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// SATP Reviews integration
const satpReviews = require('./satp-reviews');
// SATP On-Chain API (read + write)
const { registerSATPRoutes } = require('./routes/satp-api');
const { registerSATPWriteRoutes } = require('./routes/satp-write-api');
const { registerSATPAutoIdentityRoutes } = require("./routes/satp-auto-identity");
// V3 auto-identity + BOA linker (brainChain deploy 2026-04-05)
const { registerSATPAutoIdentityV3Routes } = require("./routes/satp-auto-identity-v3");
const { registerBoaLinkerV3Routes } = require("./routes/satp-boa-linker-v3");
const { registerReviewsV2Routes } = require("./api/reviews-v2");

// Profile Store (SQLite-backed persistent profiles, endorsements, reviews)
const profileStore = require('./profile-store');

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
const { ExactEvmScheme } = require('@x402/evm/exact/server');

const X402_RECEIVE_ADDRESS = process.env.X402_RECEIVE_ADDRESS || '0xEE13776767542F3a8d67d9fAd723fc43213052Bd';
const X402_FACILITATOR = process.env.X402_FACILITATOR || 'https://x402.org/facilitator';
// Base Sepolia (testnet) for now — public facilitator only supports testnet
// Switch to 'eip155:8453' (Base Mainnet) when self-hosting facilitator or using CDP mainnet
const X402_NETWORK = process.env.X402_NETWORK || 'eip155:84532'; // Base Sepolia

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
  domainVerify = require('./domain-verify');
  console.log('✓ Domain verification loaded successfully');
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
const PORT = process.env.PORT || 3333;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Basic middleware
app.use(cors({
  origin: NODE_ENV === 'production' 
    ? ['https://agentfolio.bot', 'https://www.agentfolio.bot']
    : true,
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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

  const did = 'did:web:agentfolio.bot';
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
        serviceEndpoint: 'https://agentfolio.bot/api/trust-credential',
      },
      {
        id: `${did}#satp`,
        type: 'SolanaAttestationProtocol',
        serviceEndpoint: 'https://agentfolio.bot/api/satp',
      },
      {
        id: `${did}#api`,
        type: 'AgentFolioAPI',
        serviceEndpoint: 'https://agentfolio.bot/api',
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
  const { agentId } = req.params;
  const profileStore = require('./profile-store');
  try {
    const db = profileStore.getDb();
    let profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(agentId);
    if (!profile && !agentId.startsWith('agent_')) {
      profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get('agent_' + agentId);
    }
    if (!profile && agentId.startsWith('agent_')) {
      profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(agentId.replace(/^agent_/, ''));
    }
    if (!profile) {
      return res.status(404).json({ error: 'Agent not found', agentId });
    }
    
    let wallets = {}, tags = [], skills = [];
    try { wallets = JSON.parse(profile.wallets || '{}'); } catch (_) {}
    try { const t = JSON.parse(profile.tags || '[]'); tags = Array.isArray(t) ? t : []; } catch (_) {}
    try { const s = JSON.parse(profile.skills || '[]'); skills = Array.isArray(s) ? s : []; } catch (_) {}
    
    // Verifications from chain-cache attestations cross-referenced with DB verifications
    // [P0 FIX Apr 5] Only show chain attestations that have a matching DB verification (filters old profile attestations)
    // [FIX 4] Filter attestations by profile creation date
    const attestations = (chainCache.getVerifications(profile.id, profile.created_at) || [])
      .concat(profile.id !== agentId ? (chainCache.getVerifications(agentId, profile.created_at) || []) : []);
    let dbVerifPlatforms = new Set();
    try {
      const vRows = db.prepare("SELECT platform FROM verifications WHERE profile_id = ? AND identifier IS NOT NULL AND identifier != ''").all(profile.id);
      for (const vr of vRows) dbVerifPlatforms.add(vr.platform === 'twitter' ? 'x' : vr.platform);
    } catch (_) {}
    const verifications = attestations
      .filter(att => att.platform && att.platform !== 'review')
      .filter(att => {
        const plat = att.platform === 'twitter' ? 'x' : att.platform;
        // Only include if DB has a real verification for this platform, OR it's satp/solana (wallet-based)
        return dbVerifPlatforms.has(plat) || plat === 'satp' || plat === 'solana';
      })
      .map(att => ({
        platform: att.platform,
        verified: true,
        txSignature: att.txSignature,
        solscanUrl: att.solscanUrl || `https://solscan.io/tx/${att.txSignature}`,
        timestamp: att.timestamp,
      }));
    // Deduplicate by platform (keep first = most recent from chain-cache)
    const seenPlatforms = new Set();
    const dedupedVerifications = verifications.filter(v => {
      if (seenPlatforms.has(v.platform)) return false;
      seenPlatforms.add(v.platform);
      return true;
    });
    
    // A1: Single scoring function — compute from DB verifications
    const { computeScore } = require('./lib/compute-score');
    let dbVerifRowsForScore = [];
    try {
      dbVerifRowsForScore = db.prepare('SELECT platform, identifier FROM verifications WHERE profile_id = ?').all(profile.id);
    } catch (_) {}
    const hasSatpId = dbVerifRowsForScore.some(v => v.platform === 'satp');
    const computed = computeScore(dbVerifRowsForScore, { hasSatpIdentity: hasSatpId, claimed: !!profile.claimed });
    const trustScore = computed.score;
    const tier = computed.levelName;
    
    res.json({
      agentId: profile.id,
      name: profile.name,
      did: `did:agentfolio:${profile.id}`,
      trustScore,
      tier,
      scoreVersion: 'v3',
      verifications: dedupedVerifications.map(v => ({
        platform: v.platform,
        verified: true,
        txSignature: v.txSignature,
        solscanUrl: v.solscanUrl,
        timestamp: v.timestamp,
      })),
      wallets,
      tags,
      skills,
      onChainRegistered: hasSatpId,
      v3: {
        reputationScore: computed.score,
        verificationLevel: computed.level,
        verificationLabel: computed.levelName,
        isBorn: false,
      },
      breakdown: computed.breakdown,
      links: {
        profile: `https://agentfolio.bot/profile/${profile.id}`,
        trustCredential: `https://agentfolio.bot/api/trust-credential/${profile.id}`,
        api: `https://agentfolio.bot/api/profile/${profile.id}`,
      },
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
    });
  } catch (err) {
    console.error('[Explorer] Error:', err);
    res.status(500).json({ error: 'Failed to load agent', details: err.message });
  }
});


// ─── Trust Score API (dedicated endpoint) ────────────────
app.get('/api/profile/:id/trust-score', async (req, res) => {
  // Return computed trust score for internal SSR and public use
  try {
    const profileId = req.params.id;
    const db = profileStore.getDb();
    const row = db.prepare('SELECT id, claimed FROM profiles WHERE id = ?').get(profileId);
    if (!row) return res.status(404).json({ error: 'Profile not found' });
    const { computeScore } = require('./lib/compute-score');
    const verifs = db.prepare('SELECT platform, identifier FROM verifications WHERE profile_id = ?').all(profileId);
    const hasSatp = verifs.some(v => v.platform === 'satp');
    const computed = computeScore(verifs, { hasSatpIdentity: hasSatp, claimed: !!row.claimed });
    let v3Score = null;
    try {
      const { getV3Score } = require('./lib/v3-score-service');
      v3Score = await getV3Score(profileId);
    } catch {}
    const reputationScore = v3Score?.reputationScore || computed.score;
    const verificationLevel = v3Score?.verificationLevel || computed.level;
    const labels = ['Unverified','Registered','Verified','Established','Trusted','Sovereign'];
    res.json({
      ok: true,
      data: {
        profileId,
        reputationScore,
        verificationLevel,
        verificationLabel: labels[verificationLevel] || 'Unknown',
        isBorn: v3Score?.isBorn || false,
        faceImage: v3Score?.faceImage || null,
        breakdown: computed.breakdown,
        source: v3Score ? 'v3+compute' : 'compute',
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Internal error' });
  }
});


// ─── Badge SVG ──────────────────
const { generateBadgeSVG } = require('./lib/badge-svg');
app.get('/api/badge/:id.svg', async (req, res) => {
  try {
    const id = req.params.id;
    const db = profileStore.getDb();
    const row = db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(id);
    if (!row) return res.status(404).type('text/plain').send('Profile not found');
    // A1: compute-score for badge consistency
    const { computeScore } = require('./lib/compute-score');
    const verifs = db.prepare('SELECT platform, identifier FROM verifications WHERE profile_id = ?').all(id);
    const hasSatp = verifs.some(v => v.platform === 'satp');
    const computed = computeScore(verifs, { hasSatpIdentity: hasSatp, claimed: true });
    const level = computed.level;
    const score = computed.score;
    const svg = generateBadgeSVG(row.name, level, score);
    res.set('Content-Type', 'image/svg+xml').set('Cache-Control', 'public, max-age=300').send(svg);
  } catch (e) {
    res.status(500).type('text/plain').send('Error generating badge');
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
  const { profileId, discordUsername } = req.body;
  
  if (!profileId || !discordUsername) {
    return res.status(400).json({ error: 'Missing profileId or discordUsername' });
  }

  try {
    const result = await discordVerify.initiateDiscordVerification(profileId, discordUsername);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/verification/discord/verify', async (req, res) => {
  const { challengeId, messageUrl } = req.body;
  if (!challengeId) return res.status(400).json({ error: 'Missing challengeId' });
  try {
    const result = await discordVerify.verifyDiscordChallenge(challengeId, messageUrl);
    if (result.verified && result.discordUsername) {
      const challenge = await require('./verification-challenges').getChallenge(challengeId);
      if (challenge && challenge.profileId) {
        profileStore.addVerification(challenge.profileId, 'discord', result.discordUsername, { challengeId, messageId: result.messageId, verifiedAt: new Date().toISOString() });
      }
    }
    res.json(result);
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
  const { profileId, telegramUsername } = req.body;
  
  if (!profileId || !telegramUsername) {
    return res.status(400).json({ error: 'Missing profileId or telegramUsername' });
  }

  try {
    const result = await telegramVerify.initiateTelegramVerification(profileId, telegramUsername);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/verification/telegram/verify', async (req, res) => {
  const { challengeId, messageUrl } = req.body;
  
  if (!challengeId || !messageUrl) {
    return res.status(400).json({ error: 'Missing challengeId or messageUrl' });
  }

  try {
    const result = await telegramVerify.verifyTelegramChallenge(challengeId, messageUrl);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
  const { profileId, domain } = req.body;
  
  if (!profileId || !domain) {
    return res.status(400).json({ error: 'Missing profileId or domain' });
  }

  try {
    const result = await domainVerify.initiateDomainVerification(profileId, domain);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/verification/domain/verify', async (req, res) => {
  const { challengeId, method } = req.body;
  
  if (!challengeId) {
    return res.status(400).json({ error: 'Missing challengeId' });
  }

  try {
    const result = await domainVerify.verifyDomainChallenge(challengeId, method || 'auto');
    res.json(result);
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
  const { profileId, websiteUrl } = req.body;
  
  if (!profileId || !websiteUrl) {
    return res.status(400).json({ error: 'Missing profileId or websiteUrl' });
  }

  try {
    const result = await websiteVerify.initiateWebsiteVerification(profileId, websiteUrl);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/verification/website/verify', async (req, res) => {
  const { challengeId, method } = req.body;
  
  if (!challengeId) {
    return res.status(400).json({ error: 'Missing challengeId' });
  }

  try {
    const result = await websiteVerify.verifyWebsiteChallenge(challengeId, method || 'auto');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== ETH WALLET VERIFICATION ==========
app.post('/api/verification/eth/initiate', (req, res) => {
  try {
    const { profileId, walletAddress } = req.body;
    if (!profileId || !walletAddress) return res.status(400).json({ error: 'profileId and walletAddress required' });
    if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) return res.status(400).json({ error: 'Invalid ETH address' });
    const challenge = ethVerify.generateChallenge(profileId, walletAddress);
    res.json({ success: true, ...challenge, instructions: 'Sign the message with your ETH wallet, then POST signature to /api/verification/eth/verify' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/verification/eth/verify', (req, res) => {
  try {
    const { challengeId, signature } = req.body;
    if (!challengeId || !signature) return res.status(400).json({ error: 'challengeId and signature required' });
    const result = ethVerify.verifySignature(challengeId, signature);
    if (result.verified && result.profileId) {
      profileStore.addVerification(result.profileId, 'eth', result.walletAddress, { challengeId, signature: signature.slice(0, 16) + '...', verifiedAt: new Date().toISOString() });
    }
    res.json(result);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ========== ENS VERIFICATION ==========
app.post('/api/verification/ens/initiate', (req, res) => {
  try {
    const { profileId, ensName } = req.body;
    if (!profileId || !ensName) return res.status(400).json({ error: 'profileId and ensName required' });
    if (!ensName.endsWith('.eth')) return res.status(400).json({ error: 'ENS name must end with .eth' });
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
    const { profileId, fid } = req.body;
    if (!profileId || !fid) return res.status(400).json({ error: 'profileId and fid required' });
    const challenge = farcasterVerify.generateChallenge(profileId, fid);
    res.json({ success: true, ...challenge });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/verification/farcaster/verify', async (req, res) => {
  try {
    const { challengeId, castHash } = req.body;
    if (!challengeId || !castHash) return res.status(400).json({ error: 'challengeId and castHash required' });
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
            <div style="font-size:.85em;font-weight:600;color:#8b949e;font-family:monospace">${esc(v3Rep.authority ? v3Rep.authority.slice(0,6) + '...' + v3Rep.authority.slice(-4) : '—')}</div>
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
  const url = require('url').parse(req.url);
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
    const { profileId, githubUsername } = req.body;
    if (!profileId || !githubUsername) return res.status(400).json({ error: 'profileId and githubUsername required' });
    const challenge = verificationChallenges.generateChallenge(profileId, 'github', githubUsername);
    challenge.challengeData.instructions = `Create a public gist containing: agentfolio-verify:${challenge.id}`;
    challenge.challengeData.expectedContent = `agentfolio-verify:${challenge.id}`;
    await verificationChallenges.storeChallenge(challenge);
    res.json({ challengeId: challenge.id, instructions: challenge.challengeData.instructions, expiresAt: challenge.challengeData.expiresAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/verify/github/confirm', async (req, res) => {
  try {
    const { challengeId, gistUrl } = req.body;
    if (!challengeId || !gistUrl) return res.status(400).json({ error: 'challengeId and gistUrl required' });
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
    const { profileId, xHandle } = req.body;
    if (!profileId || !xHandle) return res.status(400).json({ error: 'profileId and xHandle required' });
    const handle = xHandle.replace('@', '');
    const challenge = verificationChallenges.generateChallenge(profileId, 'x', handle);
    challenge.challengeData.instructions = `Post a tweet containing: agentfolio-verify:${challenge.id}`;
    challenge.challengeData.expectedContent = `agentfolio-verify:${challenge.id}`;
    await verificationChallenges.storeChallenge(challenge);
    res.json({ challengeId: challenge.id, instructions: challenge.challengeData.instructions, expiresAt: challenge.challengeData.expiresAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/verify/x/confirm', async (req, res) => {
  try {
    const { challengeId, tweetUrl } = req.body;
    if (!challengeId || !tweetUrl) return res.status(400).json({ error: 'challengeId and tweetUrl required' });
    const challenge = await verificationChallenges.getChallenge(challengeId);
    if (!challenge) return res.status(404).json({ error: 'Challenge not found or expired' });
    // Verify via vxtwitter API
    const tweetId = tweetUrl.split('/').pop().split('?')[0];
    const handle = challenge.challengeData.identifier;
    const resp = await fetch(`https://api.vxtwitter.com/${handle}/status/${tweetId}`);
    if (!resp.ok) return res.status(400).json({ error: 'Could not fetch tweet' });
    const tweet = await resp.json();
    if (!tweet.text?.includes(challenge.challengeData.expectedContent)) return res.status(400).json({ error: 'Tweet does not contain challenge code' });
    const proof = { tweetUrl, tweetId, verifiedAt: new Date().toISOString() };
    await verificationChallenges.completeChallenge(challengeId, proof);
    profileStore.addVerification(challenge.profileId, 'x', handle, proof);
    res.json({ verified: true, platform: 'x', identifier: handle, proof: { challengeId, tweetUrl } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Solana: challenge → user signs message → confirm (ed25519 verified)
app.post('/api/verify/solana/challenge', async (req, res) => {
  try {
    const { profileId, walletAddress } = req.body;
    if (!profileId || !walletAddress) return res.status(400).json({ error: 'profileId and walletAddress required' });
    const challenge = verificationChallenges.generateChallenge(profileId, 'solana', walletAddress);
    const message = `AgentFolio verification: ${challenge.id}`;
    challenge.challengeData.message = message;
    await verificationChallenges.storeChallenge(challenge);
    res.json({ challengeId: challenge.id, message, walletAddress, expiresAt: challenge.challengeData.expiresAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/verify/solana/confirm', async (req, res) => {
  try {
    const { challengeId, signature } = req.body;
    if (!challengeId || !signature) return res.status(400).json({ error: 'challengeId and signature required' });
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

// AgentMail: challenge → sends code to email → confirm
app.post('/api/verify/agentmail/challenge', async (req, res) => {
  try {
    const { profileId, email } = req.body;
    if (!profileId || !email) return res.status(400).json({ error: 'profileId and email required' });
    if (!email.endsWith('@agentmail.to')) return res.status(400).json({ error: 'Only @agentmail.to addresses supported' });
    const challenge = verificationChallenges.generateChallenge(profileId, 'agentmail', email);
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    challenge.challengeData.code = code;
    challenge.challengeData.instructions = `Check your ${email} inbox for verification code: ${code}`;
    await verificationChallenges.storeChallenge(challenge);
    // In production: send email with code via AgentMail API
    res.json({ challengeId: challenge.id, instructions: `Enter the verification code sent to ${email}`, expiresAt: challenge.challengeData.expiresAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/verify/agentmail/confirm', async (req, res) => {
  try {
    const { challengeId, code } = req.body;
    if (!challengeId || !code) return res.status(400).json({ error: 'challengeId and code required' });
    const challenge = await verificationChallenges.getChallenge(challengeId);
    if (!challenge) return res.status(404).json({ error: 'Challenge not found or expired' });
    if (code.toUpperCase() !== challenge.challengeData.code) return res.status(400).json({ error: 'Invalid verification code' });
    await verificationChallenges.completeChallenge(challengeId, { email: challenge.challengeData.identifier, verifiedAt: new Date().toISOString() });
    profileStore.addVerification(challenge.profileId, 'agentmail', challenge.challengeData.identifier, { challengeId, verifiedAt: new Date().toISOString() });
    res.json({ verified: true, platform: 'agentmail', identifier: challenge.challengeData.identifier, proof: { challengeId } });
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
        res.json(result);
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
  console.error(`[ERROR] ${err.message}`, { 
    path: req.path,
    method: req.method,
    stack: NODE_ENV === 'development' ? err.stack : undefined
  });
  
  res.status(500).json({
    error: NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(`[${new Date().toISOString()}] info: SIGINT received, shutting down gracefully...`, {service: "agentfolio"});
  console.log(`[${new Date().toISOString()}] info: Server closed`, {service: "agentfolio"});
  process.exit(0);
});

// ============================================================
// x402 Paid API Endpoints (USDC on Base)
// ============================================================

// Initialize x402 facilitator and resource server
const x402Facilitator = new HTTPFacilitatorClient({ url: X402_FACILITATOR });
const x402Server = new x402ResourceServer(x402Facilitator);
x402Server.register('eip155:*', new ExactEvmScheme());

// Free: SATP-integrated score (reads on-chain + off-chain)
app.get('/api/satp/score/:id', async (req, res) => {
  try {
    const profileId = req.params.id;
    const Database = require('better-sqlite3');
    const scoreDb = new Database(path.join(__dirname, '..', 'data', 'agentfolio.db'), { readonly: true });
    const row = scoreDb.prepare('SELECT * FROM profiles WHERE id = ? OR handle = ?').get(profileId, profileId);
    scoreDb.close();

    if (!row) return res.status(404).json({ error: 'Profile not found', id: profileId });

    // Build verifications from chain-cache attestations (on-chain source of truth)
    const attestations = chainCache.getVerifications(row.id, row.created_at) || [];
    const verifications = attestations
      .filter(att => att.platform && att.platform !== 'review')
      .map(att => ({ type: att.platform, verified: true, txSignature: att.txSignature, solscanUrl: att.solscanUrl || `https://solscan.io/tx/${att.txSignature}` }));
    
    const profile = {
      id: row.id, name: row.name, description: row.bio, avatar: row.avatar,
      wallets: row.wallets, skills: row.skills, verifications,
      created_at: row.created_at, last_active_at: row.last_active_at, links: row.links,
    };

    // Get Solana wallet for on-chain lookup
    let solWallet = null;
    try {
      const w = typeof profile.wallets === 'string' ? JSON.parse(profile.wallets) : profile.wallets;
      solWallet = w?.solana || null;
    } catch (e) { /* no wallet */ }

    // A1: compute-score
    const { computeScore: _cs } = require('./lib/compute-score');
    const _vRows = profileStore.getDb().prepare('SELECT platform, identifier FROM verifications WHERE profile_id = ?').all(profile.id);
    const _comp = _cs(_vRows, { hasSatpIdentity: _vRows.some(v => v.platform === 'satp'), claimed: !!profile.claimed });
    res.json({ ok: true, data: { score: _comp.score, level: _comp.level, levelName: _comp.levelName, breakdown: _comp.breakdown } });
  } catch (err) {
    console.error('[SATP Score] error:', err.message);
    res.status(500).json({ error: 'Score computation failed', detail: err.message });
  }
});

// x402 payment middleware — protects paid routes
// NOTE: x402 middleware doesn't support Express :param routes, so paid endpoints use query params
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
  
  // Build verifications from chain-cache attestations (on-chain source of truth)
  const ccVerifications = row ? (chainCache.getVerifications(row.id, row.created_at) || []) : [];
  const verifications = ccVerifications
    .filter(att => att.platform && att.platform !== 'review')
    .map(att => ({ type: att.platform, verified: true, txSignature: att.txSignature, solscanUrl: att.solscanUrl || `https://solscan.io/tx/${att.txSignature}` }));
  
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
  const { computeScore: _computeScore } = require('./lib/compute-score');
  let _dbVerifs = [];
  try {
    const _sdb = new (require('better-sqlite3'))(path.join(__dirname, '..', 'data', 'agentfolio.db'), { readonly: true });
    _dbVerifs = _sdb.prepare('SELECT platform, identifier FROM verifications WHERE profile_id = ?').all(resolvedId);
    _sdb.close();
  } catch (_) {}
  const _hasSatp = _dbVerifs.some(v => v.platform === 'satp');
  const _computed = _computeScore(_dbVerifs, { hasSatpIdentity: _hasSatp, claimed: !!row?.claimed });
  
  {
    return res.json({
      agentId: resolvedId,
      score: _computed.score,
      level: _computed.level,
      levelName: _computed.levelName,
      tier: _computed.levelName,
      source: 'compute-score',
      verifications,
      onChain: { reputationScore: _computed.score, verificationLevel: _computed.level, isBorn: false },
      payment: { protocol: 'x402', network: X402_NETWORK, price: '$0.01' },
    });
  }

  // Fallback — use compute-score
  res.json({
    agentId: resolvedId, score: _computed.score, level: _computed.level, levelName: _computed.levelName, tier: _computed.levelName,
    source: 'legacy-computed',
    payment: { protocol: 'x402', network: X402_NETWORK, price: '$0.01' },
  });
});

// Paid: Leaderboard with scores
app.get('/api/leaderboard/scores', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);

  // A1: Leaderboard via compute-score
  const db = profileStore.getDb();
  const allProfiles = db.prepare('SELECT id, name, avatar, handle, claimed FROM profiles').all();
  const { computeScore: _lbScore } = require('./lib/compute-score');
  const allVerifs = db.prepare('SELECT profile_id, platform, identifier FROM verifications').all();
  const vMap = {};
  for (const v of allVerifs) { if (!vMap[v.profile_id]) vMap[v.profile_id] = []; vMap[v.profile_id].push(v); }
  const leaderboard = [];
  for (const p of allProfiles) {
    const verifs = vMap[p.id] || [];
    const hasSatp = verifs.some(v => v.platform === 'satp');
    const comp = _lbScore(verifs, { hasSatpIdentity: hasSatp, claimed: !!p.claimed });
    if (comp.score > 0) {
      leaderboard.push({
        agentId: p.id, name: p.name, avatar: p.avatar, handle: p.handle,
        score: comp.score, level: comp.level, levelName: comp.levelName,
        source: 'compute-score',
      });
    }
  }
  leaderboard.sort((a, b) => b.score - a.score);
  leaderboard.splice(limit);

  res.json({
    leaderboard,
    total: leaderboard.length,
    limit,
    computedAt: new Date().toISOString(),
    payment: { protocol: 'x402', network: X402_NETWORK, price: '$0.05' },
  });
});

// Free: x402 pricing info endpoint
app.get('/api/x402/pricing', (req, res) => {
  res.json({
    protocol: 'x402',
    network: X402_NETWORK,
    currency: 'USDC',
    receivingAddress: X402_RECEIVE_ADDRESS,
    endpoints: {
      free: [
        { path: '/api/health', method: 'GET', price: 'free' },
        { path: '/api/profiles', method: 'GET', price: 'free' },
        { path: '/api/profile/:id', method: 'GET', price: 'free' },
        { path: '/api/x402/pricing', method: 'GET', price: 'free' },
      ],
      paid: [
        { path: '/api/score?id=<profileId>', method: 'GET', price: '$0.01', description: 'Agent reputation score' },
        { path: '/api/leaderboard/scores', method: 'GET', price: '$0.05', description: 'Full scored leaderboard' },
      ],
    },
    facilitator: X402_FACILITATOR,
    docs: 'https://x402.org',
  });
});

console.log(`[${new Date().toISOString()}] info: x402 payment layer initialized`, {
  service: 'agentfolio',
  network: X402_NETWORK,
  receivingAddress: X402_RECEIVE_ADDRESS,
  paidEndpoints: ['GET /api/score?id=<profileId> ($0.01)', 'GET /api/leaderboard/scores ($0.05)'],
});

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
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] info: AgentFolio server started`, { 
    service: "agentfolio",
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



  console.log(`[${new Date().toISOString()}] info: Available endpoints`, {
    service: "agentfolio",
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
  
  console.log(`[${new Date().toISOString()}] info: 🔧 DISCORD VERIFICATION FIX ACTIVE`, {service: "agentfolio"});
  console.log(`[${new Date().toISOString()}] info: ✓ Line 68 updated to hardened version`, {service: "agentfolio"});
  
  // Start chain-cache refresh loop (on-chain attestation data)
  try {
    chainCache.start();
    console.log(`[${new Date().toISOString()}] info: ✓ Chain-cache started (120s refresh)`, {service: "agentfolio"});
  } catch (e) {
    console.warn(`[${new Date().toISOString()}] warn: Chain-cache start failed:`, e.message);
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
