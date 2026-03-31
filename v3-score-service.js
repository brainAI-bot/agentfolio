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
const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
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
  
  // Try with isActive first, then without (layout detection)
  const result = _parseWithLayout(data, true);
  if (result && result._valid) return result;
  const result2 = _parseWithLayout(data, false);
  if (result2 && result2._valid) return result2;
  return result || result2; // return best effort
}

function _parseWithLayout(data, hasIsActive) {
  try {
    let offset = 8; // skip discriminator
    const agentIdHashBytes = data.slice(offset, offset + 32);
    offset += 32;

    const readString = () => {
      if (offset + 4 > data.length) throw new Error('overflow');
      const len = data.readUInt32LE(offset);
      offset += 4;
      if (len > 1000 || offset + len > data.length) throw new Error('bad string len');
      const str = data.slice(offset, offset + len).toString('utf8');
      offset += len;
      return str;
    };
    const readVecString = () => {
      if (offset + 4 > data.length) throw new Error('overflow');
      const count = data.readUInt32LE(offset);
      offset += 4;
      if (count > 50) throw new Error('bad vec count');
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
    
    if (offset + 32 > data.length) throw new Error('overflow before faceMint');
    const faceMint = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    const faceBurnTx = readString();
    
    if (offset + 8 > data.length) throw new Error('overflow before genesisRecord');
    const genesisRecord = Number(data.readBigInt64LE(offset));
    offset += 8;
    
    // isActive: only present in accounts rewritten by admin_rewrite_account
    let isActive = true;
    if (hasIsActive) {
      if (offset >= data.length) throw new Error('overflow at isActive');
      isActive = data[offset] === 1;
      offset += 1;
    }
    
    if (offset + 32 > data.length) throw new Error('overflow before authority');
    const authority = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    // Option<Pubkey> — Borsh: 1 byte tag + 32 bytes only if Some
    if (offset < data.length) {
      const hasPending = data[offset];
      offset += 1;
      if (hasPending === 1 && offset + 32 <= data.length) offset += 32;
    }

    if (offset + 8 > data.length) throw new Error('overflow before reputationScore');
    const reputationScore = Number(data.readBigUInt64LE(offset));
    offset += 8;
    
    if (offset >= data.length) throw new Error('overflow before verificationLevel');
    const verificationLevel = data[offset];
    offset += 1;

    // Validation: scores should be reasonable
    const _valid = verificationLevel <= 5 && reputationScore < 100000000;

    // Timestamps
    let reputationUpdatedAt = 0, verificationUpdatedAt = 0, createdAt = 0, updatedAt = 0;
    if (offset + 8 <= data.length) { reputationUpdatedAt = Number(data.readBigInt64LE(offset)); offset += 8; }
    if (offset + 8 <= data.length) { verificationUpdatedAt = Number(data.readBigInt64LE(offset)); offset += 8; }
    if (offset + 8 <= data.length) { createdAt = Number(data.readBigInt64LE(offset)); offset += 8; }
    if (offset + 8 <= data.length) { updatedAt = Number(data.readBigInt64LE(offset)); offset += 8; }

    return {
      agentName,
      reputationScore,
      reputationPct: (reputationScore / 10000).toFixed(2),
      verificationLevel,
      verificationLabel: ['Unverified','Registered','Verified','Established','Trusted','Sovereign'][verificationLevel] || 'Unknown',
      isBorn: genesisRecord > 0,
      isActive,
      bornAt: genesisRecord > 0 ? new Date(genesisRecord * 1000).toISOString() : null,
      faceImage,
      faceMint: faceMint.toBase58(),
      authority: authority.toBase58(),
      reputationUpdatedAt,
      verificationUpdatedAt,
      createdAt: createdAt > 0 ? new Date(createdAt * 1000).toISOString() : null,
      updatedAt: updatedAt > 0 ? new Date(updatedAt * 1000).toISOString() : null,
      _valid,
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

module.exports = { getV3Scores, getV3Score, clearV3Cache, getGenesisPDA, parseGenesisRecord };
