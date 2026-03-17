const { PublicKey } = require('@solana/web3.js');
const { PROGRAM_IDS, IDENTITY_SEED, REPUTATION_SEED } = require('./constants');

/**
 * Derive the Identity PDA for a wallet.
 * Convention: seeds = ["identity", wallet_pubkey]
 */
function getIdentityPDA(wallet) {
  const walletKey = new PublicKey(wallet);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(IDENTITY_SEED), walletKey.toBuffer()],
    PROGRAM_IDS.IDENTITY
  );
}

/**
 * Derive the Reputation PDA for a wallet.
 * Convention: seeds = ["reputation", wallet_pubkey]
 */
function getReputationPDA(wallet) {
  const walletKey = new PublicKey(wallet);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(REPUTATION_SEED), walletKey.toBuffer()],
    PROGRAM_IDS.REPUTATION
  );
}

module.exports = { getIdentityPDA, getReputationPDA };
