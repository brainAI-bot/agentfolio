const { PublicKey } = require('@solana/web3.js');
const {
  getProgramIds,
  IDENTITY_SEED,
  REPUTATION_AUTHORITY_SEED,
  VALIDATION_AUTHORITY_SEED,
  REVIEW_COUNTER_SEED,
  MINT_TRACKER_SEED,
  REVIEWS_AUTHORITY_SEED,
  ATTESTATION_SEED,
  REVIEW_SEED,
  ESCROW_SEED,
} = require('./constants');

/**
 * Derive the Identity PDA for a wallet.
 * Seeds: ["identity", wallet_pubkey]
 * @param {PublicKey|string} wallet
 * @param {'mainnet'|'devnet'} network
 */
function getIdentityPDA(wallet, network = 'devnet') {
  const walletKey = new PublicKey(wallet);
  const programIds = getProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(IDENTITY_SEED), walletKey.toBuffer()],
    programIds.IDENTITY
  );
}

/**
 * Derive the Reputation Authority PDA (program signer for CPI).
 * Seeds: ["reputation_authority"]
 * @param {'mainnet'|'devnet'} network
 */
function getReputationAuthorityPDA(network = 'devnet') {
  const programIds = getProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(REPUTATION_AUTHORITY_SEED)],
    programIds.REPUTATION
  );
}

/**
 * Derive the Validation Authority PDA (program signer for CPI).
 * Seeds: ["validation_authority"]
 * @param {'mainnet'|'devnet'} network
 */
function getValidationAuthorityPDA(network = 'devnet') {
  const programIds = getProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(VALIDATION_AUTHORITY_SEED)],
    programIds.VALIDATION
  );
}

/**
 * Derive the Review Counter PDA for an agent.
 * Seeds: ["review_counter", agent_id]
 * @param {PublicKey|string} agentId
 * @param {'mainnet'|'devnet'} network
 */
function getReviewCounterPDA(agentId, network = 'devnet') {
  const agentKey = new PublicKey(agentId);
  const programIds = getProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(REVIEW_COUNTER_SEED), agentKey.toBuffer()],
    programIds.REVIEWS
  );
}

/**
 * Derive the MintTracker PDA for an identity.
 * Seeds: ["mint_tracker", identity_pda]
 * @param {PublicKey|string} identityPDA
 * @param {'mainnet'|'devnet'} network
 */
function getMintTrackerPDA(identityPDA, network = 'devnet') {
  const identityKey = new PublicKey(identityPDA);
  const programIds = getProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(MINT_TRACKER_SEED), identityKey.toBuffer()],
    programIds.IDENTITY
  );
}

/**
 * Derive the Reviews Authority PDA (program signer for CPI into Attestations).
 * Seeds: ["reviews_authority"]
 * @param {'mainnet'|'devnet'} network
 */
function getReviewsAuthorityPDA(network = 'devnet') {
  const programIds = getProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(REVIEWS_AUTHORITY_SEED)],
    programIds.REVIEWS
  );
}

/**
 * Derive the Review PDA for a specific reviewer + agent pair.
 * Seeds: ["review", agent_id, reviewer]
 * @param {PublicKey|string} agentId
 * @param {PublicKey|string} reviewer
 * @param {'mainnet'|'devnet'} network
 */
function getReviewPDA(agentId, reviewer, network = 'devnet') {
  const agentKey = new PublicKey(agentId);
  const reviewerKey = new PublicKey(reviewer);
  const programIds = getProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(REVIEW_SEED), agentKey.toBuffer(), reviewerKey.toBuffer()],
    programIds.REVIEWS
  );
}

/**
 * Derive the Review Attestation PDA (auto-created via CPI when a review is submitted).
 * Seeds: ["attestation", agent_id, reviews_authority, "review", reviewer]
 * @param {PublicKey|string} agentId
 * @param {PublicKey} reviewsAuthority - Use getReviewsAuthorityPDA() to derive
 * @param {PublicKey|string} reviewer
 * @param {'mainnet'|'devnet'} network
 */
function getReviewAttestationPDA(agentId, reviewsAuthority, reviewer, network = 'devnet') {
  const agentKey = new PublicKey(agentId);
  const reviewerKey = new PublicKey(reviewer);
  const programIds = getProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(ATTESTATION_SEED),
      agentKey.toBuffer(),
      reviewsAuthority.toBuffer(),
      Buffer.from(REVIEW_SEED),
      reviewerKey.toBuffer(),
    ],
    programIds.ATTESTATIONS
  );
}

/**
 * Derive the Escrow PDA for a client + description_hash pair.
 * Seeds: ["escrow", client_pubkey, description_hash]
 * @param {PublicKey|string} client - Client wallet
 * @param {Buffer|number[]} descriptionHash - 32-byte SHA256 hash of job description
 * @param {'mainnet'|'devnet'} network
 */
function getEscrowPDA(client, descriptionHash, network = 'devnet') {
  const clientKey = new PublicKey(client);
  const hashBuf = Buffer.isBuffer(descriptionHash)
    ? descriptionHash
    : Buffer.from(descriptionHash);
  const programIds = getProgramIds(network);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(ESCROW_SEED), clientKey.toBuffer(), hashBuf],
    programIds.ESCROW
  );
}

module.exports = {
  getIdentityPDA,
  getReputationAuthorityPDA,
  getValidationAuthorityPDA,
  getReviewCounterPDA,
  getMintTrackerPDA,
  getReviewsAuthorityPDA,
  getReviewPDA,
  getReviewAttestationPDA,
  getEscrowPDA,
};
