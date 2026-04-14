/**
 * Chain Cache — On-Chain First Data Layer
 * Rebuilds from Solana every 30-60 seconds
 * 
 * Data sources:
 * 1. SATP Identity Program (97yL33) — getProgramAccounts for all identities
 * 2. Memo Attestations — scan recent VERIFY| memos from platform signer
 * 3. Genesis Records (GTppU4) — V3 scores, verification levels
 * 4. Token-2022 NFTs — Soulbound BoA NFTs
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const crypto = require('crypto');
const {
  SatpV3Client,
  deriveGenesisPda,
  agentIdHash: sdkAgentIdHash,
  deserializeGenesis,
  deserializeAttestation,
  trustTier,
  verificationLabel: sdkVerificationLabel,
  reputationPct,
  isBorn: sdkIsBorn,
  PROGRAM_IDS: V3_PROGRAM_IDS,
} = require('@brainai/satp-v3');

// Program IDs
const SATP_IDENTITY_PROGRAM = new PublicKey('97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq');
const GENESIS_PROGRAM = new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');
const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const REFRESH_INTERVAL_MS = 600_000; // 10 minutes (reduced RPC pressure)
const PLATFORM_SIGNER = process.env.SATP_PLATFORM_SIGNER || null;

let _connection = null;
function getConnection() {
  if (!_connection) _connection = new Connection(RPC_URL, 'confirmed');
  return _connection;
}

// ============ CACHE STATE ============

const cache = {
  // wallet -> { pda, verified, dataLen, authority }
  identities: new Map(),
  
  // profileId -> [{ platform, txSignature, memo, timestamp }]
  attestations: new Map(),
  
  // agentId -> { verificationLevel, reputationScore, ... }
  genesisRecords: new Map(),
  
  // wallet -> { mint, metadata }
  nfts: new Map(),
  
  // agentName (lowercase) -> wallet address (for name-based fallback lookup)
  nameMap: new Map(),
  
  lastRefresh: 0,
  refreshCount: 0,
  errors: [],
  isRefreshing: false,
};

// Track known TX signatures to avoid re-fetching on each refresh cycle
const _knownSigs = new Set();
let _lastScannedSig = null;
const _attestationTxHints = new Map();

async function resolveAttestationTxHint(conn, pda, createdAtUnix) {
  const pdaKey = pda?.toBase58 ? pda.toBase58() : String(pda || '').trim();
  if (!pdaKey) return { txSignature: null, solscanUrl: null };
  if (_attestationTxHints.has(pdaKey)) return _attestationTxHints.get(pdaKey);

  let before = null;
  let best = null;
  const target = Number(createdAtUnix) || 0;

  try {
    for (let page = 0; page < 10; page++) {
      const sigs = await conn.getSignaturesForAddress(new PublicKey(pdaKey), {
        limit: 25,
        ...(before ? { before } : {}),
      });
      if (!Array.isArray(sigs) || sigs.length === 0) break;

      for (const sig of sigs) {
        if (!sig?.signature || !sig.blockTime || sig.err) continue;
        const delta = target > 0 ? Math.abs(sig.blockTime - target) : Number.MAX_SAFE_INTEGER;
        if (!best || delta < best.delta) {
          best = {
            txSignature: sig.signature,
            solscanUrl: `https://solana.fm/tx/${sig.signature}`,
            blockTime: sig.blockTime,
            delta,
          };
          if (delta === 0) break;
        }
      }

      if (best?.delta === 0) break;
      const oldest = sigs[sigs.length - 1];
      if (!oldest?.signature) break;
      if (target > 0 && oldest.blockTime && oldest.blockTime <= target) break;
      before = oldest.signature;
    }
  } catch (_) {}

  const hint = best
    ? { txSignature: best.txSignature, solscanUrl: best.solscanUrl }
    : { txSignature: null, solscanUrl: null };
  _attestationTxHints.set(pdaKey, hint);
  return hint;
}

// ============ REFRESH FROM CHAIN ============

/**
 * Full cache refresh from on-chain data
 */
async function refreshFromChain() {
  if (cache.isRefreshing) {
    console.log('[ChainCache] Refresh already in progress, skipping');
    return;
  }
  
  cache.isRefreshing = true;
  const startTime = Date.now();
  cache.errors = [];
  
  try {
    // Run fetches in parallel
    const results = await Promise.allSettled([
      refreshIdentities(),
      refreshAttestationsFromProgramOnly(),
    ]);
    
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const source = ['identities', 'attestations'][i];
        cache.errors.push({ source, error: r.reason?.message || 'unknown' });
        console.error(`[ChainCache] ${source} refresh failed:`, r.reason?.message);
      }
    });
    
    cache.lastRefresh = Date.now();
    cache.refreshCount++;
    
    const elapsed = Date.now() - startTime;
    console.log(`[ChainCache] Refresh #${cache.refreshCount} complete in ${elapsed}ms: ${cache.identities.size} identities, ${cache.attestations.size} profiles with attestations`);
  } catch (e) {
    console.error('[ChainCache] Refresh failed:', e.message);
    cache.errors.push({ source: 'global', error: e.message });
  } finally {
    cache.isRefreshing = false;
  }
}

/**
 * Fetch all SATP identity accounts via getProgramAccounts
 */
async function refreshIdentities() {
  const conn = getConnection();
  
  // Fetch all accounts from the SATP Identity program (no size filter — V2 accounts vary)
  const allAccounts = await conn.getProgramAccounts(SATP_IDENTITY_PROGRAM, {
    encoding: 'base64',
  });
  
  const newIdentities = new Map();
  const newNameMap = new Map();
  
  for (const { pubkey, account } of allAccounts) {
    try {
      // Extract authority (wallet) from account data
      // V2 identity layout: 8-byte discriminator + 32-byte authority
      const data = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64');
      if (data.length >= 40) {
        const authority = new PublicKey(data.slice(8, 40)).toBase58();
        // Try to extract agent name from account data (after authority)
        let agentName = null;
        try {
          if (data.length > 44) {
            const nameLen = data.readUInt32LE(40);
            if (nameLen > 0 && nameLen < 200 && data.length >= 44 + nameLen) {
              agentName = data.toString('utf8', 44, 44 + nameLen).replace(/\0/g, '').trim();
            }
          }
        } catch (e) {}
        newIdentities.set(authority, {
          pda: pubkey.toBase58(),
          verified: true,
          dataLen: data.length,
          lamports: account.lamports,
          name: agentName || null,
        });
        if (agentName) {
          newNameMap.set(agentName.toLowerCase(), authority);
        }
      }
    } catch (e) {
      // Skip unparseable accounts
    }
  }
  
  // Atomic swap
  cache.identities = newIdentities;
  cache.nameMap = newNameMap;
  return newIdentities.size;
}

/**
 * Scan Solana for NEW attestation Memo TXs from platform signer.
 * OPTIMIZED: Only fetches TXs newer than last scan. Skips already-known signatures.
 * Seeds known sigs from DB on first run to avoid redundant RPC calls.
 * Typical steady-state: 0 RPC getTransaction calls (all sigs already known).
 */
async function refreshAttestationsFromChain() {
  try {
    const conn = getConnection();
    const keypairPath = process.env.SATP_PLATFORM_KEYPAIR || '/home/ubuntu/.config/solana/brainforge-personal.json';
    const raw = JSON.parse(require('fs').readFileSync(keypairPath, 'utf-8'));
    const { Keypair } = require('@solana/web3.js');
    const kp = Keypair.fromSecretKey(Uint8Array.from(raw));
    const signerPubkey = kp.publicKey;

    // Seed _knownSigs from DB on first run (avoid re-scanning known TXs)
    if (_knownSigs.size === 0) {
      try {
        const Database = require('better-sqlite3');
        const db = new Database('/home/ubuntu/agentfolio/data/agentfolio.db', { readonly: true });
        const rows = db.prepare('SELECT tx_signature FROM attestations').all();
        rows.forEach(r => _knownSigs.add(r.tx_signature));
        db.close();
        console.log(`[ChainCache] Seeded ${_knownSigs.size} known TX signatures from DB`);
      } catch (e) {
        console.warn('[ChainCache] Could not seed known sigs from DB:', e.message);
      }
    }

    // Fetch signatures — only NEW ones since last scan
    const fetchOpts = { limit: 100 };
    if (_lastScannedSig) {
      fetchOpts.until = _lastScannedSig;
    }
    
    const sigs = await conn.getSignaturesForAddress(signerPubkey, fetchOpts);
    if (!sigs || sigs.length === 0) {
      console.log('[ChainCache] No new signatures since last scan');
      return 0;
    }

    // Remember the newest signature for next scan
    if (sigs.length > 0) _lastScannedSig = sigs[0].signature;

    // Filter out already-known signatures and failed TXs
    const newSigs = sigs.filter(s => !_knownSigs.has(s.signature) && !s.err);
    
    // Mark all scanned sigs as known (including non-memo TXs)
    sigs.forEach(s => _knownSigs.add(s.signature));
    
    if (newSigs.length === 0) {
      console.log(`[ChainCache] Scanned ${sigs.length} sigs, all already known — 0 RPC TX fetches needed`);
      return 0;
    }

    console.log(`[ChainCache] ${newSigs.length} new TXs to fetch (${sigs.length - newSigs.length} already known)`);

    const Database = require('better-sqlite3');
    const dbPath = '/home/ubuntu/agentfolio/data/agentfolio.db';
    const db = new Database(dbPath);
    
    db.exec(`CREATE TABLE IF NOT EXISTS attestations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      tx_signature TEXT NOT NULL,
      memo TEXT NOT NULL,
      proof_hash TEXT NOT NULL,
      signer TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(profile_id, platform)
    )`);

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO attestations (profile_id, platform, tx_signature, memo, proof_hash, signer, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    let discovered = 0;
    const newAttestations = new Map();
    const MEMO_PREFIX = 'VERIFY|';

    // Fetch only NEW TXs with 100ms throttling between calls
    for (const sigInfo of newSigs) {
      try {
        const tx = await conn.getTransaction(sigInfo.signature, { 
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed'
        });
        
        if (!tx || !tx.meta || !tx.meta.logMessages) continue;
        
        let memoContent = null;
        for (const log of tx.meta.logMessages) {
          if (log.includes(MEMO_PREFIX)) {
            const match = log.match(/VERIFY\|([^|]+)\|([^|]+)\|([^|]+)\|([^|\s"]+)/);
            if (match) {
              memoContent = { agentId: match[1], platform: match[2], timestamp: match[3], proofHash: match[4] };
              break;
            }
          }
        }
        
        if (!memoContent) continue;
        
        const { agentId, platform, timestamp, proofHash } = memoContent;
        const fullMemo = `VERIFY|${agentId}|${platform}|${timestamp}|${proofHash}`;
        const txTime = sigInfo.blockTime ? new Date(sigInfo.blockTime * 1000).toISOString() : new Date().toISOString();
        
        try {
          insertStmt.run(agentId, platform, sigInfo.signature, fullMemo, proofHash, signerPubkey.toBase58(), txTime);
        } catch (dbErr) {}
        
        if (!newAttestations.has(agentId)) newAttestations.set(agentId, []);
        newAttestations.get(agentId).push({
          platform, txSignature: sigInfo.signature, memo: fullMemo, 
          proofHash, signer: signerPubkey.toBase58(), timestamp: txTime,
          solscanUrl: `https://solscan.io/tx/${sigInfo.signature}`,
        });
        discovered++;
        
        // Throttle: 100ms between TX fetches to avoid 429 bursts
        await new Promise(r => setTimeout(r, 100));
      } catch (txErr) {
        // Skip individual TX fetch errors
      }
    }
    
    // Merge with existing cache
    for (const [profileId, atts] of newAttestations) {
      const existing = cache.attestations.get(profileId) || [];
      const existingSigs = new Set(existing.map(a => a.txSignature));
      const newOnes = atts.filter(a => !existingSigs.has(a.txSignature));
      cache.attestations.set(profileId, [...existing, ...newOnes]);
    }
    
    db.close();
    console.log(`[ChainCache] Fetched ${newSigs.length} new TXs, discovered ${discovered} attestation memos`);
    return discovered;
  } catch (e) {
    console.warn('[ChainCache] On-chain attestation scan failed:', e.message);
    return 0;
  }
}

function normalizeAttestationPlatform(attestationType) {
  if (!attestationType) return null;
  return String(attestationType).trim().toLowerCase();
}

function upsertAttestation(map, profileId, entry) {
  if (!profileId || !entry?.platform) return;
  if (!map.has(profileId)) map.set(profileId, []);
  const list = map.get(profileId);
  const entryKey = entry.pda || entry.txSignature || entry.proofHash || `${entry.platform}:${entry.timestamp || ''}:${entry.memo || ''}`;
  const idx = list.findIndex(item => (item.pda || item.txSignature || item.proofHash || `${item.platform}:${item.timestamp || ''}:${item.memo || ''}`) === entryKey);
  if (idx >= 0) list[idx] = { ...list[idx], ...entry };
  else list.push(entry);
}

async function refreshAttestationsFromProgramOnly() {
  const newAttestations = new Map();
  const discovered = await mergeProgramAttestationsIntoMap(newAttestations);
  cache.attestations = newAttestations;
  console.log(`[ChainCache] Using attestation-program only source, ${newAttestations.size} profiles with attestations`);
  return discovered;
}

async function mergeProgramAttestationsIntoMap(newAttestations) {
  try {
    const conn = getConnection();
    const programAccounts = await conn.getProgramAccounts(V3_PROGRAM_IDS.attestations);
    let discovered = 0;
    for (const { pubkey, account } of programAccounts) {
      try {
        const parsed = deserializeAttestation(account.data);
        if (!parsed?.agentId) continue;
        let parsedProof = {};
        try { parsedProof = typeof parsed.proofData === 'string' ? JSON.parse(parsed.proofData) : (parsed.proofData || {}); } catch {}
        const platform = normalizeAttestationPlatform(parsed.attestationType);
        if (!platform) continue;
        const createdAtUnix = parsed.createdAt ? Number(parsed.createdAt) : null;
        const recoveredHint = await resolveAttestationTxHint(conn, pubkey, createdAtUnix);
        upsertAttestation(newAttestations, parsed.agentId, {
          platform,
          txSignature: recoveredHint.txSignature || parsedProof.txSignature || parsedProof.transactionSignature || parsedProof.signature || null,
          memo: `ATTESTATION|${parsed.attestationType}`,
          proofHash: null,
          proofData: parsed.proofData || JSON.stringify(parsedProof || {}),
          signer: parsed.issuer || null,
          verifiedAt: createdAtUnix ? new Date(createdAtUnix * 1000).toISOString() : null,
          timestamp: createdAtUnix ? new Date(createdAtUnix * 1000).toISOString() : new Date().toISOString(),
          solscanUrl: recoveredHint.solscanUrl || `https://solscan.io/account/${pubkey.toBase58()}`,
          pda: pubkey.toBase58(),
          source: 'attestation-program',
        });
        discovered += 1;
      } catch (_) {}
    }
    console.log(`[ChainCache] Loaded ${discovered} attestation-program accounts`);
    return discovered;
  } catch (e) {
    console.warn('[ChainCache] Program attestation read failed:', e.message);
    return 0;
  }
}

/**
* Read attestations from the existing DB table (memo-attestation.js writes here)
 * This is faster and more reliable than scanning TXs on-chain
 */
async function refreshAttestationsFromDB() {
  try {
    const path = require('path');
    const Database = require('better-sqlite3');
    const dbPath = '/home/ubuntu/agentfolio/data/agentfolio.db';
    const db = new Database(dbPath, { readonly: true });
    
    const rows = db.prepare('SELECT * FROM attestations ORDER BY created_at DESC').all();
    
    const newAttestations = new Map();
    for (const row of rows) {
      upsertAttestation(newAttestations, row.profile_id, {
        platform: normalizeAttestationPlatform(row.platform) || row.platform,
        txSignature: row.tx_signature,
        memo: row.memo,
        proofHash: row.proof_hash,
        signer: row.signer,
        timestamp: row.created_at,
        solscanUrl: `https://solscan.io/tx/${row.tx_signature}`,
      });
    }
    
    await mergeProgramAttestationsIntoMap(newAttestations);
    cache.attestations = newAttestations;
    db.close();
    return newAttestations.size;
  } catch (e) {
    console.warn('[ChainCache] Attestations DB read failed:', e.message);
    return 0;
  }
}

// ============ PUBLIC GETTERS ============

/**
 * Get agent identity by wallet address
 * @param {string} wallet - Solana wallet address
 * @returns {{ verified: boolean, pda: string, dataLen: number } | null}
 */
function getAgent(wallet) {
  return cache.identities.get(wallet) || null;
}

/**
 * Get all on-chain identities
 * @returns {Map} wallet -> identity data
 */
function getAllIdentities() {
  return cache.identities;
}

/**
 * Check if wallet is verified on-chain
 * @param {string} wallet
 * @returns {boolean}
 */
function isVerified(wallet) {
  return cache.identities.has(wallet);
}

/**
 * Get verification attestations for a profile
 * @param {string} profileId
 * @returns {Array} attestation records
 */
function getVerifications(profileId, createdAfter) {
  const allAtts = cache.attestations.get(profileId) || [];
  // CEO Apr 11 rule: trust the chain, do not filter attestation reads by date.
  return allAtts;
}

/**
 * Get verified platforms for a profile (from attestation TXs)
 * @param {string} profileId
 * @returns {string[]} e.g. ['solana', 'github', 'x']
 */
function getVerifiedPlatforms(profileId, createdAfter) {
  return getVerifications(profileId, createdAfter).map(a => a.platform);
}

/**
 * Get cache stats
 */
function getStats() {
  return {
    identities: cache.identities.size,
    attestedProfiles: cache.attestations.size,
    lastRefresh: cache.lastRefresh,
    refreshCount: cache.refreshCount,
    ageMs: Date.now() - cache.lastRefresh,
    isRefreshing: cache.isRefreshing,
    errors: cache.errors,
  };
}

/**
 * Get trust score for a profile (from Genesis Records or attestation count)
 * @param {string} profileId
 * @returns {{ reputationScore: number, verificationLevel: number } | null}
 */
function getScore(profileId) {
  // Check genesis records cache (override — team agents with manual scores)
  const genesis = cache.genesisRecords.get(profileId);
  if (genesis) return genesis;
  
  // COMPUTE from attestation data when no Genesis Record exists
  const attestations = cache.attestations.get(profileId) || [];
  const platforms = new Set(attestations.map(a => a.platform));
  
  // Check if agent has SATP identity (by name match)
  let hasIdentity = false;
  const cleanId = profileId.replace('agent_', '').toLowerCase();
  for (const [wallet, data] of cache.identities) {
    if (data.name && data.name.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanId.replace(/[^a-z0-9]/g, '')) {
      hasIdentity = true;
      break;
    }
  }
  
  if (!hasIdentity && platforms.size === 0) return null;
  
  // Compute verification level (L0-L5 from spec)
  let level = 0;
  if (hasIdentity) level = 1;  // L1: SATP registered
  if (platforms.size >= 2) level = 2;  // L2: 2+ verifications
  if (platforms.size >= 5) level = 3;  // L3: 5+ verifications (simplified — full spec checks categories)
  
  // Compute trust score (from scoring-v2 spec)
  let score = 0;
  if (hasIdentity) score += 10;       // SATP genesis = +10
  score += platforms.size * 25;        // Each attestation = +25
  
  return {
    reputationScore: score,
    verificationLevel: level,
    source: 'computed'
  };
}

/**
 * Get all agents (identities) — used by stats endpoint
 * @returns {Map} wallet -> { pda, agentId, verified, ... }
 */
function getAgentByName(name) {
  if (!name) return null;
  const wallet = cache.nameMap.get(name.toLowerCase());
  if (!wallet) return null;
  return { wallet, ...cache.identities.get(wallet) };
}

function getAllAgents() {
  // Return identities map with agentId added where we can derive it
  const result = new Map();
  for (const [wallet, data] of cache.identities) {
    result.set(wallet, { ...data, agentId: data.agentId || wallet.slice(0, 8) });
  }
  return result;
}

/**
 * Find wallet by PDA (reverse lookup)
 * @param {string} pda
 * @returns {string|null} wallet address
 */
function findWalletByPDA(pda) {
  for (const [wallet, data] of cache.identities) {
    if (data.pda === pda) return wallet;
  }
  return null;
}

/**
 * Match on-chain identity to a profile by wallet
 * @param {string} wallet
 * @param {Function} profileLookup - function that takes wallet and returns profile
 * @returns {{ wallet, identity, profileId } | null}
 */
function matchIdentityToProfile(wallet, profileLookup) {
  const identity = cache.identities.get(wallet);
  if (!identity) return null;
  
  const profile = profileLookup(wallet);
  return profile ? { wallet, identity, profileId: profile.id } : null;
}

// ============ LIFECYCLE ============

let _interval = null;

/**
 * Start the cache refresh loop
 * @param {number} [intervalMs] - Optional refresh interval override
 */
function start(intervalMs) {
  if (_interval) {
    console.warn('[ChainCache] Already running');
    return;
  }
  
  const interval = intervalMs || REFRESH_INTERVAL_MS;
  console.log(`[ChainCache] Starting (refresh every ${interval / 1000}s)`);
  
  // Initial refresh
  refreshFromChain().catch(e => console.error('[ChainCache] Initial refresh error:', e.message));
  
  // Periodic refresh
  _interval = setInterval(() => {
    refreshFromChain().catch(e => console.error('[ChainCache] Periodic refresh error:', e.message));
  }, interval);
}

/**
 * Stop the cache refresh loop
 */
function stop() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    console.log('[ChainCache] Stopped');
  }
}

/**
 * Force immediate refresh
 */
async function forceRefresh() {
  await refreshFromChain();
}


// ═══════════════════════════════════════════════════════════
// V3 Genesis Record On-Chain Scores (source of truth)
// Uses @brainai/satp-v3 SDK — no more manual Borsh parsing
// ═══════════════════════════════════════════════════════════

// Re-export SDK functions under legacy names for any callers
function agentIdHash(agentId) {
  return sdkAgentIdHash(agentId);
}

function getGenesisPDA(agentId) {
  return deriveGenesisPda(agentId);
}

function parseGenesisRecord(data, pda) {
  if (!data || data.length < 8) return null;
  try {
    const record = deserializeGenesis(Buffer.isBuffer(data) ? data : Buffer.from(data));
    return {
      pda: pda.toBase58(),
      faceImage: record.faceImage || '',
      agentName: record.agentName || '',
      verificationLevel: record.verificationLevel,
      reputationScore: record.reputationScore,
      reputationPct: record.reputationScore / 10000,
      isBorn: sdkIsBorn(record),
      source: 'v3-genesis',
    };
  } catch (e) {
    console.error('[ChainCache V3] SDK deserializeGenesis failed:', e.message);
    return null;
  }
}

let _v3CacheTime = 0;
const V3_CACHE_TTL = 5 * 60 * 1000; // 5 min
let _v3Loading = false;

/**
 * Batch-fetch V3 Genesis Records for all known profile IDs.
 * Populates cache.genesisRecords.
 */
async function fetchV3GenesisRecords(profileIds) {
  const now = Date.now();
  if (_v3CacheTime && now - _v3CacheTime < V3_CACHE_TTL && cache.genesisRecords.size > 0) return;
  if (_v3Loading) return;
  _v3Loading = true;

  try {
    const connection = getConnection();
    const pdaMap = new Map();
    for (const id of profileIds) {
      try {
        const [pda] = getGenesisPDA(id);
        pdaMap.set(pda.toBase58(), { pda, agentId: id });
      } catch {}
    }

    const pdaKeys = Array.from(pdaMap.values()).map(v => v.pda);
    let found = 0;

    // Batch 100 at a time
    for (let i = 0; i < pdaKeys.length; i += 100) {
      const batch = pdaKeys.slice(i, i + 100);
      try {
        const accounts = await connection.getMultipleAccountsInfo(batch);
        for (let j = 0; j < batch.length; j++) {
          const acct = accounts[j];
          const pdaStr = batch[j].toBase58();
          const { agentId } = pdaMap.get(pdaStr);
          if (acct && acct.data) {
            const parsed = parseGenesisRecord(Buffer.from(acct.data), batch[j]);
            if (parsed) {
              cache.genesisRecords.set(agentId, parsed);
              found++;
            }
          }
        }
      } catch (e) {
        console.error('[ChainCache V3] Batch fetch error:', e.message);
      }
    }

    _v3CacheTime = now;
    console.log('[ChainCache V3] Fetched', found, 'genesis records from', profileIds.length, 'profiles');
  } catch (e) {
    console.error('[ChainCache V3] Fatal:', e.message);
  } finally {
    _v3Loading = false;
  }
}


module.exports = {
  fetchV3GenesisRecords,
  refreshAttestationsFromChain,
  // Lifecycle
  start,
  stop,
  forceRefresh,
  
  // Getters
  getAgent,
  getAgentByName,
  getAllIdentities,
  getAllAgents,
  isVerified,
  getVerifications,
  getVerifiedPlatforms,
  getScore,
  getStats,
  findWalletByPDA,
  matchIdentityToProfile,
};
