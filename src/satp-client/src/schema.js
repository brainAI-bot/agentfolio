const borsh = require('borsh');

// ═══ V3 — GENESIS RECORD ═══

class GenesisRecordAccount {
  constructor(fields) {
    this.discriminator = fields.discriminator;   // 8 bytes
    this.agentIdHash = fields.agentIdHash;       // 32 bytes
    this.agentName = fields.agentName;           // string
    this.description = fields.description;       // string
    this.category = fields.category;             // string
    this.capabilities = fields.capabilities;     // string[]
    this.metadataUri = fields.metadataUri;       // string
    this.faceImage = fields.faceImage;           // string (Arweave URL)
    this.faceMint = fields.faceMint;             // 32 bytes (soulbound BOA mint)
    this.faceBurnTx = fields.faceBurnTx;         // string (burn TX sig)
    this.genesisRecord = fields.genesisRecord;   // i64 (0 = unborn)
    this.authority = fields.authority;           // 32 bytes
    // pendingAuthority is Option<Pubkey> — complex, skip in borsh for now
    this.reputationScore = fields.reputationScore; // u64
    this.verificationLevel = fields.verificationLevel; // u8
    this.reputationUpdatedAt = fields.reputationUpdatedAt; // i64
    this.verificationUpdatedAt = fields.verificationUpdatedAt; // i64
    this.createdAt = fields.createdAt;           // i64
    this.updatedAt = fields.updatedAt;           // i64
    this.bump = fields.bump;                     // u8
  }
}

// Note: For full deserialization of Genesis Record with Option<Pubkey>,
// prefer using the Anchor IDL + @coral-xyz/anchor. This borsh schema is
// for lightweight reads of core fields.

// ═══ V3 — REVIEW ═══

class ReviewV3Account {
  constructor(fields) {
    this.discriminator = fields.discriminator;
    this.agentId = fields.agentId;
    this.agentIdHash = fields.agentIdHash;
    this.reviewer = fields.reviewer;
    this.rating = fields.rating;
    this.reviewText = fields.reviewText;
    this.metadata = fields.metadata;
    this.createdAt = fields.createdAt;
    this.updatedAt = fields.updatedAt;
    this.isActive = fields.isActive;
    this.bump = fields.bump;
  }
}

// ═══ LEGACY V1 SCHEMAS ═══

class IdentityAccount {
  constructor(fields) {
    this.discriminator = fields.discriminator;
    this.owner = fields.owner;
    this.agentName = fields.agentName;
    this.metadata = fields.metadata;
    this.createdAt = fields.createdAt;
    this.updatedAt = fields.updatedAt;
    this.bump = fields.bump;
  }
}

const IDENTITY_SCHEMA = new Map([
  [IdentityAccount, {
    kind: 'struct',
    fields: [
      ['discriminator', [8]],
      ['owner', [32]],
      ['agentName', 'string'],
      ['metadata', 'string'],
      ['createdAt', 'u64'],
      ['updatedAt', 'u64'],
      ['bump', 'u8'],
    ],
  }],
]);

class ReputationAccount {
  constructor(fields) {
    this.discriminator = fields.discriminator;
    this.owner = fields.owner;
    this.score = fields.score;
    this.endorsements = fields.endorsements;
    this.lastEndorser = fields.lastEndorser;
    this.updatedAt = fields.updatedAt;
    this.bump = fields.bump;
  }
}

const REPUTATION_SCHEMA = new Map([
  [ReputationAccount, {
    kind: 'struct',
    fields: [
      ['discriminator', [8]],
      ['owner', [32]],
      ['score', 'u64'],
      ['endorsements', 'u32'],
      ['lastEndorser', [32]],
      ['updatedAt', 'u64'],
      ['bump', 'u8'],
    ],
  }],
]);

module.exports = {
  GenesisRecordAccount, ReviewV3Account,
  IdentityAccount, IDENTITY_SCHEMA,
  ReputationAccount, REPUTATION_SCHEMA,
};
