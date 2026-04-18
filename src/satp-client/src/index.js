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
  getReviewV3PDA,
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
   * Build a resolveDispute transaction.
   * Only the client (arbiter in V1) can resolve. Decides: release to agent or refund to client.
   * @param {PublicKey|string} clientWallet - Client/arbiter (signer)
   * @param {PublicKey|string} agentWallet - Agent account
   * @param {PublicKey|string} escrowPDA - Escrow account PDA
   * @param {boolean} releaseToAgent - true = release to agent, false = refund to client
   * @returns {{ transaction: Transaction }}
   */
  async buildResolveDispute(clientWallet, agentWallet, escrowPDA, releaseToAgent) {
    const clientKey = new PublicKey(clientWallet);
    const agentKey = new PublicKey(agentWallet);
    const escrowKey = new PublicKey(escrowPDA);

    const disc = anchorDiscriminator('resolve_dispute');
    const data = Buffer.alloc(8 + 1);
    disc.copy(data, 0);
    data.writeUInt8(releaseToAgent ? 1 : 0, 8);

    const ix = new TransactionInstruction({
      programId: this.programIds.ESCROW,
      keys: [
        { pubkey: escrowKey, isSigner: false, isWritable: true },
        { pubkey: clientKey, isSigner: true, isWritable: false },  // arbiter
        { pubkey: agentKey, isSigner: false, isWritable: true },   // agent
        { pubkey: clientKey, isSigner: false, isWritable: true },  // client_wallet
      ],
      data,
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

  // ─── Reviews V3 (Job-Scoped) ─────────────────────────────

  /**
   * Build a submitReview transaction (Reviews V3 — job-scoped).
   * Reviewer must be a party to the completed/resolved job (poster or accepted_agent).
   * Requires reviewer to have a registered SATP Identity.
   *
   * @param {PublicKey|string} reviewerWallet - Reviewer (signer, must be job party)
   * @param {PublicKey|string} reviewerIdentityPDA - Reviewer's SATP Identity PDA
   * @param {PublicKey|string} jobPDA - Job/Escrow account PDA
   * @param {object} ratings - { rating, quality, reliability, communication } (all 1-5)
   * @param {string} commentUri - URI to off-chain comment (IPFS, Arweave, etc.)
   * @param {Buffer|string} commentHash - 32-byte SHA256 hash of comment content
   * @returns {{ transaction: Transaction, reviewPDA: PublicKey }}
   */
  async buildSubmitReview(reviewerWallet, reviewerIdentityPDA, jobPDA, ratings, commentUri, commentHash) {
    const reviewerKey = new PublicKey(reviewerWallet);
    const identityPDA = new PublicKey(reviewerIdentityPDA);
    const jobKey = new PublicKey(jobPDA);
    const [reviewPDA] = getReviewV3PDA(jobKey, reviewerKey, this.network);

    const hashBuf = Buffer.isBuffer(commentHash)
      ? commentHash
      : crypto.createHash('sha256').update(commentHash).digest();

    const disc = anchorDiscriminator('submit_review');
    const uriBytes = Buffer.from(commentUri, 'utf8');

    // Serialize: rating (u8) + quality (u8) + reliability (u8) + communication (u8)
    //   + uri_len (u32 LE) + uri_bytes + hash (32 bytes)
    const data = Buffer.concat([
      disc,
      Buffer.from([ratings.rating]),
      Buffer.from([ratings.quality]),
      Buffer.from([ratings.reliability]),
      Buffer.from([ratings.communication]),
      Buffer.from(new Uint32Array([uriBytes.length]).buffer),
      uriBytes,
      hashBuf,
    ]);

    // Identity program ID (hardcoded in Reviews V3 program)
    const IDENTITY_PROGRAM = new PublicKey('EJtQh4Gyg88zXvSmFpxYkkeZsPwTsjfm4LvjmPQX1FD3');
    // Escrow program ID
    const ESCROW_PROGRAM = this.programIds.ESCROW;

    const ix = new TransactionInstruction({
      programId: this.programIds.REVIEWS,
      keys: [
        { pubkey: reviewerKey, isSigner: true, isWritable: true },
        { pubkey: identityPDA, isSigner: false, isWritable: false },
        { pubkey: jobKey, isSigner: false, isWritable: false },
        { pubkey: reviewPDA, isSigner: false, isWritable: true },
        { pubkey: IDENTITY_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: ESCROW_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = reviewerKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx, reviewPDA };
  }

  /**
   * Build a respondToReview transaction (Reviews V3).
   * Only the reviewed party can respond, and only once.
   *
   * @param {PublicKey|string} responderWallet - Reviewed party (signer)
   * @param {PublicKey|string} reviewPDA - Review account PDA
   * @param {string} responseUri - URI to off-chain response content
   * @param {Buffer|string} responseHash - 32-byte SHA256 hash of response content
   * @returns {{ transaction: Transaction }}
   */
  async buildRespondToReview(responderWallet, reviewPDA, responseUri, responseHash) {
    const responderKey = new PublicKey(responderWallet);
    const reviewKey = new PublicKey(reviewPDA);

    const hashBuf = Buffer.isBuffer(responseHash)
      ? responseHash
      : crypto.createHash('sha256').update(responseHash).digest();

    const disc = anchorDiscriminator('respond_to_review');
    const uriBytes = Buffer.from(responseUri, 'utf8');

    const data = Buffer.concat([
      disc,
      Buffer.from(new Uint32Array([uriBytes.length]).buffer),
      uriBytes,
      hashBuf,
    ]);

    const ix = new TransactionInstruction({
      programId: this.programIds.REVIEWS,
      keys: [
        { pubkey: responderKey, isSigner: true, isWritable: true },
        { pubkey: reviewKey, isSigner: false, isWritable: true },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = responderKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  /**
   * Fetch a review from on-chain.
   * @param {PublicKey|string} reviewPDA
   * @returns {object|null} Review data or null if not found
   */
  async getReview(reviewPDA) {
    const reviewKey = new PublicKey(reviewPDA);
    const acct = await this.connection.getAccountInfo(reviewKey);
    if (!acct) return null;

    try {
      const data = acct.data.slice(8); // skip Anchor discriminator
      let offset = 0;

      const reviewer = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
      const reviewed = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
      const jobId = Number(data.readBigUInt64LE(offset)); offset += 8;
      const jobRef = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
      const rating = data[offset]; offset += 1;
      const categoryQuality = data[offset]; offset += 1;
      const categoryReliability = data[offset]; offset += 1;
      const categoryCommunication = data[offset]; offset += 1;

      // String: 4-byte length prefix + bytes
      const uriLen = data.readUInt32LE(offset); offset += 4;
      const commentUri = data.slice(offset, offset + uriLen).toString('utf8'); offset += uriLen;

      const commentHash = data.slice(offset, offset + 32).toString('hex'); offset += 32;
      const timestamp = Number(data.readBigInt64LE(offset)); offset += 8;
      const hasResponse = data[offset] === 1; offset += 1;

      // Response string
      const resUriLen = data.readUInt32LE(offset); offset += 4;
      const responseUri = data.slice(offset, offset + resUriLen).toString('utf8'); offset += resUriLen;

      const responseHash = data.slice(offset, offset + 32).toString('hex'); offset += 32;
      const responseTimestamp = Number(data.readBigInt64LE(offset)); offset += 8;
      const bump = data[offset]; offset += 1;

      return {
        reviewer: reviewer.toBase58(),
        reviewed: reviewed.toBase58(),
        jobId,
        jobRef: jobRef.toBase58(),
        rating,
        categoryQuality,
        categoryReliability,
        categoryCommunication,
        commentUri,
        commentHash,
        timestamp,
        hasResponse,
        responseUri: hasResponse ? responseUri : null,
        responseHash: hasResponse ? responseHash : null,
        responseTimestamp: hasResponse ? responseTimestamp : null,
        bump,
        pda: reviewKey.toBase58(),
      };
    } catch (e) {
      return { pda: reviewKey.toBase58(), raw: acct.data.toString('hex'), error: e.message };
    }
  }

  /**
   * Derive Review V3 PDA (job-scoped).
   * @param {PublicKey|string} jobPDA
   * @param {PublicKey|string} reviewer
   * @returns {[PublicKey, number]} [pda, bump]
   */
  getReviewV3PDA(jobPDA, reviewer) {
    return getReviewV3PDA(jobPDA, reviewer, this.network);
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

// V3 SDK — now delegated to @brainai/satp-v3 (migrated 2026-03-29)
const v3sdk = require('@brainai/satp-v3');

// Legacy V3 SDK wrapper — maps old createSATPClient/SATPV3SDK to new SDK
class SATPV3SDK {
  constructor(opts = {}) {
    const rpcUrl = typeof opts === 'string'
      ? opts
      : (opts.rpcUrl || opts.url || opts.endpoint || 'https://api.mainnet-beta.solana.com');
    this.rpcUrl = rpcUrl;
    this.network = typeof opts === 'object' && opts.network
      ? opts.network
      : (rpcUrl.includes('mainnet') ? 'mainnet' : 'devnet');
    this.client = new v3sdk.SatpV3Client(rpcUrl);
  }
  async getGenesis(agentId) { return this.client.getGenesis ? this.client.getGenesis(agentId) : null; }
  async getAttestation(pda) { return this.client.getAttestation ? this.client.getAttestation(pda) : null; }
  async getReview(pda) { return this.client.getReview ? this.client.getReview(pda) : null; }
}

function createSATPClient(opts = {}) {
  const rpcUrl = typeof opts === 'string'
    ? opts
    : (opts.rpcUrl || opts.url || opts.endpoint || 'https://api.mainnet-beta.solana.com');
  const client = new v3sdk.SatpV3Client(rpcUrl);
  client.rpcUrl = rpcUrl;
  client.network = typeof opts === 'object' && opts.network
    ? opts.network
    : (rpcUrl.includes('mainnet') ? 'mainnet' : 'devnet');
  return client;
}

// Legacy borsh reader — keep for any V2 code paths
const borshReader = require('./borsh-reader');


// Fixed genesis deserializer — matches actual on-chain struct (no isActive field)
function _deserializeGenesisFixed(data) {
  if (!data || data.length < 8) return null;
  try {
    const { PublicKey } = require('@solana/web3.js');
    let offset = 8; // skip discriminator
    const agentIdHashBytes = data.slice(offset, offset + 32); offset += 32;
    const readString = () => {
      const len = data.readUInt32LE(offset); offset += 4;
      const str = data.slice(offset, offset + len).toString('utf8'); offset += len;
      return str;
    };
    const readVecString = () => {
      const count = data.readUInt32LE(offset); offset += 4;
      const arr = [];
      for (let i = 0; i < count; i++) arr.push(readString());
      return arr;
    };
    const agentName = readString();
    const description = readString();
    const category = readString();
    const capabilities = readVecString();
    const metadataUri = readString();
    const faceImage = readString();
    const faceMint = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const faceBurnTx = readString();
    const genesisRecord = Number(data.readBigInt64LE(offset)); offset += 8;
    // NOTE: No isActive field in deployed program (SDK bug — has phantom isActive)
    const authority = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const hasPending = data[offset]; offset += 1;
    let pendingAuthority = null;
    if (hasPending === 1) {
      pendingAuthority = new PublicKey(data.slice(offset, offset + 32)).toBase58();
      offset += 32;
    }
    const reputationScore = Number(data.readBigUInt64LE(offset)); offset += 8;
    const verificationLevel = data[offset]; offset += 1;
    const reputationUpdatedAt = Number(data.readBigInt64LE(offset)); offset += 8;
    const verificationUpdatedAt = Number(data.readBigInt64LE(offset)); offset += 8;
    const createdAt = Number(data.readBigInt64LE(offset)); offset += 8;
    const updatedAt = Number(data.readBigInt64LE(offset)); offset += 8;
    const bump = data[offset]; offset += 1;
    return {
      agentIdHash: Array.from(agentIdHashBytes),
      agentName, description, category, capabilities, metadataUri, faceImage,
      faceMint: faceMint.toBase58(),
      faceBurnTx,
      genesisRecord,
      isBorn: genesisRecord > 0,
      authority: authority.toBase58(),
      pendingAuthority,
      reputationScore,
      verificationLevel,
      verificationLabel: ['Unverified','Registered','Verified','Established','Trusted','Sovereign'][verificationLevel] || 'Unknown',
      reputationPct: (reputationScore / 10000).toFixed(2),
      reputationUpdatedAt, verificationUpdatedAt,
      createdAt: createdAt > 0 ? new Date(createdAt * 1000).toISOString() : null,
      updatedAt: updatedAt > 0 ? new Date(updatedAt * 1000).toISOString() : null,
      bump,
    };
  } catch (e) {
    return { error: e.message, raw: data.toString('hex').slice(0, 200) };
  }
}

module.exports = {
  // V2 SDK (backward compatible — legacy, kept for escrow V2 / old paths)
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
  getReviewV3PDA,
  anchorDiscriminator,

  // V3 SDK (now proxied through @brainai/satp-v3)
  SATPV3SDK,
  createSATPClient,
  SatpV3Client: v3sdk.SatpV3Client,
  SatpV3Builders: v3sdk.SatpV3Builders,

  // V3 PDA derivation (from @brainai/satp-v3)
  PROGRAM_IDS: v3sdk.PROGRAM_IDS,
  getV3ProgramIds: () => v3sdk.PROGRAM_IDS,
  hashAgentId: v3sdk.agentIdHash,
  agentIdHash: v3sdk.agentIdHash,
  hashName: v3sdk.descriptionHash || ((name) => require('crypto').createHash('sha256').update(name).digest()),
  getGenesisPDA: v3sdk.deriveGenesisPda,
  deriveGenesisPda: v3sdk.deriveGenesisPda,
  getV3ReputationAuthorityPDA: v3sdk.deriveReputationAuthorityPda,
  deriveReputationAuthorityPda: v3sdk.deriveReputationAuthorityPda,
  getV3ValidationAuthorityPDA: v3sdk.deriveValidationAuthorityPda,
  deriveValidationAuthorityPda: v3sdk.deriveValidationAuthorityPda,
  getV3MintTrackerPDA: v3sdk.deriveMintTrackerPda,
  deriveMintTrackerPda: v3sdk.deriveMintTrackerPda,
  getNameRegistryPDA: v3sdk.deriveNameRegistryPda,
  deriveNameRegistryPda: v3sdk.deriveNameRegistryPda,
  getLinkedWalletPDA: v3sdk.deriveLinkedWalletPda,
  deriveLinkedWalletPda: v3sdk.deriveLinkedWalletPda,
  getV3ReviewPDA: v3sdk.deriveReviewPda,
  deriveReviewPda: v3sdk.deriveReviewPda,
  getV3ReviewCounterPDA: v3sdk.deriveReviewCounterPda,
  deriveReviewCounterPda: v3sdk.deriveReviewCounterPda,
  getV3AttestationPDA: v3sdk.deriveAttestationPda,
  deriveAttestationPda: v3sdk.deriveAttestationPda,
  getV3EscrowPDA: v3sdk.deriveEscrowPda,
  deriveEscrowPda: v3sdk.deriveEscrowPda,
  deriveReviewAttestationPda: v3sdk.deriveReviewAttestationPda,

  // V3 Deserialization (from @brainai/satp-v3)
  // NOTE: v3sdk.deserializeGenesis has isActive field mismatch with deployed program
  // Using corrected manual parser until SDK v3.6+ fixes struct alignment
  deserializeGenesis: _deserializeGenesisFixed,
  deserializeGenesisRecord: _deserializeGenesisFixed, // alias for old name
  deserializeLinkedWallet: v3sdk.deserializeLinkedWallet,
  deserializeMintTracker: v3sdk.deserializeMintTracker,
  deserializeNameRegistry: v3sdk.deserializeNameRegistry,
  deserializeReview: v3sdk.deserializeReview,
  deserializeReviewCounter: v3sdk.deserializeReviewCounter,
  deserializeAttestation: v3sdk.deserializeAttestation,
  deserializeEscrowV3: v3sdk.deserializeEscrow,
  tryDeserialize: v3sdk.tryDeserialize,

  // V3 Utilities
  isBorn: v3sdk.isBorn,
  trustTier: v3sdk.trustTier,
  reputationPct: v3sdk.reputationPct,
  resolveAgent: v3sdk.resolveAgent,
  verificationLabel: v3sdk.verificationLabel,
  attestationTypeLabel: v3sdk.attestationTypeLabel,
  escrowStatusLabel: v3sdk.escrowStatusLabel,
  isAttestationValid: v3sdk.isAttestationValid,
  isEscrowExpired: v3sdk.isEscrowExpired,
  escrowRemaining: v3sdk.escrowRemaining,
  EscrowStatus: v3sdk.EscrowStatus,

  // Legacy borsh (V2 compat only — prefer V3 deserializers above)
  BorshReader: borshReader.BorshReader,
  deserializeAccount: borshReader.deserializeAccount,
  deserializeBatch: borshReader.deserializeBatch,
  getAccountDiscriminator: borshReader.getAccountDiscriminator,
  accountDiscriminator: borshReader.accountDiscriminator,
  isAccountType: borshReader.isAccountType,
  DISCRIMINATORS: borshReader.DISCRIMINATORS,
};
