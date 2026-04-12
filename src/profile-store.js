/**
 * Profile Store -- SQLite-backed persistent profiles, endorsements, and reviews
 * 
 * Endpoints registered:
 *   POST   /api/register              -- Create a new agent profile
 *   GET    /api/profiles              -- List profiles (paginated)
 *   GET    /api/profile/:id           -- Get single profile (enriched)
 *   PATCH  /api/profile/:id           -- Update profile fields
 *   POST   /api/profile/:id/endorsements -- Add endorsement
 *   GET    /api/profile/:id/endorsements -- List endorsements
 *   POST   /api/profile/:id/reviews     -- Add review
 *   GET    /api/profile/:id/reviews     -- List reviews
 */

const Database = require('better-sqlite3');
const nacl = require('tweetnacl');
const _bs58 = require('bs58');
const bs58 = _bs58.default || _bs58;
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { computeScore } = require("./lib/compute-score");
const { computeUnifiedTrustScore } = require("./lib/unified-trust-score");

// Rate limiter for registration: 5 per hour per IP
const registerLimiter = rateLimit({
  validate: false,
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Try again in 1 hour.' },
  keyGenerator: (req) => req.ip || req.headers['x-forwarded-for'] || 'unknown',
});
const { sendWelcomeEmail } = require('./lib/welcome-email');

// SATP on-chain identity registration (fire-and-forget on profile creation)
let satpWrite;
try {
  satpWrite = require('./satp-write-client');
} catch (e) {
  console.warn('[ProfileStore] satp-write-client not available, on-chain registration disabled');
}

// SATP V3 SDK -- Genesis Record creation + V3 identity reads
let satpV3;
try {
  const { createSATPClient, SATPV3SDK: WrapperSDK, hashAgentId, getGenesisPDA } = require('./satp-client/src');
  const { SATPV3SDK } = require('./satp-client/src/v3-sdk');
  const RPC_URL = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
  const v3Client = new SATPV3SDK({ rpcUrl: RPC_URL, network: "mainnet" });
  satpV3 = { client: v3Client, SATPV3SDK, hashAgentId, getGenesisPDA };
  console.log('[SATP V3] SDK loaded (v3-sdk SATPV3SDK with getGenesisRecord)');
} catch (e) {
  console.warn('[SATP V3] SDK not available:', e.message);
}
// [CEO-URGENT Apr 4] postVerificationHook -- single on-chain entry point
let postVerificationHook;
try { ({ postVerificationHook } = require('./post-verification-hook')); console.log('[PostVerify] postVerificationHook loaded'); } catch(e) { console.warn('[PostVerify] hook not available:', e.message); }


// V3 Score Service -- batch on-chain scoring
let v3ScoreService;
try {
  v3ScoreService = require('./v3-score-service');
  console.log('[V3 Scores] Score service loaded');
} catch (e) {
  console.warn('[V3 Scores] Score service not available:', e.message);
}

// Scoring Engine V2 -- 2D scoring (verification level + reputation)
let scoringEngineV2;
try {
  // [FIX 2] DISABLED
  // scoringEngineV2 = require('./lib/scoring-engine-v2');
  console.log('[ProfileStore] Scoring Engine V2 loaded');
} catch (e) {
  console.warn('[ProfileStore] Scoring Engine V2 not available:', e.message);
}

const PLATFORM_KEYPAIR_PATH = process.env.SATP_PLATFORM_KEYPAIR ||
  '/home/ubuntu/agentfolio/config/platform-keypair.json';
const SATP_NETWORK = process.env.SATP_NETWORK || 'mainnet';

const DB_PATH = path.join(__dirname, '..', 'data', 'agentfolio.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    
    // Detect review FK column FIRST (before schema init which might fail)
    try {
      const reviewCols = db.prepare("PRAGMA table_info(reviews)").all().map(c => c.name);
      module.exports._reviewFk = reviewCols.includes('reviewee_id') ? 'reviewee_id' : 'profile_id';
    } catch (e) {
      module.exports._reviewFk = 'profile_id';
    }
    
    try { initSchema(); } catch (e) {
      console.warn('[ProfileStore] initSchema warning (existing DB may have different schema):', e.message);
    }
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      website TEXT DEFAULT '',
      framework TEXT DEFAULT '',
      capabilities TEXT DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      wallet TEXT DEFAULT '',
      twitter TEXT DEFAULT '',
      github TEXT DEFAULT '',
      email TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      api_key TEXT UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS endorsements (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      endorser_id TEXT NOT NULL,
      endorser_name TEXT DEFAULT '',
      skill TEXT NOT NULL,
      comment TEXT DEFAULT '',
      weight INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (profile_id) REFERENCES profiles(id),
      UNIQUE(profile_id, endorser_id, skill)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      reviewer_name TEXT DEFAULT '',
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      title TEXT DEFAULT '',
      comment TEXT DEFAULT '',
      job_id TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    );

    CREATE TABLE IF NOT EXISTS verifications (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      identifier TEXT NOT NULL,
      proof TEXT DEFAULT '{}',
      verified_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (profile_id) REFERENCES profiles(id),
      UNIQUE(profile_id, platform)
    );

    CREATE TABLE IF NOT EXISTS activity_feed (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      detail TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    );

    CREATE INDEX IF NOT EXISTS idx_endorsements_profile ON endorsements(profile_id);
    CREATE INDEX IF NOT EXISTS idx_verifications_profile ON verifications(profile_id);
    CREATE INDEX IF NOT EXISTS idx_activity_profile ON activity_feed(profile_id);
    CREATE INDEX IF NOT EXISTS idx_profiles_wallet ON profiles(wallet);
    CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status);
  `);
  // reviews table may use reviewee_id (CEO fix) or profile_id -- detect which
  const reviewCols = db.prepare("PRAGMA table_info(reviews)").all().map(c => c.name);
  const reviewFk = reviewCols.includes('reviewee_id') ? 'reviewee_id' : 'profile_id';
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_reviews_fk ON reviews(${reviewFk})`); } catch {}
  // Store for use in queries
  module.exports._reviewFk = reviewFk;
}

// Review auth: challenge-response with wallet signing
let _reviewChallenges = new Map(); // nonce -> { wallet, profileId, expiresAt }
const REVIEW_CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function genId(prefix = 'agent') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function isBlockedProdTestProfile(name, profileId) {
  const normalizedName = String(name || '').trim().toLowerCase();
  const normalizedId = String(profileId || '').trim().toLowerCase();
  return /^rollbackproof\d*$/.test(normalizedId)
    || /^rollback\s*proof(\s*\d+)?$/.test(normalizedName)
    || /^rollbackproof\d*$/.test(normalizedName)
    || /^p0autotest\d*$/.test(normalizedId)
    || /^p0\s*autotest(\s*\d+)?$/.test(normalizedName)
    || /^autotest\d*$/.test(normalizedId);
}

function isLocalRegistrationRequest(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || req.hostname || '').toLowerCase();
  return host.includes('localhost') || host.includes('127.0.0.1') || host.includes('0.0.0.0');
}

function genApiKey() {
  return `af_${crypto.randomBytes(24).toString('hex')}`;
}

function parseJsonField(val, defaultVal = []) {
  if (val === null || val === undefined || val === '') return defaultVal;
  if (typeof val === 'object') return val; // already parsed
  try { return JSON.parse(val); } catch { return defaultVal; }
}

async function loadPreferredSatpSignerKeypair() {
  const fs = require('fs');
  const { Connection, Keypair } = require('@solana/web3.js');
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
  const conn = new Connection(rpcUrl, 'confirmed');
  const candidatePaths = [
    process.env.SATP_PLATFORM_KEYPAIR || '/home/ubuntu/agentfolio/config/platform-keypair.json',
    '/home/ubuntu/.config/solana/brainforge-personal.json',
  ].filter(Boolean);
  let best = null;
  for (const signerPath of candidatePaths) {
    try {
      if (!fs.existsSync(signerPath)) continue;
      const raw = JSON.parse(fs.readFileSync(signerPath, 'utf-8'));
      const signer = Keypair.fromSecretKey(Uint8Array.from(raw));
      const lamports = await conn.getBalance(signer.publicKey);
      if (!best || lamports > best.lamports) best = { signerPath, signer, lamports };
      if (lamports >= 10_000_000) {
        if (signerPath != candidatePaths[0]) console.warn('[SATP] Using funded fallback signer for registration:', signer.publicKey.toBase58(), 'path=' + signerPath);
        return signer;
      }
    } catch (e) {
      console.warn('[SATP] Failed to inspect signer ' + signerPath + ':', e.message);
    }
  }
  if (best) {
    console.warn('[SATP] No well-funded signer found, using highest-balance signer', best.signer.publicKey.toBase58(), 'lamports=' + best.lamports);
    return best.signer;
  }
  throw new Error('No SATP signer keypair available');
}


function chainAttestationMatchesWallet(att, row) {
  try {
    const currentWallets = new Set();
    if (row?.wallet) currentWallets.add(String(row.wallet));
    try {
      const wallets = typeof row?.wallets === 'string' ? JSON.parse(row.wallets || '{}') : (row?.wallets || {});
      if (wallets?.solana) currentWallets.add(String(wallets.solana));
    } catch {}
    try {
      const vd = typeof row?.verification_data === 'string' ? JSON.parse(row.verification_data || '{}') : (row?.verification_data || {});
      if (vd?.solana?.address) currentWallets.add(String(vd.solana.address));
    } catch {}
    if (!currentWallets.size) return false;

    let proofData = {};
    try { proofData = typeof att?.proofData === 'string' ? JSON.parse(att.proofData) : (att?.proofData || {}); } catch {}
    const candidates = [att?.signer, att?.identifier, proofData?.wallet, proofData?.address, proofData?.identifier]
      .filter(Boolean)
      .map(v => String(v));
    return candidates.some(v => currentWallets.has(v));
  } catch {
    return false;
  }
}

function isPublicVerificationPlatform(platform) {
  const normalized = String(platform || '').trim().toLowerCase();
  if (!normalized) return false;
  return !['satp', 'satp_v3', 'satp_verification'].includes(normalized);
}

// Score protection guard -- prevents corrupt scores from being written
const MAX_VALID_SCORE = 10000;
const MAX_LEVEL_JUMP = 2;
const VALID_LEVELS = ['NEW', 'UNVERIFIED', 'REGISTERED', 'VERIFIED', 'ESTABLISHED', 'TRUSTED', 'SOVEREIGN', 'ELITE'];
function validateScoreWrite(agentId, newScore, newLevel, source) {
  if (typeof newScore === 'number' && newScore > MAX_VALID_SCORE) {
    console.error('[SCORE GUARD] BLOCKED: score ' + newScore + ' > ' + MAX_VALID_SCORE + ' for ' + agentId + ' (source: ' + source + ')');
    return false;
  }
  if (typeof newScore === 'number' && newScore < 0) {
    console.error('[SCORE GUARD] BLOCKED: negative score ' + newScore + ' for ' + agentId + ' (source: ' + source + ')');
    return false;
  }
  if (newLevel && !VALID_LEVELS.includes(newLevel)) {
    console.error('[SCORE GUARD] BLOCKED: invalid level "' + newLevel + '" for ' + agentId + ' (source: ' + source + ')');
    return false;
  }
  // P1: Level jump protection -- reject if level changes by more than 2 steps
  if (newLevel) {
    try {
      // P0: DB reads removed -- check v3 cache for level jump protection
      const { _getFromCache } = require('./v3-score-service');
      const v3Cached = _getFromCache(agentId);
      const existing = v3Cached ? { level: v3Cached.verificationLabel } : null;
      if (existing && existing.level) {
        const LEVEL_ORDER = ['NEW', 'UNVERIFIED', 'REGISTERED', 'VERIFIED', 'ESTABLISHED', 'TRUSTED', 'SOVEREIGN', 'ELITE'];
        const oldIdx = LEVEL_ORDER.indexOf(existing.level);
        const newIdx = LEVEL_ORDER.indexOf(newLevel);
        if (oldIdx >= 0 && newIdx >= 0 && Math.abs(newIdx - oldIdx) > 2) {
          console.error('[SCORE GUARD] BLOCKED: level jump too large for ' + agentId + ': ' + existing.level + ' -> ' + newLevel + ' (delta=' + Math.abs(newIdx - oldIdx) + ', max=2, source: ' + source + ')');
          return false;
        }
      }
    } catch (e) {
      // DB read failure shouldn't block writes
    }
  }
  return true;
}

function rollbackVerificationCache(profileId, platform) {
  const d = getDb();
  try {
    d.prepare('DELETE FROM verifications WHERE profile_id = ? AND platform = ?').run(profileId, platform);
  } catch (e) {
    console.error('[PostVerify] Failed to delete verification row during rollback:', e.message);
  }

  try {
    const row = d.prepare('SELECT verification_data FROM profiles WHERE id = ?').get(profileId);
    if (row) {
      const vd = JSON.parse(row.verification_data || '{}');
      delete vd[platform];
      d.prepare('UPDATE profiles SET verification_data = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(vd), new Date().toISOString(), profileId);
    }
  } catch (e) {
    console.error('[PostVerify] Failed to rollback verification_data:', e.message);
  }

  try {
    const profileJsonPath = require('path').join('/home/ubuntu/agentfolio/data/profiles', profileId + '.json');
    if (require('fs').existsSync(profileJsonPath)) {
      const profileJson = JSON.parse(require('fs').readFileSync(profileJsonPath, 'utf-8'));
      if (profileJson.verificationData && profileJson.verificationData[platform]) {
        delete profileJson.verificationData[platform];
        require('fs').writeFileSync(profileJsonPath, JSON.stringify(profileJson, null, 2));
      }
    }
  } catch (e) {
    console.error('[PostVerify] Failed to rollback verification JSON:', e.message);
  }
}

function addVerification(profileId, platform, identifier, proof, userPaidGenesis = false) {
  const d = getDb();
  const id = genId('ver');
  d.prepare(`
    INSERT OR REPLACE INTO verifications (id, profile_id, platform, identifier, proof, verified_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(id, profileId, platform, identifier, JSON.stringify(proof || {}));

  // Also update verification_data on the profile record
  try {
    const row = d.prepare('SELECT verification_data FROM profiles WHERE id = ?').get(profileId);
    if (row) {
      const vd = JSON.parse(row.verification_data || '{}');
      vd[platform] = { address: identifier, verified: true, linked: true, verifiedAt: new Date().toISOString() };
      d.prepare('UPDATE profiles SET verification_data = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(vd), new Date().toISOString(), profileId);
    }
  } catch (e) {
    console.error('Failed to update verification_data on profile:', e.message);
  }

  // Sync verification_data to JSON file so frontend (SSR) picks it up
  try {
    const profileJsonPath = require('path').join('/home/ubuntu/agentfolio/data/profiles', profileId + '.json');
    if (require('fs').existsSync(profileJsonPath)) {
      const profileJson = JSON.parse(require('fs').readFileSync(profileJsonPath, 'utf-8'));
      if (!profileJson.verificationData) profileJson.verificationData = {};
      profileJson.verificationData[platform] = { address: identifier, verified: true, linked: true, verifiedAt: new Date().toISOString() };
      require('fs').writeFileSync(profileJsonPath, JSON.stringify(profileJson, null, 2));
    }
  } catch (syncErr) {
    console.error('Failed to sync verification to JSON file:', syncErr.message);
  }


  // Post-verification pipeline: DB cache must roll back if on-chain write fails.
  if (postVerificationHook) {
    postVerificationHook(profileId, platform, identifier, proof)
      .then(onchainSucceeded => {
        if (!onchainSucceeded) {
          rollbackVerificationCache(profileId, platform);
          console.warn(`[PostVerify] Rolled back DB cache for ${profileId}/${platform} because on-chain write did not succeed`);
        }
      })
      .catch(e => {
        rollbackVerificationCache(profileId, platform);
        console.error('[PostVerify] Hook error:', e.message);
      });
  }

      addActivity(profileId, 'verification', { platform, identifier });


  // Legacy memo attestation path removed.
  // Chain-first verification writes now go through postVerificationHook only.

  // [REMOVED] Duplicate V3 update block -- handled by the unified V3 block above (verification + reputation + recompute)

  // Notify CMD Center of verification
  try {
    const http = require('http');
    // Count total verifications
    const vdRow = getDb().prepare('SELECT verification_data FROM profiles WHERE id = ?').get(profileId);
    let totalVerifs = 0;
    try {
      const vd = JSON.parse(vdRow?.verification_data || '{}');
      totalVerifs = Object.values(vd).filter(v => v && v.verified).length;
    } catch {}
    
    const notifData = JSON.stringify({
      agent_id: 'agentfolio',
      project_id: 'agentfolio',
      text: `🔐 ${profileId} verified: ${platform}${identifier ? ' (' + (typeof identifier === 'string' ? identifier.slice(0,20) : '') + ')' : ''} (total: ${totalVerifs})`,
      color: '#00BFFF',
    });
    const notifReq = http.request({
      hostname: 'localhost', port: 3456, path: '/api/comms/push',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HQ-Key': process.env.HQ_API_KEY || 'REDACTED_HQ_KEY' },
      timeout: 3000,
    });
    notifReq.on('error', () => {});
    notifReq.write(notifData);
    notifReq.end();
  } catch (_) {}

    // Record score history on verification change
  if (global._recordScoreHistory) {
    (async () => {
      try {
        const { getV3Score } = require('./v3-score-service');
        const v3 = await getV3Score(profileId);
        if (v3) {
          global._recordScoreHistory(profileId, v3.reputationScore, v3.verificationLabel.toUpperCase(), JSON.stringify({ verificationLevel: v3.verificationLevel, verificationLabel: v3.verificationLabel, isBorn: v3.isBorn }), 'verification_' + platform);
        }
      } catch (e) { console.error('[ScoreHistory] Post-verification record failed:', e.message); }
    })();
  }

  return id;
}

function addActivity(profileId, eventType, detail) {
  const d = getDb();
  d.prepare('INSERT INTO activity_feed (profile_id, event_type, detail) VALUES (?, ?, ?)').run(
    profileId, eventType, JSON.stringify(detail || {})
  );
}

function enrichProfile(row) {
  if (!row) return null;
  const d = getDb();
  const endorsements = d.prepare('SELECT * FROM endorsements WHERE profile_id = ? ORDER BY created_at DESC').all(row.id);
  // [P0 FIX] DB verifications query REMOVED -- chain-cache is sole source of truth
  const activity = d.prepare('SELECT * FROM activity_feed WHERE profile_id = ? ORDER BY created_at DESC LIMIT 20').all(row.id);
  const rfk = module.exports._reviewFk || 'profile_id';
  const reviewStats = d.prepare(`
    SELECT COUNT(*) as total, ROUND(AVG(rating),2) as avg_rating,
      SUM(CASE WHEN rating >= 4 THEN 1 ELSE 0 END) as positive,
      SUM(CASE WHEN rating <= 2 THEN 1 ELSE 0 END) as negative
    FROM reviews WHERE ${rfk} = ?
  `).get(row.id);
  
  // [CEO Apr 4] DB scoring removed from display -- on-chain only via v3ScoreService/chain-cache
  let trust_score = null;















  // Resolve avatar: nft_avatar.image takes priority
  let resolvedAvatar = row.avatar;
  if (row.nft_avatar) {
    try {
      const nft = typeof row.nft_avatar === 'string' ? JSON.parse(row.nft_avatar) : row.nft_avatar;
      if (nft.image || nft.arweaveUrl) {
        resolvedAvatar = (nft.image || nft.arweaveUrl).replace('node1.irys.xyz', 'gateway.irys.xyz');
      }
    } catch {}
  }

  // V3 on-chain scores (cache populated by batch warm-up)
  let v3 = null;
  if (v3ScoreService) {
    try {
      const cached = v3ScoreService._getFromCache ? v3ScoreService._getFromCache(row.id) : null;
      if (cached) v3 = {
        reputationScore: cached.reputationScore,
        reputationPct: cached.reputationPct,
        verificationLevel: cached.verificationLevel,
        verificationLabel: cached.verificationLabel,
        isBorn: cached.isBorn,
      };
    } catch {}
  }

  return {
    ...row,
    walletAddress: row.wallet || null,
    avatar: resolvedAvatar ? resolvedAvatar.replace('node1.irys.xyz', 'gateway.irys.xyz') : resolvedAvatar,
    // Raw V3/genesis data is exposed via dedicated endpoints.
    // Omitting it here prevents contradictory profile payloads for API consumers.
    v3: undefined,
    capabilities: parseJsonField(row.capabilities),
    tags: parseJsonField(row.tags),
    links: parseJsonField(row.links, {}),
    wallets: parseJsonField(row.wallets, {}),
    skills: parseJsonField(row.skills),
    // [P0 FIX] verification_data: active verifications first, chain-cache only for tx/timestamp hints
    verification_data: (() => {
      const vd = {};
      try {
        const chainCache = require('./lib/chain-cache');
        const atts = chainCache.getVerifications(row.id, row.created_at) || [];
        const hints = new Map();
        for (const att of atts) {
          if (!att.platform || att.platform === 'review' || !isPublicVerificationPlatform(att.platform)) continue;
          if (!chainAttestationMatchesWallet(att, row)) continue;
          const plat = att.platform === 'twitter' ? 'x' : att.platform;
          if (hints.has(plat)) continue;
          let proofData = {};
          try { proofData = typeof att.proofData === 'string' ? JSON.parse(att.proofData) : (att.proofData || {}); } catch {}
          hints.set(plat, {
            txSignature: att.txSignature || proofData.txSignature || proofData.signature || proofData.transactionSignature || null,
            verifiedAt: att.timestamp || att.verifiedAt || null,
          });
        }
        const rows = getDb().prepare('SELECT platform, identifier, proof, verified_at FROM verifications WHERE profile_id = ? ORDER BY verified_at DESC').all(row.id);
        for (const ver of rows) {
          const plat = ver.platform === 'twitter' ? 'x' : ver.platform;
          if (!plat || plat === 'review' || !isPublicVerificationPlatform(plat) || vd[plat]) continue;
          let proof = {};
          try { proof = typeof ver.proof === 'string' ? JSON.parse(ver.proof) : (ver.proof || {}); } catch {}
          const displayId = ver.identifier || proof.identifier || proof.address || proof.wallet || row.wallet || null;
          if (!displayId) continue;
          const hint = hints.get(plat) || {};
          const txSignature = proof.txSignature || proof.signature || proof.transactionSignature || hint.txSignature || null;
          if (plat === 'solana' && !txSignature) continue;
          vd[plat] = {
            verified: true,
            address: proof.address || displayId,
            identifier: displayId,
            linked: true,
            txSignature,
            verifiedAt: ver.verified_at || hint.verifiedAt || null,
            source: 'active-verification'
          };
        }
        const attRows = getDb().prepare('SELECT platform, tx_signature, memo, created_at FROM attestations WHERE profile_id = ? ORDER BY created_at DESC').all(row.id);
        for (const att of attRows) {
          const plat = att.platform === 'twitter' ? 'x' : att.platform;
          if (!plat || plat === 'review' || !isPublicVerificationPlatform(plat) || vd[plat] || !att.tx_signature) continue;
          const fallbackId = plat === 'github' ? (row.github || row.handle || 'github') : plat === 'x' ? (row.twitter || row.handle || 'x') : (row.wallet || row.handle || plat);
          vd[plat] = {
            verified: true,
            address: fallbackId,
            identifier: fallbackId,
            linked: true,
            txSignature: att.tx_signature,
            verifiedAt: att.created_at || null,
            source: 'on-chain-attestation'
          };
        }
      } catch (_) {}
      return vd;
    })(),
    portfolio: parseJsonField(row.portfolio),
    endorsements_given: parseJsonField(row.endorsements_given),
    custom_badges: parseJsonField(row.custom_badges),
    metadata: parseJsonField(row.metadata, {}),
    nft_avatar: parseJsonField(row.nft_avatar, {}),
    endorsements: { items: endorsements, total: endorsements.length },
    verifications: (() => {
      const vMap = {};
      try {
        const chainCache = require('./lib/chain-cache');
        const atts = chainCache.getVerifications(row.id, row.created_at) || [];
        const hints = new Map();
        for (const att of atts) {
          if (!att.platform || att.platform === 'review' || !isPublicVerificationPlatform(att.platform)) continue;
          if (!chainAttestationMatchesWallet(att, row)) continue;
          const platform = att.platform === 'twitter' ? 'x' : att.platform;
          if (hints.has(platform)) continue;
          let proofData = {};
          try { proofData = typeof att.proofData === 'string' ? JSON.parse(att.proofData) : (att.proofData || {}); } catch {}
          const txSignature = att.txSignature || proofData.txSignature || proofData.signature || proofData.transactionSignature || null;
          hints.set(platform, {
            txSignature,
            verifiedAt: att.timestamp || att.verifiedAt || null,
            url: att.solscanUrl || (txSignature ? ('https://solana.fm/tx/' + txSignature) : null),
          });
        }
        const rows = getDb().prepare('SELECT platform, identifier, proof, verified_at FROM verifications WHERE profile_id = ? ORDER BY verified_at DESC').all(row.id);
        for (const ver of rows) {
          const platform = ver.platform === 'twitter' ? 'x' : ver.platform;
          if (!platform || platform === 'review' || !isPublicVerificationPlatform(platform) || vMap[platform]) continue;
          let proof = {};
          try { proof = typeof ver.proof === 'string' ? JSON.parse(ver.proof) : (ver.proof || {}); } catch {}
          const displayId = ver.identifier || proof.identifier || proof.address || proof.wallet || row.wallet || null;
          if (!displayId) continue;
          const hint = hints.get(platform) || {};
          const txSignature = proof.txSignature || proof.signature || proof.transactionSignature || hint.txSignature || null;
          if (platform === 'solana' && !txSignature) continue;
          const proofUrl = hint.url || (txSignature ? ('https://solana.fm/tx/' + txSignature) : null);
          vMap[platform] = {
            verified: true,
            address: proof.address || displayId,
            identifier: displayId,
            proof: { txSignature, timestamp: ver.verified_at || hint.verifiedAt || null, url: proofUrl },
            verified_at: ver.verified_at || hint.verifiedAt || null,
            source: 'active-verification',
          };
        }
        const attRows = getDb().prepare('SELECT platform, tx_signature, memo, created_at FROM attestations WHERE profile_id = ? ORDER BY created_at DESC').all(row.id);
        for (const att of attRows) {
          const platform = att.platform === 'twitter' ? 'x' : att.platform;
          if (!platform || platform === 'review' || !isPublicVerificationPlatform(platform) || vMap[platform] || !att.tx_signature) continue;
          const fallbackId = platform === 'github' ? (row.github || row.handle || 'github') : platform === 'x' ? (row.twitter || row.handle || 'x') : (row.wallet || row.handle || platform);
          vMap[platform] = {
            verified: true,
            address: fallbackId,
            identifier: fallbackId,
            proof: { txSignature: att.tx_signature, timestamp: att.created_at || null, url: 'https://solana.fm/tx/' + att.tx_signature },
            verified_at: att.created_at || null,
            source: 'on-chain-attestation',
          };
        }
      } catch (e) { /* chain-cache not available */ }
      return vMap;
    })(),
    onchain_verification_count: (() => {
      try {
        const platforms = new Set();
        const verRows = getDb().prepare('SELECT platform, proof FROM verifications WHERE profile_id = ?').all(row.id);
        verRows.forEach(ver => {
          const platform = ver.platform === 'twitter' ? 'x' : ver.platform;
          if (!platform) return;
          if (platform === 'solana') {
            let proof = {};
            try { proof = typeof ver.proof === 'string' ? JSON.parse(ver.proof) : (ver.proof || {}); } catch {}
            if (!(proof.txSignature || proof.signature || proof.transactionSignature)) return;
          }
          platforms.add(platform);
        });
        const attRows = getDb().prepare('SELECT platform, tx_signature FROM attestations WHERE profile_id = ?').all(row.id);
        attRows.forEach(att => {
          const platform = att.platform === 'twitter' ? 'x' : att.platform;
          if (platform && att.tx_signature) platforms.add(platform);
        });
        return platforms.size;
      } catch (_) {
        return 0;
      }
    })(),
    activity: activity.map(a => ({ ...a, type: a.event_type, detail: parseJsonField(a.detail) })),
    reviews: {
      total: reviewStats.total,
      avg_rating: reviewStats.avg_rating,
      positive: reviewStats.positive,
      negative: reviewStats.negative,
    },
    // Scoring v2 Phase A: verification level and trust score are independent.
    ...(() => {
      const unified = computeUnifiedTrustScore(getDb(), row, { v3Score: v3 });
      const breakdown = unified.breakdown || {};
      return {
        trust_score: {
          overall_score: unified.score,
          level: unified.levelName,
          score_breakdown: breakdown,
          source: unified.source,
        },
        level: unified.level,
        tier: unified.levelName,
        score: unified.score,
        trustScore: unified.score,
        trustScoreBreakdown: breakdown,
        trustBreakdown: unified.trustBreakdown || {},
        verificationLevel: unified.level,
        verification_level: unified.level,
        reputation_score: unified.score,
        levelName: unified.levelName,
        verificationBadge: unified.badge,
        verificationLevelName: unified.levelName,
      };
    })(),
    // Top-level unclaimed flag for frontend (from metadata)
    unclaimed: (() => { try { if (row.claimed === 0 || row.claimed === "0") return true; const m = typeof row.metadata === "string" ? JSON.parse(row.metadata || "{}") : (row.metadata || {}); return m.unclaimed === true || m.isPlaceholder === true || m.placeholder === true; } catch { return false; } })(),
  };
}

function registerRoutes(app) {
  // ── POST /api/register ──────────────────────────────────────────
  // ── PATCH /api/register -- update wallet after registration ──
  app.patch('/api/register', (req, res) => {
    const { profileId, walletAddress, signature, signedMessage } = req.body;
    if (!profileId || !walletAddress) {
      return res.status(400).json({ error: 'profileId and walletAddress required' });
    }
    // Verify signature if provided
    if (signature && signedMessage) {
      try {
        const pubkeyBytes = bs58.decode(walletAddress);
        if (pubkeyBytes.length !== 32) throw new Error('invalid pubkey length');
        let sigBytes;
        try { sigBytes = bs58.decode(signature); } catch (_) {
          sigBytes = Buffer.from(signature, 'base64');
        }
        if (sigBytes.length !== 64) throw new Error('invalid signature length');
        const msgBytes = new TextEncoder().encode(signedMessage);
        const valid = nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
        if (!valid) {
          return res.status(401).json({ error: 'invalid wallet signature' });
        }
      } catch (sigErr) {
        return res.status(400).json({ error: `signature verification error: ${sigErr.message}` });
      }
    }
    try {
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare('UPDATE profiles SET wallet = ?, claimed = 1, claimed_by = ?, claimed_at = ?, updated_at = ? WHERE id = ?').run(walletAddress, walletAddress, now, now, profileId);
      // Also update wallets JSON
      const row = db.prepare('SELECT wallets FROM profiles WHERE id = ?').get(profileId);
      if (row) {
        const wallets = JSON.parse(row.wallets || '{}');
        wallets.solana = walletAddress;
        db.prepare('UPDATE profiles SET wallets = ? WHERE id = ?').run(JSON.stringify(wallets), profileId);
      }
      try {
        addVerification(profileId, "solana", walletAddress, { method: "register-patch", auto: true });
        console.log(`[Register PATCH] Auto-verified Solana wallet for ${profileId}: ${walletAddress}`);
      } catch (vErr) {
        console.error(`[Register PATCH] Solana auto-verify failed for ${profileId}:`, vErr.message, vErr.stack);
      }
      res.json({ ok: true, wallet: walletAddress });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

    app.post('/api/register', registerLimiter, (req, res) => {
    const { name, handle, description, tagline, bio, avatar, website, framework, capabilities, tags, wallet, wallets, skills, links, twitter, github, email, signature, signedMessage, userPaidGenesis } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length < 1) {
      return res.status(400).json({ error: 'name is required (non-empty string)' });
    }

    // ── Server-side wallet signature verification (ed25519) ──────────
    const solWallet = (wallets && wallets.solana) || wallet || '';
    // Wallet is optional for programmatic registration (MCP/A2A)
    // If wallet is provided, signature verification is required
    if (solWallet && signature && signedMessage) {
      try {
        const pubkeyBytes = bs58.decode(solWallet);
        if (pubkeyBytes.length !== 32) throw new Error('invalid pubkey length');
        let sigBytes;
        try { sigBytes = bs58.decode(signature); } catch (_) {
          sigBytes = Buffer.from(signature, 'base64');
        }
        if (sigBytes.length !== 64) throw new Error('invalid signature length');
        const msgBytes = new TextEncoder().encode(signedMessage);
        const valid = nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
        if (!valid) {
          return res.status(401).json({ error: 'invalid wallet signature -- proof of ownership failed' });
        }
      } catch (sigErr) {
        return res.status(400).json({ error: `signature verification error: ${sigErr.message}` });
      }
    } else if (solWallet && (!signature || !signedMessage)) {
      return res.status(400).json({ error: 'When wallet is provided, signature and signedMessage are required' });
    }

    // Normalize frontend format → backend format
    const resolvedBio = (bio || tagline || description || '').trim();
    const resolvedWallets = wallets || {};
    const solanaWallet = resolvedWallets.solana || wallet || '';
    const resolvedLinks = links || {};
    const resolvedTwitter = twitter || resolvedLinks.x || resolvedLinks.twitter || '';
    const resolvedGithub = github || resolvedLinks.github || '';
    const resolvedWebsite = website || resolvedLinks.website || '';
    const resolvedEmail = email || '';
    // Skills: accept array of objects [{name, category, verified}] or array of strings
    let resolvedSkills = [];
    if (Array.isArray(skills)) {
      resolvedSkills = skills.map(s => typeof s === 'string' ? { name: s, category: 'general', verified: false } : s);
    } else if (Array.isArray(capabilities)) {
      resolvedSkills = capabilities.map(c => typeof c === 'string' ? { name: c, category: 'general', verified: false } : c);
    }

    const d = getDb();
    // Allow custom profile ID from user, or auto-generate
    let id;
    const customId = req.body.customId;
    if (customId && typeof customId === 'string') {
      const cleaned = customId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (cleaned.length < 3 || cleaned.length > 32) {
        return res.status(400).json({ error: 'Custom ID must be 3-32 characters (letters, numbers, underscore, dash)' });
      }
      id = cleaned;
      if (isBlockedProdTestProfile(name, id) && !isLocalRegistrationRequest(req)) {
        return res.status(400).json({ error: 'Test profile IDs are blocked on production. Use the local registration harness instead.' });
      }
      // Check uniqueness
      const existing = d.prepare('SELECT id FROM profiles WHERE id = ?').get(id);
      if (existing) {
        return res.status(409).json({ error: 'This profile ID is already taken' });
      }
    } else {
      id = genId();
      if (isBlockedProdTestProfile(name, id) && !isLocalRegistrationRequest(req)) {
        return res.status(400).json({ error: 'Test profile IDs are blocked on production. Use the local registration harness instead.' });
      }
    }
    const apiKey = genApiKey();
    // Detect if production schema has 'handle' column
    const cols = d.prepare("PRAGMA table_info(profiles)").all().map(c => c.name);
    const hasHandle = cols.includes('handle');
    const hasVerificationData = cols.includes('verification_data');
    const hasBio = cols.includes('bio');
    const hasSkillsCol = cols.includes('skills');
    const hasWalletsCol = cols.includes('wallets');
    const hasLinksCol = cols.includes('links');

    try {
      const now = new Date().toISOString();
      const h = (handle || name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')).substring(0, 64);
      
      // Build verification_data with wallet info so eligibility checks work
      const verificationData = {};
      if (solanaWallet) {
        verificationData.solana = { address: solanaWallet, verified: false, linked: true };
      }

      // Use flexible INSERT based on available columns
      const insertCols = ['id', 'name'];
      const insertPlaceholders = ['?', '?'];
      const insertVals = [id, name.trim()];

      const optionalFields = [
        ['handle', hasHandle, h],
        ['description', cols.includes('description'), resolvedBio],
        ['bio', hasBio, resolvedBio],
        ['avatar', true, avatar || ''],
        ['website', true, resolvedWebsite],
        ['framework', true, framework || ''],
        ['capabilities', true, JSON.stringify(resolvedSkills.map(s => s.name || s))],
        ['tags', true, JSON.stringify(tags || [])],
        ['wallet', true, solanaWallet],
        ['wallets', hasWalletsCol, JSON.stringify(resolvedWallets)],
        ['twitter', true, resolvedTwitter],
        ['github', true, resolvedGithub],
        ['email', true, resolvedEmail],
        ['api_key', true, apiKey],
        ['status', true, 'active'],
        ['skills', hasSkillsCol, JSON.stringify(resolvedSkills)],
        ['links', hasLinksCol, JSON.stringify(resolvedLinks)],
        ['verification_data', hasVerificationData, JSON.stringify(verificationData)],
        ['created_at', true, now],
        ['updated_at', true, now],
        ['claimed', cols.includes('claimed'), solanaWallet ? 1 : 0],
        ['claimed_by', cols.includes('claimed_by'), solanaWallet || ''],
        ['claimed_at', cols.includes('claimed_at'), solanaWallet ? now : ''],
      ];

      for (const [col, exists, val] of optionalFields) {
        if (exists && cols.includes(col)) {
          insertCols.push(col);
          insertPlaceholders.push('?');
          insertVals.push(val);
        }
      }

      d.prepare(`INSERT INTO profiles (${insertCols.join(', ')}) VALUES (${insertPlaceholders.join(', ')})`).run(...insertVals);

      // ── Disk JSON DISABLED (DB is source of truth) ──
      // Disk JSON files were never cleaned on deletion. DB is canonical.
      const profilesDir = path.join(__dirname, '..', 'data', 'profiles');
      const fs = require('fs');
      fs.mkdirSync(profilesDir, { recursive: true });
      const profileJson = {
        id,
        name: name.trim(),
        handle: h.startsWith('@') ? h : `@${h}`,
        bio: resolvedBio,
        avatar: avatar || null,
        links: {
          twitter: resolvedTwitter || null,
          github: resolvedGithub || null,
          website: resolvedWebsite || null,
          x: resolvedLinks.x || resolvedTwitter || null,
          moltbook: null,
          agentmail: null,
        },
        wallets: {
          solana: solanaWallet || null,
          hyperliquid: resolvedWallets.hyperliquid || null,
          ethereum: resolvedWallets.ethereum || null,
        },
        skills: resolvedSkills.map(s => ({
          name: s.name || s,
          category: s.category || 'general',
          verified: s.verified || false,
          proofs: s.proofs || [],
        })),
        portfolio: [],
        trackRecord: null,
        verification: { tier: 'unverified', score: 0, lastVerified: null },
        verificationData: {
          ...(solanaWallet ? { solana: { address: solanaWallet, verified: false, linked: true } } : {}),
        },
        stats: { jobsCompleted: 0, rating: 0, reviewsReceived: 0 },
        endorsements: [],
        endorsementsGiven: [],
        moltbookStats: {},
        unclaimed: false,
        activity: [{ type: 'registered', createdAt: now }],
        createdAt: now,
        updatedAt: now,
      };
      fs.writeFileSync(path.join(profilesDir, `${id}.json`), JSON.stringify(profileJson, null, 2));
      console.log(`[ProfileStore] Registration complete for ${id} (DB + disk JSON written)`);

      // Bug A fix: Auto-verify Solana wallet on registration
      console.log(`[ProfileStore] Auto-verify check for ${id}: solanaWallet="${solanaWallet}"`);
      if (solanaWallet) {
        try {
          addVerification(id, "solana", solanaWallet, { method: "registration", auto: true });
          console.log(`[ProfileStore] Auto-verified Solana wallet for ${id}: ${solanaWallet}`);
        } catch (avErr) {
          console.error(`[ProfileStore] Solana auto-verify FAILED for ${id}:`, avErr.message, avErr.stack);
        }
      } else {
        console.warn(`[ProfileStore] No solana wallet for ${id} — skipping auto-verify`);
      }

      // Fire-and-forget: create SATP V3 Genesis Record (skip if user will pay)
      if (satpV3 && !userPaidGenesis) {
        (async () => {
          const { Keypair } = require('@solana/web3.js');
          const signer = await loadPreferredSatpSignerKeypair();
          try {
            const { transaction, genesisPDA: genesisPda } = await satpV3.client.buildCreateIdentity(
              signer.publicKey,
              id,
              {
                name: name.trim().substring(0, 32),
                description: (resolvedBio || 'AgentFolio registered agent').substring(0, 256),
                category: framework || 'general',
                capabilities: resolvedSkills.slice(0, 5).map(s => s.name || s),
                metadataUri: ''
              }
            );
            transaction.sign(signer);
            const sig = await satpV3.client.connection.sendRawTransaction(transaction.serialize());
            await satpV3.client.connection.confirmTransaction(sig, 'confirmed');
            console.log(`[SATP V3] Genesis Record confirmed for ${id}: pda=${genesisPda.toBase58()} tx=${sig}`);
            try { require('./v3-score-service').clearV3Cache(); } catch {}
          } catch (err) {
            console.error(`[SATP V3] Genesis Record attempt 1 failed for ${id}:`, err.message);
            // Retry once after 3s (transient RPC failures are common)
            try {
              await new Promise(r => setTimeout(r, 3000));
              const { transaction: tx2, genesisPDA: pda2 } = await satpV3.client.buildCreateIdentity(
                signer.publicKey, id,
                {
                  name: name.trim().substring(0, 32),
                  description: (resolvedBio || 'AgentFolio registered agent').substring(0, 256),
                  category: framework || 'general',
                  capabilities: resolvedSkills.slice(0, 5).map(s => s.name || s),
                  metadataUri: ''
                }
              );
              tx2.sign(signer);
              const sig2 = await satpV3.client.connection.sendRawTransaction(tx2.serialize(), { skipPreflight: true, maxRetries: 3 });
              await satpV3.client.connection.confirmTransaction(sig2, 'confirmed');
              console.log(`[SATP V3] Genesis Record confirmed (retry) for ${id}: pda=${pda2.toBase58()} tx=${sig2}`);
              try { require('./v3-score-service').clearV3Cache(); } catch {}
            } catch (retryErr) {
              console.error(`[SATP V3] Genesis Record retry also failed for ${id}:`, retryErr.message);
            }
          }
        })();
      }
      // Legacy V1 identity (kept for backward compat)
      if (solanaWallet && satpWrite) {
        (async () => {
          try {
            const signer = satpWrite.loadKeypair(PLATFORM_KEYPAIR_PATH);
            const result = await satpWrite.registerIdentity(
              {
                name: name.trim().substring(0, 32),
                description: resolvedBio.substring(0, 256) || 'AgentFolio registered agent',
                category: framework || 'general',
                capabilities: resolvedSkills.slice(0, 5).map(s => s.name || s),
                metadataUri: '',
              },
              signer,
              SATP_NETWORK
            );
            console.log(`[SATP V1] On-chain identity created for ${id}: tx=${result.txSignature}`);
          } catch (err) {
            console.error(`[SATP V1] Failed to create on-chain identity for ${id}:`, err.message);
          }
        })();
      }

      // Auto-calculate trust score for new profile
      try {
        const { getProfileScoringData } = require('./lib/profile-scoring-integration');
        const scoringData = getProfileScoringData(profileJson);
        const overallScore = scoringData.overall?.score || scoringData.reputationScore?.score || 0;
        const level = scoringData.verificationLevel?.name || 'NEW';
        const breakdown = JSON.stringify(scoringData);
        if (validateScoreWrite(id, overallScore, level, 'registration')) {
          // P0: DB score writes removed -- on-chain v3 is sole source
        } else {
          console.error('[SCORE GUARD] Skipped corrupt score write for ' + id + ': score=' + overallScore + ' level=' + level);
        }
        // Record score history
        if (global._recordScoreHistory) {
          global._recordScoreHistory(id, overallScore, level, breakdown, 'registration');
        }
        console.log('[ProfileStore] Trust score calculated for ' + id + ': ' + overallScore);
      } catch (scoreErr) {
        console.error('[ProfileStore] Trust scoring failed for ' + id + ':', scoreErr.message);
      }

      // Fire-and-forget: send welcome email if agent provided an email
      if (resolvedEmail) {
        sendWelcomeEmail(resolvedEmail, { id, name: name.trim(), handle: h });
      }
      // Notify CMD Center of new registration
      try {
        const http = require('http');
        const notifData = JSON.stringify({
          agent_id: 'agentfolio',
          project_id: 'agentfolio',
          text: `🆕 New agent registered: ${name.trim()} (agent_${id.replace('agent_','')}) -- ${(resolvedSkills || []).slice(0,3).map(s => s.name || s).join(', ') || 'no skills'}${solanaWallet ? ' • wallet: ' + solanaWallet.slice(0,8) + '...' : ''}`,
          color: '#00BFFF',
        });
        const notifReq = http.request({
          hostname: 'localhost', port: 3456, path: '/api/comms/push',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-HQ-Key': process.env.HQ_API_KEY || 'REDACTED_HQ_KEY' },
          timeout: 3000,
        });
        notifReq.on('error', () => {}); // fire-and-forget
        notifReq.write(notifData);
        notifReq.end();
      } catch (_) {} // Never fail registration due to notification

      // Chain-first Solana verification on registration: cache only after on-chain success.
      if (solanaWallet) {
        try {
          const proof = { source: "registration", wallet: solanaWallet, signatureVerified: !!signature };
          if (postVerificationHook) {
            Promise.resolve(postVerificationHook(id, "solana", solanaWallet, proof))
              .then((bridgeResult) => {
                if (bridgeResult) {
                  const enrichedProof = (bridgeResult && typeof bridgeResult === 'object') ? {
                    ...proof,
                    txSignature: bridgeResult.txSignature || null,
                    attestationPDA: bridgeResult.attestationPDA || null,
                    solscanUrl: bridgeResult.txSignature ? ('https://solana.fm/tx/' + bridgeResult.txSignature) : undefined,
                  } : proof;
                  addVerification(id, 'solana', solanaWallet, enrichedProof);
                  console.log("[Register] Cached Solana verification after on-chain success for " + id);
                } else {
                  console.warn("[Register] Skipped Solana verification cache for " + id + " because on-chain write failed");
                }
              })
              .catch((vErr) => console.error("[Register] Solana auto-verify failed:", vErr.message));
          }
        } catch (vErr) { console.error("[Register] Solana auto-verify failed:", vErr.message); }
      }

      res.status(201).json({
        id,
        profileId: id,
        profileUrl: `https://agentfolio.bot/profile/${id}`,
        verifyUrl: `https://agentfolio.bot/verify/${id}`,
        api_key: apiKey,
        message: 'Profile registered successfully. Save your api_key -- it authenticates write operations.',
        satp: solanaWallet ? 'On-chain identity creation initiated' : 'No wallet provided -- on-chain identity skipped',
      });
    } catch (e) {
      console.error('Register error:', e.message);
      res.status(500).json({ error: 'Registration failed', detail: e.message });
    }
  });


  // ── GET /api/profile/:id/genesis -- V3 Genesis Record (on-chain) ──
  app.get('/api/profile/:id/genesis', async (req, res) => {
    if (!v3ScoreService) return res.json({ error: 'V3 score service not available', genesis: null });
    try {
      const rawId = req.params.id;
      let record = null;
      // Try the raw ID directly (handles both "agent_brainkid" and display names)
      record = await v3ScoreService.getV3Score(rawId);
      // If not found and it's an agent_ ID, try looking up profile name
      if (!record && rawId.startsWith('agent_')) {
        const d = getDb();
        const row = d.prepare('SELECT name FROM profiles WHERE id = ?').get(rawId);
        if (row && row.name) {
          record = await v3ScoreService.getV3Score(row.name);
        }
      }
      // If not found and it looks like a display name, try agent_ + lowercase
      if (!record && !rawId.startsWith('agent_')) {
        const normalizedId = 'agent_' + rawId.toLowerCase().replace(/[^a-z0-9]/g, '');
        record = await v3ScoreService.getV3Score(normalizedId);
        // Also try DB lookup by name (case-insensitive)
        if (!record) {
          try {
            const d = getDb();
            const row = d.prepare('SELECT id FROM profiles WHERE LOWER(name) = LOWER(?)').get(rawId);
            if (row && row.id) {
              record = await v3ScoreService.getV3Score(row.id);
            }
          } catch {}
        }
      }
      // [Apr 10] Preserve raw genesis here. Profile/trust overlays are handled separately
      // so /api/profile/:id/genesis remains a true on-chain source-of-truth view.

      res.json({ genesis: record });
    } catch (e) {
      res.json({ genesis: null, error: e.message });
    }
  });


  // ── POST /api/satp/genesis/prepare -- User-paid Genesis Record (returns unsigned TX) ──
  app.post('/api/satp/genesis/prepare', async (req, res) => {
    if (!satpV3) return res.status(503).json({ error: 'SATP V3 SDK not available' });
    try {
      const { agentId, payer } = req.body;
      if (!agentId || !payer) return res.status(400).json({ error: 'agentId and payer required' });

      // Check if genesis record already exists
      const existing = await satpV3.client.getGenesisRecord(agentId);
      if (existing && !existing.error) return res.status(409).json({ error: 'Genesis record already exists', genesis: existing });

      // Get profile data for name/description/skills
      const profile = getDb().prepare('SELECT * FROM profiles WHERE id = ?').get(agentId);
      const name = profile ? (profile.name || agentId).substring(0, 32) : agentId.substring(0, 32);
      const bio = profile ? (profile.bio || '').substring(0, 256) : '';
      const skills = profile?.skills ? (typeof profile.skills === 'string' ? JSON.parse(profile.skills) : profile.skills).slice(0, 5).map(s => s.name || s) : [];
      const category = profile?.framework || 'general';

      const { PublicKey } = require('@solana/web3.js');
      const payerKey = new PublicKey(payer);

      // Build TX with user wallet as creator/authority. Platform only fee-pays.
      const fs = require('fs');
      const { Keypair } = require('@solana/web3.js');
      const deployerKey = JSON.parse(fs.readFileSync(PLATFORM_KEYPAIR_PATH, 'utf-8'));
      const deployer = Keypair.fromSecretKey(Uint8Array.from(deployerKey));

      const { transaction, genesisPDA: genesisPda } = await satpV3.client.buildCreateIdentity(
        payerKey, agentId,
        { name, description: bio || 'AgentFolio registered agent', category, capabilities: skills, metadataUri: '' }
      );

      transaction.feePayer = deployer.publicKey;
      const { blockhash, lastValidBlockHeight } = await satpV3.client.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;

      // Platform signs only as fee payer. User wallet signs as authority.
      transaction.partialSign(deployer);

      // Serialize and return (user's wallet will add their signature)
      const serialized = transaction.serialize({ requireAllSignatures: false });
      const base64Tx = serialized.toString('base64');

      res.json({
        transaction: base64Tx,
        genesisPda: genesisPda.toBase58(),
        agentId,
        payer,
        blockhash,
        lastValidBlockHeight,
        rentCost: '~0.0105 SOL',
      });
    } catch (e) {
      console.error('[SATP V3] Genesis prepare error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/profiles ───────────────────────────────────────────
  app.get('/api/profiles', async (req, res) => {
    const d = getDb();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const status = req.query.status || 'active';
    const search = String(req.query.search || '').trim().toLowerCase();

    let rows;
    try {
      rows = d.prepare(`
        SELECT p.*, 0 AS _trust_score, NULL AS _trust_level
        FROM profiles p
        
        WHERE p.status = ? AND (p.hidden = 0 OR p.hidden IS NULL)
        ORDER BY p.created_at DESC

      `).all(status);
    } catch (e) {
      rows = d.prepare('SELECT * FROM profiles WHERE status = ? AND (hidden = 0 OR hidden IS NULL) ORDER BY created_at DESC').all(status);
    }

    // Strip api_key from list responses
    let profiles = rows.map(r => {
      const { api_key, ...rest } = r;
      // Resolve avatar: nft_avatar.image takes priority over avatar
      let resolvedAvatar = rest.avatar;
      if (rest.nft_avatar) {
        try {
          const nft = typeof rest.nft_avatar === 'string' ? JSON.parse(rest.nft_avatar) : rest.nft_avatar;
          if (nft.image || nft.arweaveUrl) {
            resolvedAvatar = (nft.image || nft.arweaveUrl).replace('node1.irys.xyz', 'gateway.irys.xyz');
          }
        } catch {}
      }
      // [FIX 5a] Claimed = DB claimed field OR chain verifications
      let claimed = rest.claimed === 1 || rest.claimed === '1' || rest.claimed === true;
      if (!claimed) {
        try {
          const _ccCl = require("./lib/chain-cache");
          const _ccPl = _ccCl.getVerifiedPlatforms(rest.id, rest.created_at);
          claimed = _ccPl.length > 0;
        } catch (_) {}
      }
      const { _trust_score: ts, _trust_level: dbLevel, ...cleanRest } = rest;
      const _md = parseJsonField(cleanRest.metadata);
      const unclaimed = (cleanRest.claimed === 0 || cleanRest.claimed === "0") || _md.unclaimed === true || _md.isPlaceholder === true || _md.placeholder === true;
      return { ...cleanRest, avatar: resolvedAvatar, capabilities: parseJsonField(cleanRest.capabilities), tags: parseJsonField(cleanRest.tags), links: parseJsonField(cleanRest.links), wallets: parseJsonField(cleanRest.wallets), skills: parseJsonField(cleanRest.skills), verification_data: {} /* [P0] chain-cache only, no DB reads */, portfolio: parseJsonField(cleanRest.portfolio), endorsements_given: parseJsonField(cleanRest.endorsements_given), custom_badges: parseJsonField(cleanRest.custom_badges), metadata: _md, nft_avatar: parseJsonField(cleanRest.nft_avatar), trust_score: ts || 0, _dbLevel: dbLevel || null, claimed, unclaimed };
    });

    if (search) {
      const matchesSearch = (p) => {
        const wallets = p.wallets || {};
        const haystacks = [
          p.id,
          p.name,
          p.handle,
          p.wallet,
          p.claimed_by,
          p.description,
          p.bio,
          wallets.solana,
        ].filter(Boolean).map(v => String(v).toLowerCase());
        return haystacks.some(v => v.includes(search));
      };
      profiles = profiles.filter(matchesSearch);
    }

    const total = profiles.length;

    // A1: Compute scores for all profiles using chain-cache-derived verifications
    {
      const chainCache = require('./lib/chain-cache');
      for (const p of profiles) {
        // Clean start: directory score display is genesis-only. No synthetic score from identity/attestations.
        p.trust_score = 0;
        p.trustScore = 0;
        p.score = 0;
        p.reputation_score = 0;
        p.level = 0;
        p.tier = 'Unverified';
        p.verificationLevel = 0;
        p.verificationLabel = 'Unverified';
      }
    }
    // Clean start: default scores stay at 0 unless V3 genesis exists.
    profiles.sort((a, b) => (b.trustScore || 0) - (a.trustScore || 0));

    // P0-13: Paginate after V3 overlay sort
    // [FIX 3] Second chain-cache overlay REMOVED -- V3 genesis only

    // Clean start: promote live V3 genesis to top-level fields, otherwise keep zero.
    const levelLabels = ['Unverified','Registered','Verified','Established','Trusted','Sovereign'];
    let v3ScoresById = new Map();
    try {
      const { getV3Scores } = require('./v3-score-service');
      v3ScoresById = await getV3Scores(profiles.map(p => p.id));
    } catch (_) {}
    for (const p of profiles) {
      const v = v3ScoresById.get(p.id) || p.v3 || {};
      const unified = computeUnifiedTrustScore(d, p, { v3Score: v });
      const displayScore = unified.score;
      const displayLevel = unified.level;
      const displayLabel = unified.levelName;
      p.trustScore = displayScore;
      p.reputationScore = displayScore;
      p.score = displayScore;
      p.verificationLevel = displayLevel;
      p.verificationLabel = displayLabel;
      p.levelName = displayLabel;
      p.verificationBadge = unified.badge;
      p.trust_score = displayScore;
      p.trust_score_details = {
        overall_score: displayScore,
        level: displayLabel,
        score_breakdown: unified.breakdown || {},
        source: unified.source,
      };
      p.v3 = {
        ...(p.v3 || {}),
        reputationScore: displayScore,
        verificationLevel: displayLevel,
        verificationLabel: displayLabel,
        breakdown: unified.breakdown || {},
        source: unified.source,
      };
      p.verificationLevelName = displayLabel;
    }
    // Sort parameter: trust_desc (default), trust_asc, name_asc, name_desc, newest, oldest
    const sortParam = (req.query.sort || "trust_desc").toLowerCase();
    switch (sortParam) {
      case "trust_asc":
        profiles.sort((a, b) => (a.trustScore || 0) - (b.trustScore || 0));
        break;
      case "name_asc":
        profiles.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        break;
      case "name_desc":
        profiles.sort((a, b) => (b.name || "").localeCompare(a.name || ""));
        break;
      case "newest":
        profiles.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        break;
      case "oldest":
        profiles.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
        break;
      case "trust_desc":
      default:
        profiles.sort((a, b) => (b.trustScore || 0) - (a.trustScore || 0));
        break;
    }

    const paginatedProfiles = profiles.slice(offset, offset + limit);
    res.json({ profiles: paginatedProfiles, total, page, limit, pages: Math.ceil(total / limit), sort: sortParam });
  });

  // ── GET /api/profile/:id ───────────────────────────────────────
  app.get('/api/profile/:id', async (req, res) => {
    const d = getDb();
    let row = d.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
    // Fallback: try matching by name (case-insensitive) or agent_ prefix
    if (!row) {
      row = d.prepare('SELECT * FROM profiles WHERE LOWER(name) = LOWER(?)').get(req.params.id);
    }
    if (!row) {
      row = d.prepare('SELECT * FROM profiles WHERE id = ?').get('agent_' + req.params.id.toLowerCase());
    }
    if (!row) return res.status(404).json({ error: 'Profile not found' });

    const { api_key, ...safe } = row;
    // Warm V3 cache for BOTH request param AND resolved row.id
    // (enrichProfile reads cache by row.id, which may differ from req.params.id)
    if (v3ScoreService) {
      const idsToWarm = new Set([req.params.id, row.id]);
      try { await v3ScoreService.getV3Scores([...idsToWarm]); } catch {}
    }

    const enriched = enrichProfile(safe);

    // Single-profile display should preserve attestation-derived score and use Genesis only as metadata/fallback.
    if (enriched) {
      try {
        const genesisUrl = "http://localhost:" + (process.env.PORT || 3000) + "/api/profile/" + encodeURIComponent(row.id) + "/genesis";
        const genesisResp = await fetch(genesisUrl);
        const genesisJson = await genesisResp.json();
        const v3Data = genesisJson && genesisJson.genesis ? genesisJson.genesis : genesisJson;
        const hasGenesis = v3Data && v3Data.agentName && !v3Data.error;
        if (hasGenesis) {
          const v3Score = v3Data.reputationScore > 10000 ? Math.round(v3Data.reputationScore / 1000) : (v3Data.reputationScore || 0);
          enriched.onchain = v3Data;
          enriched.isBorn = v3Data.isBorn;
          if (v3Data.faceImage) enriched.faceImage = v3Data.faceImage;
          if (v3Data.authority && !enriched.walletAddress) enriched.walletAddress = v3Data.authority;
          if (v3Score > 0 && Number(enriched.trustScore || enriched.score || 0) <= 0 && Number(enriched.verificationLevel || 0) <= 0) {
            enriched.trust_score = { overall_score: v3Score, level: v3Data.verificationLabel || 'Unverified', score_breakdown: {}, source: 'v3-genesis-fallback' };
            enriched.score = v3Score;
            enriched.trustScore = v3Score;
            enriched.reputation_score = v3Score;
            enriched.level = v3Data.verificationLevel || 0;
            enriched.tier = v3Data.verificationLabel || 'Unverified';
            enriched.levelName = enriched.tier;
            enriched.verificationLevel = enriched.level;
            enriched.verificationLevelName = enriched.tier;
          }
        } else {
          enriched.onchain = null;
          enriched.isBorn = false;
        }
      } catch (e) {
        enriched.onchain = null;
      }
    }
    res.json(enriched);
  });

  // ── PATCH /api/profile/:id ─────────────────────────────────────
  app.patch('/api/profile/:id', (req, res) => {
    const d = getDb();
    const apiKey = (req.headers['x-api-key'] || (req.headers['authorization'] || '').replace('Bearer ', '') || '').trim();
    const walletSig = req.headers['x-wallet-signature'];
    const walletAddr = req.headers['x-wallet-address'];

    let row = d.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
    if (!row) row = d.prepare('SELECT * FROM profiles WHERE LOWER(name) = LOWER(?)').get(req.params.id);
    if (!row) row = d.prepare('SELECT * FROM profiles WHERE id = ?').get('agent_' + req.params.id.toLowerCase());
    if (!row) return res.status(404).json({ error: 'Profile not found' });

    // Auth: API key OR wallet signature
    let authed = false;
    if (apiKey && row.api_key === apiKey) {
      authed = true;
    } else if (walletSig && walletAddr) {
      // Verify wallet owns this profile (check wallets column)
      try {
        const profileWallets = typeof row.wallets === 'string' ? JSON.parse(row.wallets || '{}') : (row.wallets || {});
        const profileSolana = profileWallets.solana || '';
        if (profileSolana && profileSolana === walletAddr) {
          // Verify ed25519 signature of profile ID
          const nacl = require('tweetnacl');
          const sigBytes = Buffer.from(walletSig, 'base64');
          const msgBytes = Buffer.from(`agentfolio-edit:${req.params.id}`);
          const pubBytes = bs58.decode(walletAddr);
          if (nacl.sign.detached.verify(msgBytes, sigBytes, pubBytes)) {
            authed = true;
          }
        }
      } catch (e) {
        console.error('[PATCH] Wallet auth failed:', e.message);
      }
    }
    if (!authed) return res.status(403).json({ error: 'Invalid api_key or wallet signature' });

    const allowed = ['name', 'bio', 'description', 'handle', 'avatar', 'website', 'framework', 'capabilities', 'tags', 'wallet', 'twitter', 'github', 'email', 'skills', 'wallets', 'links', 'portfolio'];
    const sets = [];
    const vals = [];
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        sets.push(`${k} = ?`);
        vals.push((Array.isArray(req.body[k]) || (typeof req.body[k] === 'object' && req.body[k] !== null)) ? JSON.stringify(req.body[k]) : req.body[k]);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'No updatable fields provided' });

    sets.push("updated_at = datetime('now')");
    vals.push(req.params.id);
    d.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

    // Return enriched profile so frontend can update state
    const updated = d.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
    const enriched = enrichProfile(updated);

    // Also update the JSON file for Next.js SSR
    try {
      const profilesDir = require('path').join(__dirname, '..', 'data', 'profiles');
      const existingPath = require('path').join(profilesDir, `${req.params.id}.json`);
      if (require('fs').existsSync(existingPath)) {
        const existing = JSON.parse(require('fs').readFileSync(existingPath, 'utf-8'));
        // Merge updated fields
        if (req.body.bio !== undefined) existing.bio = req.body.bio;
        if (req.body.handle !== undefined) existing.handle = req.body.handle;
        if (req.body.links !== undefined) existing.links = { ...existing.links, ...req.body.links };
        if (req.body.avatar !== undefined) existing.avatar = req.body.avatar;
        if (req.body.name !== undefined) existing.name = req.body.name;
        if (req.body.skills !== undefined) existing.skills = req.body.skills;
        if (req.body.portfolio !== undefined) existing.portfolio = req.body.portfolio;
        existing.updatedAt = new Date().toISOString();
        require('fs').writeFileSync(existingPath, JSON.stringify(existing, null, 2));
      }
    } catch (jsonErr) {
      console.error('[PATCH] Failed to update JSON file:', jsonErr.message);
    }

    res.json({ updated: true, profile: enriched });
  });

  // ── POST /api/profile/:id/endorsements ─────────────────────────
  app.post('/api/profile/:id/endorsements', (req, res) => {
    const { endorser_id, endorser_name, skill, comment, weight } = req.body;
    if (!endorser_id || !skill) return res.status(400).json({ error: 'endorser_id and skill are required' });

    const d = getDb();
    const profile = d.prepare('SELECT id FROM profiles WHERE id = ?').get(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    if (endorser_id === req.params.id) return res.status(400).json({ error: 'Cannot self-endorse' });

    const id = genId('end');
    try {
      d.prepare(`
        INSERT INTO endorsements (id, profile_id, endorser_id, endorser_name, skill, comment, weight)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, req.params.id, endorser_id, endorser_name || '', skill, comment || '', weight || 1);
      addActivity(req.params.id, 'endorsement', { endorser_id, endorser_name, skill });
      // Fire-and-forget: send welcome email if agent provided an email
      if (resolvedEmail) {
        sendWelcomeEmail(resolvedEmail, { id, name: name.trim(), handle: h });
      }
      res.status(201).json({ id, message: 'Endorsement added' });
    } catch (e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Duplicate endorsement (same endorser + skill)' });
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/profile/:id/endorsements ──────────────────────────
  app.get('/api/profile/:id/endorsements', (req, res) => {
    const d = getDb();
    const items = d.prepare('SELECT * FROM endorsements WHERE profile_id = ? ORDER BY created_at DESC').all(req.params.id);
    res.json({ endorsements: items, total: items.length });
  });

  // ── POST /api/profile/:id/reviews/challenge -- Get signing challenge ──
  app.post('/api/profile/:id/reviews/challenge', (req, res) => {
    const { wallet } = req.body;
    if (!wallet) return res.status(400).json({ error: 'wallet (Solana address) required' });

    const d = getDb();
    const profile = d.prepare('SELECT id FROM profiles WHERE id = ?').get(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    // Generate challenge
    const nonce = crypto.randomBytes(32).toString('hex');
    const message = `AgentFolio Review Challenge\nProfile: ${req.params.id}\nWallet: ${wallet}\nNonce: ${nonce}\nTimestamp: ${new Date().toISOString()}`;

    _reviewChallenges.set(nonce, {
      wallet,
      profileId: req.params.id,
      expiresAt: Date.now() + REVIEW_CHALLENGE_TTL_MS,
    });

    // Cleanup expired challenges
    for (const [k, v] of _reviewChallenges) {
      if (v.expiresAt < Date.now()) _reviewChallenges.delete(k);
    }

    res.json({ nonce, message, expiresIn: REVIEW_CHALLENGE_TTL_MS / 1000 });
  });

  // ── POST /api/profile/:id/reviews -- Submit review (AUTHENTICATED) ──
  app.post('/api/profile/:id/reviews', (req, res) => {
    const { wallet, signature, nonce, rating, title, comment, job_id } = req.body;

    // Require wallet auth
    if (!wallet || !signature || !nonce) {
      return res.status(401).json({
        error: 'Authentication required. Call POST /api/profile/:id/reviews/challenge first, then sign the message.',
        required: ['wallet', 'signature', 'nonce', 'rating'],
      });
    }
    if (!rating) return res.status(400).json({ error: 'rating (1-5) is required' });
    const r = parseInt(rating);
    if (r < 1 || r > 5) return res.status(400).json({ error: 'rating must be 1-5' });

    // Verify challenge
    const challenge = _reviewChallenges.get(nonce);
    if (!challenge) return res.status(401).json({ error: 'Invalid or expired challenge nonce' });
    if (challenge.expiresAt < Date.now()) {
      _reviewChallenges.delete(nonce);
      return res.status(401).json({ error: 'Challenge expired' });
    }
    if (challenge.wallet !== wallet || challenge.profileId !== req.params.id) {
      return res.status(401).json({ error: 'Challenge mismatch (wallet or profileId)' });
    }
    _reviewChallenges.delete(nonce); // One-time use

    // Verify Solana signature
    try {
      const { PublicKey } = require('@solana/web3.js');
      const nacl = require('tweetnacl');
      const bs58 = require('bs58');

      const expectedMessage = `AgentFolio Review Challenge\nProfile: ${req.params.id}\nWallet: ${wallet}\nNonce: ${nonce}\nTimestamp: ${challenge.issuedAt || ''}`;
      // Reconstruct the message that was signed
      const challengeMsg = _reviewChallenges._lastMessage || `AgentFolio Review Challenge\nProfile: ${req.params.id}\nWallet: ${wallet}\nNonce: ${nonce}`;

      const pubkey = new PublicKey(wallet);
      const sigBytes = bs58.decode(signature);
      // Try to verify with the challenge message stored format
      const msgBytes = new TextEncoder().encode(`AgentFolio Review Challenge\nProfile: ${req.params.id}\nWallet: ${wallet}\nNonce: ${nonce}`);

      // Note: Full ed25519 verification. If tweetnacl not available, fall back to challenge-only auth.
      let sigValid = false;
      try {
        sigValid = nacl.sign.detached.verify(msgBytes, sigBytes, pubkey.toBytes());
      } catch (sigErr) {
        console.error('[Reviews Auth] Signature verification failed:', sigErr.message);
        sigValid = false; // Reject invalid signatures -- no fallback
      }

      if (!sigValid) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    } catch (authErr) {
      console.error('[Reviews Auth] Auth error:', authErr.message);
      return res.status(401).json({ error: 'Authentication failed: ' + authErr.message });
    }

    // Resolve reviewer profile from wallet
    const d = getDb();
    const profile = d.prepare('SELECT id FROM profiles WHERE id = ?').get(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    // Find reviewer's profile by wallet
    let reviewer_id = null;
    let reviewer_name = wallet.slice(0, 8) + '...' + wallet.slice(-4);
    try {
      const allProfiles = d.prepare('SELECT id, name, wallets FROM profiles').all();
      for (const p of allProfiles) {
        try {
          const w = JSON.parse(p.wallets || '{}');
          if (w.solana === wallet) {
            reviewer_id = p.id;
            reviewer_name = p.name || reviewer_id;
            break;
          }
        } catch {}
      }
    } catch {}
    if (!reviewer_id) reviewer_id = 'wallet_' + wallet.slice(0, 12);

    if (reviewer_id === req.params.id) return res.status(400).json({ error: 'Cannot self-review' });

    const id = genId('rev');
    const rfk = module.exports._reviewFk || 'reviewee_id';
    d.prepare(`
      INSERT INTO reviews (id, ${rfk}, reviewer_id, reviewer_name, rating, title, comment, job_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.params.id, reviewer_id, reviewer_name || '', r, title || '', comment || '', job_id || '');
    addActivity(req.params.id, 'review', { reviewer_id, reviewer_name, rating: r, title });

    res.status(201).json({ id, rating: r, title: title || '', comment: comment || '', reviewer_id, reviewer_name, job_id: job_id || '', authenticated: true, message: 'Review added (wallet-authenticated)' });
  });

  // ── GET /api/profile/:id/reviews ───────────────────────────────
  app.get('/api/profile/:id/reviews', (req, res) => {
    const d = getDb();
    const rfk = module.exports._reviewFk || 'profile_id';
    const items = d.prepare(`SELECT * FROM reviews WHERE ${rfk} = ? ORDER BY created_at DESC`).all(req.params.id);
    const stats = d.prepare(`
      SELECT COUNT(*) as total, ROUND(AVG(rating),2) as avg_rating FROM reviews WHERE ${rfk} = ?
    `).get(req.params.id);
    res.json({ reviews: items, ...stats });
  });


  // GET /api/wallet/lookup/:addr -- find profile by Solana wallet (frontend format)
  app.get('/api/wallet/lookup/:addr', (req, res) => {
    const wallet = req.params.addr;
    if (!wallet) return res.status(400).json({ found: false, error: 'wallet address required' });
    try {
      const db = getDb();
      // Check wallet column directly
      let match = db.prepare('SELECT id, name FROM profiles WHERE wallet = ?').get(wallet);
      if (!match) match = db.prepare('SELECT id, name FROM profiles WHERE claimed_by = ?').get(wallet);
      if (!match) {
        // Check wallets JSON column
        const all = db.prepare('SELECT id, name, wallets FROM profiles').all();
        for (const p of all) {
          try {
            const w = JSON.parse(p.wallets || '{}');
            if (w.solana === wallet) { match = { id: p.id, name: p.name }; break; }
          } catch (_) {}
        }
      }
      if (match) {
        return res.json({ found: true, profileId: match.id, name: match.name, profile: { id: match.id, name: match.name } });
      }
      return res.status(404).json({ found: false, error: 'No profile found for this wallet' });
    } catch (e) {
      return res.status(500).json({ found: false, error: e.message });
    }
  });

  // GET /api/profile-by-wallet?wallet=<address> -- find profile by Solana wallet
  app.get('/api/profile-by-wallet', (req, res) => {
    const { wallet } = req.query;
    if (!wallet) return res.status(400).json({ error: 'wallet required' });
    try {
      const db = getDb();
      // Direct wallet column lookup (fast path)
      const directMatch = db.prepare('SELECT id, name FROM profiles WHERE wallet = ?').get(wallet);
      if (directMatch) return res.json({ id: directMatch.id, name: directMatch.name });
      const claimedMatch = db.prepare('SELECT id, name FROM profiles WHERE claimed_by = ?').get(wallet);
      if (claimedMatch) return res.json({ id: claimedMatch.id, name: claimedMatch.name });
      const profiles = db.prepare('SELECT id, name, wallets FROM profiles').all();
      for (const p of profiles) {
        try {
          // [P0 FIX] Check wallets column only -- no DB verification_data
          const w = JSON.parse(p.wallets || '{}');
          if (w.solana === wallet) {
            return res.json({ id: p.id, name: p.name });
          }
        } catch (e2) {}
      }
      return res.status(404).json({ error: 'No profile found for this wallet' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // B5: /api/search endpoint
  app.get("/api/search", (req, res) => {
    const q = (req.query.q || "").trim();
    if (!q) return res.json({ results: [], total: 0 });
    const lim = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const d = getDb();
    const pattern = "%" + q + "%";
    try {
      const rows = d.prepare(
        "SELECT id, name, description, avatar, framework FROM profiles WHERE status = ? AND (hidden = 0 OR hidden IS NULL) AND (name LIKE ? OR description LIKE ? OR framework LIKE ? OR id LIKE ?) ORDER BY created_at DESC LIMIT ?"
      ).all("active", pattern, pattern, pattern, pattern, lim);
      res.json({ results: rows, total: rows.length, query: q });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

// addVerification IS the unified onVerificationComplete hook
// Every verification handler calls it → DB persist + V3 on-chain update + memo attestation + recompute
const onVerificationComplete = addVerification;
module.exports = { registerRoutes, getDb, addVerification, onVerificationComplete, addActivity, deleteProfile };

// Profile deletion -- also cleans disk JSON
function deleteProfile(profileId) {
  const d = getDb();
  // Delete from all related tables
  const tables = ['verifications', 'attestations', 'satp_attestations', 'satp_trust_scores', 'claims', 'claim_tokens', 'endorsements', 'reviews', 'activity', 'activity_feed'];
  for (const table of tables) {
    try {
      const col = table === 'endorsements' ? 'from_profile_id' : 'profile_id';
      d.prepare(`DELETE FROM ${table} WHERE ${col} = ? OR profile_id = ?`).run(profileId, profileId);
    } catch {}
  }
  d.prepare('DELETE FROM profiles WHERE id = ?').run(profileId);
  // Clean disk JSON
  const jsonPath = require('path').join(__dirname, '..', 'data', 'profiles', profileId + '.json');
  try { require('fs').unlinkSync(jsonPath); } catch {}
  return { deleted: true, id: profileId };
}
