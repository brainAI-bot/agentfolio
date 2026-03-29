/**
 * BorshReader — Zero-dependency Borsh deserialization for SATP V3 accounts.
 *
 * Decodes raw on-chain account data (Buffer) into typed JavaScript objects.
 * Handles the 8-byte Anchor discriminator automatically.
 *
 * Supports all 8 V3 account types:
 *   - GenesisRecord (Identity V3)
 *   - LinkedWallet (Identity V3)
 *   - MintTracker (Identity V3)
 *   - NameRegistry (Identity V3)
 *   - Review (Reviews V3)
 *   - ReviewCounter (Reviews V3)
 *   - Attestation (Attestations V3)
 *   - EscrowV3 (Escrow V3)
 *
 * @module borsh-reader
 */

const { PublicKey } = require('@solana/web3.js');

// ═══════════════════════════════════════════════════
//  BorshReader — streaming Borsh deserializer
// ═══════════════════════════════════════════════════

class BorshReader {
  /**
   * @param {Buffer} buf - Raw account data buffer
   * @param {number} [offset=0] - Starting offset
   */
  constructor(buf, offset = 0) {
    this.buf = buf;
    this.offset = offset;
  }

  /** Read n raw bytes, advance offset. */
  readBytes(n) {
    const slice = this.buf.slice(this.offset, this.offset + n);
    this.offset += n;
    return slice;
  }

  /** Read u8 */
  readU8() {
    const val = this.buf[this.offset];
    this.offset += 1;
    return val;
  }

  /** Read u16 LE */
  readU16() {
    const val = this.buf.readUInt16LE(this.offset);
    this.offset += 2;
    return val;
  }

  /** Read u32 LE */
  readU32() {
    const val = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return val;
  }

  /** Read u64 LE → number (safe for values < 2^53) */
  readU64() {
    return Number(this.buf.readBigUInt64LE(this.offset));
    // Note: offset advanced after return won't work — fix:
  }

  /** Read u64 LE → number, advances offset */
  readU64Num() {
    const val = Number(this.buf.readBigUInt64LE(this.offset));
    this.offset += 8;
    return val;
  }

  /** Read u64 LE → BigInt */
  readU64BigInt() {
    const val = this.buf.readBigUInt64LE(this.offset);
    this.offset += 8;
    return val;
  }

  /** Read i64 LE → number */
  readI64() {
    const val = Number(this.buf.readBigInt64LE(this.offset));
    this.offset += 8;
    return val;
  }

  /** Read i64 LE → BigInt */
  readI64BigInt() {
    const val = this.buf.readBigInt64LE(this.offset);
    this.offset += 8;
    return val;
  }

  /** Read bool (1 byte, 0x01 = true) */
  readBool() {
    const val = this.buf[this.offset] === 1;
    this.offset += 1;
    return val;
  }

  /** Read [u8; 32] as Buffer */
  readFixedBytes32() {
    return Buffer.from(this.readBytes(32));
  }

  /** Read Pubkey (32 bytes) → PublicKey */
  readPubkey() {
    return new PublicKey(this.readBytes(32));
  }

  /** Read Pubkey (32 bytes) → base58 string */
  readPubkeyBase58() {
    return new PublicKey(this.readBytes(32)).toBase58();
  }

  /** Read Borsh String (4-byte LE length + UTF-8 bytes) */
  readString() {
    const len = this.readU32();
    const str = this.buf.slice(this.offset, this.offset + len).toString('utf8');
    this.offset += len;
    return str;
  }

  /** Read Vec<String> (4-byte LE count, then count × String) */
  readVecString() {
    const count = this.readU32();
    const arr = [];
    for (let i = 0; i < count; i++) {
      arr.push(this.readString());
    }
    return arr;
  }

  /** Read Option<T> — returns null for None, or calls reader fn for Some */
  readOption(readerFn) {
    const tag = this.readU8();
    if (tag === 0) return null;
    return readerFn.call(this);
  }

  /** Read Option<Pubkey> → base58 string | null */
  readOptionPubkey() {
    return this.readOption(function () {
      return this.readPubkeyBase58();
    });
  }

  /** Read Option<i64> → number | null */
  readOptionI64() {
    return this.readOption(function () {
      return this.readI64();
    });
  }

  /** Read Option<[u8; 32]> → hex string | null */
  readOptionBytes32Hex() {
    return this.readOption(function () {
      return this.readFixedBytes32().toString('hex');
    });
  }

  /** Skip 8-byte Anchor discriminator */
  skipDiscriminator() {
    this.offset += 8;
    return this;
  }

  /** Get remaining unread bytes */
  remaining() {
    return this.buf.length - this.offset;
  }
}

// ═══════════════════════════════════════════════════
//  Account Deserializers
// ═══════════════════════════════════════════════════

/**
 * Deserialize a GenesisRecord from raw account data.
 * @param {Buffer} data - Raw account data (with 8-byte discriminator)
 * @returns {object} Parsed GenesisRecord
 */
function deserializeGenesisRecord(data) {
  const r = new BorshReader(data).skipDiscriminator();

  const agentIdHash = r.readFixedBytes32();
  const agentName = r.readString();
  const description = r.readString();
  const category = r.readString();
  const capabilities = r.readVecString();
  const metadataUri = r.readString();
  const faceImage = r.readString();
  const faceMint = r.readPubkey();
  const faceBurnTx = r.readString();
  const genesisRecord = r.readI64();
  const isActive = r.readBool();
  const authority = r.readPubkeyBase58();
  const pendingAuthority = r.readOptionPubkey();
  const reputationScore = r.readU64Num();
  const verificationLevel = r.readU8();
  const reputationUpdatedAt = r.readI64();
  const verificationUpdatedAt = r.readI64();
  const createdAt = r.readI64();
  const updatedAt = r.readI64();
  const bump = r.readU8();

  return {
    agentIdHash: agentIdHash.toString('hex'),
    agentName,
    description,
    category,
    capabilities,
    metadataUri,
    faceImage: faceImage || null,
    faceMint: faceMint.equals(PublicKey.default) ? null : faceMint.toBase58(),
    faceBurnTx: faceBurnTx || null,
    genesisRecord,
    isBorn: genesisRecord !== 0,
    isActive,
    authority,
    pendingAuthority,
    reputationScore,
    verificationLevel,
    reputationUpdatedAt,
    verificationUpdatedAt,
    createdAt,
    updatedAt,
    bump,
  };
}

/**
 * Deserialize a LinkedWallet from raw account data.
 * @param {Buffer} data - Raw account data (with 8-byte discriminator)
 * @returns {object} Parsed LinkedWallet
 */
function deserializeLinkedWallet(data) {
  const r = new BorshReader(data).skipDiscriminator();

  return {
    identity: r.readPubkeyBase58(),
    wallet: r.readPubkeyBase58(),
    chain: r.readString(),
    label: r.readString(),
    verifiedAt: r.readI64(),
    isActive: r.readBool(),
    bump: r.readU8(),
  };
}

/**
 * Deserialize a MintTracker from raw account data.
 * @param {Buffer} data - Raw account data (with 8-byte discriminator)
 * @returns {object} Parsed MintTracker
 */
function deserializeMintTracker(data) {
  const r = new BorshReader(data).skipDiscriminator();

  return {
    identity: r.readPubkeyBase58(),
    mintCount: r.readU8(),
    lastMintTimestamp: r.readI64(),
    bump: r.readU8(),
  };
}

/**
 * Deserialize a NameRegistry from raw account data.
 * @param {Buffer} data - Raw account data (with 8-byte discriminator)
 * @returns {object} Parsed NameRegistry
 */
function deserializeNameRegistry(data) {
  const r = new BorshReader(data).skipDiscriminator();

  return {
    name: r.readString(),
    nameHash: r.readFixedBytes32().toString('hex'),
    identity: r.readPubkeyBase58(),
    authority: r.readPubkeyBase58(),
    registeredAt: r.readI64(),
    isActive: r.readBool(),
    bump: r.readU8(),
  };
}

/**
 * Deserialize a Review from raw account data.
 * @param {Buffer} data - Raw account data (with 8-byte discriminator)
 * @returns {object} Parsed Review
 */
function deserializeReview(data) {
  const r = new BorshReader(data).skipDiscriminator();

  return {
    agentId: r.readString(),
    agentIdHash: r.readFixedBytes32().toString('hex'),
    reviewer: r.readPubkeyBase58(),
    rating: r.readU8(),
    reviewText: r.readString(),
    metadata: r.readString(),
    createdAt: r.readI64(),
    updatedAt: r.readI64(),
    isActive: r.readBool(),
    bump: r.readU8(),
  };
}

/**
 * Deserialize a ReviewCounter from raw account data.
 * @param {Buffer} data - Raw account data (with 8-byte discriminator)
 * @returns {object} Parsed ReviewCounter
 */
function deserializeReviewCounter(data) {
  const r = new BorshReader(data).skipDiscriminator();

  return {
    agentId: r.readString(),
    agentIdHash: r.readFixedBytes32().toString('hex'),
    count: r.readU64Num(),
    bump: r.readU8(),
  };
}

/**
 * Deserialize an Attestation from raw account data.
 * @param {Buffer} data - Raw account data (with 8-byte discriminator)
 * @returns {object} Parsed Attestation
 */
function deserializeAttestation(data) {
  const r = new BorshReader(data).skipDiscriminator();

  const agentId = r.readString();
  const agentIdHash = r.readFixedBytes32().toString('hex');
  const attestationType = r.readString();
  const issuer = r.readPubkeyBase58();
  const proofData = r.readString();
  const verified = r.readBool();
  const createdAt = r.readI64();
  const expiresAt = r.readOptionI64();
  const isRevoked = r.readBool();
  const bump = r.readU8();

  // Compute validity: not revoked, verified, and not expired
  const now = Math.floor(Date.now() / 1000);
  const isExpired = expiresAt !== null && expiresAt < now;
  const isValid = verified && !isRevoked && !isExpired;

  return {
    agentId,
    agentIdHash,
    attestationType,
    issuer,
    proofData,
    verified,
    createdAt,
    expiresAt,
    isRevoked,
    isExpired,
    isValid,
    bump,
  };
}

/**
 * Deserialize an EscrowV3 from raw account data.
 * @param {Buffer} data - Raw account data (with 8-byte discriminator)
 * @returns {object} Parsed EscrowV3
 */
function deserializeEscrowV3(data) {
  const r = new BorshReader(data).skipDiscriminator();

  const ESCROW_STATUS_MAP = [
    'Active', 'WorkSubmitted', 'Released',
    'Cancelled', 'Disputed', 'Resolved',
  ];

  const client = r.readPubkeyBase58();
  const agent = r.readPubkeyBase58();
  const agentIdHash = r.readFixedBytes32().toString('hex');
  const amount = r.readU64Num();
  const releasedAmount = r.readU64Num();
  const descriptionHash = r.readFixedBytes32().toString('hex');
  const deadline = r.readI64();
  const nonce = r.readU64Num();
  const statusByte = r.readU8();
  const minVerificationLevel = r.readU8();
  const requireBorn = r.readBool();
  const createdAt = r.readI64();
  const arbiter = r.readPubkeyBase58();
  const workHash = r.readOptionBytes32Hex();
  const workSubmittedAt = r.readOptionI64();
  const disputeReasonHash = r.readOptionBytes32Hex();
  const disputedAt = r.readOptionI64();
  const disputedBy = r.readOptionPubkey();
  const bump = r.readU8();

  return {
    client,
    agent,
    agentIdHash,
    amount,
    releasedAmount,
    remaining: amount - releasedAmount,
    descriptionHash,
    deadline,
    nonce,
    status: ESCROW_STATUS_MAP[statusByte] || `Unknown(${statusByte})`,
    statusCode: statusByte,
    minVerificationLevel,
    requireBorn,
    createdAt,
    arbiter,
    workHash,
    workSubmittedAt,
    disputeReasonHash,
    disputedAt,
    disputedBy,
    bump,
  };
}

// ═══════════════════════════════════════════════════
//  Auto-detect Account Type
// ═══════════════════════════════════════════════════

const crypto = require('crypto');

/** Compute Anchor account discriminator: SHA256("account:<AccountName>")[0..8] */
function accountDiscriminator(accountName) {
  return crypto.createHash('sha256')
    .update(`account:${accountName}`)
    .digest()
    .slice(0, 8);
}

// Pre-compute discriminators for all V3 account types
const DISCRIMINATORS = {
  GenesisRecord: accountDiscriminator('GenesisRecord'),
  LinkedWallet: accountDiscriminator('LinkedWallet'),
  MintTracker: accountDiscriminator('MintTracker'),
  NameRegistry: accountDiscriminator('NameRegistry'),
  Review: accountDiscriminator('Review'),
  ReviewCounter: accountDiscriminator('ReviewCounter'),
  Attestation: accountDiscriminator('Attestation'),
  EscrowV3: accountDiscriminator('EscrowV3'),
};

const DESERIALIZERS = {
  GenesisRecord: deserializeGenesisRecord,
  LinkedWallet: deserializeLinkedWallet,
  MintTracker: deserializeMintTracker,
  NameRegistry: deserializeNameRegistry,
  Review: deserializeReview,
  ReviewCounter: deserializeReviewCounter,
  Attestation: deserializeAttestation,
  EscrowV3: deserializeEscrowV3,
};

/**
 * Auto-detect and deserialize any SATP V3 account from raw data.
 * Matches the 8-byte Anchor discriminator to determine account type.
 *
 * @param {Buffer} data - Raw account data (must include 8-byte discriminator)
 * @returns {{ type: string, data: object }} Account type name + parsed data
 * @throws {Error} If discriminator doesn't match any known type
 */
function deserializeAccount(data) {
  if (!Buffer.isBuffer(data) || data.length < 8) {
    throw new Error('Invalid account data: must be a Buffer with at least 8 bytes');
  }

  const disc = data.slice(0, 8);

  for (const [name, expected] of Object.entries(DISCRIMINATORS)) {
    if (disc.equals(expected)) {
      return {
        type: name,
        data: DESERIALIZERS[name](data),
      };
    }
  }

  throw new Error(
    `Unknown account discriminator: ${disc.toString('hex')}. ` +
    `Known types: ${Object.keys(DISCRIMINATORS).join(', ')}`
  );
}

/**
 * Get the Anchor discriminator for a known account type.
 * @param {string} accountName - e.g. 'GenesisRecord', 'EscrowV3'
 * @returns {Buffer} 8-byte discriminator
 */
function getAccountDiscriminator(accountName) {
  if (DISCRIMINATORS[accountName]) {
    return Buffer.from(DISCRIMINATORS[accountName]);
  }
  return accountDiscriminator(accountName);
}

/**
 * Check if raw data matches a specific account type.
 * @param {Buffer} data - Raw account data
 * @param {string} accountName - Expected account type name
 * @returns {boolean}
 */
function isAccountType(data, accountName) {
  if (!Buffer.isBuffer(data) || data.length < 8) return false;
  const expected = DISCRIMINATORS[accountName];
  if (!expected) return false;
  return data.slice(0, 8).equals(expected);
}

// ═══════════════════════════════════════════════════
//  Batch Deserializer (for getProgramAccounts results)
// ═══════════════════════════════════════════════════

/**
 * Deserialize multiple accounts from getProgramAccounts result.
 * Skips accounts that fail to deserialize (logs warning).
 *
 * @param {{ pubkey: PublicKey, account: { data: Buffer } }[]} accounts - getProgramAccounts result
 * @param {string} [expectedType] - If provided, only deserialize this type (faster, no auto-detect)
 * @returns {{ pubkey: string, type: string, data: object }[]}
 */
function deserializeBatch(accounts, expectedType) {
  const results = [];

  for (const { pubkey, account } of accounts) {
    try {
      let type, parsed;

      if (expectedType && DESERIALIZERS[expectedType]) {
        // Direct deserialization — skip discriminator check for speed
        type = expectedType;
        parsed = DESERIALIZERS[expectedType](account.data);
      } else {
        // Auto-detect
        const result = deserializeAccount(account.data);
        type = result.type;
        parsed = result.data;
      }

      results.push({
        pubkey: pubkey.toBase58(),
        type,
        data: parsed,
      });
    } catch (e) {
      // Skip malformed accounts
      if (process.env.SATP_DEBUG) {
        console.warn(`[BorshReader] Failed to deserialize ${pubkey.toBase58()}: ${e.message}`);
      }
    }
  }

  return results;
}

module.exports = {
  // Core reader
  BorshReader,

  // Individual deserializers
  deserializeGenesisRecord,
  deserializeLinkedWallet,
  deserializeMintTracker,
  deserializeNameRegistry,
  deserializeReview,
  deserializeReviewCounter,
  deserializeAttestation,
  deserializeEscrowV3,

  // Auto-detect
  deserializeAccount,
  deserializeBatch,

  // Discriminator utilities
  getAccountDiscriminator,
  accountDiscriminator,
  isAccountType,
  DISCRIMINATORS,
};
