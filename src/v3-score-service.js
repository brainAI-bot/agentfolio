/**
 * V3 Score Service — Batch-fetches Genesis Records for all agents
 * Caches with 5-min TTL. Uses getMultipleAccounts for efficiency.
 * 
 * Usage:
 *   const { getV3Scores, getV3Score } = require('./v3-score-service');
 *   const allScores = await getV3Scores(['agent_brainforge', 'agent_x', ...]);
 *   const one = await getV3Score('agent_brainforge');
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const crypto = require("crypto");
let sdkDeriveGenesisPda = null;
try { sdkDeriveGenesisPda = require("@brainai/satp-v3").deriveGenesisPda; } catch {}


const PROGRAM_ID = new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');
const GENESIS_SEED = 'genesis';
const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_RETRY_DELAYS_MS = [250, 500, 1000];

let _cache = new Map();
let _cacheTime = 0;
let _connection = null;
let _inflight = new Map();
let sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getConnection() {
  if (!_connection) _connection = new Connection(RPC, 'confirmed');
  return _connection;
}

function agentIdHash(agentId) {
  return crypto.createHash('sha256').update(agentId).digest();
}

function getGenesisPDA(agentId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(GENESIS_SEED), agentIdHash(agentId)],
    PROGRAM_ID
  )[0];
}

function isRateLimitError(error) {
  const message = error?.message || '';
  return /429|rate limit|too many requests/i.test(message);
}

async function fetchMultipleAccountsWithRetry(conn, pdas) {
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await conn.getMultipleAccountsInfo(pdas);
    } catch (error) {
      const retryDelay = RATE_LIMIT_RETRY_DELAYS_MS[attempt];
      if (!isRateLimitError(error) || retryDelay == null) throw error;
      console.warn(`[V3 Score Service] Rate limited, retrying batch in ${retryDelay}ms`);
      await sleep(retryDelay);
    }
  }
  return null;
}

function getFetchKey(agentIds) {
  return [...agentIds].sort().join('|');
}

function parseGenesisRecord(data) {
  if (!data || data.length < 8) return null;
  try {
    let offset = 8; // skip discriminator
    const agentIdHashBytes = data.slice(offset, offset + 32);
    offset += 32;

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
    const faceMint = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    const faceBurnTx = readString();
    const genesisRecord = Number(data.readBigInt64LE(offset));
    offset += 8;
    // NOTE: No isActive field on-chain. Struct goes straight to authority.
    // See brainChain SDK 3.5.0 TypeScript types (GenesisRecord interface).
    const authority = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    // Option<Pubkey> — Borsh: 1 byte tag + 32 bytes only if Some
    const hasPending = data[offset];
    offset += 1;
    if (hasPending === 1) offset += 32;

    const rawReputationScore = Number(data.readBigUInt64LE(offset));
    offset += 8;
    const reputationScore = Math.min(Math.round(rawReputationScore / 10000), 800);
    const verificationLevel = data[offset];
    offset += 1;

    // Timestamps (SDK 3.5.0 struct)
    const reputationUpdatedAt = Number(data.readBigInt64LE(offset)); offset += 8;
    const verificationUpdatedAt = Number(data.readBigInt64LE(offset)); offset += 8;
    const createdAt = Number(data.readBigInt64LE(offset)); offset += 8;
    const updatedAt = Number(data.readBigInt64LE(offset)); offset += 8;
    const bump = data[offset]; offset += 1;

    return {
      agentName,
      reputationScore,
      rawReputationScore,
      reputationPct: (rawReputationScore / 10000).toFixed(2),
      verificationLevel,
      verificationLabel: ['Unverified','Registered','Verified','Established','Trusted','Sovereign'][verificationLevel] || 'Unknown',
      isBorn: genesisRecord > 0,
      bornAt: genesisRecord > 0 ? new Date(genesisRecord * 1000).toISOString() : null,
      faceImage,
      faceMint: faceMint.toBase58(),
      authority: authority.toBase58(),
      reputationUpdatedAt,
      verificationUpdatedAt,
      createdAt: createdAt > 0 ? new Date(createdAt * 1000).toISOString() : null,
      updatedAt: updatedAt > 0 ? new Date(updatedAt * 1000).toISOString() : null,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Batch-fetch V3 scores for multiple agent IDs.
 * Returns Map<agentId, score|null>
 */
async function getV3Scores(agentIds) {
  const now = Date.now();
  const result = new Map();
  const missingIds = [];

  for (const id of agentIds) {
    if (_cache.has(id)) {
      result.set(id, _cache.get(id));
    } else {
      missingIds.push(id);
    }
  }

  const hasCompleteCachedResult = missingIds.length === 0;
  const cacheIsFresh = now - _cacheTime < CACHE_TTL_MS;

  if (hasCompleteCachedResult && cacheIsFresh) return result;

  if (hasCompleteCachedResult && _cache.size > 0) {
    const refreshKey = getFetchKey(agentIds);
    if (!_inflight.has(refreshKey)) {
      _inflight.set(refreshKey, refreshV3Scores(agentIds).finally(() => _inflight.delete(refreshKey)));
    }
    return result;
  }

  const idsToFetch = missingIds.length > 0 ? missingIds : agentIds;
  const fetched = await refreshV3Scores(idsToFetch);
  for (const id of idsToFetch) {
    if (fetched.has(id)) result.set(id, fetched.get(id));
    else if (_cache.has(id)) result.set(id, _cache.get(id));
    else result.set(id, null);
  }
  return result;
}

async function refreshV3Scores(agentIds) {
  const fetchKey = getFetchKey(agentIds);
  if (_inflight.has(fetchKey)) return _inflight.get(fetchKey);

  const fetchPromise = (async () => {
  const conn = getConnection();
  const pdas = agentIds.map(id => getGenesisPDA(id));

  // Batch in groups of 100 (getMultipleAccounts limit)
  const BATCH = 100;
  const result = new Map();
  let hadSuccess = false;

  for (let i = 0; i < pdas.length; i += BATCH) {
    const batchPdas = pdas.slice(i, i + BATCH);
    const batchIds = agentIds.slice(i, i + BATCH);
    try {
      const accounts = await fetchMultipleAccountsWithRetry(conn, batchPdas);
      hadSuccess = true;
      for (let j = 0; j < accounts.length; j++) {
        const parsed = accounts[j] ? parseGenesisRecord(accounts[j].data) : null;
        result.set(batchIds[j], parsed);
        _cache.set(batchIds[j], parsed);
      }
    } catch (e) {
      console.error('[V3 Score Service] Batch fetch failed:', e.message);
      // Preserve stale cache on transient failures, only use null for uncached ids.
      for (const id of batchIds) {
        if (_cache.has(id)) {
          result.set(id, _cache.get(id));
        } else {
          result.set(id, null);
        }
      }
    }
  }

    if (hadSuccess) _cacheTime = Date.now();
    return result;
  })().finally(() => {
    _inflight.delete(fetchKey);
  });

  _inflight.set(fetchKey, fetchPromise);
  return fetchPromise;
}

/**
 * Get V3 score for a single agent ID.
 */
async function getV3Score(agentId) {
  if (_cache.has(agentId) && Date.now() - _cacheTime < CACHE_TTL_MS) {
    return _cache.get(agentId);
  }
  const scores = await getV3Scores([agentId]);
  return scores.get(agentId) || null;
}

/**
 * Clear cache (e.g. after verification update).
 */
function clearV3Cache() {
  _cache.clear();
  _cacheTime = 0;
  _inflight.clear();
}

/**
 * Synchronous cache read — used by enrichProfile to avoid async in sync context.
 * Returns cached V3 data or null if not cached / expired.
 */
function _getFromCache(agentId) {
  if (Date.now() - _cacheTime > CACHE_TTL_MS) return null;
  return _cache.get(agentId) || null;
}

module.exports = {
  getV3Scores,
  getV3Score,
  clearV3Cache,
  getGenesisPDA,
  parseGenesisRecord,
  _getFromCache,
  __test: {
    _cache,
    refreshV3Scores,
    setCacheTime(value) { _cacheTime = value; },
    setSleepForTests(fn) { sleep = fn; },
    reset() {
      _cache.clear();
      _cacheTime = 0;
      _inflight.clear();
      _connection = null;
      sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    },
  },
};
