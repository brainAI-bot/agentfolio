/**
 * SATP Identity Registry Client
 * Reads on-chain agent identity, reputation scores, and verification levels
 * from the SATP program cluster on Solana.
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const borsh = require('borsh');

// V3 SDK: borsh-reader for Genesis Record deserialization + V3 PDA derivation
let deserializeGenesisRecord, hashAgentId, getGenesisPDA, getV3ProgramIds;
try {
  const borshReader = require('./satp-client/src/borsh-reader');
  const v3pda = require('./satp-client/src/v3-pda');
  deserializeGenesisRecord = borshReader.deserializeGenesisRecord;
  hashAgentId = v3pda.hashAgentId;
  getGenesisPDA = v3pda.getGenesisPDA;
  getV3ProgramIds = v3pda.getV3ProgramIds;
  console.log('[SATP Identity] V3 borsh-reader loaded — Genesis Record deserialization enabled');
} catch (e) {
  console.warn('[SATP Identity] V3 SDK not available:', e.message);
}

// ─── Program IDs ─────────────────────────────────────────
// V2 programs (mainnet) — coordinated with brainChain SDK v2.0
const PROGRAMS = {
  IDENTITY: new PublicKey('97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq'),
  REVIEWS: new PublicKey('Ge1sD2qwmH8QaaKCPZzZERvsFXNVMvKbAgTp2p17yjLK'),
  REPUTATION: new PublicKey('C9ogv8TBrvFy4pLKDoGQg9B73Q5rKPPsQ4kzkcDk6Jd'),
  ATTESTATIONS: new PublicKey('ENvaD19QzwWWMJFu5r5xJ9SmHqWN6GvyzxACRejqbdug'),
  VALIDATION: new PublicKey('9p795d2j3eGqzborG2AncucWBaU6PieKxmhKVroV3LNh'),
  ESCROW: new PublicKey('STyY8w4ZHws3X1AMoocWuDYBoogVDwvymPy8Wifx5TH'),
};

// Legacy V1 programs (still have accounts on mainnet)
const LEGACY_PROGRAMS = {
  IDENTITY_V1: new PublicKey('BY4jzmnrui1K5gZ5z5xRQkVfEEMXYHYugtH1Ua867eyr'),
  IDENTITY_V1B: new PublicKey('CV5Wd9YGFX5A4dvuaFuEDuKQWp14NfnLrSdxY7EHFyeB'),
};

// Devnet program IDs
const DEVNET_PROGRAMS = {
  IDENTITY: new PublicKey('EJtQh4Gyg88zXvSmFpxYkkeZsPwTsjfm4LvjmPQX1FD3'),
  REVIEWS: new PublicKey('D8HsSpK3JtAN7tVcA1yfgxScju7KcG6skEfaShSKojki'),
  REPUTATION: new PublicKey('4y4W2Mdfpu91C4iVowiDyJTmdKSjo8bmSDQrX2c84WQF'),
  ATTESTATIONS: new PublicKey('9xT3eNcndkmnqZtJqDQ1ggckHK7Dxo5EsAt5mHqsPBhP'),
  VALIDATION: new PublicKey('8jLaqodAzfM7oCxP7aedFeszeNjnJ5ik56dzhDU2HQgc'),
};

function getPrograms(network) {
  return network === 'devnet' ? DEVNET_PROGRAMS : PROGRAMS;
}

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const DEVNET_RPC = 'https://api.devnet.solana.com';

function getRpcUrl(network) {
  return (network === 'devnet') ? DEVNET_RPC : RPC_URL;
}

// ─── Account Cache (TTL-based, all identity programs) ────
const _cache = { accounts: null, time: 0, byAuthority: new Map(), byName: new Map() };
const CACHE_TTL_MS = 1_800_000; // 30min cache // 10min cache (accounts rarely change)

let _cacheLoading = null; // prevent concurrent cache loads

async function getAllIdentityAccounts(connection) {
  const now = Date.now();
  if (_cache.accounts && (now - _cache.time) < CACHE_TTL_MS) {
    return _cache.accounts;
  }
  
  // Prevent concurrent cache loads (thundering herd)
  if (_cacheLoading) return _cacheLoading;
  
  _cacheLoading = _loadAllAccounts(connection);
  try {
    return await _cacheLoading;
  } finally {
    _cacheLoading = null;
  }
}

async function _loadAllAccounts(connection) {
  const allProgIds = [PROGRAMS.IDENTITY, LEGACY_PROGRAMS.IDENTITY_V1, LEGACY_PROGRAMS.IDENTITY_V1B];
  const allParsed = [];
  const seenPDAs = new Set();
  
  for (let i = 0; i < allProgIds.length; i++) {
    const progId = allProgIds[i];
    if (i > 0) await new Promise(r => setTimeout(r, 10000)); // 10s delay between programs to avoid 429
    try {
      const accounts = await connection.getProgramAccounts(progId);
      for (const { pubkey, account } of accounts) {
        const pdaStr = pubkey.toBase58();
        if (seenPDAs.has(pdaStr)) continue;
        seenPDAs.add(pdaStr);
        
        const parsed = parseIdentityAccount(account.data);
        if (parsed) {
          parsed.pda = pdaStr;
          parsed.programId = progId.toBase58();
          allParsed.push(parsed);
        }
      }
      // Small delay between programs to avoid rate limiting
      if (allProgIds.indexOf(progId) < allProgIds.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      console.error(`[SATP Cache] ${progId.toBase58().slice(0,8)} error:`, e.message);
    }
  }
  
  // V3: Also scan Genesis Records from V3 Identity program
  if (getV3ProgramIds) {
    try {
      const v3Ids = getV3ProgramIds('mainnet');
      if (v3Ids && v3Ids.IDENTITY) {
        await new Promise(r => setTimeout(r, 2000));
        const v3Accounts = await connection.getProgramAccounts(v3Ids.IDENTITY);
        for (const { pubkey, account } of v3Accounts) {
          const pdaStr = pubkey.toBase58();
          if (seenPDAs.has(pdaStr)) continue;
          seenPDAs.add(pdaStr);
          const parsed = parseIdentityAccount(account.data);
          if (parsed) {
            parsed.pda = pdaStr;
            parsed.programId = v3Ids.IDENTITY.toBase58();
            parsed.version = 3;
            allParsed.push(parsed);
          }
        }
        console.log(`[SATP Cache] V3 accounts scanned from ${v3Ids.IDENTITY.toBase58().slice(0,8)}`);
      }
    } catch (e) {
      console.error('[SATP Cache] V3 scan error:', e.message);
    }
  }

  // Build indexes
  _cache.byAuthority.clear();
  _cache.byName.clear();
  for (const agent of allParsed) {
    _cache.byAuthority.set(agent.authority, agent);
    if (agent.name) _cache.byName.set(agent.name.toLowerCase(), agent);
  }
  
  // Only update cache if we got results (don't overwrite with empty on RPC failure)
  if (allParsed.length > 0 || !_cache.accounts) {
    _cache.accounts = allParsed;
    _cache.time = Date.now();
    console.log(`[SATP Cache] Loaded ${allParsed.length} agents from ${allProgIds.length} programs`);
  } else if (_cache.accounts) {
    // RPC failed but we have stale data — extend TTL and serve stale
    _cache.time = Date.now();
    console.log(`[SATP Cache] RPC failed, serving ${_cache.accounts.length} stale agents`);
    return _cache.accounts;
  }
  return allParsed;
}

// Warm cache on module load (after a delay to avoid startup congestion)
setTimeout(() => {
  const connection = new Connection(RPC_URL, 'confirmed');
  getAllIdentityAccounts(connection).catch(e => 
    console.error('[SATP Cache] Warmup error:', e.message)
  );
}, 30000); // 30s startup delay to avoid RPC burst

// ─── PDA Derivation ──────────────────────────────────────

// V2: seeds = [b"identity", authority]
function getIdentityPDA(walletPubkey, network) {
  const progs = getPrograms(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('identity'), new PublicKey(walletPubkey).toBuffer()],
    progs.IDENTITY
  );
}

// V1 legacy: seeds = [b"agent", owner]
function getIdentityPDALegacy(walletPubkey, programId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('agent'), new PublicKey(walletPubkey).toBuffer()],
    programId
  );
}

function getReputationAuthorityPDA(network) {
  const progs = getPrograms(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('reputation_authority')],
    progs.REPUTATION
  );
}

function getValidationAuthorityPDA(network) {
  const progs = getPrograms(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('validation_authority')],
    progs.VALIDATION
  );
}

function getAttestationPDA(agentWallet, issuer, attestationType, network) {
  const progs = getPrograms(network);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('attestation'),
      new PublicKey(agentWallet).toBuffer(),
      new PublicKey(issuer).toBuffer(),
      Buffer.from(attestationType),
    ],
    progs.ATTESTATIONS
  );
}

function getReviewPDA(agentId, reviewer, network) {
  const progs = getPrograms(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('review'), new PublicKey(agentId).toBuffer(), new PublicKey(reviewer).toBuffer()],
    progs.REVIEWS
  );
}

// ─── Account Parsing ─────────────────────────────────────

/**
 * Parse AgentIdentity account data from on-chain.
 * Handles both V2 (~300-600 bytes) and V3 Genesis Record (~1384 bytes) formats.
 * V3 accounts are detected by size and deserialized with borsh-reader.
 */
function parseIdentityAccount(data) {
  if (!data || data.length < 48) return null;
  
  // V3 Genesis Records are ~1384 bytes; V2 identities are ~300-600.
  // If data >= 800 bytes and V3 borsh-reader is available, try V3 first.
  if (data.length >= 800 && deserializeGenesisRecord) {
    try {
      const v3 = deserializeGenesisRecord(data);
      if (v3 && v3.authority) {
        return {
          authority: v3.authority,
          name: v3.agentName || '',
          description: v3.description || '',
          metadataUri: v3.metadataUri || '',
          version: 3,
          reputationScore: v3.reputationScore / 10000,
          reputationScoreRaw: v3.reputationScore,
          verificationLevel: v3.verificationLevel,
          verificationLabel: levelToLabel(v3.verificationLevel),
          reputationRank: scoreToRank(v3.reputationScore / 10000),
          createdAt: v3.createdAt ? new Date(v3.createdAt * 1000).toISOString() : null,
          updatedAt: v3.updatedAt ? new Date(v3.updatedAt * 1000).toISOString() : null,
          onChain: true,
          // V3-specific fields
          agentIdHash: v3.agentIdHash,
          category: v3.category || '',
          capabilities: v3.capabilities || [],
          faceImage: v3.faceImage,
          faceMint: v3.faceMint,
          isBorn: v3.isBorn,
          isActive: v3.isActive,
          pendingAuthority: v3.pendingAuthority,
          reputationUpdatedAt: v3.reputationUpdatedAt ? new Date(v3.reputationUpdatedAt * 1000).toISOString() : null,
          verificationUpdatedAt: v3.verificationUpdatedAt ? new Date(v3.verificationUpdatedAt * 1000).toISOString() : null,
        };
      }
    } catch (v3err) {
      // V3 parse failed — fall through to V2 parser
    }
  }
  
  // V2 parsing (original logic)
  try {
    let offset = 8; // skip Anchor discriminator
    
    // version: u64
    const version = Number(data.readBigUInt64LE(offset));
    offset += 8;
    
    // authority: Pubkey (32)
    const authority = new PublicKey(data.slice(offset, offset + 32)).toBase58();
    offset += 32;
    
    // If account is too short for strings, return minimal
    if (data.length <= offset + 4) {
      return {
        authority, name: '', description: '', metadataUri: '',
        version, reputationScore: 0, reputationScoreRaw: 0,
        verificationLevel: 0, createdAt: null, updatedAt: null, onChain: true,
      };
    }
    
    // Read strings: name, description, metadata_uri
    function readString() {
      if (data.length < offset + 4) return '';
      const len = data.readUInt32LE(offset);
      offset += 4;
      if (len <= 0 || len > 1024 || data.length < offset + len) { return ''; }
      const s = data.slice(offset, offset + len).toString('utf8');
      offset += len;
      return s;
    }
    
    const name = readString();
    const description = readString();
    const metadataUri = readString();
    
    // Timestamps: created_at(i64) + updated_at(i64)
    let createdAt = null, updatedAt = null;
    if (data.length >= offset + 8) {
      const ts = Number(data.readBigInt64LE(offset));
      offset += 8;
      if (ts > 1577836800 && ts < 1893456000) createdAt = new Date(ts * 1000).toISOString();
    }
    if (data.length >= offset + 8) {
      const ts = Number(data.readBigInt64LE(offset));
      offset += 8;
      if (ts > 1577836800 && ts < 1893456000) updatedAt = new Date(ts * 1000).toISOString();
    }
    
    // reputation_score: u64, verification_level: u8
    let reputationScore = 0, verificationLevel = 0;
    if (data.length >= offset + 8) {
      const raw = Number(data.readBigUInt64LE(offset));
      if (raw <= 1000000) reputationScore = raw;
      offset += 8;
    }
    if (data.length >= offset + 1) {
      const lvl = data.readUInt8(offset);
      if (lvl <= 5) verificationLevel = lvl;
      offset += 1;
    }
    
    return {
      authority, name, description, metadataUri, version,
      reputationScore: reputationScore / 10000,
      reputationScoreRaw: reputationScore,
      verificationLevel,
      verificationLabel: levelToLabel(verificationLevel),
      reputationRank: scoreToRank(reputationScore / 10000),
      createdAt, updatedAt, onChain: true,
    };
  } catch (err) {
    console.error('[SATP Identity] Parse error:', err.message);
    return null;
  }
}

/**
 * Parse Attestation account
 */
function parseAttestationAccount(data) {
  if (!data || data.length < 16) return null;
  
  try {
    let offset = 8; // Anchor discriminator
    
    const id = new PublicKey(data.slice(offset, offset + 32)).toBase58();
    offset += 32;
    
    const agentId = new PublicKey(data.slice(offset, offset + 32)).toBase58();
    offset += 32;
    
    const typeLen = data.readUInt32LE(offset);
    offset += 4;
    const attestationType = data.slice(offset, offset + typeLen).toString('utf8');
    offset += typeLen;
    
    const issuer = new PublicKey(data.slice(offset, offset + 32)).toBase58();
    offset += 32;
    
    const proofLen = data.readUInt32LE(offset);
    offset += 4;
    const proofData = data.slice(offset, offset + proofLen).toString('utf8');
    offset += proofLen;
    
    const verified = data.readUInt8(offset) === 1;
    offset += 1;
    
    const createdAt = Number(data.readBigInt64LE(offset));
    offset += 8;
    
    // Option<i64> for expires_at
    const hasExpiry = data.readUInt8(offset) === 1;
    offset += 1;
    const expiresAt = hasExpiry ? Number(data.readBigInt64LE(offset)) : null;
    offset += 8;
    
    return {
      id,
      agentId,
      attestationType,
      issuer,
      proofData: tryParseJSON(proofData),
      verified,
      createdAt: new Date(createdAt * 1000).toISOString(),
      expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
      expired: expiresAt ? (expiresAt * 1000 < Date.now()) : false,
    };
  } catch (err) {
    console.error('[SATP Attestation] Parse error:', err.message);
    return null;
  }
}

function tryParseJSON(str) {
  try { return JSON.parse(str); } catch { return str; }
}

// ─── High-Level Query Functions ──────────────────────────

/**
 * Get full agent identity from on-chain
 * Uses cached index for fast lookup, falls back to direct RPC
 */
async function getAgentIdentity(addressOrWallet, network) {
  const connection = new Connection(getRpcUrl(network), 'confirmed');
  const walletStr = new PublicKey(addressOrWallet).toBase58();
  
  // Try 0: V3 Genesis Record lookup by agent-ID hash
  // Works for both wallet addresses and agent_id strings
  if (hashAgentId && getGenesisPDA) {
    try {
      const [v3pda] = getGenesisPDA(addressOrWallet, network);
      const v3Info = await connection.getAccountInfo(v3pda);
      if (v3Info && v3Info.data.length >= 800) {
        const v3identity = parseIdentityAccount(v3Info.data);
        if (v3identity) {
          v3identity.pda = v3pda.toBase58();
          v3identity.programId = getV3ProgramIds ? getV3ProgramIds(network).IDENTITY?.toBase58() : 'v3';
          v3identity.onChain = true;
          v3identity.version = 3;
          return v3identity;
        }
      }
    } catch (e) { /* not a valid agent_id or V3 lookup failed, continue */ }
  }

  // Try 1: V2 PDA derivation (fast, single RPC call)
  try {
    const [pda] = getIdentityPDA(addressOrWallet, network);
    const accountInfo = await connection.getAccountInfo(pda);
    if (accountInfo) {
      const identity = parseIdentityAccount(accountInfo.data);
      if (identity) {
        identity.pda = pda.toBase58();
        identity.programId = getPrograms(network).IDENTITY.toBase58();
        identity.onChain = true;
        return identity;
      }
    }
  } catch (e) { /* fall through */ }
  
  // Try 2: legacy PDA derivations (single RPC each)
  for (const legacyProg of [LEGACY_PROGRAMS.IDENTITY_V1, LEGACY_PROGRAMS.IDENTITY_V1B]) {
    try {
      // V1 used ["agent", owner] seeds
      const [legacyPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('agent'), new PublicKey(addressOrWallet).toBuffer()],
        legacyProg
      );
      const info = await connection.getAccountInfo(legacyPda);
      if (info && info.owner.equals(legacyProg)) {
        const identity = parseIdentityAccount(info.data);
        if (identity) {
          identity.pda = legacyPda.toBase58();
          identity.programId = legacyProg.toBase58();
          identity.onChain = true;
          return identity;
        }
      }
    } catch (e) { /* fall through */ }
  }
  
  // Try 3: direct address (maybe user passed a PDA)
  try {
    const accountInfo = await connection.getAccountInfo(new PublicKey(addressOrWallet));
    if (accountInfo && accountInfo.data.length >= 48) {
      const identity = parseIdentityAccount(accountInfo.data);
      if (identity) {
        identity.pda = walletStr;
        identity.programId = accountInfo.owner.toBase58();
        identity.onChain = true;
        return identity;
      }
    }
  } catch (e) { /* fall through */ }
  
  // Try 4: cached authority index (bulk scan, last resort)
  try {
    await getAllIdentityAccounts(connection);
    const cached = _cache.byAuthority.get(walletStr);
    if (cached) return { ...cached, onChain: true };
  } catch (e) { /* fall through */ }
  
  return null;
}

/**
 * Get identity by searching all registered agents for a matching authority or name
 */
async function findAgentByName(name) {
  const connection = new Connection(RPC_URL, 'confirmed');
  await getAllIdentityAccounts(connection);
  return _cache.byName.get(name.toLowerCase()) || null;
}

/**
 * Get all attestations for an agent
 */
async function getAgentAttestations(walletPubkey) {
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Search attestations program for this agent
  // agent_id at offset 8 (disc) + 32 (id) = 40
  const accounts = await connection.getProgramAccounts(PROGRAMS.ATTESTATIONS, {
    filters: [
      { memcmp: { offset: 40, bytes: new PublicKey(walletPubkey).toBase58() } },
    ],
  });
  
  return accounts
    .map(({ pubkey, account }) => {
      const att = parseAttestationAccount(account.data);
      if (att) att.pda = pubkey.toBase58();
      return att;
    })
    .filter(Boolean);
}

/**
 * Get computed reputation + verification for an agent
 * Returns the on-chain computed scores (trustless)
 */
async function getAgentScores(walletPubkey, network) {
  const identity = await getAgentIdentity(walletPubkey, network);
  if (!identity) return null;
  
  return {
    wallet: walletPubkey,
    reputationScore: identity.reputationScore,
    reputationScoreRaw: identity.reputationScoreRaw,
    verificationLevel: identity.verificationLevel,
    verificationLabel: levelToLabel(identity.verificationLevel),
    reputationRank: scoreToRank(identity.reputationScore),
    reputationUpdatedAt: identity.reputationUpdatedAt,
    verificationUpdatedAt: identity.verificationUpdatedAt,
    onChain: true,
    trustless: true,
  };
}

/**
 * List all registered agents (paginated)
 */
async function listRegisteredAgents(limit = 50, offset = 0) {
  const connection = new Connection(RPC_URL, 'confirmed');
  const allAgents = await getAllIdentityAccounts(connection);
  
  const total = allAgents.length;
  const page = allAgents.slice(offset, offset + limit);
  
  return { agents: page, total, limit, offset };
}

// ─── Helpers ─────────────────────────────────────────────

function levelToLabel(level) {
  const labels = ['Unverified', 'Registered', 'Verified', 'Trusted', 'Established', 'Elite'];
  return labels[level] || 'Unknown';
}

function scoreToRank(score) {
  if (score >= 80) return 'Elite';
  if (score >= 60) return 'Expert';
  if (score >= 40) return 'Skilled';
  if (score >= 20) return 'Competent';
  if (score >= 10) return 'Developing';
  return 'Newcomer';
}

// ─── Exports ─────────────────────────────────────────────

module.exports = {
  PROGRAMS,
  LEGACY_PROGRAMS,
  DEVNET_PROGRAMS,
  getPrograms,
  getIdentityPDA,
  getIdentityPDALegacy,
  getReputationAuthorityPDA,
  getValidationAuthorityPDA,
  getAttestationPDA,
  getReviewPDA,
  parseIdentityAccount,
  parseAttestationAccount,
  getAgentIdentity,
  findAgentByName,
  getAgentAttestations,
  getAgentScores,
  listRegisteredAgents,
  levelToLabel,
  scoreToRank,
  // V3 re-exports (available if V3 SDK loaded)
  ...(hashAgentId ? { hashAgentId } : {}),
  ...(getGenesisPDA ? { getGenesisPDA } : {}),
  ...(getV3ProgramIds ? { getV3ProgramIds } : {}),
  ...(deserializeGenesisRecord ? { deserializeGenesisRecord } : {}),
};
