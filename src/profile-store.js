/**
 * Profile Store — SQLite-backed persistent profiles, endorsements, and reviews
 * 
 * Endpoints registered:
 *   POST   /api/register              — Create a new agent profile
 *   GET    /api/profiles              — List profiles (paginated)
 *   GET    /api/profile/:id           — Get single profile (enriched)
 *   PATCH  /api/profile/:id           — Update profile fields
 *   POST   /api/profile/:id/endorsements — Add endorsement
 *   GET    /api/profile/:id/endorsements — List endorsements
 *   POST   /api/profile/:id/reviews     — Add review
 *   GET    /api/profile/:id/reviews     — List reviews
 */

const Database = require('better-sqlite3');
const nacl = require('tweetnacl');
const _bs58 = require('bs58');
const bs58 = _bs58.default || _bs58;
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

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

// SATP V3 SDK — Genesis Record creation + V3 identity reads
let satpV3;
try {
  const { createSATPClient, SATPV3SDK: WrapperSDK, hashAgentId, getGenesisPDA } = require('./satp-client/src');
  const { SATPV3SDK } = require('./satp-client/src/v3-sdk');
  const RPC_URL = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
  const v3Client = new SATPV3SDK({ rpcUrl: RPC_URL });
  satpV3 = { client: v3Client, SATPV3SDK, hashAgentId, getGenesisPDA };
  console.log('[SATP V3] SDK loaded (v3-sdk SATPV3SDK with getGenesisRecord)');
} catch (e) {
  console.warn('[SATP V3] SDK not available:', e.message);
}
// [CEO-URGENT Apr 4] postVerificationHook — single on-chain entry point
let postVerificationHook;
try { ({ postVerificationHook } = require('./post-verification-hook')); console.log('[PostVerify] postVerificationHook loaded'); } catch(e) { console.warn('[PostVerify] hook not available:', e.message); }


// V3 Score Service — batch on-chain scoring
let v3ScoreService;
try {
  v3ScoreService = require('./v3-score-service');
  console.log('[V3 Scores] Score service loaded');
} catch (e) {
  console.warn('[V3 Scores] Score service not available:', e.message);
}

// Scoring Engine V2 — 2D scoring (verification level + reputation)
let scoringEngineV2;
try {
  scoringEngineV2 = require('./lib/scoring-engine-v2');
  console.log('[ProfileStore] Scoring Engine V2 loaded');
} catch (e) {
  console.warn('[ProfileStore] Scoring Engine V2 not available:', e.message);
}

// Memo attestation for on-chain verification records
let postMemoAttestation;
try {
  postMemoAttestation = require('./lib/memo-attestation').postVerificationMemo;
  console.log('[ProfileStore] Memo attestation loaded');
} catch (e) {
  console.warn('[ProfileStore] Memo attestation not available:', e.message);
}

const PLATFORM_KEYPAIR_PATH = process.env.SATP_PLATFORM_KEYPAIR ||
  '/home/ubuntu/.config/solana/brainforge-personal.json';
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
  // reviews table may use reviewee_id (CEO fix) or profile_id — detect which
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

function genApiKey() {
  return `af_${crypto.randomBytes(24).toString('hex')}`;
}

function parseJsonField(val, defaultVal = []) {
  if (val === null || val === undefined || val === '') return defaultVal;
  if (typeof val === 'object') return val; // already parsed
  try { return JSON.parse(val); } catch { return defaultVal; }
}


// Score protection guard — prevents corrupt scores from being written
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
  // P1: Level jump protection — reject if level changes by more than 2 steps
  if (newLevel) {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT level FROM satp_trust_scores WHERE agent_id = ?').get(agentId);
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


  // [S4 FIX] Removed duplicate SATP update block — single block below handles it

  // V3: Update verification level AND reputation on-chain (unified)
  if (satpV3 && !userPaidGenesis) {
    (async () => {
      try {
        const { Keypair } = require('@solana/web3.js');
        const signerKey = JSON.parse(require('fs').readFileSync(PLATFORM_KEYPAIR_PATH, 'utf-8'));
        const signer = Keypair.fromSecretKey(Uint8Array.from(signerKey));
        
        // Check if genesis record exists first
        const genesis = await satpV3.client.getGenesisRecord(profileId);
        if (!genesis || genesis.error) {
          console.log(`[SATP V3] No genesis record for ${profileId}, skipping on-chain updates`);
          return;
        }
        
        // Get all verifications for this profile
        const d = getDb();
        const allVerifs = d.prepare('SELECT platform FROM verifications WHERE profile_id = ?').all(profileId);
        const verifCount = allVerifs.length;
        
        // Calculate new verification level with category awareness
        const CATEGORY_MAP = {
          solana: 'wallets', ethereum: 'wallets', hyperliquid: 'wallets', polymarket: 'wallets',
          moltbook: 'platforms', agentmail: 'platforms', github: 'platforms', x: 'platforms', twitter: 'platforms', discord: 'platforms', telegram: 'platforms',
          domain: 'infrastructure', mcp: 'infrastructure', a2a: 'infrastructure', website: 'infrastructure',
          satp: 'onchain',
        };
        const categories = new Set(allVerifs.map(v => CATEGORY_MAP[v.platform] || 'other'));
        const catCount = categories.size;
        
        // Verification level calculation: L0-L5
        // L5 Sovereign: L4 + human-proof verification (X or GitHub verified)
        const HUMAN_PLATFORMS = ['github', 'x', 'twitter'];
        const hasHumanProof = allVerifs.some(v => HUMAN_PLATFORMS.includes(v.platform));
        let newLevel = 0;
        if (verifCount >= 8 && catCount >= 3 && hasHumanProof) newLevel = 5; // L5 Sovereign
        else if (verifCount >= 8 && catCount >= 3) newLevel = 4; // L4 Trusted
        else if (verifCount >= 5 && catCount >= 2) newLevel = 3; // L3 Established  
        else if (verifCount >= 2) newLevel = 2; // L2 Verified
        else if (verifCount >= 1) newLevel = 1; // L1 Registered
        
        // Calculate trust score using Scoring Engine V2
        let newTrustScore = 0;
        try {
          // Build profile object for v2 engine from DB data
          const profileRow = d.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
          const endorsements = d.prepare('SELECT * FROM endorsements WHERE profile_id = ?').all(profileId);
          const rfk = module.exports._reviewFk || 'profile_id';
          const reviews = d.prepare(`SELECT * FROM reviews WHERE ${rfk} = ?`).all(profileId);
          const jobCount = (() => { try { return d.prepare("SELECT COUNT(*) as c FROM jobs WHERE selected_agent_id = ? AND status = 'completed'").get(profileId)?.c || 0; } catch { return 0; } })();
          
          // Build verificationData from DB verifications table
          const verifData = {};
          for (const v of allVerifs) {
            verifData[v.platform] = { verified: true };
          }
          
          const profileObj = {
            id: profileId,
            name: profileRow?.name || '',
            handle: profileRow?.handle || '',
            bio: profileRow?.bio || profileRow?.description || '',
            avatar: profileRow?.avatar || '',
            skills: parseJsonField(profileRow?.skills, []),
            verificationData: verifData,
            endorsements: endorsements,
            stats: {
              jobsCompleted: jobCount,
              reviewsReceived: reviews.length,
              rating: reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0,
            },
            lastActivity: profileRow?.updated_at || profileRow?.created_at,
            createdAt: profileRow?.created_at,
            nftAvatar: parseJsonField(profileRow?.nft_avatar, {}),
          };
          
          if (scoringEngineV2) {
            const scoreResult = scoringEngineV2.getCompleteScore(profileObj);
            newTrustScore = scoreResult.reputationScore.score;
            console.log(`[SATP V3] V2 Score for ${profileId}: L${scoreResult.verificationLevel.level} ${scoreResult.verificationLevel.name}, Rep=${newTrustScore}, Tier=${scoreResult.overall.tier}`);
          } else {
            // Fallback: simple verification count * 50
            newTrustScore = Math.min(800, verifCount * 50);
            console.log(`[SATP V3] Fallback score for ${profileId}: ${newTrustScore}`);
          }
        } catch (scoreErr) {
          console.error(`[SATP V3] Score calculation error for ${profileId}:`, scoreErr.message);
          newTrustScore = Math.min(800, verifCount * 50); // fallback
        }
        
        // Update verification level if changed
        if (newLevel > genesis.verificationLevel) {
          const { transaction } = await satpV3.client.buildUpdateVerification(signer.publicKey, profileId, newLevel);
          transaction.sign(signer);
          const sig = await satpV3.client.connection.sendRawTransaction(transaction.serialize());
          console.log(`[SATP V3] Verification updated for ${profileId}: level ${genesis.verificationLevel} → ${newLevel}, tx=${sig}`);
        }
        
        // Update reputation score if changed (with score protection — P1 hardening)
        const levelJump = Math.abs(newLevel - genesis.verificationLevel);
        if (levelJump > 2) {
          console.warn(`[SATP V3] BLOCKED: Level jump too large for ${profileId}: ${genesis.verificationLevel} -> ${newLevel} (delta=${levelJump}). Max allowed: 2.`);
        } else if (newTrustScore > 10000) {
          console.warn(`[SATP V3] BLOCKED: Score too high for ${profileId}: ${newTrustScore}. Max allowed: 10000.`);
        }
        if (newTrustScore > genesis.reputationScore && newTrustScore <= 10000 && newTrustScore < 1500) {
          const repTx = await satpV3.client.buildUpdateReputation(signer.publicKey, profileId, newTrustScore);
          repTx.transaction.sign(signer);
          const repSig = await satpV3.client.connection.sendRawTransaction(repTx.transaction.serialize());
          console.log(`[SATP V3] Reputation updated for ${profileId}: ${genesis.reputationScore} → ${newTrustScore}, tx=${repSig}`);
        }

        // V3 recompute CPI — fire-and-forget after direct updates (CEO directive Apr 4)
        try {
          const recomputeLevelTx = await satpV3.client.buildRecomputeLevel(signer.publicKey, profileId, []);
          recomputeLevelTx.transaction.sign(signer);
          const lvlSig = await satpV3.client.connection.sendRawTransaction(recomputeLevelTx.transaction.serialize());
          console.log(`[SATP V3] recompute_level CPI for ${profileId}: tx=${lvlSig}`);
        } catch (rcErr) {
          console.warn(`[SATP V3] recompute_level CPI failed for ${profileId}: ${rcErr.message}`);
        }
        try {
          const recomputeRepTx = await satpV3.client.buildRecomputeReputation(signer.publicKey, profileId, []);
          recomputeRepTx.transaction.sign(signer);
          const repRcSig = await satpV3.client.connection.sendRawTransaction(recomputeRepTx.transaction.serialize());
          console.log(`[SATP V3] recompute_reputation CPI for ${profileId}: tx=${repRcSig}`);
        } catch (rcErr) {
          console.warn(`[SATP V3] recompute_reputation CPI failed for ${profileId}: ${rcErr.message}`);
        }
        
      } catch (err) {
        console.error(`[SATP V3] On-chain update failed for ${profileId}:`, err.message);
      }
    })();
  }

    addActivity(profileId, 'verification', { platform, identifier });

  // [CEO-URGENT Apr 4] Fire postVerificationHook (attestation + recompute CPI)
  if (postVerificationHook) {
    postVerificationHook(profileId, platform, identifier, proof).catch(err => console.error('[PostVerify] Hook error:', err.message));
  }

  // Fire-and-forget: post on-chain Memo attestation
  if (postMemoAttestation) {
    postMemoAttestation(profileId, platform, { identifier, verified_at: new Date().toISOString() })
      .then(result => {
        if (result) console.log(`[ProfileStore] Memo attestation posted for ${profileId}/${platform}: ${result.explorerUrl}`);
      })
      .catch(err => console.error(`[ProfileStore] Memo attestation failed for ${profileId}/${platform}:`, err.message));
  }

    // [CEO-URGENT 2026-04-04] ISR cache revalidation after verification
  try {
    const { revalidateProfileCache } = require('./post-verification-hook');
    revalidateProfileCache(profileId).catch(e => console.warn('[PostVerify] ISR revalidation error:', e.message));
  } catch (e) { /* post-verification-hook not available */ }

  // [REMOVED] Duplicate V3 update block — handled by the unified V3 block above (verification + reputation + recompute)

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
      headers: { 'Content-Type': 'application/json', 'X-HQ-Key': 'REDACTED_HQ_KEY' },
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
  // [P0 FIX] DB verifications query REMOVED — chain-cache is sole source of truth
  const activity = d.prepare('SELECT * FROM activity_feed WHERE profile_id = ? ORDER BY created_at DESC LIMIT 20').all(row.id);
  const rfk = module.exports._reviewFk || 'profile_id';
  const reviewStats = d.prepare(`
    SELECT COUNT(*) as total, ROUND(AVG(rating),2) as avg_rating,
      SUM(CASE WHEN rating >= 4 THEN 1 ELSE 0 END) as positive,
      SUM(CASE WHEN rating <= 2 THEN 1 ELSE 0 END) as negative
    FROM reviews WHERE ${rfk} = ?
  `).get(row.id);
  
  // [CEO Apr 4] DB scoring removed from display — on-chain only via v3ScoreService/chain-cache
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
    avatar: resolvedAvatar ? resolvedAvatar.replace('node1.irys.xyz', 'gateway.irys.xyz') : resolvedAvatar,
    v3,
    capabilities: parseJsonField(row.capabilities),
    tags: parseJsonField(row.tags),
    links: parseJsonField(row.links, {}),
    wallets: parseJsonField(row.wallets, {}),
    skills: parseJsonField(row.skills),
    // [P0 FIX v2] verification_data: chain-cache first, DB fallback for recent verifications
    verification_data: (() => {
      const vd = {};
      // 1. Read DB verifications (always available immediately after verify)
      let dbVerifs = {};
      try {
        const _d = getDb();
        const _rows = _d.prepare('SELECT platform, identifier, verified_at FROM verifications WHERE profile_id = ?').all(row.id);
        for (const _r of _rows) {
          const plat = _r.platform === 'twitter' ? 'x' : _r.platform;
          dbVerifs[plat] = { identifier: _r.identifier || '', verifiedAt: _r.verified_at || null };
        }
      } catch (__) {}
      // 2. Read chain-cache attestations (authoritative when available)
      try {
        const _cc = require('./lib/chain-cache');
        const _atts = _cc.getVerifications(row.id);
        for (const att of _atts) {
          if (!att.platform || att.platform === 'review') continue;
          const plat = att.platform === 'twitter' ? 'x' : att.platform;
          if (vd[plat]) continue;
          const displayId = dbVerifs[plat]?.identifier || '';
          vd[plat] = { verified: true, address: displayId, identifier: displayId, linked: true, verifiedAt: att.timestamp || null, source: 'on-chain' };
        }
      } catch (_) {}
      // 3. Fill in DB-only verifications not yet on-chain (recent verifications pre-attestation)
      for (const [plat, info] of Object.entries(dbVerifs)) {
        if (!vd[plat]) {
          vd[plat] = { verified: true, address: info.identifier, identifier: info.identifier, linked: true, verifiedAt: info.verifiedAt, source: 'db' };
        }
      }
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
      // 1. DB verifications (immediate persistence)
      let dbVerifs = {};
      try {
        const d = getDb();
        const rows = d.prepare('SELECT platform, identifier, verified_at FROM verifications WHERE profile_id = ?').all(row.id);
        for (const r of rows) {
          const plat = r.platform === 'twitter' ? 'x' : r.platform;
          dbVerifs[plat] = { identifier: r.identifier || '', verifiedAt: r.verified_at || null, rawPlatform: r.platform };
        }
      } catch (_) {}
      // 2. Chain-cache attestations (authoritative when available)
      try {
        const chainCache = require('./lib/chain-cache');
        const atts = chainCache.getVerifications(row.id);
        for (const att of atts) {
          if (!att.platform || att.platform === 'review') continue;
          const platform = att.platform === 'twitter' ? 'x' : att.platform;
          if (vMap[platform]) continue;
          const displayId = dbVerifs[platform]?.identifier || platform;
          vMap[platform] = {
            verified: true,
            address: displayId,
            identifier: displayId,
            proof: { txSignature: att.txSignature, timestamp: att.timestamp, url: 'https://solana.fm/tx/' + att.txSignature },
            verified_at: att.timestamp || null,
            source: 'on-chain',
          };
        }
      } catch (e) { /* chain-cache not available */ }
      // 3. DB fallback for platforms not yet on-chain
      for (const [plat, info] of Object.entries(dbVerifs)) {
        if (!vMap[plat]) {
          vMap[plat] = {
            verified: true,
            address: info.identifier || plat,
            identifier: info.identifier || plat,
            proof: {},
            verified_at: info.verifiedAt || null,
            source: 'db',
          };
        }
      }
      return vMap;
    })(),
    activity: activity.map(a => ({ ...a, type: a.event_type, detail: parseJsonField(a.detail) })),
    reviews: {
      total: reviewStats.total,
      avg_rating: reviewStats.avg_rating,
      positive: reviewStats.positive,
      negative: reviewStats.negative,
    },
    trust_score: v3 ? { overall_score: v3.reputationScore > 10000 ? Math.round(v3.reputationScore / 1000) : v3.reputationScore, level: ["Unverified","Registered","Verified","Established","Trusted","Sovereign"][v3.verificationLevel] || "Unverified", score_breakdown: {}, source: "v3-onchain" } : null, // [CEO-URGENT] on-chain only — no DB fallback
    // Computed level/tier/score — chain-cache is primary source
    level: v3 ? v3.verificationLevel : null, // on-chain only
    tier: v3 ? (["Unclaimed","Registered","Verified","Established","Trusted","Sovereign"][v3.verificationLevel] || v3.verificationLabel || "Unclaimed") : null, // on-chain only
    score: v3 ? v3.reputationScore : null, // on-chain only
    verification_level: v3 ? v3.verificationLevel : 0, // on-chain only
    reputation_score: v3 ? v3.reputationScore : 0, // on-chain only
    // Top-level unclaimed flag for frontend (from metadata)
    unclaimed: (() => { try { const m = typeof row.metadata === 'string' ? JSON.parse(row.metadata || '{}') : (row.metadata || {}); return m.unclaimed === true || m.isPlaceholder === true || m.placeholder === true; } catch { return false; } })(),
  };
}

function registerRoutes(app) {
  // ── POST /api/register ──────────────────────────────────────────
  app.post('/api/register', registerLimiter, (req, res) => {
    const { name, handle, description, bio, avatar, website, framework, capabilities, tags, wallet, wallets, skills, links, twitter, github, email, signature, signedMessage, userPaidGenesis } = req.body;
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
          return res.status(401).json({ error: 'invalid wallet signature — proof of ownership failed' });
        }
      } catch (sigErr) {
        return res.status(400).json({ error: `signature verification error: ${sigErr.message}` });
      }
    } else if (solWallet && (!signature || !signedMessage)) {
      return res.status(400).json({ error: 'When wallet is provided, signature and signedMessage are required' });
    }

    // Normalize frontend format → backend format
    const resolvedBio = (bio || description || '').trim();
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
      // Check uniqueness
      const existing = d.prepare('SELECT id FROM profiles WHERE id = ?').get(id);
      if (existing) {
        return res.status(409).json({ error: 'This profile ID is already taken' });
      }
    } else {
      id = genId();
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
      ];

      for (const [col, exists, val] of optionalFields) {
        if (exists && cols.includes(col)) {
          insertCols.push(col);
          insertPlaceholders.push('?');
          insertVals.push(val);
        }
      }

      d.prepare(`INSERT INTO profiles (${insertCols.join(', ')}) VALUES (${insertPlaceholders.join(', ')})`).run(...insertVals);

      // ── Write JSON profile file so Next.js frontend can find it ──
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
      console.log(`[ProfileStore] JSON profile written: ${profilesDir}/${id}.json`);

      // Fire-and-forget: create SATP V3 Genesis Record (skip if user will pay)
      if (satpV3 && !userPaidGenesis) {
        (async () => {
          const { Keypair } = require('@solana/web3.js');
          const signerKey = JSON.parse(require('fs').readFileSync(PLATFORM_KEYPAIR_PATH, 'utf-8'));
          const signer = Keypair.fromSecretKey(Uint8Array.from(signerKey));
          const hashBuf = satpV3.agentIdHash(id);
          try {
            const { transaction, genesisPda } = await satpV3.client.buildCreateGenesisRecord(
              signer.publicKey,
              hashBuf,
              name.trim().substring(0, 32),
              (resolvedBio || 'AgentFolio registered agent').substring(0, 256),
              framework || 'general',
              resolvedSkills.slice(0, 5).map(s => s.name || s),
              ''
            );
            transaction.sign(signer);
            const sig = await satpV3.client.connection.sendRawTransaction(transaction.serialize());
            await satpV3.client.connection.confirmTransaction(sig, 'confirmed');
            console.log(`[SATP V3] Genesis Record confirmed for ${id}: pda=${genesisPda.toBase58()} tx=${sig}`);
          } catch (err) {
            console.error(`[SATP V3] Genesis Record attempt 1 failed for ${id}:`, err.message);
            // Retry once after 3s (transient RPC failures are common)
            try {
              await new Promise(r => setTimeout(r, 3000));
              const { transaction: tx2, genesisPda: pda2 } = await satpV3.client.buildCreateGenesisRecord(
                signer.publicKey, hashBuf,
                name.trim().substring(0, 32),
                (resolvedBio || 'AgentFolio registered agent').substring(0, 256),
                framework || 'general',
                resolvedSkills.slice(0, 5).map(s => s.name || s),
                ''
              );
              tx2.sign(signer);
              const sig2 = await satpV3.client.connection.sendRawTransaction(tx2.serialize(), { skipPreflight: true, maxRetries: 3 });
              await satpV3.client.connection.confirmTransaction(sig2, 'confirmed');
              console.log(`[SATP V3] Genesis Record confirmed (retry) for ${id}: pda=${pda2.toBase58()} tx=${sig2}`);
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
          d.prepare("INSERT OR REPLACE INTO satp_trust_scores (agent_id, overall_score, level, score_breakdown, last_computed) VALUES (?, ?, ?, ?, datetime('now'))").run(id, overallScore, level, breakdown);
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
          text: `🆕 New agent registered: ${name.trim()} (agent_${id.replace('agent_','')}) — ${(resolvedSkills || []).slice(0,3).map(s => s.name || s).join(', ') || 'no skills'}${solanaWallet ? ' • wallet: ' + solanaWallet.slice(0,8) + '...' : ''}`,
          color: '#00BFFF',
        });
        const notifReq = http.request({
          hostname: 'localhost', port: 3456, path: '/api/comms/push',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-HQ-Key': 'REDACTED_HQ_KEY' },
          timeout: 3000,
        });
        notifReq.on('error', () => {}); // fire-and-forget
        notifReq.write(notifData);
        notifReq.end();
      } catch (_) {} // Never fail registration due to notification

      res.status(201).json({
        id,
        profileId: id,
        profileUrl: `https://agentfolio.bot/profile/${id}`,
        verifyUrl: `https://agentfolio.bot/verify/${id}`,
        api_key: apiKey,
        message: 'Profile registered successfully. Save your api_key — it authenticates write operations.',
        satp: solanaWallet ? 'On-chain identity creation initiated' : 'No wallet provided — on-chain identity skipped',
      });
    } catch (e) {
      console.error('Register error:', e.message);
      res.status(500).json({ error: 'Registration failed', detail: e.message });
    }
  });


  // ── GET /api/profile/:id/genesis — V3 Genesis Record (on-chain) ──
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
      // [CEO Apr 4] DB score override REMOVED — on-chain is sole authority for display


















      res.json({ genesis: record });
    } catch (e) {
      res.json({ genesis: null, error: e.message });
    }
  });


  // ── POST /api/satp/genesis/prepare — User-paid Genesis Record (returns unsigned TX) ──
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

      const hashBuf = satpV3.agentIdHash(agentId);
      const { PublicKey } = require('@solana/web3.js');
      const payerKey = new PublicKey(payer);

      // Build TX with deployer as creator/authority, user as feePayer
      const fs = require('fs');
      const { Keypair } = require('@solana/web3.js');
      const deployerKey = JSON.parse(fs.readFileSync(PLATFORM_KEYPAIR_PATH, 'utf-8'));
      const deployer = Keypair.fromSecretKey(Uint8Array.from(deployerKey));

      const { transaction, genesisPda } = await satpV3.client.buildCreateGenesisRecord(
        deployer.publicKey, hashBuf, name, bio || 'AgentFolio registered agent', category, skills, ''
      );

      // User pays the transaction fee + rent
      transaction.feePayer = payerKey;
      const { blockhash, lastValidBlockHeight } = await satpV3.client.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;

      // Deployer signs as creator/authority
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

    const total = d.prepare('SELECT COUNT(*) as c FROM profiles WHERE status = ? AND (hidden = 0 OR hidden IS NULL)').get(status).c;
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
    const profiles = rows.map(r => {
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
      // P1: Determine claimed status from chain-cache (NOT DB verification_data)
      let claimed = false;
      try {
        const _ccCl = require("./lib/chain-cache");
        const _ccPl = _ccCl.getVerifiedPlatforms(rest.id);
        claimed = _ccPl.length > 0;
      } catch (_) {}
      const { _trust_score: ts, _trust_level: dbLevel, ...cleanRest } = rest;
      const _md = parseJsonField(cleanRest.metadata);
      const unclaimed = _md.unclaimed === true || _md.isPlaceholder === true || _md.placeholder === true;
      return { ...cleanRest, avatar: resolvedAvatar, capabilities: parseJsonField(cleanRest.capabilities), tags: parseJsonField(cleanRest.tags), links: parseJsonField(cleanRest.links), wallets: parseJsonField(cleanRest.wallets), skills: parseJsonField(cleanRest.skills), verification_data: {} /* [P0] chain-cache only, no DB reads */, portfolio: parseJsonField(cleanRest.portfolio), endorsements_given: parseJsonField(cleanRest.endorsements_given), custom_badges: parseJsonField(cleanRest.custom_badges), metadata: _md, nft_avatar: parseJsonField(cleanRest.nft_avatar), trust_score: ts || 0, _dbLevel: dbLevel || null, claimed, unclaimed };
    });

    // V3 on-chain score overlay — authoritative
    if (v3ScoreService) {
      try {
        // P0 FIX: Use display names for V3 lookup (chain records use names, not DB IDs)
        const nameIds = profiles.map(p => p.name);
        const dbIds = profiles.map(p => p.id);
        const v3ByName = await v3ScoreService.getV3Scores(nameIds);
        const v3ById = await v3ScoreService.getV3Scores(dbIds);
        for (const p of profiles) {
          // Try name first (chain uses display names), then DB ID
          const v3 = v3ByName.get(p.name) || v3ById.get(p.id);
          if (v3 && v3.verificationLevel > 0) {
            p.v3 = {
              level: v3.verificationLevel,
              score: v3.reputationScore,
              reputationScore: v3.reputationScore,
              reputationPct: v3.reputationPct,
              verificationLevel: v3.verificationLevel,
              verificationLabel: v3.verificationLabel,
              isBorn: v3.isBorn,
            };
            if (v3.reputationScore > (p.trust_score || 0)) { p.trust_score = v3.reputationScore; }
          }
        }
        // REMOVED: // DB enrichment fallback for agents with chain defaults (level=0)
        // REMOVED: const levelMap = { 'NEW': 0, 'UNVERIFIED': 0, 'REGISTERED': 1, 'BASIC': 2, 'VERIFIED': 2, 'ESTABLISHED': 3, 'TRUSTED': 4, 'SOVEREIGN': 5 };
        // REMOVED: for (const p of profiles) {
        // REMOVED: if (!p.v3 || !p.v3.level) {
        // REMOVED: try {
        // REMOVED: const d = getDb();
        // REMOVED: let row = d.prepare('SELECT verification FROM profiles WHERE id = ?').get(p.id);
        // REMOVED: if (row && row.verification) {
        // REMOVED: const vData = typeof row.verification === 'string' ? JSON.parse(row.verification) : row.verification;
        // REMOVED: // level can be a string label ("SOVEREIGN") or number
        // REMOVED: const numLevel = typeof vData.level === 'number' ? vData.level : (levelMap[(vData.level || '').toUpperCase()] ?? 0);
        // REMOVED: const numScore = vData.score || vData.reputationScore || 0;
        // REMOVED: if (numLevel > 0 || numScore > 0) {
        // REMOVED: const labels = ['Unverified','Registered','Verified','Established','Trusted','Sovereign'];
        // REMOVED: p.v3 = {
        // REMOVED: level: numLevel,
        // REMOVED: score: numScore,
        // REMOVED: reputationScore: numScore,
        // REMOVED: reputationPct: (numScore / 100).toFixed(2),
        // REMOVED: verificationLevel: numLevel,
        // REMOVED: verificationLabel: labels[numLevel] || 'Unknown',
        // REMOVED: isBorn: vData.isBorn || false,
        // REMOVED: };
        // REMOVED: if (numScore > (p.trust_score || 0)) {
        // REMOVED: p.trust_score = numScore;
        // REMOVED: }
        // REMOVED: }
        // REMOVED: }
        // REMOVED: } catch (_) {}
        // REMOVED: }
        // REMOVED: }
        // Re-sort by trust_score DESC after V3 overlay (DB sort may be stale)
        profiles.sort((a, b) => (b.trust_score || 0) - (a.trust_score || 0));
      } catch (e) {
        console.warn('[V3 Scores] Batch profiles warm-up failed:', e.message);
      }
    }

    // Chain-cache score overlay: for agents without V3, compute from on-chain attestations
    try {
      const chainCache = require('./lib/chain-cache');
      for (const p of profiles) {
        if (!p.v3) {
          const ccScore = chainCache.getScore(p.id);
          // On-chain is authoritative (CEO directive Apr 4) — don't overwrite with chain score
          if (ccScore) {
            p.chain_cache_score = ccScore;
            // On-chain is authoritative — always use chain score
            if (ccScore.reputationScore) {
              p.trust_score = ccScore.reputationScore;
            }
          }
        }
        // Add verification count from chain-cache (on-chain source of truth)
        const ccPlatforms = chainCache.getVerifiedPlatforms(p.id);
        if (ccPlatforms.length > 0) {
          p.onchain_verification_count = ccPlatforms.length;
          p.onchain_platforms = ccPlatforms;
        }
      }
      // Re-sort after chain-cache overlay
      profiles.sort((a, b) => (b.trust_score || 0) - (a.trust_score || 0));
    } catch (e) {
      // chain-cache may not be available yet
    }

    // P0-13: Paginate after V3 overlay sort
    // Chain-cache: overlay on-chain verification count + score for all profiles
    try {
      const chainCache = require('./lib/chain-cache');
      for (const p of profiles) {
        // On-chain verification count (from attestation memos)
        const ccVerifications = chainCache.getVerifications(p.id);
        if (ccVerifications && ccVerifications.length > 0) {
          const ccPlatforms = [...new Set(ccVerifications.map(v => v.platform))];
          p.onchain_verification_count = ccPlatforms.length;
          p.onchain_platforms = ccPlatforms;
        }
        // On-chain score (from Genesis Record or computed)
        const ccScore = chainCache.getScore(p.id);
        if (ccScore) {
          p.chain_score = ccScore.reputationScore || 0;
          p.chain_level = ccScore.verificationLevel || 0;
          // On-chain is authoritative (CEO directive Apr 4) — chain score as fallback only
          if (ccScore.reputationScore && !p.trust_score) {
            p.trust_score = ccScore.reputationScore;
          }
        }
      }
      // Final sort by trust_score after chain-cache overlay
      profiles.sort((a, b) => (b.trust_score || 0) - (a.trust_score || 0));
    } catch (e) { /* chain-cache may not be ready yet */ }

    // P0 FIX: Promote v3/chain-cache level+score to top-level fields for directory consumption
    const levelLabels = ['Unverified','Registered','Verified','Established','Trusted','Sovereign'];
    for (const p of profiles) {
      const v = p.v3 || {};
      const cl = p.chain_level || 0;
      const cs = p.chain_score || 0;
      p.level = v.verificationLevel || v.level || cl || 0;
      p.score = v.reputationScore || v.score || cs || p.trust_score || 0;
      p.levelName = v.verificationLabel || levelLabels[p.level] || 'Unknown';
    }
    // Sort parameter: trust_desc (default), trust_asc, name_asc, name_desc, newest, oldest
    const sortParam = (req.query.sort || "trust_desc").toLowerCase();
    switch (sortParam) {
      case "trust_asc":
        profiles.sort((a, b) => (a.trust_score || 0) - (b.trust_score || 0));
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
        profiles.sort((a, b) => (b.trust_score || 0) - (a.trust_score || 0));
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

    // ON-CHAIN = TRUTH: Fetch genesis data via internal HTTP call to our own genesis endpoint
    // This endpoint has the correct deserialization + DB enrichment for on-chain defaults
    if (enriched) {
      try {
        const genesisUrl = "http://localhost:" + (process.env.PORT || 3000) + "/api/profile/" + encodeURIComponent(row.id) + "/genesis";
        const genesisResp = await fetch(genesisUrl);
        const genesisJson = await genesisResp.json();
        const v3Data = genesisJson && genesisJson.genesis ? genesisJson.genesis : genesisJson;
        const hasGenesis = v3Data && v3Data.agentName && !v3Data.error;

        if (hasGenesis) {
          enriched.onchain = v3Data;
          // ON-CHAIN is authoritative for scores (CEO directive 2026-04-04)
          const levelLabels = ["Unverified","Registered","Verified","Established","Trusted","Sovereign"];
          enriched.trust_score = { source: "on-chain", reputationScore: v3Data.reputationScore, verificationLevel: v3Data.verificationLevel, isBorn: v3Data.isBorn, faceImage: v3Data.faceImage || null, authority: v3Data.authority || null };
          enriched.level = v3Data.verificationLevel;
          enriched.score = v3Data.reputationScore;
          enriched.levelName = v3Data.verificationLabel || levelLabels[v3Data.verificationLevel] || "Unknown";
          enriched.verificationLevel = v3Data.verificationLevel;
          enriched.verification_level = v3Data.verificationLevel;
          enriched.reputation_score = v3Data.reputationScore;
          enriched.tier = v3Data.verificationLabel || levelLabels[v3Data.verificationLevel] || "Unknown";
          enriched.isBorn = v3Data.isBorn;
          if (v3Data.faceImage) enriched.faceImage = v3Data.faceImage;
          if (v3Data.authority) enriched.walletAddress = v3Data.authority;
        } else {
          enriched.onchain = null;
          enriched.trust_score = { source: "none", message: "No on-chain Genesis Record" };
          enriched.level = 0; enriched.score = 0; enriched.levelName = "Unverified";
          enriched.verificationLevel = 0; enriched.verification_level = 0;
          enriched.reputation_score = 0; enriched.tier = "Unverified"; enriched.isBorn = false;
        }
      } catch (e) {
        enriched.onchain = null;
        enriched.trust_score = { source: "error", message: e.message };
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

    const allowed = ['name', 'bio', 'description', 'handle', 'avatar', 'website', 'framework', 'capabilities', 'tags', 'wallet', 'twitter', 'github', 'email', 'skills', 'wallets', 'links'];
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

  // ── POST /api/profile/:id/reviews/challenge — Get signing challenge ──
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

  // ── POST /api/profile/:id/reviews — Submit review (AUTHENTICATED) ──
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
        sigValid = false; // Reject invalid signatures — no fallback
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


  // GET /api/profile-by-wallet?wallet=<address> — find profile by Solana wallet
  app.get('/api/profile-by-wallet', (req, res) => {
    const { wallet } = req.query;
    if (!wallet) return res.status(400).json({ error: 'wallet required' });
    try {
      const db = getDb();
      const profiles = db.prepare('SELECT id, name, wallets FROM profiles').all();
      for (const p of profiles) {
        try {
          // [P0 FIX] Check wallets column only — no DB verification_data
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
}

// addVerification IS the unified onVerificationComplete hook
// Every verification handler calls it → DB persist + V3 on-chain update + memo attestation + recompute
const onVerificationComplete = addVerification;
module.exports = { registerRoutes, getDb, addVerification, onVerificationComplete, addActivity };
