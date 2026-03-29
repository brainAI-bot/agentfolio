const { PublicKey } = require('@solana/web3.js');

// SATP v2 Program IDs — Devnet
const DEVNET_PROGRAM_IDS = {
  IDENTITY: new PublicKey('EJtQh4Gyg88zXvSmFpxYkkeZsPwTsjfm4LvjmPQX1FD3'),
  REVIEWS: new PublicKey('D8HsSpK3JtAN7tVcA1yfgxScju7KcG6skEfaShSKojki'),
  REPUTATION: new PublicKey('4y4W2Mdfpu91C4iVowiDyJTmdKSjo8bmSDQrX2c84WQF'),
  ATTESTATIONS: new PublicKey('9xT3eNcndkmnqZtJqDQ1ggckHK7Dxo5EsAt5mHqsPBhP'),
  VALIDATION: new PublicKey('8jLaqodAzfM7oCxP7aedFeszeNjnJ5ik56dzhDU2HQgc'),
  ESCROW: new PublicKey('UpJ7jmUzHkQ7EdBKiBv3zq8Dr1fVh6GVWKa7nYtwQ22'),
};

// SATP v2 Program IDs — Mainnet
const MAINNET_PROGRAM_IDS = {
  IDENTITY: new PublicKey('97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq'),
  REVIEWS: new PublicKey('Ge1sD2qwmH8QaaKCPZzZERvsFXNVMvKbAgTp2p17yjLK'),
  REPUTATION: new PublicKey('C9ogv8TBrvFy4pLKDoGQg9B73Q5rKPPsQ4kzkcDk6Jd'),
  ATTESTATIONS: new PublicKey('ENvaD19QzwWWMJFu5r5xJ9SmHqWN6GvyzxACRejqbdug'),
  VALIDATION: new PublicKey('9p795d2j3eGqzborG2AncucWBaU6PieKxmhKVroV3LNh'),
  ESCROW: new PublicKey('UpJ7jmUzHkQ7EdBKiBv3zq8Dr1fVh6GVWKa7nYtwQ22'), // TODO: update after mainnet deploy
};

const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const DEVNET_RPC = 'https://api.devnet.solana.com';

// PDA seeds (must match on-chain programs)
const IDENTITY_SEED = 'identity';
const REPUTATION_AUTHORITY_SEED = 'reputation_authority';
const VALIDATION_AUTHORITY_SEED = 'validation_authority';
const REVIEW_COUNTER_SEED = 'review_counter';
const MINT_TRACKER_SEED = 'mint_tracker';
const REVIEWS_AUTHORITY_SEED = 'reviews_authority';
const ATTESTATION_SEED = 'attestation';
const REVIEW_SEED = 'review';
const ESCROW_SEED = 'escrow';

/**
 * Get program IDs for a given network.
 * @param {'mainnet'|'devnet'} network
 * @returns {object} Program ID map
 */
function getProgramIds(network = 'devnet') {
  return network === 'mainnet' ? MAINNET_PROGRAM_IDS : DEVNET_PROGRAM_IDS;
}

/**
 * Get RPC URL for a given network.
 * @param {'mainnet'|'devnet'} network
 * @returns {string} RPC URL
 */
function getRpcUrl(network = 'devnet') {
  return network === 'mainnet' ? MAINNET_RPC : DEVNET_RPC;
}

module.exports = {
  DEVNET_PROGRAM_IDS,
  MAINNET_PROGRAM_IDS,
  getProgramIds,
  getRpcUrl,
  MAINNET_RPC,
  DEVNET_RPC,
  IDENTITY_SEED,
  REPUTATION_AUTHORITY_SEED,
  VALIDATION_AUTHORITY_SEED,
  REVIEW_COUNTER_SEED,
  MINT_TRACKER_SEED,
  REVIEWS_AUTHORITY_SEED,
  ATTESTATION_SEED,
  REVIEW_SEED,
  ESCROW_SEED,
};
