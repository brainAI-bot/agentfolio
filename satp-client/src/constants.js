const { PublicKey } = require('@solana/web3.js');

const PROGRAM_IDS = {
  IDENTITY: new PublicKey('BY4jzmnrui1K5gZ5z5xRQkVfEEMXYHYugtH1Ua867eyr'),
  REPUTATION: new PublicKey('TQ4P9R2Y5FRyw1TZfwoWQ2Mf6XeohbGdhYNcDxh6YYh'),
  VALIDATION: new PublicKey('AdDWFa9oEmZdrTrhu8YTWu4ozbTP7e6qa9rvyqfAvM7N'),
  ESCROW: new PublicKey('STyY8w4ZHws3X1AMoocWuDYBoogVDwvymPy8Wifx5TH'),
};

const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const DEVNET_RPC = 'https://api.devnet.solana.com';

// PDA seeds (Anchor convention)
const IDENTITY_SEED = 'identity';
const REPUTATION_SEED = 'reputation';

module.exports = { PROGRAM_IDS, MAINNET_RPC, DEVNET_RPC, IDENTITY_SEED, REPUTATION_SEED };
