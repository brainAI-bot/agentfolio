const { PublicKey } = require('@solana/web3.js');

// SATP V3 Program IDs (Mainnet — same keypairs as devnet)
const PROGRAM_IDS = {
  IDENTITY_V3: new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG'),
  REVIEWS_V3: new PublicKey('r9XX4frcqxxAZ6Au9V5PA3EAxs1zoNckqLLmoSRcNr4'),
  REPUTATION_V3: new PublicKey('2Lz7KzMvKdrGeAuS8WPHu7jK2yScrnKVgacpYVEuDjkJ'),
  ATTESTATIONS_V3: new PublicKey('6Xd1dAQJPvQRJ4Ntr6LtPTjDjPUZ8nfnmYLZaZ2DtrdD'),
  VALIDATION_V3: new PublicKey('6rYRiCYidJYV7QvKrzKGgNu4oMh6BAvynked69R7xMbV'),
  // Legacy V1 (kept for backward compat)
  IDENTITY: new PublicKey('BY4jzmnrui1K5gZ5z5xRQkVfEEMXYHYugtH1Ua867eyr'),
  REPUTATION: new PublicKey('TQ4P9R2Y5FRyw1TZfwoWQ2Mf6XeohbGdhYNcDxh6YYh'),
  VALIDATION: new PublicKey('AdDWFa9oEmZdrTrhu8YTWu4ozbTP7e6qa9rvyqfAvM7N'),
  ESCROW: new PublicKey('STyY8w4ZHws3X1AMoocWuDYBoogVDwvymPy8Wifx5TH'),
};

const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const DEVNET_RPC = 'https://api.devnet.solana.com';

// V3 PDA seeds
const GENESIS_SEED = 'genesis';
const REVIEW_V3_SEED = 'review_v3';
const REVIEW_COUNTER_V3_SEED = 'review_counter_v3';
const ATTESTATION_V3_SEED = 'attestation_v3';
const LINKED_WALLET_SEED = 'linked_wallet';
const MINT_TRACKER_SEED = 'mint_tracker';

// Legacy V1 seeds
const IDENTITY_SEED = 'identity';
const REPUTATION_SEED = 'reputation';

function getProgramIds(network) {
  return PROGRAM_IDS;
}

function getRpcUrl(network) {
  return network === 'devnet' ? DEVNET_RPC : MAINNET_RPC;
}

module.exports = {
  PROGRAM_IDS, MAINNET_RPC, DEVNET_RPC, getProgramIds, getRpcUrl,
  GENESIS_SEED, REVIEW_V3_SEED, REVIEW_COUNTER_V3_SEED,
  ATTESTATION_V3_SEED, LINKED_WALLET_SEED, MINT_TRACKER_SEED,
  IDENTITY_SEED, REPUTATION_SEED,
};

// V3 Name Registry seed (added 2026-03-22)
const NAME_REGISTRY_SEED = 'name_registry';
module.exports.NAME_REGISTRY_SEED = NAME_REGISTRY_SEED;
