const borsh = require('borsh');

// ---- Identity Account Schema ----
class IdentityAccount {
  constructor(fields) {
    this.discriminator = fields.discriminator; // 8 bytes (Anchor)
    this.owner = fields.owner;                 // 32 bytes pubkey
    this.agentName = fields.agentName;         // string
    this.metadata = fields.metadata;           // string (JSON)
    this.createdAt = fields.createdAt;         // i64 timestamp
    this.updatedAt = fields.updatedAt;         // i64 timestamp
    this.bump = fields.bump;                   // u8
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

// ---- Reputation Account Schema ----
class ReputationAccount {
  constructor(fields) {
    this.discriminator = fields.discriminator;
    this.owner = fields.owner;
    this.score = fields.score;               // u64
    this.endorsements = fields.endorsements; // u32 count
    this.lastEndorser = fields.lastEndorser; // 32 bytes pubkey
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

module.exports = { IdentityAccount, IDENTITY_SCHEMA, ReputationAccount, REPUTATION_SCHEMA };
