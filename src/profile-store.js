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
const { sendWelcomeEmail } = require('./lib/welcome-email');

// SATP on-chain identity registration (fire-and-forget on profile creation)
let satpWrite;
try {
  satpWrite = require('./satp-write-client');
} catch (e) {
  console.warn('[ProfileStore] satp-write-client not available, on-chain registration disabled');
}

// SATP V3 SDK — Genesis Record creation
let satpV3;
try {
  const { createSATPClient, agentIdHash } = require('./satp-client/src');
  satpV3 = { client: createSATPClient({ rpcUrl: process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED' }), agentIdHash };
  console.log('[SATP V3] SDK loaded successfully');
} catch (e) {
  console.warn('[SATP V3] SDK not available:', e.message);
}

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
        
        // Update reputation score if changed
        if (newTrustScore > genesis.reputationScore) {
          const repTx = await satpV3.client.buildUpdateReputation(signer.publicKey, profileId, newTrustScore);
          repTx.transaction.sign(signer);
          const repSig = await satpV3.client.connection.sendRawTransaction(repTx.transaction.serialize());
          console.log(`[SATP V3] Reputation updated for ${profileId}: ${genesis.reputationScore} → ${newTrustScore}, tx=${repSig}`);
        }
        
      } catch (err) {
        console.error(`[SATP V3] On-chain update failed for ${profileId}:`, err.message);
      }
    })();
  }

    addActivity(profileId, 'verification', { platform, identifier });

  // Fire-and-forget: post on-chain Memo attestation
  if (postMemoAttestation) {
    postMemoAttestation(profileId, platform, { identifier, verified_at: new Date().toISOString() })
      .then(result => {
        if (result) console.log(`[ProfileStore] Memo attestation posted for ${profileId}/${platform}: ${result.explorerUrl}`);
      })
      .catch(err => console.error(`[ProfileStore] Memo attestation failed for ${profileId}/${platform}:`, err.message));
  }

  // Fire-and-forget: update V3 on-chain verification level
  if (satpV3 && !userPaidGenesis) {
    (async () => {
      try {
        // Check if Genesis Record exists first
        const record = await satpV3.client.getGenesisRecord(profileId);
        if (!record || record.error) {
          console.log(`[SATP V3] No Genesis Record for ${profileId} — skipping verification update`);
          return;
        }

        // Calculate new verification level based on platform count
        const d = getDb();
        const verifs = d.prepare('SELECT platform FROM verifications WHERE profile_id = ?').all(profileId);
        const platforms = new Set(verifs.map(v => v.platform));
        const HUMAN_PLATS = ['github', 'x', 'twitter'];
        const hasHuman = [...platforms].some(p => HUMAN_PLATS.includes(p));
        let newLevel = 0;
        if (platforms.size >= 8 && hasHuman) newLevel = 5;
        else if (platforms.size >= 8) newLevel = 4;
        else if (platforms.size >= 5) newLevel = 3;
        else if (platforms.size >= 3) newLevel = 2;
        else if (platforms.size >= 1) newLevel = 1;

        if (newLevel > record.verificationLevel) {
          const { Keypair } = require('@solana/web3.js');
          const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(require('fs').readFileSync(PLATFORM_KEYPAIR_PATH, 'utf-8'))));
          const { transaction } = await satpV3.client.buildUpdateVerification(signer.publicKey, profileId, newLevel);
          transaction.sign(signer);
          const sig = await satpV3.client.connection.sendRawTransaction(transaction.serialize());
          console.log(`[SATP V3] Verification level updated to ${newLevel} for ${profileId}: tx=${sig}`);
        }
      } catch (err) {
        console.error(`[SATP V3] Failed to update verification for ${profileId}:`, err.message);
      }
    })();
  }

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
      headers: { 'Content-Type': 'application/json', 'X-HQ-Key': 'HQ_API_KEY_REDACTED' },
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
  const verifications = d.prepare('SELECT * FROM verifications WHERE profile_id = ? ORDER BY verified_at DESC').all(row.id);
  const activity = d.prepare('SELECT * FROM activity_feed WHERE profile_id = ? ORDER BY created_at DESC LIMIT 20').all(row.id);
  const rfk = module.exports._reviewFk || 'profile_id';
  const reviewStats = d.prepare(`
    SELECT COUNT(*) as total, ROUND(AVG(rating),2) as avg_rating,
      SUM(CASE WHEN rating >= 4 THEN 1 ELSE 0 END) as positive,
      SUM(CASE WHEN rating <= 2 THEN 1 ELSE 0 END) as negative
    FROM reviews WHERE ${rfk} = ?
  `).get(row.id);
  
  // SATP Trust Score (from satp_trust_scores table)
  let trust_score = null;
  try {
    const trustRow = d.prepare('SELECT overall_score, level, score_breakdown FROM satp_trust_scores WHERE agent_id = ?').get(row.id);
    if (trustRow) {
      trust_score = {
        overall_score: trustRow.overall_score,
        level: trustRow.level,
        score_breakdown: parseJsonField(trustRow.score_breakdown, {}),
      };
    }
  } catch (e) {
    // satp_trust_scores table may not exist yet
  }

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
    verification_data: parseJsonField(row.verification_data, {}),
    portfolio: parseJsonField(row.portfolio),
    endorsements_given: parseJsonField(row.endorsements_given),
    custom_badges: parseJsonField(row.custom_badges),
    metadata: parseJsonField(row.metadata, {}),
    nft_avatar: parseJsonField(row.nft_avatar, {}),
    endorsements: { items: endorsements, total: endorsements.length },
    verifications: (() => {
      const vMap = {};
      // === 3) Chain-cache attestations (supplementary) ===
      try {
        const chainCache = require('./lib/chain-cache');
        const atts = chainCache.getVerifications(row.id);
        for (const att of atts) {
          if (att.platform && !vMap[att.platform]) {
            vMap[att.platform] = {
              verified: true,
              address: att.identifier || '',
              identifier: att.identifier || '',
              proof: { txSignature: att.txSignature, timestamp: att.timestamp },
              verified_at: att.timestamp || null,
              source: 'on-chain',
            };
          }
        }
      } catch (e) { /* chain-cache not available — fall back to DB */ }
      
      // === DB verifications (fill gaps not covered by chain-cache) ===
      for (const v of verifications) {
        if (!vMap[v.platform]) {
          const proof = parseJsonField(v.proof);
          vMap[v.platform] = {
            verified: true,
            address: v.identifier,
            identifier: v.identifier,
            proof,
            verified_at: v.verified_at,
            source: 'db',
          };
        }
      }
      // === verification_data JSON column (additional metadata) ===
      const vd = parseJsonField(row.verification_data, {});
      for (const [platform, data] of Object.entries(vd)) {
        if (data && data.verified) {
          if (!vMap[platform]) {
            vMap[platform] = {
              verified: true,
              address: data.address || data.handle || data.username || data.email || data.url || data.did || data.domain || "",
              identifier: data.address || data.handle || data.username || data.email || data.url || data.did || data.domain || "",
              proof: { verifiedAt: data.verifiedAt || data.linkedAt || null },
              verified_at: data.verifiedAt || data.linkedAt || null,
              source: 'db-json',
            };
          } else {
            // Merge extra metadata from DB into chain-cache entry (handle, username, etc.)
            const existing = vMap[platform];
            if (data.handle && !existing.handle) existing.handle = data.handle;
            if (data.username && !existing.username) existing.username = data.username;
            if (data.email && !existing.email) existing.email = data.email;
            if (data.url && !existing.url) existing.url = data.url;
            if (data.did && !existing.did) existing.did = data.did;
            if (data.domain && !existing.domain) existing.domain = data.domain;
            if (data.address && !existing.address) existing.address = data.address;
          }
        }
      }
      return vMap;
    })(),
    activity: activity.map(a => ({ ...a, detail: parseJsonField(a.detail) })),
    reviews: {
      total: reviewStats.total,
      avg_rating: reviewStats.avg_rating,
      positive: reviewStats.positive,
      negative: reviewStats.negative,
    },
    trust_score,
    // Computed level/tier/score — chain-cache is primary source
    level: v3 ? v3.verificationLevel : (trust_score ? trust_score.level : null),
    tier: v3 ? (v3.verificationLabel || ['Unclaimed','Registered','Verified','Established','Trusted','Sovereign'][v3.verificationLevel] || 'Unclaimed') : (trust_score ? (trust_score.level >= 4 ? 'Elite' : trust_score.level >= 3 ? 'Established' : trust_score.level >= 2 ? 'Verified' : trust_score.level >= 1 ? 'Basic' : 'Unclaimed') : null),
    score: v3 ? v3.reputationScore : (trust_score ? trust_score.overall_score : null),
    verification_level: v3 ? v3.verificationLevel : (trust_score ? trust_score.level : 0),
    reputation_score: v3 ? v3.reputationScore : (trust_score ? trust_score.overall_score : 0),
  };
}

function registerRoutes(app) {
  // ── POST /api/register ──────────────────────────────────────────
  app.post('/api/register', (req, res) => {
    const { name, handle, description, bio, avatar, website, framework, capabilities, tags, wallet, wallets, skills, links, twitter, github, email, signature, signedMessage, userPaidGenesis } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length < 1) {
      return res.status(400).json({ error: 'name is required (non-empty string)' });
    }

    // ── Server-side wallet signature verification (ed25519) ──────────
    const solWallet = (wallets && wallets.solana) || wallet || '';
    if (!solWallet) {
      return res.status(400).json({ error: 'wallet (Solana address) is required' });
    }
    if (!signature || !signedMessage) {
      return res.status(400).json({ error: 'signature and signedMessage are required to prove wallet ownership' });
    }
    try {
      const pubkeyBytes = bs58.decode(solWallet);
      if (pubkeyBytes.length !== 32) throw new Error('invalid pubkey length');
      // Signature can be base58 or base64
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
        d.prepare("INSERT OR REPLACE INTO satp_trust_scores (agent_id, overall_score, level, score_breakdown, last_computed) VALUES (?, ?, ?, ?, datetime('now'))").run(id, overallScore, level, breakdown);
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
          headers: { 'Content-Type': 'application/json', 'X-HQ-Key': 'HQ_API_KEY_REDACTED' },
          timeout: 3000,
        });
        notifReq.on('error', () => {}); // fire-and-forget
        notifReq.write(notifData);
        notifReq.end();
      } catch (_) {} // Never fail registration due to notification

      res.status(201).json({
        id,
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
    if (!satpV3) return res.json({ error: 'SATP V3 SDK not available', genesis: null });
    try {
      const rawId = req.params.id;
      // Try the raw ID first (e.g. "brainKID")
      let record = await satpV3.client.getGenesisRecord(rawId);
      if (!record) {
        // If DB-style ID (e.g. "agent_brainkid"), look up the profile name and try that
        const d = getDb();
        const row = d.prepare('SELECT name FROM profiles WHERE id = ?').get(rawId);
        if (row && row.name && row.name !== rawId) {
          record = await satpV3.client.getGenesisRecord(row.name);
        }
        // Also try stripping "agent_" prefix and capitalizing
        if (!record && rawId.startsWith('agent_')) {
          const stripped = rawId.replace('agent_', '');
          record = await satpV3.client.getGenesisRecord(stripped);
        }
      }
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
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status || 'active';

    const total = d.prepare('SELECT COUNT(*) as c FROM profiles WHERE status = ? AND (hidden = 0 OR hidden IS NULL)').get(status).c;
    let rows;
    try {
      rows = d.prepare(`
        SELECT p.*, COALESCE(t.overall_score, 0) AS _trust_score
        FROM profiles p
        LEFT JOIN satp_trust_scores t ON t.agent_id = p.id
        WHERE p.status = ? AND (p.hidden = 0 OR p.hidden IS NULL)
        ORDER BY _trust_score DESC, p.created_at DESC

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
      // P1: Determine claimed status (has at least one verified platform)
      let claimed = false;
      try {
        const vd = typeof rest.verification_data === 'string' ? JSON.parse(rest.verification_data || '{}') : (rest.verification_data || {});
        claimed = Object.values(vd).some(v => v && v.verified === true);
      } catch (_) {}
      const { _trust_score: ts, ...cleanRest } = rest;
      return { ...cleanRest, avatar: resolvedAvatar, capabilities: parseJsonField(cleanRest.capabilities), tags: parseJsonField(cleanRest.tags), links: parseJsonField(cleanRest.links), wallets: parseJsonField(cleanRest.wallets), skills: parseJsonField(cleanRest.skills), verification_data: parseJsonField(cleanRest.verification_data), portfolio: parseJsonField(cleanRest.portfolio), endorsements_given: parseJsonField(cleanRest.endorsements_given), custom_badges: parseJsonField(cleanRest.custom_badges), metadata: parseJsonField(cleanRest.metadata), nft_avatar: parseJsonField(cleanRest.nft_avatar), trust_score: ts || 0, claimed };
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
            if (v3.reputationScore > p.trust_score) {
              p.trust_score = v3.reputationScore;
            }
          }
        }
        // DB enrichment fallback for agents with chain defaults (level=0)
        const levelMap = { 'NEW': 0, 'UNVERIFIED': 0, 'REGISTERED': 1, 'BASIC': 2, 'VERIFIED': 2, 'ESTABLISHED': 3, 'TRUSTED': 4, 'SOVEREIGN': 5 };
        for (const p of profiles) {
          if (!p.v3 || !p.v3.level) {
            try {
              const d = getDb();
              let row = d.prepare('SELECT verification FROM profiles WHERE id = ?').get(p.id);
              if (row && row.verification) {
                const vData = typeof row.verification === 'string' ? JSON.parse(row.verification) : row.verification;
                // level can be a string label ("SOVEREIGN") or number
                const numLevel = typeof vData.level === 'number' ? vData.level : (levelMap[(vData.level || '').toUpperCase()] ?? 0);
                const numScore = vData.score || vData.reputationScore || 0;
                if (numLevel > 0 || numScore > 0) {
                  const labels = ['Unverified','Registered','Verified','Established','Trusted','Sovereign'];
                  p.v3 = {
                    level: numLevel,
                    score: numScore,
                    reputationScore: numScore,
                    reputationPct: (numScore / 100).toFixed(2),
                    verificationLevel: numLevel,
                    verificationLabel: labels[numLevel] || 'Unknown',
                    isBorn: vData.isBorn || false,
                  };
                  if (numScore > (p.trust_score || 0)) {
                    p.trust_score = numScore;
                  }
                }
              }
            } catch (_) {}
          }
        }
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
          if (ccScore && ccScore.reputationScore > (p.trust_score || 0)) {
            p.trust_score = ccScore.reputationScore;
            p.chain_cache_score = ccScore;
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
          // Chain-cache score is authoritative
          if (ccScore.reputationScore && ccScore.reputationScore > (p.trust_score || 0)) {
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

    const paginatedProfiles = profiles.slice(offset, offset + limit);
    res.json({ profiles: paginatedProfiles, total, page, limit, pages: Math.ceil(total / limit) });
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
    // Warm V3 cache for this profile
    if (v3ScoreService) {
      try { await v3ScoreService.getV3Scores([req.params.id]); } catch {}
    }
    // Merge V3 on-chain Genesis Record
      const enriched = enrichProfile(safe);
      if (satpV3 && enriched) {
        try {
          const genesis = await satpV3.client.getGenesisRecord(req.params.id);
          enriched.onchain = genesis;
          if (genesis) {
            enriched.trust_score = { 
              source: 'satp_v3_onchain',
              reputationScore: genesis.reputationScore,
              reputationPct: genesis.reputationPct,
              verificationLevel: genesis.verificationLevel,
              verificationLabel: genesis.verificationLabel,
              isBorn: genesis.isBorn,
              pda: genesis.pda,
            };
          } else {
            enriched.trust_score = { source: 'none', message: 'No SATP V3 Genesis Record' };
          }
        } catch (e) {
          enriched.onchain = null;
          enriched.trust_score = { source: 'error', message: e.message };
        }
      }
      // P0 FIX: Add levelName — DB-enriched when chain shows defaults
      if (enriched) {
        const levelLabels = ['Unverified','Registered','Verified','Established','Trusted','Sovereign'];
        const v = enriched.v3 || {};
        const ts = enriched.trust_score || {};
        let level = v.verificationLevel || v.level || ts.verificationLevel || 0;
        let score = v.reputationScore || v.score || ts.reputationScore || enriched.trust_score_num || 0;
        let label = v.verificationLabel || ts.verificationLabel || '';
        
        // If chain data shows defaults (level=0 or score=500000), use DB verification data
        if (level === 0 || score === 500000) {
          try {
            const vd = typeof row.verification === 'string' ? JSON.parse(row.verification || '{}') : (row.verification || {});
            const dbLevelMap = { SOVEREIGN: 5, TRUSTED: 4, ESTABLISHED: 3, VERIFIED: 2, REGISTERED: 1, NEW: 0 };
            if (vd.level && typeof vd.level === 'string' && dbLevelMap[vd.level.toUpperCase()] !== undefined) {
              level = dbLevelMap[vd.level.toUpperCase()];
              label = levelLabels[level] || label;
            } else if (vd.level && typeof vd.level === 'number' && vd.level > 0) {
              level = vd.level;
              label = levelLabels[level] || label;
            }
            if (vd.score && typeof vd.score === 'number' && vd.score < 10000) {
              score = vd.score;
            }
          } catch {}
        }
        
        enriched.level = level;
        enriched.score = score;
        enriched.levelName = label || levelLabels[level] || 'Unknown';
        enriched.verificationLevel = level;
        
        // Also enrich trust_score for frontend consumption
        if (enriched.trust_score && (enriched.trust_score.verificationLevel === 0 || enriched.trust_score.reputationScore === 500000)) {
          enriched.trust_score.verificationLevel = level;
          enriched.trust_score.verificationLabel = label || levelLabels[level];
          enriched.trust_score.reputationScore = score;
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

  // ── POST /api/profile/:id/reviews ──────────────────────────────
  app.post('/api/profile/:id/reviews', (req, res) => {
    const { reviewer_id, reviewer_name, rating, title, comment, job_id } = req.body;
    if (!reviewer_id || !rating) return res.status(400).json({ error: 'reviewer_id and rating (1-5) are required' });
    const r = parseInt(rating);
    if (r < 1 || r > 5) return res.status(400).json({ error: 'rating must be 1-5' });

    const d = getDb();
    const profile = d.prepare('SELECT id FROM profiles WHERE id = ?').get(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    if (reviewer_id === req.params.id) return res.status(400).json({ error: 'Cannot self-review' });

    const id = genId('rev');
    d.prepare(`
      INSERT INTO reviews (id, profile_id, reviewer_id, reviewer_name, rating, title, comment, job_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.params.id, reviewer_id, reviewer_name || '', r, title || '', comment || '', job_id || '');
    addActivity(req.params.id, 'review', { reviewer_id, reviewer_name, rating: r, title });

      // Fire-and-forget: send welcome email if agent provided an email
      if (resolvedEmail) {
        sendWelcomeEmail(resolvedEmail, { id, name: name.trim(), handle: h });
      }
    res.status(201).json({ id, rating: r, title: title || '', comment: comment || '', reviewer_id, reviewer_name: reviewer_name || '', job_id: job_id || '', message: 'Review added' });
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
      const profiles = db.prepare('SELECT id, name, verification_data, wallets FROM profiles').all();
      for (const p of profiles) {
        try {
          const vd = JSON.parse(p.verification_data || '{}');
          if (vd.solana && vd.solana.address === wallet && vd.solana.verified) {
            return res.json({ id: p.id, name: p.name });
          }
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

module.exports = { registerRoutes, getDb, addVerification, addActivity };
