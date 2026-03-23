const {
  Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram,
} = require('@solana/web3.js');
const crypto = require('crypto');
const borsh = require('borsh');
const { PROGRAM_IDS, MAINNET_RPC } = require('./constants');
const {
  agentIdHash, getGenesisPDA, getLinkedWalletPDA, getMintTrackerPDA,
  getReviewPDA, getReviewCounterPDA, getAttestationPDA,
  getReputationAuthorityPDA, getValidationAuthorityPDA, resolveAgent,
  getIdentityPDA, getReputationPDA,
} = require('./pda');

class SATPV3SDK {
  constructor(opts = {}) {
    this.rpcUrl = opts.rpcUrl || MAINNET_RPC;
    this.commitment = opts.commitment || 'confirmed';
    this.connection = new Connection(this.rpcUrl, this.commitment);
  }

  // ═══ GENESIS RECORD (V3) ═══

  /**
   * Read an agent's Genesis Record by agent_id. Zero trust — pure on-chain.
   * @param {string} agentId - e.g. "brainForge", "agent-12345"
   * @returns {Promise<object|null>} Genesis Record data or null
   */
  async getGenesisRecord(agentId) {
    const [pda] = getGenesisPDA(agentId);
    const acct = await this.connection.getAccountInfo(pda);
    if (!acct) return null;

    // Use Anchor discriminator check (first 8 bytes)
    const data = acct.data;
    if (data.length < 8) return null;

    // Parse manually since borsh with Option<Pubkey> is complex
    // Skip discriminator (8), read agent_id_hash (32)
    let offset = 8;
    const agentIdHashBytes = data.slice(offset, offset + 32);
    offset += 32;

    // Read borsh strings: u32 len + bytes
    const readString = () => {
      const len = data.readUInt32LE(offset);
      offset += 4;
      const str = data.slice(offset, offset + len).toString('utf8');
      offset += len;
      return str;
    };

    // Read Vec<String>: u32 count, then count strings
    const readVecString = () => {
      const count = data.readUInt32LE(offset);
      offset += 4;
      const arr = [];
      for (let i = 0; i < count; i++) arr.push(readString());
      return arr;
    };

    try {
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

      // Option<Pubkey>: 1 byte tag + (32 bytes if Some)
      const hasPending = data[offset];
      offset += 1;
      let pendingAuthority = null;
      if (hasPending === 1) {
        pendingAuthority = new PublicKey(data.slice(offset, offset + 32)).toBase58();
        offset += 32;
      }

      const reputationScore = Number(data.readBigUInt64LE(offset));
      offset += 8;
      const verificationLevel = data[offset];
      offset += 1;
      const reputationUpdatedAt = Number(data.readBigInt64LE(offset));
      offset += 8;
      const verificationUpdatedAt = Number(data.readBigInt64LE(offset));
      offset += 8;
      const createdAt = Number(data.readBigInt64LE(offset));
      offset += 8;
      const updatedAt = Number(data.readBigInt64LE(offset));
      offset += 8;

      return {
        pda: pda.toBase58(),
        agentIdHash: Array.from(agentIdHashBytes),
        agentName,
        description,
        category,
        capabilities,
        metadataUri,
        faceImage,
        faceMint: faceMint.toBase58(),
        faceBurnTx,
        genesisRecord,
        isBorn: genesisRecord > 0,
        bornAt: genesisRecord > 0 ? new Date(genesisRecord * 1000).toISOString() : null,
        authority: authority.toBase58(),
        pendingAuthority,
        reputationScore,
        reputationPct: (reputationScore / 10000).toFixed(2),
        verificationLevel,
        verificationLabel: ['Unverified','Basic','Verified','Established','Trusted','Sovereign'][verificationLevel] || 'Unknown',
        reputationUpdatedAt,
        verificationUpdatedAt,
        createdAt,
        updatedAt,
      };
    } catch (e) {
      return { pda: pda.toBase58(), error: e.message, raw: data.toString('hex').slice(0, 200) };
    }
  }

  /**
   * Build a createIdentity (Genesis Record) transaction.
   * @param {PublicKey|string} creator - Creator wallet (authority)
   * @param {Buffer|number[]} agentIdHashBuf - 32-byte SHA-256 of agent_id
   * @param {string} name
   * @param {string} description
   * @param {string} category
   * @param {string[]} capabilities
   * @param {string} metadataUri
   */
  async buildCreateGenesisRecord(creator, agentIdHashBuf, name, description, category, capabilities, metadataUri) {
    const creatorKey = new PublicKey(creator);
    const hashBuf = Buffer.from(agentIdHashBuf);
    const [genesisPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('genesis'), hashBuf],
      PROGRAM_IDS.IDENTITY_V3
    );

    // Anchor discriminator for "create_identity"
    const disc = crypto.createHash('sha256')
      .update('global:create_identity')
      .digest().slice(0, 8);

    // Encode: disc + agent_id_hash(32) + name(string) + description(string) + category(string) + capabilities(vec<string>) + metadata_uri(string)
    const encStr = (s) => {
      const b = Buffer.from(s, 'utf8');
      const len = Buffer.alloc(4);
      len.writeUInt32LE(b.length);
      return Buffer.concat([len, b]);
    };
    const encVecStr = (arr) => {
      const len = Buffer.alloc(4);
      len.writeUInt32LE(arr.length);
      return Buffer.concat([len, ...arr.map(encStr)]);
    };

    const data = Buffer.concat([
      disc, hashBuf,
      encStr(name), encStr(description), encStr(category),
      encVecStr(capabilities), encStr(metadataUri),
    ]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_IDS.IDENTITY_V3,
      keys: [
        { pubkey: genesisPda, isSigner: false, isWritable: true },
        { pubkey: creatorKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = creatorKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx, genesisPda };
  }

  /**
   * Build a burnToBecome transaction.
   */
  async buildBurnToBecome(authority, genesisPda, faceImage, faceMint, faceBurnTx) {
    const authKey = new PublicKey(authority);
    const disc = crypto.createHash('sha256')
      .update('global:burn_to_become')
      .digest().slice(0, 8);

    const encStr = (s) => {
      const b = Buffer.from(s, 'utf8');
      const len = Buffer.alloc(4);
      len.writeUInt32LE(b.length);
      return Buffer.concat([len, b]);
    };

    const data = Buffer.concat([
      disc,
      encStr(faceImage),
      new PublicKey(faceMint).toBuffer(),
      encStr(faceBurnTx),
    ]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_IDS.IDENTITY_V3,
      keys: [
        { pubkey: new PublicKey(genesisPda), isSigner: false, isWritable: true },
        { pubkey: authKey, isSigner: true, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = authKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    return { transaction: tx };
  }

  /**
   * Resolve agent_id → PDA address (no RPC needed).
   */
  resolveAgent(agentId) {
    return resolveAgent(agentId).toBase58();
  }

  /**
   * Check if agent has been born (completed burn-to-become).
   */
  async isAgentBorn(agentId) {
    const record = await this.getGenesisRecord(agentId);
    return record ? record.isBorn : false;
  }


  // ═══ UPDATE VERIFICATION LEVEL ═══

  /**
   * Build an updateVerification transaction (authority-only).
   * Updates the verification_level field on the Genesis Record.
   * @param {PublicKey|string} authority - Genesis Record authority
   * @param {string} agentId - Agent ID (to derive PDA)
   * @param {number} newLevel - New verification level (0-5)
   */
  async buildUpdateVerification(authority, agentId, newLevel) {
    const authKey = new PublicKey(authority);
    const hashBuf = agentIdHash(agentId);
    const [genesisPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('genesis'), hashBuf],
      PROGRAM_IDS.IDENTITY_V3
    );

    const disc = crypto.createHash('sha256')
      .update('global:update_verification')
      .digest().slice(0, 8);

    // Encode: disc + new_level (u8)
    const data = Buffer.concat([disc, Buffer.from([newLevel])]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_IDS.IDENTITY_V3,
      keys: [
        { pubkey: genesisPda, isSigner: false, isWritable: true },
        { pubkey: authKey, isSigner: true, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = authKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    return { transaction: tx, genesisPda };
  }

  // ═══ UPDATE REPUTATION SCORE ═══

  /**
   * Build an updateReputation transaction (authority-only).
   * Updates the reputation_score field on the Genesis Record.
   * @param {PublicKey|string} authority - Genesis Record authority
   * @param {string} agentId - Agent ID
   * @param {number} newScore - New reputation score (0-1000000, maps to 0-100.00%)
   */
  async buildUpdateReputation(authority, agentId, newScore) {
    const authKey = new PublicKey(authority);
    const hashBuf = agentIdHash(agentId);
    const [genesisPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('genesis'), hashBuf],
      PROGRAM_IDS.IDENTITY_V3
    );

    const disc = crypto.createHash('sha256')
      .update('global:update_reputation')
      .digest().slice(0, 8);

    // Encode: disc + new_score (u64 LE)
    const scoreBuf = Buffer.alloc(8);
    scoreBuf.writeBigUInt64LE(BigInt(newScore));
    const data = Buffer.concat([disc, scoreBuf]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_IDS.IDENTITY_V3,
      keys: [
        { pubkey: genesisPda, isSigner: false, isWritable: true },
        { pubkey: authKey, isSigner: true, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = authKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    return { transaction: tx, genesisPda };
  }

    // ═══ LEGACY V1 (backward compat) ═══

  async getIdentity(wallet) {
    const [pda] = getIdentityPDA(new PublicKey(wallet));
    const acct = await this.connection.getAccountInfo(pda);
    if (!acct) return null;
    return { pda: pda.toBase58(), exists: true };
  }
}

// Convenience: create SDK for agent_id lookup
function createSATPClient(opts) {
  return new SATPV3SDK(opts);
}

module.exports = {
  SATPV3SDK, createSATPClient, PROGRAM_IDS,
  // PDA helpers
  agentIdHash, getGenesisPDA, getLinkedWalletPDA, getMintTrackerPDA,
  getReviewPDA, getReviewCounterPDA, getAttestationPDA,
  getReputationAuthorityPDA, getValidationAuthorityPDA, resolveAgent,
  // Legacy
  getIdentityPDA, getReputationPDA,
};

// ═══ NAME REGISTRY + LINKED WALLETS (added 2026-03-22 by brainChain) ═══

const { getNameRegistryPDA, nameHash } = require('./pda');

// Add methods to prototype
SATPV3SDK.prototype.getNameRegistry = async function(name) {
  const [pda] = getNameRegistryPDA(name);
  const acct = await this.connection.getAccountInfo(pda);
  if (!acct) return null;
  const data = acct.data;
  let offset = 8; // skip discriminator
  // name: String (4 + 32)
  const nameLen = data.readUInt32LE(offset); offset += 4;
  const regName = data.slice(offset, offset + nameLen).toString('utf8'); offset += 32;
  // name_hash: [u8; 32]
  const regHash = data.slice(offset, offset + 32); offset += 32;
  // identity: Pubkey
  const identity = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
  // authority: Pubkey
  const authority = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
  // registered_at: i64
  const registeredAt = Number(data.readBigInt64LE(offset)); offset += 8;
  // is_active: bool
  const isActive = data[offset] === 1;
  return {
    pda: pda.toBase58(), name: regName, nameHash: regHash.toString('hex'),
    identity: identity.toBase58(), authority: authority.toBase58(),
    registeredAt, isActive,
  };
};

SATPV3SDK.prototype.isNameTaken = async function(name) {
  const reg = await this.getNameRegistry(name);
  return reg !== null && reg.isActive;
};

SATPV3SDK.prototype.getLinkedWallets = async function(agentId) {
  const [genesisPda] = getGenesisPDA(agentId);
  const accounts = await this.connection.getProgramAccounts(PROGRAM_IDS.IDENTITY_V3, {
    filters: [
      { dataSize: 138 },
      { memcmp: { offset: 8, bytes: genesisPda.toBase58() } },
    ],
  });
  return accounts.map(a => {
    const d = a.account.data;
    let o = 8; // skip disc
    o += 32; // identity
    const wallet = new PublicKey(d.slice(o, o + 32)); o += 32;
    const chainLen = d.readUInt32LE(o); o += 4;
    const chain = d.slice(o, o + chainLen).toString('utf8'); o += 16;
    const labelLen = d.readUInt32LE(o); o += 4;
    const label = d.slice(o, o + labelLen).toString('utf8'); o += 32;
    const verifiedAt = Number(d.readBigInt64LE(o)); o += 8;
    const isActive = d[o] === 1;
    return { pubkey: a.pubkey.toBase58(), wallet: wallet.toBase58(), chain, label, verifiedAt, isActive };
  });
};

module.exports.getNameRegistryPDA = getNameRegistryPDA;
module.exports.nameHash = nameHash;
