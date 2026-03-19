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
const crypto = require('crypto');

const PROGRAM_ID = new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');
const GENESIS_SEED = 'genesis';
const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let _cache = new Map();
let _cacheTime = 0;
let _connection = null;

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
    const authority = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    // Option<Pubkey>
    const hasPending = data[offset];
    offset += 1;
    if (hasPending === 1) offset += 32;

    const reputationScore = Number(data.readBigUInt64LE(offset));
    offset += 8;
    const verificationLevel = data[offset];
    offset += 1;

    return {
      agentName,
      reputationScore,
      reputationPct: (reputationScore / 10000).toFixed(2),
      verificationLevel,
      verificationLabel: ['Unverified','Registered','Verified','Established','Trusted','Sovereign'][verificationLevel] || 'Unknown',
      isBorn: genesisRecord > 0,
      bornAt: genesisRecord > 0 ? new Date(genesisRecord * 1000).toISOString() : null,
      faceImage,
      faceMint: faceMint.toBase58(),
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
  // Check cache
  if (Date.now() - _cacheTime < CACHE_TTL_MS && _cache.size > 0) {
    const result = new Map();
    let allCached = true;
    for (const id of agentIds) {
      if (_cache.has(id)) {
        result.set(id, _cache.get(id));
      } else {
        allCached = false;
      }
    }
    if (allCached) return result;
  }

  const conn = getConnection();
  const pdas = agentIds.map(id => getGenesisPDA(id));

  // Batch in groups of 100 (getMultipleAccounts limit)
  const BATCH = 100;
  const result = new Map();

  for (let i = 0; i < pdas.length; i += BATCH) {
    const batchPdas = pdas.slice(i, i + BATCH);
    const batchIds = agentIds.slice(i, i + BATCH);
    try {
      const accounts = await conn.getMultipleAccountsInfo(batchPdas);
      for (let j = 0; j < accounts.length; j++) {
        const parsed = accounts[j] ? parseGenesisRecord(accounts[j].data) : null;
        result.set(batchIds[j], parsed);
        _cache.set(batchIds[j], parsed);
      }
    } catch (e) {
      console.error('[V3 Score Service] Batch fetch failed:', e.message);
      // Set null for failed batch
      for (const id of batchIds) {
        result.set(id, null);
        _cache.set(id, null);
      }
    }
  }

  _cacheTime = Date.now();
  return result;
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
}

// Sync cache accessor for enrichProfile
function _getFromCache(agentId) {
  return _cache.get(agentId) || null;
}

module.exports = { getV3Scores, getV3Score, clearV3Cache, getGenesisPDA, parseGenesisRecord, _getFromCache };