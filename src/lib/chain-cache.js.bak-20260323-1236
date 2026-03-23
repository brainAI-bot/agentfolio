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

// Program IDs
const SATP_IDENTITY_PROGRAM = new PublicKey('97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq');
const GENESIS_PROGRAM = new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');
const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
const REFRESH_INTERVAL_MS = 45_000; // 45 seconds
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
      refreshAttestationsFromDB().then(() => refreshAttestationsFromChain()), // DB first, then on-chain scan
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
 * Scan Solana for attestation Memo TXs from platform signer.
 * Finds VERIFY|agent_id|platform|timestamp|proof_hash memos on-chain.
 * Writes discovered attestations to DB for fast future lookups.
 */
async function refreshAttestationsFromChain() {
  try {
    const conn = getConnection();
    const keypairPath = process.env.SATP_PLATFORM_KEYPAIR || '/home/ubuntu/.config/solana/brainforge-personal.json';
    const raw = JSON.parse(require('fs').readFileSync(keypairPath, 'utf-8'));
    const { Keypair } = require('@solana/web3.js');
    const kp = Keypair.fromSecretKey(Uint8Array.from(raw));
    const signerPubkey = kp.publicKey;

    // Fetch recent signatures (last 100 TXs from platform signer)
    const sigs = await conn.getSignaturesForAddress(signerPubkey, { limit: 200 });
    if (!sigs || sigs.length === 0) {
      console.log('[ChainCache] No signatures found for platform signer');
      return 0;
    }

    const path = require('path');
    const Database = require('better-sqlite3');
    const dbPath = '/home/ubuntu/agentfolio/data/agentfolio.db';
    const db = new Database(dbPath);
    
    // Ensure table exists
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

    // Batch fetch transactions to find memo content
    // Process in chunks of 20
    for (let i = 0; i < sigs.length; i += 20) {
      const batch = sigs.slice(i, i + 20);
      for (const sigInfo of batch) {
        if (sigInfo.err) continue; // Skip failed TXs
        try {
          const tx = await conn.getTransaction(sigInfo.signature, { 
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed'
          });
          if (!tx || !tx.meta || !tx.meta.logMessages) continue;
          
          // Find memo in log messages
          const memoLog = tx.meta.logMessages.find(l => 
            l.includes('Program log: Memo') || l.includes(MEMO_PREFIX)
          );
          if (!memoLog) continue;
          
          // Extract memo content - could be in different formats
          let memoContent = null;
          for (const log of tx.meta.logMessages) {
            if (log.includes(MEMO_PREFIX)) {
              // Extract the VERIFY|... part
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
          
          // Write to DB
          try {
            insertStmt.run(agentId, platform, sigInfo.signature, fullMemo, proofHash, signerPubkey.toBase58(), txTime);
          } catch (dbErr) {
            // UNIQUE constraint — already exists, that's fine
          }
          
          // Add to in-memory cache
          if (!newAttestations.has(agentId)) newAttestations.set(agentId, []);
          newAttestations.get(agentId).push({
            platform, txSignature: sigInfo.signature, memo: fullMemo, 
            proofHash, signer: signerPubkey.toBase58(), timestamp: txTime,
            solscanUrl: `https://solscan.io/tx/${sigInfo.signature}`,
          });
          discovered++;
        } catch (txErr) {
          // Skip individual TX fetch errors
        }
      }
    }
    
    // Merge with existing cache.attestations
    for (const [profileId, atts] of newAttestations) {
      const existing = cache.attestations.get(profileId) || [];
      const existingSigs = new Set(existing.map(a => a.txSignature));
      const newOnes = atts.filter(a => !existingSigs.has(a.txSignature));
      cache.attestations.set(profileId, [...existing, ...newOnes]);
    }
    
    db.close();
    console.log(`[ChainCache] Scanned ${sigs.length} on-chain TXs, discovered ${discovered} attestation memos`);
    return discovered;
  } catch (e) {
    console.warn('[ChainCache] On-chain attestation scan failed:', e.message);
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
    
    // Security: only trust attestations after hardened system date AND from platform signer
    const HARDENED_DATE = '2026-03-20T00:00:00.000Z'; // Relaxed: signer check is the real security
    // Trust both current and legacy platform signers
    const trustedSigners = new Set([
      PLATFORM_SIGNER,
      'Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc', // deploy wallet
      '4St74qSyzuGyV2TA9gxej9GvXG2TgVSTvp1HEpzJbwcP', // legacy signer
      'JAbcYnKy4p2c5SYV3bHu14VtD6EDDpzj44uGYW8BMud4', // brainforge personal
    ].filter(Boolean));
    const rows = db.prepare('SELECT * FROM attestations WHERE created_at >= ? ORDER BY created_at DESC').all(HARDENED_DATE);
    
    const newAttestations = new Map();
    for (const row of rows) {
      // Signer check: only trust attestations from known platform signers
      if (row.signer && !trustedSigners.has(row.signer)) {
        continue; // Skip attestations from untrusted signers
      }
      if (!newAttestations.has(row.profile_id)) {
        newAttestations.set(row.profile_id, []);
      }
      newAttestations.get(row.profile_id).push({
        platform: row.platform,
        txSignature: row.tx_signature,
        memo: row.memo,
        proofHash: row.proof_hash,
        signer: row.signer,
        timestamp: row.created_at,
        solscanUrl: `https://solscan.io/tx/${row.tx_signature}`,
      });
    }
    
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
function getVerifications(profileId) {
  return cache.attestations.get(profileId) || [];
}

/**
 * Get verified platforms for a profile (from attestation TXs)
 * @param {string} profileId
 * @returns {string[]} e.g. ['solana', 'github', 'x']
 */
function getVerifiedPlatforms(profileId) {
  const atts = cache.attestations.get(profileId) || [];
  return [...new Set(atts.map(a => a.platform))];
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
  // Check genesis records cache
  const genesis = cache.genesisRecords.get(profileId);
  if (genesis) return genesis;
  
  // No attestation fallback — Genesis Record is the only source of truth.
  // CEO directive: If no Genesis Record, score = 0.
  return null;
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
// ═══════════════════════════════════════════════════════════
const IDENTITY_V3 = new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');

function agentIdHash(agentId) {
  return crypto.createHash('sha256').update(agentId).digest();
}

function getGenesisPDA(agentId) {
  const hash = agentIdHash(agentId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('genesis'), hash],
    IDENTITY_V3
  );
}

function parseGenesisRecord(data, pda) {
  if (!data || data.length < 8) return null;
  try {
    let offset = 8; // skip discriminator
    offset += 32; // agent_id_hash

    const readString = () => {
      const len = data.readUInt32LE(offset);
      offset += 4;
      const str = data.slice(offset, offset + len).toString('utf8');
      offset += len;
      return str;
    };
    const readVecString = () => {
      const count = data.readUInt32LE(offset);
      offset += 4;
      const arr = [];
      for (let i = 0; i < count; i++) arr.push(readString());
      return arr;
    };

    const agentName = readString();
    const description = readString();
    const category = readString();
    const capabilities = readVecString();
    const metadataUri = readString();
    const faceImage = readString();
    offset += 32; // faceMint
    const faceBurnTx = readString();
    const genesisRecord = Number(data.readBigInt64LE(offset));
    offset += 8;
    offset += 32; // authority
    const hasPending = data[offset];
    offset += 1;
    if (hasPending === 1) offset += 32;
    const reputationScore = Number(data.readBigUInt64LE(offset));
    offset += 8;
    const verificationLevel = data[offset];
    offset += 1;

    return {
      pda: pda.toBase58(),
      agentName,
      verificationLevel,
      reputationScore,
      reputationPct: reputationScore / 10000,
      isBorn: genesisRecord > 0,
      source: 'v3-genesis',
    };
  } catch (e) {
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
