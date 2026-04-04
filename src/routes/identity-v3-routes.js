/**
 * SATP V3 Identity API Routes
 *
 * GET /identity/:agentId           — Get Genesis Record by agent_id
 * GET /identity/address/:pda       — Get Genesis Record by PDA address
 * GET /identity/check/:agentId     — Check if agent has identity (boolean)
 * GET /identity/name/:name         — Check name availability
 * POST /identity/create            — Build create identity transaction (unsigned)
 * POST /identity/update            — Build update identity transaction (unsigned)
 * POST /identity/burn-to-become    — Build burn-to-become transaction (unsigned)
 *
 * brainChain — 2026-03-28
 */

const { Router } = require('express');
const { Connection, PublicKey } = require('@solana/web3.js');
const crypto = require('crypto');

const router = Router();

// ── Config ─────────────────────────────────────────────────────────────────────

const NETWORK = process.env.SATP_NETWORK || process.env.SOLANA_NETWORK || 'mainnet';
const RPC_URL = process.env.SOLANA_RPC_URL || (NETWORK === 'mainnet'
  ? 'https://api.mainnet-beta.solana.com'
  : 'https://api.devnet.solana.com');

const IDENTITY_PROGRAM_ID = new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');

const conn = new Connection(RPC_URL, 'confirmed');

// ── Helpers ────────────────────────────────────────────────────────────────────

function hashAgentId(agentId) {
  return crypto.createHash('sha256').update(agentId).digest();
}

function hashName(name) {
  return crypto.createHash('sha256').update(name.toLowerCase()).digest();
}

function getGenesisPDA(agentIdHash) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('genesis'), agentIdHash],
    IDENTITY_PROGRAM_ID
  );
}

function getNameRegistryPDA(nameHash) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('name_registry_v3'), nameHash],
    IDENTITY_PROGRAM_ID
  );
}

/**
 * Parse a Genesis Record from raw account data.
 * Layout matches identity_v3 on-chain struct (after 8-byte Anchor discriminator).
 */
function parseGenesisRecord(data, pda) {
  let offset = 8; // skip Anchor discriminator

  function readString() {
    const len = data.readUInt32LE(offset);
    offset += 4;
    const str = data.slice(offset, offset + len).toString('utf8');
    offset += len;
    return str;
  }

  function readVecString() {
    const count = data.readUInt32LE(offset);
    offset += 4;
    const arr = [];
    for (let i = 0; i < count; i++) {
      arr.push(readString());
    }
    return arr;
  }

  function readPubkey() {
    const pk = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    return pk.toBase58();
  }

  function readI64() {
    const low = data.readUInt32LE(offset);
    const high = data.readInt32LE(offset + 4);
    offset += 8;
    return high * 0x100000000 + low;
  }

  function readU32() {
    const val = data.readUInt32LE(offset);
    offset += 4;
    return val;
  }

  function readBool() {
    const val = data[offset];
    offset += 1;
    return val === 1;
  }

  function readOptionPubkey() {
    const tag = data[offset];
    offset += 1;
    if (tag === 1) {
      return readPubkey();
    }
    return null;
  }

  try {
    const agentIdHash = data.slice(offset, offset + 32).toString('hex');
    offset += 32;

    const agentName = readString();
    const description = readString();
    const category = readString();
    const capabilities = readVecString();
    const metadataUri = readString();

    // Face fields (added in V3 upgrade)
    const faceImage = readString();
    const faceMint = readPubkey();
    const faceBurnTx = readString();
    const genesisRecord = readI64();

    // Layout detection: old accounts don't have is_active between genesis_record and authority
    let isActive, authority, pendingAuthority;
    const peekByte = data[offset];
    if (peekByte !== 0 && peekByte !== 1) {
      // Old layout — no is_active field
      isActive = true;
      authority = readPubkey();
      pendingAuthority = readOptionPubkey();
    } else {
      const optionPos = offset + 1 + 32;
      if (optionPos < data.length && (data[optionPos] === 0 || data[optionPos] === 1)) {
        isActive = readBool();
        authority = readPubkey();
        pendingAuthority = readOptionPubkey();
      } else {
        isActive = true;
        authority = readPubkey();
        pendingAuthority = readOptionPubkey();
      }
    }

    const reputationScore = Number(data.readBigUInt64LE(offset)); offset += 8;
    const verificationLevel = data[offset]; offset += 1;
    const reputationUpdatedAt = readI64();
    const verificationUpdatedAt = readI64();

    const createdAt = readI64();
    const updatedAt = readI64();

    return {
      pda,
      agentIdHash,
      agentName,
      description,
      category,
      capabilities,
      metadataUri,
      faceImage,
      faceMint,
      faceBurnTx,
      genesisRecord: genesisRecord > 0 ? new Date(genesisRecord * 1000).toISOString() : null,
      isBorn: genesisRecord > 0,
      isActive,
      authority,
      pendingAuthority,
      reputationScore,
      verificationLevel,
      createdAt: new Date(createdAt * 1000).toISOString(),
      updatedAt: new Date(updatedAt * 1000).toISOString(),
    };
  } catch (e) {
    return { error: 'Failed to parse Genesis Record', detail: e.message, pda, dataLength: data.length };
  }
}


// P0: satp_trust_scores enrichment removed — V3 on-chain is sole source
const Database = require('better-sqlite3');
const pathMod = require('path');
const LEVEL_MAP = { UNCLAIMED: 0, NEW: 0, REGISTERED: 1, VERIFIED: 2, ESTABLISHED: 3, TRUSTED: 4, SOVEREIGN: 5 };
const LEVEL_LABELS = ['Unverified','Registered','Verified','Established','Trusted','Sovereign'];

function enrichFromDB(record) {
  if (!record || record.error) return record;
  
  // Enrich face data from DB nft_avatar if on-chain is empty
  if (!record.faceImage || record.faceImage === '' || record.faceImage === null) {
    try {
      const db2 = new Database(pathMod.join(__dirname, '..', '..', 'data', 'agentfolio.db'), { readonly: true });
      const agentId2 = 'agent_' + record.agentName.toLowerCase();
      const profileRow = db2.prepare('SELECT nft_avatar FROM profiles WHERE id = ?').get(agentId2);
      db2.close();
      if (profileRow && profileRow.nft_avatar) {
        try {
          const nftData = JSON.parse(profileRow.nft_avatar);
          if (nftData.image) record.faceImage = nftData.image;
          if (nftData.soulboundMint) record.faceMint = nftData.soulboundMint;
          if (nftData.burnTxSignature) record.faceBurnTx = nftData.burnTxSignature;
          // HARD RULE: isBorn comes from on-chain ONLY — never from DB (CEO directive 2026-03-31)
          record._faceEnrichedFromDB = true;
        } catch (e) {}
      }
    } catch (e) {}
  }
  
  if (record.reputationScore !== 500000 || record.verificationLevel !== 0) return record;
  try {
    const db = new Database(pathMod.join(__dirname, '..', '..', 'data', 'agentfolio.db'), { readonly: true });
    const agentId = 'agent_' + record.agentName.toLowerCase();
    let row = null; // P0: DB reads removed — on-chain v3 only
    db.close();
    if (row) {
      const numLevel = typeof row.level === 'number' ? row.level : (LEVEL_MAP[String(row.level).toUpperCase()] || 0);
      record.reputationScore = row.overall_score || record.reputationScore;
      record.verificationLevel = numLevel;
      record.verificationLabel = LEVEL_LABELS[numLevel] || 'Unknown';
      record._enrichedFromDB = true;
    }
  } catch (e) { /* silently continue with on-chain defaults */ }
  return record;
}

// ── Routes ─────────────────────────────────────────────────────────────────────

/**
 * GET /identity/:agentId — Fetch Genesis Record by agent_id string
 */
router.get('/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    const hash = hashAgentId(agentId);
    const [pda] = getGenesisPDA(hash);

    const info = await conn.getAccountInfo(pda);
    if (!info) {
      return res.status(404).json({
        error: 'Identity not found',
        agentId,
        pda: pda.toBase58(),
        network: NETWORK,
      });
    }

    const record = enrichFromDB(parseGenesisRecord(info.data, pda.toBase58()));
    res.json({ agentId, network: NETWORK, ...record });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /identity/address/:pda — Fetch Genesis Record by PDA address
 */
router.get('/address/:pda', async (req, res) => {
  try {
    const pdaKey = new PublicKey(req.params.pda);
    const info = await conn.getAccountInfo(pdaKey);
    if (!info) {
      return res.status(404).json({ error: 'Account not found', pda: req.params.pda });
    }

    const record = enrichFromDB(parseGenesisRecord(info.data, req.params.pda));
    res.json({ network: NETWORK, ...record });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /identity/check/:agentId — Check if identity exists (lightweight)
 */
router.get('/check/:agentId', async (req, res) => {
  try {
    const hash = hashAgentId(req.params.agentId);
    const [pda] = getGenesisPDA(hash);

    const info = await conn.getAccountInfo(pda, { dataSlice: { offset: 0, length: 0 } });
    res.json({
      agentId: req.params.agentId,
      exists: !!info,
      pda: pda.toBase58(),
      network: NETWORK,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /identity/name/:name — Check name availability
 */
router.get('/name/:name', async (req, res) => {
  try {
    const name = req.params.name;
    const nameHash = hashName(name);
    const [pda] = getNameRegistryPDA(nameHash);

    const info = await conn.getAccountInfo(pda, { dataSlice: { offset: 0, length: 0 } });
    res.json({
      name,
      available: !info,
      registryPda: pda.toBase58(),
      network: NETWORK,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
