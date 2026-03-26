const {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} = require('@solana/web3.js');
const borsh = require('borsh');
const { getProgramIds, getRpcUrl } = require('./constants');
const {
  getIdentityPDA,
  getReputationAuthorityPDA,
  getValidationAuthorityPDA,
  getReviewCounterPDA,
  getMintTrackerPDA,
  getReviewsAuthorityPDA,
  getReviewPDA,
  getReviewAttestationPDA,
  getEscrowPDA,
} = require('./pda');
const {
  IdentityAccount, IDENTITY_SCHEMA,
  ReputationAccount, REPUTATION_SCHEMA,
} = require('./schema');
const crypto = require('crypto');

/**
 * Compute Anchor instruction discriminator.
 * @param {string} ixName - e.g. "create_identity"
 * @returns {Buffer} 8-byte discriminator
 */
function anchorDiscriminator(ixName) {
  return crypto.createHash('sha256')
    .update(`global:${ixName}`)
    .digest()
    .slice(0, 8);
}

class SATPSDK {
  /**
   * @param {object} opts
   * @param {'mainnet'|'devnet'} [opts.network='devnet'] - Network selection
   * @param {string} [opts.rpcUrl] - Custom RPC endpoint (overrides network default)
   * @param {string} [opts.commitment='confirmed'] - Commitment level
   */
  constructor(opts = {}) {
    this.network = opts.network || 'devnet';
    this.rpcUrl = opts.rpcUrl || getRpcUrl(this.network);
    this.commitment = opts.commitment || 'confirmed';
    this.connection = new Connection(this.rpcUrl, this.commitment);
    this.programIds = getProgramIds(this.network);
  }

  // ─── Identity ──────────────────────────────────────────

  /**
   * Build a createIdentity transaction.
   * @param {PublicKey|string} wallet - Owner wallet (signer)
   * @param {string} agentName
   * @param {string|object} metadata - JSON string or object
   * @returns {{ transaction: Transaction, identityPDA: PublicKey }}
   */
  async buildCreateIdentity(wallet, agentName, metadata) {
    const walletKey = new PublicKey(wallet);
    const [identityPDA] = getIdentityPDA(walletKey, this.network);
    const metaStr = typeof metadata === 'object' ? JSON.stringify(metadata) : metadata;

    const disc = anchorDiscriminator('create_identity');
    const nameBytes = Buffer.from(agentName, 'utf8');
    const metaBytes = Buffer.from(metaStr, 'utf8');

    const data = Buffer.concat([
      disc,
      Buffer.from(new Uint32Array([nameBytes.length]).buffer),
      nameBytes,
      Buffer.from(new Uint32Array([metaBytes.length]).buffer),
      metaBytes,
    ]);

    const ix = new TransactionInstruction({
      programId: this.programIds.IDENTITY,
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
   * Create an identity on-chain (requires a Keypair signer).
   */
  async createIdentity(signer, agentName, metadata) {
    const { transaction } = await this.buildCreateIdentity(signer.publicKey, agentName, metadata);
    const sig = await this.connection.sendTransaction(transaction, [signer]);
    await this.connection.confirmTransaction(sig, this.commitment);
    return sig;
  }

  /**
   * Fetch identity data for a wallet. Returns null if not found.
   */
  async getIdentity(wallet) {
    const [pda] = getIdentityPDA(new PublicKey(wallet), this.network);
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
      return { pda: pda.toBase58(), raw: acct.data.toString('hex'), error: e.message };
    }
  }

  // ─── Reputation (v2 CPI-based recompute) ───────────────

  /**
   * Build a recomputeReputation transaction.
   * This is permissionless — anyone can call it to recompute an agent's score.
   * The Reputation program CPIs into Identity to update the score.
   *
   * @param {PublicKey|string} agentWallet - Agent whose reputation to recompute
   * @param {PublicKey|string} payer - Transaction fee payer (signer)
   * @returns {{ transaction: Transaction }}
   */
  async buildRecomputeReputation(agentWallet, payer) {
    const agentKey = new PublicKey(agentWallet);
    const payerKey = new PublicKey(payer);
    const [identityPDA] = getIdentityPDA(agentKey, this.network);
    const [repAuthority] = getReputationAuthorityPDA(this.network);
    const [reviewCounter] = getReviewCounterPDA(agentKey, this.network);

    const disc = anchorDiscriminator('recompute_reputation');

    const ix = new TransactionInstruction({
      programId: this.programIds.REPUTATION,
      keys: [
        { pubkey: payerKey, isSigner: true, isWritable: true },
        { pubkey: identityPDA, isSigner: false, isWritable: true },
        { pubkey: reviewCounter, isSigner: false, isWritable: false },
        { pubkey: repAuthority, isSigner: false, isWritable: false },
        { pubkey: this.programIds.IDENTITY, isSigner: false, isWritable: false },
      ],
      data: disc,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = payerKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  /**
   * Trigger reputation recompute (permissionless).
   */
  async recomputeReputation(signerKeypair, agentWallet) {
    const { transaction } = await this.buildRecomputeReputation(agentWallet, signerKeypair.publicKey);
    const sig = await this.connection.sendTransaction(transaction, [signerKeypair]);
    await this.connection.confirmTransaction(sig, this.commitment);
    return sig;
  }

  /**
   * Fetch reputation data for a wallet.
   */
  async getReputation(wallet) {
    const [pda] = getIdentityPDA(new PublicKey(wallet), this.network);
    const acct = await this.connection.getAccountInfo(pda);
    if (!acct) return null;

    try {
      const decoded = borsh.deserialize(IDENTITY_SCHEMA, IdentityAccount, acct.data);
      return {
        owner: new PublicKey(decoded.owner).toBase58(),
        agentName: decoded.agentName,
        reputationScore: decoded.reputationScore || 0,
        verificationLevel: decoded.verificationLevel || 0,
        pda: pda.toBase58(),
      };
    } catch (e) {
      return { pda: pda.toBase58(), raw: acct.data.toString('hex'), error: e.message };
    }
  }

  // ─── Validation (v2 CPI-based recompute) ───────────────

  /**
   * Build a recomputeLevel transaction.
   * Permissionless — recomputes verification level based on attestation count.
   *
   * @param {PublicKey|string} agentWallet - Agent whose level to recompute
   * @param {PublicKey|string} payer - Transaction fee payer
   * @returns {{ transaction: Transaction }}
   */
  async buildRecomputeLevel(agentWallet, payer) {
    const agentKey = new PublicKey(agentWallet);
    const payerKey = new PublicKey(payer);
    const [identityPDA] = getIdentityPDA(agentKey, this.network);
    const [valAuthority] = getValidationAuthorityPDA(this.network);

    const disc = anchorDiscriminator('recompute_level');

    const ix = new TransactionInstruction({
      programId: this.programIds.VALIDATION,
      keys: [
        { pubkey: payerKey, isSigner: true, isWritable: true },
        { pubkey: identityPDA, isSigner: false, isWritable: true },
        { pubkey: valAuthority, isSigner: false, isWritable: false },
        { pubkey: this.programIds.IDENTITY, isSigner: false, isWritable: false },
      ],
      data: disc,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = payerKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  /**
   * Trigger verification level recompute (permissionless).
   */
  async recomputeLevel(signerKeypair, agentWallet) {
    const { transaction } = await this.buildRecomputeLevel(agentWallet, signerKeypair.publicKey);
    const sig = await this.connection.sendTransaction(transaction, [signerKeypair]);
    await this.connection.confirmTransaction(sig, this.commitment);
    return sig;
  }

  // ─── MintTracker ───────────────────────────────────────

  /**
   * Build initMintTracker transaction.
   * @param {PublicKey|string} wallet - Identity owner
   * @returns {{ transaction: Transaction, mintTrackerPDA: PublicKey }}
   */
  async buildInitMintTracker(wallet) {
    const walletKey = new PublicKey(wallet);
    const [identityPDA] = getIdentityPDA(walletKey, this.network);
    const [mintTrackerPDA] = getMintTrackerPDA(identityPDA, this.network);

    const disc = anchorDiscriminator('init_mint_tracker');

    const ix = new TransactionInstruction({
      programId: this.programIds.IDENTITY,
      keys: [
        { pubkey: walletKey, isSigner: true, isWritable: true },
        { pubkey: identityPDA, isSigner: false, isWritable: false },
        { pubkey: mintTrackerPDA, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: disc,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = walletKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx, mintTrackerPDA };
  }

  // ─── Verification ──────────────────────────────────────

  /**
   * Check if a wallet has a registered SATP identity.
   */
  async verifyAgent(wallet) {
    const identity = await this.getIdentity(wallet);
    return identity !== null && !identity.error;
  }

  // ─── Utility ───────────────────────────────────────────

  // ─── Escrow ─────────────────────────────────────────────

  /**
   * Build a createEscrow transaction.
   * @param {PublicKey|string} clientWallet - Client (payer + signer)
   * @param {PublicKey|string} agentWallet - Agent to receive funds on release
   * @param {number} amountLamports - Amount in lamports to escrow
   * @param {string} description - Job description (will be SHA256-hashed for PDA seed)
   * @param {number} deadlineUnix - Unix timestamp deadline
   * @returns {{ transaction: Transaction, escrowPDA: PublicKey, descriptionHash: Buffer }}
   */
  async buildCreateEscrow(clientWallet, agentWallet, amountLamports, description, deadlineUnix) {
    const clientKey = new PublicKey(clientWallet);
    const agentKey = new PublicKey(agentWallet);
    const descHash = crypto.createHash('sha256').update(description).digest();
    const [escrowPDA] = getEscrowPDA(clientKey, descHash, this.network);

    const disc = anchorDiscriminator('create_escrow');

    // Serialize: agent (32) + amount (u64 LE 8) + description_hash (32) + deadline (i64 LE 8)
    const agentBuf = agentKey.toBuffer();
    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64LE(BigInt(amountLamports));
    const deadlineBuf = Buffer.alloc(8);
    deadlineBuf.writeBigInt64LE(BigInt(deadlineUnix));

    const data = Buffer.concat([disc, agentBuf, amountBuf, descHash, deadlineBuf]);

    const ix = new TransactionInstruction({
      programId: this.programIds.ESCROW,
      keys: [
        { pubkey: clientKey, isSigner: true, isWritable: true },
        { pubkey: escrowPDA, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = clientKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx, escrowPDA, descriptionHash: descHash };
  }

  /**
   * Build a release transaction (client releases funds to agent).
   * @param {PublicKey|string} clientWallet - Client (signer)
   * @param {PublicKey|string} agentWallet - Agent receiving funds
   * @param {PublicKey|string} escrowPDA - Escrow account PDA
   * @returns {{ transaction: Transaction }}
   */
  async buildRelease(clientWallet, agentWallet, escrowPDA) {
    const clientKey = new PublicKey(clientWallet);
    const agentKey = new PublicKey(agentWallet);
    const escrowKey = new PublicKey(escrowPDA);

    const disc = anchorDiscriminator('release');

    const ix = new TransactionInstruction({
      programId: this.programIds.ESCROW,
      keys: [
        { pubkey: escrowKey, isSigner: false, isWritable: true },
        { pubkey: clientKey, isSigner: true, isWritable: false },
        { pubkey: agentKey, isSigner: false, isWritable: true },
      ],
      data: disc,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = clientKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  /**
   * Build a submitWork transaction (agent submits work proof).
   * @param {PublicKey|string} agentWallet - Agent (signer)
   * @param {PublicKey|string} escrowPDA - Escrow account PDA
   * @param {string} workProof - Work proof (will be SHA256-hashed)
   * @returns {{ transaction: Transaction, workHash: Buffer }}
   */
  async buildSubmitWork(agentWallet, escrowPDA, workProof) {
    const agentKey = new PublicKey(agentWallet);
    const escrowKey = new PublicKey(escrowPDA);
    const workHash = crypto.createHash('sha256').update(workProof).digest();

    const disc = anchorDiscriminator('submit_work');
    const data = Buffer.concat([disc, workHash]);

    const ix = new TransactionInstruction({
      programId: this.programIds.ESCROW,
      keys: [
        { pubkey: escrowKey, isSigner: false, isWritable: true },
        { pubkey: agentKey, isSigner: true, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = agentKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx, workHash };
  }

  /**
   * Build a cancel transaction (client cancels after deadline).
   * @param {PublicKey|string} clientWallet - Client (signer)
   * @param {PublicKey|string} escrowPDA - Escrow account PDA
   * @returns {{ transaction: Transaction }}
   */
  async buildCancel(clientWallet, escrowPDA) {
    const clientKey = new PublicKey(clientWallet);
    const escrowKey = new PublicKey(escrowPDA);

    const disc = anchorDiscriminator('cancel');

    const ix = new TransactionInstruction({
      programId: this.programIds.ESCROW,
      keys: [
        { pubkey: escrowKey, isSigner: false, isWritable: true },
        { pubkey: clientKey, isSigner: true, isWritable: true },
      ],
      data: disc,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = clientKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  /**
   * Build a raiseDispute transaction (either party disputes).
   * @param {PublicKey|string} signerWallet - Client or agent (signer)
   * @param {PublicKey|string} escrowPDA - Escrow account PDA
   * @returns {{ transaction: Transaction }}
   */
  async buildRaiseDispute(signerWallet, escrowPDA) {
    const signerKey = new PublicKey(signerWallet);
    const escrowKey = new PublicKey(escrowPDA);

    const disc = anchorDiscriminator('raise_dispute');

    const ix = new TransactionInstruction({
      programId: this.programIds.ESCROW,
      keys: [
        { pubkey: escrowKey, isSigner: false, isWritable: true },
        { pubkey: signerKey, isSigner: true, isWritable: false },
      ],
      data: disc,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = signerKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  /**
   * Build a closeEscrow transaction (returns rent to client).
   * @param {PublicKey|string} clientWallet - Client (signer)
   * @param {PublicKey|string} escrowPDA - Escrow account PDA
   * @returns {{ transaction: Transaction }}
   */
  async buildCloseEscrow(clientWallet, escrowPDA) {
    const clientKey = new PublicKey(clientWallet);
    const escrowKey = new PublicKey(escrowPDA);

    const disc = anchorDiscriminator('close_escrow');

    const ix = new TransactionInstruction({
      programId: this.programIds.ESCROW,
      keys: [
        { pubkey: escrowKey, isSigner: false, isWritable: true },
        { pubkey: clientKey, isSigner: true, isWritable: true },
      ],
      data: disc,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = clientKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  /**
   * Fetch escrow state from on-chain account.
   * @param {PublicKey|string} escrowPDA
   * @returns {object|null} Escrow state or null if not found
   */
  async getEscrow(escrowPDA) {
    const escrowKey = new PublicKey(escrowPDA);
    const acct = await this.connection.getAccountInfo(escrowKey);
    if (!acct) return null;

    try {
      // Skip 8-byte Anchor discriminator
      const data = acct.data.slice(8);
      const client = new PublicKey(data.slice(0, 32));
      const agent = new PublicKey(data.slice(32, 64));
      const amount = Number(data.readBigUInt64LE(64));
      const descriptionHash = data.slice(72, 104);
      const deadline = Number(data.readBigInt64LE(104));
      const statusByte = data[112];
      const createdAt = Number(data.readBigInt64LE(113));
      const bump = data[121];

      const statusMap = ['Active', 'Released', 'Cancelled', 'WorkSubmitted', 'Disputed'];
      const status = statusMap[statusByte] || `Unknown(${statusByte})`;

      // Optional work_hash (1 byte option flag + 32 bytes)
      let workHash = null;
      if (data[122] === 1) {
        workHash = data.slice(123, 155).toString('hex');
      }

      return {
        client: client.toBase58(),
        agent: agent.toBase58(),
        amount,
        descriptionHash: descriptionHash.toString('hex'),
        deadline,
        status,
        createdAt,
        bump,
        workHash,
        pda: escrowKey.toBase58(),
      };
    } catch (e) {
      return { pda: escrowKey.toBase58(), raw: acct.data.toString('hex'), error: e.message };
    }
  }

  // ─── Utility ───────────────────────────────────────────

  /**
   * Derive all PDAs for a wallet without RPC calls.
   */
  getPDAs(wallet) {
    const walletKey = new PublicKey(wallet);
    const [identityPDA] = getIdentityPDA(walletKey, this.network);
    const [reviewCounter] = getReviewCounterPDA(walletKey, this.network);
    const [mintTracker] = getMintTrackerPDA(identityPDA, this.network);
    const [repAuthority] = getReputationAuthorityPDA(this.network);
    const [valAuthority] = getValidationAuthorityPDA(this.network);

    return {
      identity: identityPDA.toBase58(),
      reviewCounter: reviewCounter.toBase58(),
      mintTracker: mintTracker.toBase58(),
      reputationAuthority: repAuthority.toBase58(),
      validationAuthority: valAuthority.toBase58(),
    };
  }
}

module.exports = {
  SATPSDK,
  getProgramIds,
  getIdentityPDA,
  getReputationAuthorityPDA,
  getValidationAuthorityPDA,
  getReviewCounterPDA,
  getMintTrackerPDA,
  getReviewsAuthorityPDA,
  getReviewPDA,
  getReviewAttestationPDA,
  getEscrowPDA,
  anchorDiscriminator,
};
