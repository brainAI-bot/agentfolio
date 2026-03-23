const { PublicKey } = require('@solana/web3.js');
const crypto = require('crypto');
const {
  PROGRAM_IDS, GENESIS_SEED, REVIEW_V3_SEED, REVIEW_COUNTER_V3_SEED,
  ATTESTATION_V3_SEED, LINKED_WALLET_SEED, MINT_TRACKER_SEED,
  IDENTITY_SEED, REPUTATION_SEED,
} = require('./constants');

// ═══ V3 HELPERS ═══

/** SHA-256 hash of agent_id string → 32-byte Buffer. Matches on-chain agent_id_hash(). */
function agentIdHash(agentId) {
  return crypto.createHash('sha256').update(agentId).digest();
}

/** Derive Genesis Record PDA: [b"genesis", sha256(agent_id)] */
function getGenesisPDA(agentId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(GENESIS_SEED), agentIdHash(agentId)],
    PROGRAM_IDS.IDENTITY_V3
  );
}

/** Derive Linked Wallet PDA: [b"linked_wallet", genesis_pda, wallet] */
function getLinkedWalletPDA(genesisPda, wallet) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(LINKED_WALLET_SEED), new PublicKey(genesisPda).toBuffer(), new PublicKey(wallet).toBuffer()],
    PROGRAM_IDS.IDENTITY_V3
  );
}

/** Derive Mint Tracker PDA: [b"mint_tracker", genesis_pda] */
function getMintTrackerPDA(genesisPda) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(MINT_TRACKER_SEED), new PublicKey(genesisPda).toBuffer()],
    PROGRAM_IDS.IDENTITY_V3
  );
}

/** Derive Review V3 PDA: [b"review_v3", sha256(agent_id), reviewer] */
function getReviewPDA(agentId, reviewer) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(REVIEW_V3_SEED), agentIdHash(agentId), new PublicKey(reviewer).toBuffer()],
    PROGRAM_IDS.REVIEWS_V3
  );
}

/** Derive Review Counter V3 PDA: [b"review_counter_v3", sha256(agent_id)] */
function getReviewCounterPDA(agentId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(REVIEW_COUNTER_V3_SEED), agentIdHash(agentId)],
    PROGRAM_IDS.REVIEWS_V3
  );
}

/** Derive Attestation V3 PDA: [b"attestation_v3", sha256(agent_id), issuer, type] */
function getAttestationPDA(agentId, issuer, attestationType) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(ATTESTATION_V3_SEED),
      agentIdHash(agentId),
      new PublicKey(issuer).toBuffer(),
      Buffer.from(attestationType),
    ],
    PROGRAM_IDS.ATTESTATIONS_V3
  );
}

/** Derive Reputation V3 Authority PDA */
function getReputationAuthorityPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('reputation_v3_authority')],
    PROGRAM_IDS.REPUTATION_V3
  );
}

/** Derive Validation V3 Authority PDA */
function getValidationAuthorityPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('validation_v3_authority')],
    PROGRAM_IDS.VALIDATION_V3
  );
}

/** Resolve agent_id → Genesis PDA address (zero-trust lookup) */
function resolveAgent(agentId) {
  const [pda] = getGenesisPDA(agentId);
  return pda;
}

// ═══ LEGACY V1 HELPERS (backward compat) ═══

function getIdentityPDA(wallet) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(IDENTITY_SEED), new PublicKey(wallet).toBuffer()],
    PROGRAM_IDS.IDENTITY
  );
}

function getReputationPDA(wallet) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(REPUTATION_SEED), new PublicKey(wallet).toBuffer()],
    PROGRAM_IDS.REPUTATION
  );
}

module.exports = {
  // V3
  agentIdHash, getGenesisPDA, getLinkedWalletPDA, getMintTrackerPDA,
  getReviewPDA, getReviewCounterPDA, getAttestationPDA,
  getReputationAuthorityPDA, getValidationAuthorityPDA, resolveAgent,
  // Legacy
  getIdentityPDA, getReputationPDA,
};

// ═══ NAME REGISTRY (added 2026-03-22) ═══

/** Compute name hash: SHA-256(lowercase(name)) */
function nameHash(name) {
  return crypto.createHash('sha256').update(name.toLowerCase()).digest();
}

/** Derive Name Registry PDA: [b"name_registry", sha256(lowercase(name))] */
function getNameRegistryPDA(name) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('name_registry'), nameHash(name)],
    PROGRAM_IDS.IDENTITY_V3
  );
}

module.exports.nameHash = nameHash;
module.exports.getNameRegistryPDA = getNameRegistryPDA;
