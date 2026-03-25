/**
 * V3 Explorer — reads ALL Genesis Records from V3 on-chain program
 * 
 * Source of truth for the SATP explorer. No DB enrichment.
 * V3 Genesis Records contain authoritative verification levels,
 * reputation scores, face/soulbound NFT data, etc.
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const crypto = require('crypto');
const bs58 = require('bs58').default || require('bs58');

const V3_PROGRAM = new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');
const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 3 * 60 * 1000; // 3 min

const GENESIS_DISC = crypto.createHash('sha256')
  .update('account:GenesisRecord')
  .digest().slice(0, 8);

function parseGenesisRecord(pubkey, data) {
  if (!data || data.length < 100) return null;
  
  // Check discriminator
  if (!data.slice(0, 8).equals(GENESIS_DISC)) return null;
  
  try {
    var offset = 8;
    var agentIdHashBytes = data.slice(offset, offset + 32);
    offset += 32;

    var readString = function() {
      var len = data.readUInt32LE(offset);
      offset += 4;
      var str = data.slice(offset, offset + len).toString('utf8');
      offset += len;
      return str;
    };
    var readVecString = function() {
      var count = data.readUInt32LE(offset);
      offset += 4;
      var arr = [];
      for (var i = 0; i < count; i++) arr.push(readString());
      return arr;
    };

    var agentName = readString();
    var description = readString();
    var category = readString();
    var capabilities = readVecString();
    var metadataUri = readString();
    var faceImage = readString();
    var faceMint = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    var faceBurnTx = readString();
    var genesisTimestamp = Number(data.readBigInt64LE(offset));
    offset += 8;
    var authority = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    // Option<Pubkey>
    var hasPending = data[offset];
    offset += 1;
    if (hasPending === 1) offset += 32;

    var reputationScore = Number(data.readBigUInt64LE(offset));
    offset += 8;
    var verificationLevel = data[offset];
    offset += 1;

    var tierLabels = ['unverified', 'registered', 'verified', 'established', 'trusted', 'sovereign'];
    var tierName = tierLabels[verificationLevel] || 'unverified';

    return {
      pda: pubkey,
      authority: authority.toBase58(),
      agentName: agentName,
      description: description,
      category: category,
      capabilities: capabilities,
      metadataUri: metadataUri,
      faceImage: faceImage || null,
      faceMint: faceMint.toBase58() === '11111111111111111111111111111111' ? null : faceMint.toBase58(),
      faceBurnTx: faceBurnTx || null,
      soulbound: !!faceBurnTx && faceBurnTx.length > 10,
      genesisTimestamp: genesisTimestamp,
      isBorn: genesisTimestamp > 0,
      bornAt: genesisTimestamp > 0 ? new Date(genesisTimestamp * 1000).toISOString() : null,
      reputationScore: reputationScore,
      verificationLevel: verificationLevel,
      tier: tierName,
      tierLabel: 'L' + verificationLevel + ' \u00b7 ' + tierName.charAt(0).toUpperCase() + tierName.slice(1),
    };
  } catch (e) {
    return null;
  }
}

async function fetchAllV3Agents() {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) {
    return _cache;
  }

  var connection = new Connection(RPC, 'confirmed');
  
  // Use memcmp with base58-encoded discriminator to filter Genesis Records
  var discBase58 = bs58.encode(GENESIS_DISC);
  
  var accounts = await connection.getProgramAccounts(V3_PROGRAM, {
    filters: [
      { memcmp: { offset: 0, bytes: discBase58 } },
    ],
  });

  var agents = [];
  for (var i = 0; i < accounts.length; i++) {
    var acct = accounts[i];
    var parsed = parseGenesisRecord(acct.pubkey.toBase58(), acct.account.data);
    if (parsed && parsed.agentName) {
      agents.push(parsed);
    }
  }

  // Filter out smoke test records and deduplicate by name
  // Keep the record with the highest verification level (real data over test)
  var byName = new Map();
  for (var j = 0; j < agents.length; j++) {
    var agent = agents[j];
    // Skip obvious test records
    if (agent.agentName.toLowerCase().startsWith('smoketest')) continue;
    
    var key = agent.agentName.toLowerCase();
    var existing = byName.get(key);
    if (!existing || agent.verificationLevel > existing.verificationLevel) {
      byName.set(key, agent);
    }
  }
  
  agents = Array.from(byName.values());
  agents.sort(function(a, b) { return b.reputationScore - a.reputationScore; });

  _cache = agents;
  _cacheTime = Date.now();
  console.log('[V3 Explorer] Fetched ' + agents.length + ' unique V3 Genesis Records from chain');
  return agents;
}

function clearCache() {
  _cache = null;
  _cacheTime = 0;
}

module.exports = { fetchAllV3Agents: fetchAllV3Agents, clearCache: clearCache, parseGenesisRecord: parseGenesisRecord };
