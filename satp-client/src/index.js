const {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} = require('@solana/web3.js');
const borsh = require('borsh');
const { PROGRAM_IDS, MAINNET_RPC } = require('./constants');
const { getIdentityPDA, getReputationPDA } = require('./pda');
const {
  IdentityAccount, IDENTITY_SCHEMA,
  ReputationAccount, REPUTATION_SCHEMA,
} = require('./schema');

class SATPSDK {
  /**
   * @param {object} opts
   * @param {string} [opts.rpcUrl] - Solana RPC endpoint (default: mainnet)
   * @param {string} [opts.commitment] - Commitment level (default: confirmed)
   */
  constructor(opts = {}) {
    this.rpcUrl = opts.rpcUrl || MAINNET_RPC;
    this.commitment = opts.commitment || 'confirmed';
    this.connection = new Connection(this.rpcUrl, this.commitment);
  }

  // ─── Identity ──────────────────────────────────────────

  /**
   * Build a registerIdentity transaction (caller signs & sends).
   * @param {PublicKey|string} wallet - Owner wallet
   * @param {string} agentName
   * @param {string|object} metadata - JSON string or object
   * @returns {{ transaction: Transaction, identityPDA: PublicKey }}
   */
  async buildRegisterIdentity(wallet, agentName, metadata) {
    const walletKey = new PublicKey(wallet);
    const [identityPDA, bump] = getIdentityPDA(walletKey);
    const metaStr = typeof metadata === 'object' ? JSON.stringify(metadata) : metadata;

    // Anchor discriminator for "register_identity" (first 8 bytes of SHA256("global:register_identity"))
    const crypto = require('crypto');
    const disc = crypto.createHash('sha256')
      .update('global:register_identity')
      .digest()
      .slice(0, 8);

    // Encode instruction data: discriminator + agentName (borsh string) + metadata (borsh string)
    const nameBytes = Buffer.from(agentName, 'utf8');
    const metaBytes = Buffer.from(metaStr, 'utf8');

    const data = Buffer.concat([
      disc,
      // borsh string = u32 len + bytes
      Buffer.from(new Uint32Array([nameBytes.length]).buffer),
      nameBytes,
      Buffer.from(new Uint32Array([metaBytes.length]).buffer),
      metaBytes,
    ]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_IDS.IDENTITY,
      keys: [
        { pubkey: walletKey, isSigner: true, isWritable: true },
        { pubkey: identityPDA, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = walletKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx, identityPDA };
  }

  /**
   * Register an identity on-chain (requires a Keypair signer).
   * @param {import('@solana/web3.js').Keypair} signer
   * @param {string} agentName
   * @param {string|object} metadata
   * @returns {Promise<string>} Transaction signature
   */
  async registerIdentity(signer, agentName, metadata) {
    const { transaction } = await this.buildRegisterIdentity(signer.publicKey, agentName, metadata);
    const sig = await this.connection.sendTransaction(transaction, [signer]);
    await this.connection.confirmTransaction(sig, this.commitment);
    return sig;
  }

  /**
   * Fetch identity data for a wallet. Returns null if not found.
   * @param {PublicKey|string} wallet
   * @returns {Promise<object|null>}
   */
  async getIdentity(wallet) {
    const [pda] = getIdentityPDA(new PublicKey(wallet));
    const acct = await this.connection.getAccountInfo(pda);
    if (!acct) return null;

    try {
      const decoded = borsh.deserialize(IDENTITY_SCHEMA, IdentityAccount, acct.data);
      return {
        owner: new PublicKey(decoded.owner).toBase58(),
        agentName: decoded.agentName,
        metadata: decoded.metadata,
        createdAt: Number(decoded.createdAt),
        updatedAt: Number(decoded.updatedAt),
        pda: pda.toBase58(),
      };
    } catch (e) {
      // If schema doesn't match exactly, return raw
      return { pda: pda.toBase58(), raw: acct.data.toString('hex'), error: e.message };
    }
  }

  // ─── Reputation ────────────────────────────────────────

  /**
   * Build an addReputation transaction.
   * @param {PublicKey|string} wallet - Target agent wallet
   * @param {number} score - Reputation score to add
   * @param {PublicKey|string} endorser - Endorser wallet (signer)
   * @returns {{ transaction: Transaction, reputationPDA: PublicKey }}
   */
  async buildAddReputation(wallet, score, endorser) {
    const walletKey = new PublicKey(wallet);
    const endorserKey = new PublicKey(endorser);
    const [repPDA] = getReputationPDA(walletKey);

    const crypto = require('crypto');
    const disc = crypto.createHash('sha256')
      .update('global:add_reputation')
      .digest()
      .slice(0, 8);

    const scoreBuf = Buffer.alloc(8);
    scoreBuf.writeBigUInt64LE(BigInt(score));

    const data = Buffer.concat([disc, scoreBuf]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_IDS.REPUTATION,
      keys: [
        { pubkey: endorserKey, isSigner: true, isWritable: true },
        { pubkey: walletKey, isSigner: false, isWritable: false },
        { pubkey: repPDA, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = endorserKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx, reputationPDA: repPDA };
  }

  /**
   * Add reputation on-chain (requires endorser Keypair).
   */
  async addReputation(endorserKeypair, targetWallet, score) {
    const { transaction } = await this.buildAddReputation(targetWallet, score, endorserKeypair.publicKey);
    const sig = await this.connection.sendTransaction(transaction, [endorserKeypair]);
    await this.connection.confirmTransaction(sig, this.commitment);
    return sig;
  }

  /**
   * Fetch reputation data for a wallet. Returns null if not found.
   */
  async getReputation(wallet) {
    const [pda] = getReputationPDA(new PublicKey(wallet));
    const acct = await this.connection.getAccountInfo(pda);
    if (!acct) return null;

    try {
      const decoded = borsh.deserialize(REPUTATION_SCHEMA, ReputationAccount, acct.data);
      return {
        owner: new PublicKey(decoded.owner).toBase58(),
        score: Number(decoded.score),
        endorsements: decoded.endorsements,
        lastEndorser: new PublicKey(decoded.lastEndorser).toBase58(),
        updatedAt: Number(decoded.updatedAt),
        pda: pda.toBase58(),
      };
    } catch (e) {
      return { pda: pda.toBase58(), raw: acct.data.toString('hex'), error: e.message };
    }
  }

  // ─── Verification ──────────────────────────────────────

  /**
   * Check if a wallet has a registered SATP identity.
   * @param {PublicKey|string} wallet
   * @returns {Promise<boolean>}
   */
  async verifyAgent(wallet) {
    const identity = await this.getIdentity(wallet);
    return identity !== null && !identity.error;
  }

  // ─── Utility ───────────────────────────────────────────

  /**
   * Derive PDAs without making RPC calls.
   */
  getPDAs(wallet) {
    const [identityPDA] = getIdentityPDA(new PublicKey(wallet));
    const [repPDA] = getReputationPDA(new PublicKey(wallet));
    return {
      identity: identityPDA.toBase58(),
      reputation: repPDA.toBase58(),
    };
  }
}

module.exports = { SATPSDK, PROGRAM_IDS, getIdentityPDA, getReputationPDA };
