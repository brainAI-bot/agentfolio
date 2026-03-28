const { PublicKey } = require('@solana/web3.js');
const crypto = require('crypto');

// ═══════════════════════════════════════════════════
//  SATP V3 Program IDs — Devnet
// ═══════════════════════════════════════════════════

const V3_DEVNET_PROGRAM_IDS = {
  IDENTITY: new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG'),
  REVIEWS: new PublicKey('r9XX4frcqxxAZ6Au9V5PA3EAxs1zoNckqLLmoSRcNr4'),
  REPUTATION: new PublicKey('2Lz7KzMvKdrGeAuS8WPHu7jK2yScrnKVgacpYVEuDjkJ'),
  ATTESTATIONS: new PublicKey('6Xd1dAQJPvQRJ4Ntr6LtPTjDjPUZ8nfnmYLZaZ2DtrdD'),
  VALIDATION: new PublicKey('6rYRiCYidJYV7QvKrzKGgNu4oMh6BAvynked69R7xMbV'),
  ESCROW: new PublicKey('EscV3111111111111111111111111111111111111111'),
};

// V3 Mainnet IDs — same keypairs as devnet (same authority, same program IDs)
const V3_MAINNET_PROGRAM_IDS = {
  IDENTITY: new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG'),
  REVIEWS: new PublicKey('r9XX4frcqxxAZ6Au9V5PA3EAxs1zoNckqLLmoSRcNr4'),
  REPUTATION: new PublicKey('2Lz7KzMvKdrGeAuS8WPHu7jK2yScrnKVgacpYVEuDjkJ'),
  ATTESTATIONS: new PublicKey('6Xd1dAQJPvQRJ4Ntr6LtPTjDjPUZ8nfnmYLZaZ2DtrdD'),
  VALIDATION: new PublicKey('6rYRiCYidJYV7QvKrzKGgNu4oMh6BAvynked69R7xMbV'),
  ESCROW: new PublicKey('EscV3111111111111111111111111111111111111111'),
};

// ═══════════════════════════════════════════════════
//  V3 PDA Seeds — must match on-chain programs
// ═══════════════════════════════════════════════════

const V3_SEEDS = {
  GENESIS: 'genesis',
  REPUTATION_AUTHORITY: 'reputation_v3_authority',
  VALIDATION_AUTHORITY: 'validation_v3_authority',
  MINT_TRACKER: 'mint_tracker',
  NAME_REGISTRY: 'name_registry',
  LINKED_WALLET: 'linked_wallet',
  REVIEW: 'review_v3',
  REVIEW_COUNTER: 'review_counter_v3',
  ATTESTATION: 'attestation',
  ESCROW_V3: 'escrow_v3',
};

// ═══════════════════════════════════════════════════
//  V3 Program ID Getter
// ═══════════════════════════════════════════════════

function getV3ProgramIds(network = 'devnet') {
  return network === 'mainnet' ? V3_MAINNET_PROGRAM_IDS : V3_DEVNET_PROGRAM_IDS;
}

// ═══════════════════════════════════════════════════
//  Utility: Hash agent_id to 32-byte seed
// ═══════════════════════════════════════════════════

/**
 * Hash an agent_id string to 32-byte SHA-256 (matches on-chain solana_program::hash::hash).
 * @param {string} agentId - Agent identifier string
 * @returns {Buffer} 32-byte hash
 */
function hashAgentId(agentId) {
  return crypto.createHash('sha256').update(agentId, 'utf8').digest();
}

/**
 * Hash a name (lowercased) for name registry PDA.
 * @param {string} name
 * @returns {Buffer} 32-byte SHA-256 hash
 */
function hashName(name) {
  return crypto.createHash('sha256').update(name.toLowerCase(), 'utf8').digest();
}

// ═══════════════════════════════════════════════════
//  V3 PDA Derivation Functions
// ═══════════════════════════════════════════════════

/**
 * Derive Genesis Record PDA.
 * Seeds: ["genesis", agent_id_hash]
 * @param {string|Buffer} agentIdOrHash - agent_id string or 32-byte hash
 * @param {'mainnet'|'devnet'} network
 * @returns {[PublicKey, number]} [pda, bump]
 */
function getGenesisPDA(agentIdOrHash, network = 'devnet') {
  const hash = typeof agentIdOrHash === 'string'
    ? hashAgentId(agentIdOrHash)
    : Buffer.from(agentIdOrHash);
  const programIds = getV3ProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(V3_SEEDS.GENESIS), hash],
    programIds.IDENTITY
  );
}

/**
 * Derive Reputation V3 Authority PDA (CPI signer).
 * Seeds: ["reputation_v3_authority"]
 * @param {'mainnet'|'devnet'} network
 * @returns {[PublicKey, number]}
 */
function getV3ReputationAuthorityPDA(network = 'devnet') {
  const programIds = getV3ProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(V3_SEEDS.REPUTATION_AUTHORITY)],
    programIds.REPUTATION
  );
}

/**
 * Derive Validation V3 Authority PDA (CPI signer).
 * Seeds: ["validation_v3_authority"]
 * @param {'mainnet'|'devnet'} network
 * @returns {[PublicKey, number]}
 */
function getV3ValidationAuthorityPDA(network = 'devnet') {
  const programIds = getV3ProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(V3_SEEDS.VALIDATION_AUTHORITY)],
    programIds.VALIDATION
  );
}

/**
 * Derive MintTracker PDA.
 * Seeds: ["mint_tracker", genesis_pda]
 * @param {PublicKey|string} genesisPDA
 * @param {'mainnet'|'devnet'} network
 * @returns {[PublicKey, number]}
 */
function getV3MintTrackerPDA(genesisPDA, network = 'devnet') {
  const genesisKey = new PublicKey(genesisPDA);
  const programIds = getV3ProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(V3_SEEDS.MINT_TRACKER), genesisKey.toBuffer()],
    programIds.IDENTITY
  );
}

/**
 * Derive Name Registry PDA.
 * Seeds: ["name_registry", name_hash]
 * @param {string|Buffer} nameOrHash - Display name string or 32-byte hash
 * @param {'mainnet'|'devnet'} network
 * @returns {[PublicKey, number]}
 */
function getNameRegistryPDA(nameOrHash, network = 'devnet') {
  const hash = typeof nameOrHash === 'string'
    ? hashName(nameOrHash)
    : Buffer.from(nameOrHash);
  const programIds = getV3ProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(V3_SEEDS.NAME_REGISTRY), hash],
    programIds.IDENTITY
  );
}

/**
 * Derive Linked Wallet PDA.
 * Seeds: ["linked_wallet", genesis_pda, wallet]
 * @param {PublicKey|string} genesisPDA
 * @param {PublicKey|string} wallet
 * @param {'mainnet'|'devnet'} network
 * @returns {[PublicKey, number]}
 */
function getLinkedWalletPDA(genesisPDA, wallet, network = 'devnet') {
  const genesisKey = new PublicKey(genesisPDA);
  const walletKey = new PublicKey(wallet);
  const programIds = getV3ProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(V3_SEEDS.LINKED_WALLET), genesisKey.toBuffer(), walletKey.toBuffer()],
    programIds.IDENTITY
  );
}

/**
 * Derive V3 Review PDA (agent-scoped).
 * Seeds: ["review_v3", SHA256(agent_id), reviewer]
 * @param {string|Buffer} agentIdOrHash - agent_id string or 32-byte hash
 * @param {PublicKey|string} reviewer
 * @param {'mainnet'|'devnet'} network
 * @returns {[PublicKey, number]}
 */
function getV3ReviewPDA(agentIdOrHash, reviewer, network = 'devnet') {
  const hash = typeof agentIdOrHash === 'string'
    ? hashAgentId(agentIdOrHash)
    : Buffer.from(agentIdOrHash);
  const reviewerKey = new PublicKey(reviewer);
  const programIds = getV3ProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(V3_SEEDS.REVIEW), hash, reviewerKey.toBuffer()],
    programIds.REVIEWS
  );
}

/**
 * Derive V3 Review Counter PDA.
 * Seeds: ["review_counter_v3", SHA256(agent_id)]
 * @param {string|Buffer} agentIdOrHash - agent_id string or 32-byte hash
 * @param {'mainnet'|'devnet'} network
 * @returns {[PublicKey, number]}
 */
function getV3ReviewCounterPDA(agentIdOrHash, network = 'devnet') {
  const hash = typeof agentIdOrHash === 'string'
    ? hashAgentId(agentIdOrHash)
    : Buffer.from(agentIdOrHash);
  const programIds = getV3ProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(V3_SEEDS.REVIEW_COUNTER), hash],
    programIds.REVIEWS
  );
}

/**
 * Derive V3 Attestation PDA.
 * Seeds: ["attestation", agent_id_hash, attester, attestation_type]
 * @param {string|Buffer} agentIdOrHash
 * @param {PublicKey|string} attester
 * @param {string} attestationType
 * @param {'mainnet'|'devnet'} network
 * @returns {[PublicKey, number]}
 */
function getV3AttestationPDA(agentIdOrHash, attester, attestationType, network = 'devnet') {
  const hash = typeof agentIdOrHash === 'string'
    ? hashAgentId(agentIdOrHash)
    : Buffer.from(agentIdOrHash);
  const attesterKey = new PublicKey(attester);
  const programIds = getV3ProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(V3_SEEDS.ATTESTATION),
      hash,
      attesterKey.toBuffer(),
      Buffer.from(attestationType, 'utf8'),
    ],
    programIds.ATTESTATIONS
  );
}

/**
 * Derive Escrow V3 PDA.
 * Seeds: ["escrow_v3", client, description_hash, nonce_le_bytes]
 * @param {PublicKey|string} client - Client wallet
 * @param {Buffer} descriptionHash - 32-byte SHA-256 of job description
 * @param {number|bigint} nonce - Unique nonce (u64)
 * @param {'mainnet'|'devnet'} network
 * @returns {[PublicKey, number]}
 */
function getV3EscrowPDA(client, descriptionHash, nonce, network = 'devnet') {
  const clientKey = new PublicKey(client);
  const hashBuf = Buffer.isBuffer(descriptionHash) ? descriptionHash : Buffer.from(descriptionHash);
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(BigInt(nonce));
  const programIds = getV3ProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(V3_SEEDS.ESCROW_V3), clientKey.toBuffer(), hashBuf, nonceBuf],
    programIds.ESCROW
  );
}

module.exports = {
  // Program IDs
  V3_DEVNET_PROGRAM_IDS,
  V3_MAINNET_PROGRAM_IDS,
  getV3ProgramIds,
  V3_SEEDS,

  // Utilities
  hashAgentId,
  hashName,

  // PDA derivation
  getGenesisPDA,
  getV3ReputationAuthorityPDA,
  getV3ValidationAuthorityPDA,
  getV3MintTrackerPDA,
  getNameRegistryPDA,
  getLinkedWalletPDA,
  getV3ReviewPDA,
  getV3ReviewCounterPDA,
  getV3AttestationPDA,
  getV3EscrowPDA,
};
