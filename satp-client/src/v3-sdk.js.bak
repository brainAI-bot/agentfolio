const {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} = require('@solana/web3.js');
const crypto = require('crypto');
const {
  getV3ProgramIds,
  hashAgentId,
  hashName,
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
} = require('./v3-pda');

const DEVNET_RPC = 'https://api.devnet.solana.com';
const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';

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

/**
 * Serialize a Rust String: 4-byte LE length prefix + UTF-8 bytes.
 */
function serializeString(str) {
  const bytes = Buffer.from(str, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
}

/**
 * Serialize a Vec<String>: 4-byte LE count + each string serialized.
 */
function serializeVecString(arr) {
  const count = Buffer.alloc(4);
  count.writeUInt32LE(arr.length);
  const parts = arr.map(s => serializeString(s));
  return Buffer.concat([count, ...parts]);
}

class SATPV3SDK {
  /**
   * @param {object} opts
   * @param {'mainnet'|'devnet'} [opts.network='devnet']
   * @param {string} [opts.rpcUrl]
   * @param {string} [opts.commitment='confirmed']
   */
  constructor(opts = {}) {
    this.network = opts.network || 'devnet';
    this.rpcUrl = opts.rpcUrl || (this.network === 'mainnet' ? MAINNET_RPC : DEVNET_RPC);
    this.commitment = opts.commitment || 'confirmed';
    this.connection = new Connection(this.rpcUrl, this.commitment);
    this.programIds = getV3ProgramIds(this.network);
  }

  // ═══════════════════════════════════════════════════
  //  IDENTITY — Genesis Record CRUD
  // ═══════════════════════════════════════════════════

  /**
   * Build createIdentity transaction.
   * @param {PublicKey|string} creator - Wallet that pays rent and becomes authority
   * @param {string} agentId - Agent identifier (hashed to derive PDA)
   * @param {object} meta - { name, description, category, capabilities, metadataUri }
   * @returns {{ transaction: Transaction, genesisPDA: PublicKey, agentIdHash: Buffer }}
   */
  async buildCreateIdentity(creator, agentId, meta) {
    const creatorKey = new PublicKey(creator);
    const agentIdHash = hashAgentId(agentId);
    const [genesisPDA] = getGenesisPDA(agentIdHash, this.network);

    const disc = anchorDiscriminator('create_identity');
    const data = Buffer.concat([
      disc,
      agentIdHash,                                    // [u8; 32]
      serializeString(meta.name || ''),               // String
      serializeString(meta.description || ''),        // String
      serializeString(meta.category || ''),           // String
      serializeVecString(meta.capabilities || []),    // Vec<String>
      serializeString(meta.metadataUri || ''),        // String
    ]);

    const ix = new TransactionInstruction({
      programId: this.programIds.IDENTITY,
      keys: [
        { pubkey: genesisPDA, isSigner: false, isWritable: true },
        { pubkey: creatorKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = creatorKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx, genesisPDA, agentIdHash };
  }

  /**
   * Build burnToBecome transaction (agent's permanent face/birth event).
   * @param {PublicKey|string} authority - Genesis record authority (signer)
   * @param {string|Buffer} agentIdOrHash - Agent ID string or 32-byte hash
   * @param {string} faceImage - Arweave/IPFS URL to face image
   * @param {PublicKey|string} faceMint - Soulbound BOA NFT mint address
   * @param {string} faceBurnTx - Burn transaction signature
   * @returns {{ transaction: Transaction }}
   */
  async buildBurnToBecome(authority, agentIdOrHash, faceImage, faceMint, faceBurnTx) {
    const authorityKey = new PublicKey(authority);
    const [genesisPDA] = getGenesisPDA(agentIdOrHash, this.network);
    const faceMintKey = new PublicKey(faceMint);

    const disc = anchorDiscriminator('burn_to_become');
    const data = Buffer.concat([
      disc,
      serializeString(faceImage),
      faceMintKey.toBuffer(),           // Pubkey (32 bytes)
      serializeString(faceBurnTx),
    ]);

    const ix = new TransactionInstruction({
      programId: this.programIds.IDENTITY,
      keys: [
        { pubkey: genesisPDA, isSigner: false, isWritable: true },
        { pubkey: authorityKey, isSigner: true, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = authorityKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  /**
   * Build updateIdentity transaction.
   * Pass null/undefined for fields to leave unchanged.
   * @param {PublicKey|string} authority
   * @param {string|Buffer} agentIdOrHash
   * @param {object} updates - { name?, description?, category?, capabilities?, metadataUri? }
   * @returns {{ transaction: Transaction }}
   */
  async buildUpdateIdentity(authority, agentIdOrHash, updates) {
    const authorityKey = new PublicKey(authority);
    const [genesisPDA] = getGenesisPDA(agentIdOrHash, this.network);

    const disc = anchorDiscriminator('update_identity');

    // Serialize Option<String> — 0x00 for None, 0x01 + string for Some
    function optString(val) {
      if (val == null) return Buffer.from([0x00]);
      return Buffer.concat([Buffer.from([0x01]), serializeString(val)]);
    }

    // Serialize Option<Vec<String>>
    function optVecString(val) {
      if (val == null) return Buffer.from([0x00]);
      return Buffer.concat([Buffer.from([0x01]), serializeVecString(val)]);
    }

    const data = Buffer.concat([
      disc,
      optString(updates.name),
      optString(updates.description),
      optString(updates.category),
      optVecString(updates.capabilities),
      optString(updates.metadataUri),
    ]);

    const ix = new TransactionInstruction({
      programId: this.programIds.IDENTITY,
      keys: [
        { pubkey: genesisPDA, isSigner: false, isWritable: true },
        { pubkey: authorityKey, isSigner: true, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = authorityKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  /**
   * Build proposeAuthority transaction (2-step rotation).
   * @param {PublicKey|string} authority - Current authority (signer)
   * @param {string|Buffer} agentIdOrHash
   * @param {PublicKey|string} newAuthority
   * @returns {{ transaction: Transaction }}
   */
  async buildProposeAuthority(authority, agentIdOrHash, newAuthority) {
    const authorityKey = new PublicKey(authority);
    const newAuthKey = new PublicKey(newAuthority);
    const [genesisPDA] = getGenesisPDA(agentIdOrHash, this.network);

    const disc = anchorDiscriminator('propose_authority');
    const data = Buffer.concat([disc, newAuthKey.toBuffer()]);

    const ix = new TransactionInstruction({
      programId: this.programIds.IDENTITY,
      keys: [
        { pubkey: genesisPDA, isSigner: false, isWritable: true },
        { pubkey: authorityKey, isSigner: true, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = authorityKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  /**
   * Build acceptAuthority transaction.
   * @param {PublicKey|string} newAuthority - Pending authority (signer)
   * @param {string|Buffer} agentIdOrHash
   * @returns {{ transaction: Transaction }}
   */
  async buildAcceptAuthority(newAuthority, agentIdOrHash) {
    const newAuthKey = new PublicKey(newAuthority);
    const [genesisPDA] = getGenesisPDA(agentIdOrHash, this.network);

    const disc = anchorDiscriminator('accept_authority');

    const ix = new TransactionInstruction({
      programId: this.programIds.IDENTITY,
      keys: [
        { pubkey: genesisPDA, isSigner: false, isWritable: true },
        { pubkey: newAuthKey, isSigner: true, isWritable: false },
      ],
      data: disc,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = newAuthKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  // ═══════════════════════════════════════════════════
  //  IDENTITY — Name Registry
  // ═══════════════════════════════════════════════════

  /**
   * Build registerName transaction.
   * @param {PublicKey|string} authority - Identity authority (signer + payer)
   * @param {string|Buffer} agentIdOrHash
   * @param {string} name - Display name (2-32 chars)
   * @returns {{ transaction: Transaction, nameRegistryPDA: PublicKey }}
   */
  async buildRegisterName(authority, agentIdOrHash, name) {
    const authorityKey = new PublicKey(authority);
    const [genesisPDA] = getGenesisPDA(agentIdOrHash, this.network);
    const nameHash = hashName(name);
    const [nameRegistryPDA] = getNameRegistryPDA(nameHash, this.network);

    const disc = anchorDiscriminator('register_name');
    const data = Buffer.concat([
      disc,
      serializeString(name),
      nameHash,   // [u8; 32]
    ]);

    const ix = new TransactionInstruction({
      programId: this.programIds.IDENTITY,
      keys: [
        { pubkey: genesisPDA, isSigner: false, isWritable: true },
        { pubkey: nameRegistryPDA, isSigner: false, isWritable: true },
        { pubkey: authorityKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = authorityKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx, nameRegistryPDA };
  }

  /**
   * Build releaseName transaction (frees name for others to claim).
   * @param {PublicKey|string} authority
   * @param {string|Buffer} agentIdOrHash
   * @param {string} name - The registered name to release
   * @returns {{ transaction: Transaction }}
   */
  async buildReleaseName(authority, agentIdOrHash, name) {
    const authorityKey = new PublicKey(authority);
    const [genesisPDA] = getGenesisPDA(agentIdOrHash, this.network);
    const nameHash = hashName(name);
    const [nameRegistryPDA] = getNameRegistryPDA(nameHash, this.network);

    const disc = anchorDiscriminator('release_name');

    const ix = new TransactionInstruction({
      programId: this.programIds.IDENTITY,
      keys: [
        { pubkey: genesisPDA, isSigner: false, isWritable: false },
        { pubkey: nameRegistryPDA, isSigner: false, isWritable: true },
        { pubkey: authorityKey, isSigner: true, isWritable: false },
      ],
      data: disc,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = authorityKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  /**
   * Build cancelAuthorityTransfer transaction.
   * @param {PublicKey|string} authority - Current authority (signer)
   * @param {string|Buffer} agentIdOrHash
   * @returns {{ transaction: Transaction }}
   */
  async buildCancelAuthorityTransfer(authority, agentIdOrHash) {
    const authorityKey = new PublicKey(authority);
    const [genesisPDA] = getGenesisPDA(agentIdOrHash, this.network);

    const disc = anchorDiscriminator('cancel_authority_transfer');

    const ix = new TransactionInstruction({
      programId: this.programIds.IDENTITY,
      keys: [
        { pubkey: genesisPDA, isSigner: false, isWritable: true },
        { pubkey: authorityKey, isSigner: true, isWritable: false },
      ],
      data: disc,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = authorityKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  // ═══════════════════════════════════════════════════
  //  IDENTITY — Linked Wallets
  // ═══════════════════════════════════════════════════

  /**
   * Build linkWallet transaction.
   * @param {PublicKey|string} authority
   * @param {string|Buffer} agentIdOrHash
   * @param {PublicKey|string} wallet - Wallet to link
   * @param {string} chain - Chain identifier (e.g. "solana", max 16 chars)
   * @param {string} label - Label (e.g. "deploy", max 32 chars)
   * @returns {{ transaction: Transaction, linkedWalletPDA: PublicKey }}
   */
  async buildLinkWallet(authority, agentIdOrHash, wallet, chain, label) {
    const authorityKey = new PublicKey(authority);
    const walletKey = new PublicKey(wallet);
    const [genesisPDA] = getGenesisPDA(agentIdOrHash, this.network);
    const [linkedWalletPDA] = getLinkedWalletPDA(genesisPDA, walletKey, this.network);

    const disc = anchorDiscriminator('link_wallet');
    const data = Buffer.concat([
      disc,
      walletKey.toBuffer(),
      serializeString(chain),
      serializeString(label),
    ]);

    const ix = new TransactionInstruction({
      programId: this.programIds.IDENTITY,
      keys: [
        { pubkey: genesisPDA, isSigner: false, isWritable: false },
        { pubkey: linkedWalletPDA, isSigner: false, isWritable: true },
        { pubkey: authorityKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = authorityKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx, linkedWalletPDA };
  }

  /**
   * Build unlinkWallet transaction.
   * @param {PublicKey|string} authority
   * @param {string|Buffer} agentIdOrHash
   * @param {PublicKey|string} wallet - Wallet to unlink
   * @returns {{ transaction: Transaction }}
   */
  async buildUnlinkWallet(authority, agentIdOrHash, wallet) {
    const authorityKey = new PublicKey(authority);
    const walletKey = new PublicKey(wallet);
    const [genesisPDA] = getGenesisPDA(agentIdOrHash, this.network);
    const [linkedWalletPDA] = getLinkedWalletPDA(genesisPDA, walletKey, this.network);

    const disc = anchorDiscriminator('unlink_wallet');

    const ix = new TransactionInstruction({
      programId: this.programIds.IDENTITY,
      keys: [
        { pubkey: genesisPDA, isSigner: false, isWritable: false },
        { pubkey: linkedWalletPDA, isSigner: false, isWritable: true },
        { pubkey: authorityKey, isSigner: true, isWritable: false },
      ],
      data: disc,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = authorityKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  // ═══════════════════════════════════════════════════
  //  IDENTITY — MintTracker
  // ═══════════════════════════════════════════════════

  /**
   * Build initMintTracker transaction.
   * @param {PublicKey|string} authority
   * @param {string|Buffer} agentIdOrHash
   * @returns {{ transaction: Transaction, mintTrackerPDA: PublicKey }}
   */
  async buildInitMintTracker(authority, agentIdOrHash) {
    const authorityKey = new PublicKey(authority);
    const [genesisPDA] = getGenesisPDA(agentIdOrHash, this.network);
    const [mintTrackerPDA] = getV3MintTrackerPDA(genesisPDA, this.network);

    const disc = anchorDiscriminator('init_mint_tracker');

    const ix = new TransactionInstruction({
      programId: this.programIds.IDENTITY,
      keys: [
        { pubkey: genesisPDA, isSigner: false, isWritable: false },
        { pubkey: mintTrackerPDA, isSigner: false, isWritable: true },
        { pubkey: authorityKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: disc,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = authorityKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx, mintTrackerPDA };
  }

  /**
   * Build recordMint transaction (tracks mints, max 3 per identity).
   * @param {PublicKey|string} authority
   * @param {string|Buffer} agentIdOrHash
   * @returns {{ transaction: Transaction }}
   */
  async buildRecordMint(authority, agentIdOrHash) {
    const authorityKey = new PublicKey(authority);
    const [genesisPDA] = getGenesisPDA(agentIdOrHash, this.network);
    const [mintTrackerPDA] = getV3MintTrackerPDA(genesisPDA, this.network);

    const disc = anchorDiscriminator('record_mint');

    const ix = new TransactionInstruction({
      programId: this.programIds.IDENTITY,
      keys: [
        { pubkey: genesisPDA, isSigner: false, isWritable: false },
        { pubkey: mintTrackerPDA, isSigner: false, isWritable: true },
        { pubkey: authorityKey, isSigner: true, isWritable: false },
      ],
      data: disc,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = authorityKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  // ═══════════════════════════════════════════════════
  //  IDENTITY — Deactivation
  // ═══════════════════════════════════════════════════

  /**
   * Build deactivateIdentity transaction.
   * @param {PublicKey|string} authority
   * @param {string|Buffer} agentIdOrHash
   * @returns {{ transaction: Transaction }}
   */
  async buildDeactivateIdentity(authority, agentIdOrHash) {
    const authorityKey = new PublicKey(authority);
    const [genesisPDA] = getGenesisPDA(agentIdOrHash, this.network);

    const disc = anchorDiscriminator('deactivate_identity');

    const ix = new TransactionInstruction({
      programId: this.programIds.IDENTITY,
      keys: [
        { pubkey: genesisPDA, isSigner: false, isWritable: true },
        { pubkey: authorityKey, isSigner: true, isWritable: false },
      ],
      data: disc,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = authorityKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  /**
   * Build reactivateIdentity transaction.
   * @param {PublicKey|string} authority
   * @param {string|Buffer} agentIdOrHash
   * @returns {{ transaction: Transaction }}
   */
  async buildReactivateIdentity(authority, agentIdOrHash) {
    const authorityKey = new PublicKey(authority);
    const [genesisPDA] = getGenesisPDA(agentIdOrHash, this.network);

    const disc = anchorDiscriminator('reactivate_identity');

    const ix = new TransactionInstruction({
      programId: this.programIds.IDENTITY,
      keys: [
        { pubkey: genesisPDA, isSigner: false, isWritable: true },
        { pubkey: authorityKey, isSigner: true, isWritable: false },
      ],
      data: disc,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = authorityKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  // ═══════════════════════════════════════════════════
  //  ATTESTATIONS V3 — Create, Verify, Revoke
  // ═══════════════════════════════════════════════════

  /**
   * Build createAttestation transaction.
   * @param {PublicKey|string} issuer - Signer + fee payer
   * @param {string} agentId - Agent identifier
   * @param {string} attestationType - Type of attestation (max 32 chars)
   * @param {string} proofData - JSON proof data (max 512 chars)
   * @param {number|null} expiresAt - Optional Unix timestamp for expiry
   * @returns {{ transaction: Transaction, attestationPDA: PublicKey }}
   */
  async buildCreateAttestation(issuer, agentId, attestationType, proofData, expiresAt = null) {
    const issuerKey = new PublicKey(issuer);
    const [attPDA] = getV3AttestationPDA(agentId, issuerKey, attestationType, this.network);

    const disc = anchorDiscriminator('create_attestation');

    // Encode args: agent_id (string), attestation_type (string), proof_data (string), expires_at (Option<i64>)
    const agentIdBuf = Buffer.from(agentId);
    const typeBuf = Buffer.from(attestationType);
    const proofBuf = Buffer.from(proofData);

    const parts = [
      disc,
      // agent_id: string (4-byte len + data)
      Buffer.alloc(4),
      agentIdBuf,
      // attestation_type: string (4-byte len + data)
      Buffer.alloc(4),
      typeBuf,
      // proof_data: string (4-byte len + data)
      Buffer.alloc(4),
      proofBuf,
    ];

    parts[1].writeUInt32LE(agentIdBuf.length);
    parts[3].writeUInt32LE(typeBuf.length);
    parts[5].writeUInt32LE(proofBuf.length);

    // expires_at: Option<i64>
    if (expiresAt !== null && expiresAt !== undefined) {
      const optBuf = Buffer.alloc(9);
      optBuf.writeUInt8(1, 0); // Some
      optBuf.writeBigInt64LE(BigInt(expiresAt), 1);
      parts.push(optBuf);
    } else {
      parts.push(Buffer.from([0])); // None
    }

    const data = Buffer.concat(parts);

    const ix = new TransactionInstruction({
      programId: this.programIds.ATTESTATIONS,
      keys: [
        { pubkey: attPDA, isSigner: false, isWritable: true },
        { pubkey: issuerKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = issuerKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx, attestationPDA: attPDA };
  }

  /**
   * Build verifyAttestation transaction (issuer-only).
   * @param {PublicKey|string} issuer - Must be the original issuer
   * @param {PublicKey|string} attestationPDA - Attestation account address
   * @returns {{ transaction: Transaction }}
   */
  async buildVerifyAttestation(issuer, attestationPDA) {
    const issuerKey = new PublicKey(issuer);
    const attKey = new PublicKey(attestationPDA);

    const disc = anchorDiscriminator('verify_attestation');

    const ix = new TransactionInstruction({
      programId: this.programIds.ATTESTATIONS,
      keys: [
        { pubkey: attKey, isSigner: false, isWritable: true },
        { pubkey: issuerKey, isSigner: true, isWritable: false },
      ],
      data: disc,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = issuerKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  /**
   * Build revokeAttestation transaction (issuer-only).
   * @param {PublicKey|string} issuer - Must be the original issuer
   * @param {PublicKey|string} attestationPDA - Attestation account address
   * @returns {{ transaction: Transaction }}
   */
  async buildRevokeAttestation(issuer, attestationPDA) {
    const issuerKey = new PublicKey(issuer);
    const attKey = new PublicKey(attestationPDA);

    const disc = anchorDiscriminator('revoke_attestation');

    const ix = new TransactionInstruction({
      programId: this.programIds.ATTESTATIONS,
      keys: [
        { pubkey: attKey, isSigner: false, isWritable: true },
        { pubkey: issuerKey, isSigner: true, isWritable: false },
      ],
      data: disc,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = issuerKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  // ═══════════════════════════════════════════════════
  //  REVIEWS — Create / Update / Delete / Counter
  // ═══════════════════════════════════════════════════

  /**
   * Build initReviewCounter transaction. Must be called once per agent before any reviews.
   * PDA: ["review_counter_v3", SHA256(agent_id)]
   * @param {PublicKey|string} payer - Transaction signer + fee payer
   * @param {string} agentId - Agent identifier
   * @returns {{ transaction: Transaction, counterPDA: PublicKey }}
   */
  async buildInitReviewCounter(payer, agentId) {
    const payerKey = new PublicKey(payer);
    const [counterPDA] = getV3ReviewCounterPDA(agentId, this.network);

    const disc = anchorDiscriminator('init_review_counter');
    const data = Buffer.concat([disc, serializeString(agentId)]);

    const ix = new TransactionInstruction({
      programId: this.programIds.REVIEWS,
      keys: [
        { pubkey: counterPDA, isSigner: false, isWritable: true },
        { pubkey: payerKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = payerKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx, counterPDA };
  }

  /**
   * Build createReview transaction (V3.1 with self-review prevention).
   * PDA: ["review_v3", SHA256(agent_id), reviewer]
   *
   * @param {PublicKey|string} reviewer - Reviewer wallet (signer + fee payer)
   * @param {string} agentId - Agent identifier being reviewed
   * @param {number} rating - 1-5 rating
   * @param {string} reviewText - Review text (max 512 chars)
   * @param {string} [metadata=''] - Optional metadata JSON (max 256 chars)
   * @param {object} [opts={}] - Optional self-review check params
   * @param {PublicKey|string} [opts.identityProgram] - Identity program ID for self-review check
   * @param {PublicKey|string} [opts.identityAccount] - Identity PDA for self-review check
   * @returns {{ transaction: Transaction, reviewPDA: PublicKey }}
   */
  async buildCreateReview(reviewer, agentId, rating, reviewText, metadata = '', opts = {}) {
    const reviewerKey = new PublicKey(reviewer);
    const [reviewPDA] = getV3ReviewPDA(agentId, reviewerKey, this.network);
    const [counterPDA] = getV3ReviewCounterPDA(agentId, this.network);

    // Self-review check: if identityProgram is provided, use it; otherwise use system_program (skip check)
    const identityProgram = opts.identityProgram
      ? new PublicKey(opts.identityProgram)
      : SystemProgram.programId;
    const identityAccount = opts.identityAccount
      ? new PublicKey(opts.identityAccount)
      : SystemProgram.programId; // placeholder when check is skipped

    const disc = anchorDiscriminator('create_review');
    const data = Buffer.concat([
      disc,
      serializeString(agentId),
      Buffer.from([rating]),
      serializeString(reviewText),
      serializeString(metadata),
    ]);

    const ix = new TransactionInstruction({
      programId: this.programIds.REVIEWS,
      keys: [
        { pubkey: reviewPDA, isSigner: false, isWritable: true },
        { pubkey: counterPDA, isSigner: false, isWritable: true },
        { pubkey: reviewerKey, isSigner: true, isWritable: true },
        { pubkey: identityProgram, isSigner: false, isWritable: false },
        { pubkey: identityAccount, isSigner: false, isWritable: false },
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
   * Build createReview with self-review prevention enabled (convenience).
   * Automatically resolves identity PDA from agentId.
   * @param {PublicKey|string} reviewer
   * @param {string} agentId
   * @param {number} rating
   * @param {string} reviewText
   * @param {string} [metadata='']
   * @returns {{ transaction: Transaction, reviewPDA: PublicKey }}
   */
  async buildCreateReviewWithSelfCheck(reviewer, agentId, rating, reviewText, metadata = '') {
    const [identityAccount] = getGenesisPDA(agentId, this.network);
    return this.buildCreateReview(reviewer, agentId, rating, reviewText, metadata, {
      identityProgram: this.programIds.IDENTITY,
      identityAccount,
    });
  }

  /**
   * Build updateReview transaction (reviewer only).
   * @param {PublicKey|string} reviewer - Must be the original reviewer
   * @param {PublicKey|string} reviewPDA - Review account address
   * @param {object} updates - { rating?: number, reviewText?: string, metadata?: string }
   * @returns {{ transaction: Transaction }}
   */
  async buildUpdateReview(reviewer, reviewPDA, updates = {}) {
    const reviewerKey = new PublicKey(reviewer);
    const reviewKey = new PublicKey(reviewPDA);

    const disc = anchorDiscriminator('update_review');

    // Encode Option<u8> rating
    const ratingBuf = updates.rating != null
      ? Buffer.from([1, updates.rating])
      : Buffer.from([0]);

    // Encode Option<String> review_text
    const textBuf = updates.reviewText != null
      ? Buffer.concat([Buffer.from([1]), serializeString(updates.reviewText)])
      : Buffer.from([0]);

    // Encode Option<String> metadata
    const metaBuf = updates.metadata != null
      ? Buffer.concat([Buffer.from([1]), serializeString(updates.metadata)])
      : Buffer.from([0]);

    const data = Buffer.concat([disc, ratingBuf, textBuf, metaBuf]);

    const ix = new TransactionInstruction({
      programId: this.programIds.REVIEWS,
      keys: [
        { pubkey: reviewKey, isSigner: false, isWritable: true },
        { pubkey: reviewerKey, isSigner: true, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = reviewerKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  /**
   * Build deleteReview transaction (soft-delete, reviewer only).
   * @param {PublicKey|string} reviewer - Must be the original reviewer
   * @param {PublicKey|string} reviewPDA - Review account address
   * @returns {{ transaction: Transaction }}
   */
  async buildDeleteReview(reviewer, reviewPDA) {
    const reviewerKey = new PublicKey(reviewer);
    const reviewKey = new PublicKey(reviewPDA);

    const disc = anchorDiscriminator('delete_review');

    const ix = new TransactionInstruction({
      programId: this.programIds.REVIEWS,
      keys: [
        { pubkey: reviewKey, isSigner: false, isWritable: true },
        { pubkey: reviewerKey, isSigner: true, isWritable: false },
      ],
      data: disc,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = reviewerKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  /**
   * Fetch a Review account.
   * @param {string} agentId - Agent identifier
   * @param {PublicKey|string} reviewer - Reviewer pubkey
   * @returns {object|null}
   */
  async getReview(agentId, reviewer) {
    const reviewerKey = new PublicKey(reviewer);
    const [pda] = getV3ReviewPDA(agentId, reviewerKey, this.network);
    const acct = await this.connection.getAccountInfo(pda);
    if (!acct) return null;

    try {
      const data = acct.data.slice(8); // skip Anchor discriminator
      let offset = 0;

      const readString = () => {
        const len = data.readUInt32LE(offset); offset += 4;
        const str = data.slice(offset, offset + len).toString('utf8'); offset += len;
        return str;
      };

      const reviewAgentId = readString();
      const agentIdHash = data.slice(offset, offset + 32); offset += 32;
      const reviewerPk = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
      const rating = data[offset]; offset += 1;
      const reviewText = readString();
      const metadata = readString();
      const createdAt = Number(data.readBigInt64LE(offset)); offset += 8;
      const updatedAt = Number(data.readBigInt64LE(offset)); offset += 8;
      const isActive = data[offset] === 1; offset += 1;
      const bump = data[offset]; offset += 1;

      return {
        pda: pda.toBase58(),
        agentId: reviewAgentId,
        agentIdHash: Buffer.from(agentIdHash).toString('hex'),
        reviewer: reviewerPk.toBase58(),
        rating,
        reviewText,
        metadata,
        createdAt,
        updatedAt,
        isActive,
        bump,
      };
    } catch (e) {
      return { pda: pda.toBase58(), raw: acct.data.toString('hex'), error: e.message };
    }
  }

  /**
   * Fetch review counter for an agent.
   * @param {string} agentId
   * @returns {{ count: number, pda: string }|null}
   */
  async getReviewCount(agentId) {
    const [pda] = getV3ReviewCounterPDA(agentId, this.network);
    const acct = await this.connection.getAccountInfo(pda);
    if (!acct) return null;

    try {
      const data = acct.data.slice(8);
      let offset = 0;

      const readString = () => {
        const len = data.readUInt32LE(offset); offset += 4;
        const str = data.slice(offset, offset + len).toString('utf8'); offset += len;
        return str;
      };

      const counterAgentId = readString();
      offset += 32; // agent_id_hash
      const count = Number(data.readBigUInt64LE(offset)); offset += 8;
      const bump = data[offset]; offset += 1;

      return { pda: pda.toBase58(), agentId: counterAgentId, count, bump };
    } catch (e) {
      return { pda: pda.toBase58(), raw: acct.data.toString('hex'), error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════
  //  REPUTATION — Permissionless Recompute
  // ═══════════════════════════════════════════════════

  /**
   * Build recomputeReputation transaction (permissionless).
   * Reads review accounts from remaining_accounts and CPIs into Identity.
   * @param {PublicKey|string} caller - Transaction signer + fee payer
   * @param {string|Buffer} agentIdOrHash
   * @param {PublicKey[]} reviewAccounts - Array of Review account pubkeys to include
   * @returns {{ transaction: Transaction }}
   */
  async buildRecomputeReputation(caller, agentIdOrHash, reviewAccounts = []) {
    const callerKey = new PublicKey(caller);
    const [genesisPDA] = getGenesisPDA(agentIdOrHash, this.network);
    const [repAuthority] = getV3ReputationAuthorityPDA(this.network);

    const disc = anchorDiscriminator('recompute_reputation');

    const keys = [
      { pubkey: genesisPDA, isSigner: false, isWritable: true },
      { pubkey: repAuthority, isSigner: false, isWritable: false },
      { pubkey: this.programIds.IDENTITY, isSigner: false, isWritable: false },
      { pubkey: callerKey, isSigner: true, isWritable: true },
    ];

    // Add review accounts as remaining_accounts (read-only)
    for (const acct of reviewAccounts) {
      keys.push({ pubkey: new PublicKey(acct), isSigner: false, isWritable: false });
    }

    const ix = new TransactionInstruction({
      programId: this.programIds.REPUTATION,
      keys,
      data: disc,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = callerKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  // ═══════════════════════════════════════════════════
  //  VALIDATION — Permissionless Recompute
  // ═══════════════════════════════════════════════════

  /**
   * Build recomputeLevel transaction (permissionless).
   * Reads attestation accounts from remaining_accounts and CPIs into Identity.
   * @param {PublicKey|string} caller
   * @param {string|Buffer} agentIdOrHash
   * @param {PublicKey[]} attestationAccounts - Array of Attestation account pubkeys
   * @returns {{ transaction: Transaction }}
   */
  async buildRecomputeLevel(caller, agentIdOrHash, attestationAccounts = []) {
    const callerKey = new PublicKey(caller);
    const [genesisPDA] = getGenesisPDA(agentIdOrHash, this.network);
    const [valAuthority] = getV3ValidationAuthorityPDA(this.network);

    const disc = anchorDiscriminator('recompute_level');

    const keys = [
      { pubkey: genesisPDA, isSigner: false, isWritable: true },
      { pubkey: valAuthority, isSigner: false, isWritable: false },
      { pubkey: this.programIds.IDENTITY, isSigner: false, isWritable: false },
      { pubkey: callerKey, isSigner: true, isWritable: true },
    ];

    for (const acct of attestationAccounts) {
      keys.push({ pubkey: new PublicKey(acct), isSigner: false, isWritable: false });
    }

    const ix = new TransactionInstruction({
      programId: this.programIds.VALIDATION,
      keys,
      data: disc,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = callerKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  // ═══════════════════════════════════════════════════
  //  ESCROW V3 — Identity-Verified On-Chain Escrow
  // ═══════════════════════════════════════════════════

  /**
   * Build createEscrow transaction (V3 — identity-verified).
   *
   * Creates an escrow between a client and a verified SATP V3 agent.
   * Verifies agent's Genesis Record on-chain (PDA derivation + owner check).
   * Optionally enforces minimum verification level and born status.
   *
   * PDA seeds: ["escrow_v3", client, description_hash, nonce_le_bytes]
   *
   * @param {PublicKey|string} client - Client wallet (signer + payer)
   * @param {PublicKey|string} agentWallet - Agent's wallet to receive funds
   * @param {string} agentId - Agent identifier (for Genesis Record lookup)
   * @param {number} amount - Lamports to escrow
   * @param {string|Buffer} descriptionOrHash - Job description string (will be SHA-256 hashed) or 32-byte hash buffer
   * @param {number} deadline - Unix timestamp deadline
   * @param {number} [nonce=0] - Nonce for uniqueness (multiple escrows between same parties)
   * @param {object} [opts={}] - Optional trust requirements
   * @param {number} [opts.minVerificationLevel=0] - Minimum verification level (0-5)
   * @param {boolean} [opts.requireBorn=false] - Require agent to have completed burn-to-become
   * @param {PublicKey|string} [opts.arbiter] - Arbiter for dispute resolution (defaults to client)
   * @returns {{ transaction: Transaction, escrowPDA: PublicKey, descriptionHash: Buffer }}
   */
  async buildCreateEscrow(client, agentWallet, agentId, amount, descriptionOrHash, deadline, nonce = 0, opts = {}) {
    const clientKey = new PublicKey(client);
    const agentWalletKey = new PublicKey(agentWallet);
    const descriptionHash = Buffer.isBuffer(descriptionOrHash) && descriptionOrHash.length === 32
      ? descriptionOrHash
      : crypto.createHash('sha256').update(typeof descriptionOrHash === 'string' ? descriptionOrHash : Buffer.from(descriptionOrHash)).digest();

    const [escrowPDA] = getV3EscrowPDA(clientKey, descriptionHash, nonce, this.network);
    const [agentIdentityPDA] = getGenesisPDA(agentId, this.network);

    const arbiterKey = opts.arbiter ? new PublicKey(opts.arbiter) : clientKey;
    const minVerificationLevel = opts.minVerificationLevel || 0;
    const requireBorn = opts.requireBorn || false;

    const disc = anchorDiscriminator('create_escrow');

    // Serialize args: agent_id (String), amount (u64), description_hash ([u8;32]),
    //   deadline (i64), nonce (u64), min_verification_level (u8), require_born (bool)
    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64LE(BigInt(amount));
    const deadlineBuf = Buffer.alloc(8);
    deadlineBuf.writeBigInt64LE(BigInt(deadline));
    const nonceBuf = Buffer.alloc(8);
    nonceBuf.writeBigUInt64LE(BigInt(nonce));

    const data = Buffer.concat([
      disc,
      serializeString(agentId),                       // String
      amountBuf,                                      // u64
      descriptionHash,                                // [u8; 32]
      deadlineBuf,                                    // i64
      nonceBuf,                                       // u64
      Buffer.from([minVerificationLevel]),             // u8
      Buffer.from([requireBorn ? 1 : 0]),              // bool
    ]);

    const ix = new TransactionInstruction({
      programId: this.programIds.ESCROW,
      keys: [
        { pubkey: clientKey, isSigner: true, isWritable: true },
        { pubkey: agentWalletKey, isSigner: false, isWritable: false },
        { pubkey: agentIdentityPDA, isSigner: false, isWritable: false },
        { pubkey: arbiterKey, isSigner: false, isWritable: false },
        { pubkey: escrowPDA, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = clientKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx, escrowPDA, descriptionHash };
  }

  /**
   * Build submitWork transaction (agent submits work proof).
   * @param {PublicKey|string} agent - Agent wallet (signer)
   * @param {PublicKey|string} escrowPDA - Escrow account address
   * @param {string|Buffer} workProofOrHash - Work proof string (SHA-256 hashed) or 32-byte hash
   * @returns {{ transaction: Transaction, workHash: Buffer }}
   */
  async buildSubmitWork(agent, escrowPDA, workProofOrHash) {
    const agentKey = new PublicKey(agent);
    const escrowKey = new PublicKey(escrowPDA);
    const workHash = Buffer.isBuffer(workProofOrHash) && workProofOrHash.length === 32
      ? workProofOrHash
      : crypto.createHash('sha256').update(typeof workProofOrHash === 'string' ? workProofOrHash : Buffer.from(workProofOrHash)).digest();

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
   * Build release transaction (client releases full remaining funds to agent).
   * @param {PublicKey|string} client - Client wallet (signer)
   * @param {PublicKey|string} agent - Agent wallet (receives funds)
   * @param {PublicKey|string} escrowPDA - Escrow account address
   * @returns {{ transaction: Transaction }}
   */
  async buildEscrowRelease(client, agent, escrowPDA) {
    const clientKey = new PublicKey(client);
    const agentKey = new PublicKey(agent);
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
   * Build partialRelease transaction (milestone payment).
   * @param {PublicKey|string} client - Client wallet (signer)
   * @param {PublicKey|string} agent - Agent wallet (receives funds)
   * @param {PublicKey|string} escrowPDA - Escrow account address
   * @param {number} amount - Lamports to release
   * @returns {{ transaction: Transaction }}
   */
  async buildPartialRelease(client, agent, escrowPDA, amount) {
    const clientKey = new PublicKey(client);
    const agentKey = new PublicKey(agent);
    const escrowKey = new PublicKey(escrowPDA);

    const disc = anchorDiscriminator('partial_release');
    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64LE(BigInt(amount));

    const data = Buffer.concat([disc, amountBuf]);

    const ix = new TransactionInstruction({
      programId: this.programIds.ESCROW,
      keys: [
        { pubkey: escrowKey, isSigner: false, isWritable: true },
        { pubkey: clientKey, isSigner: true, isWritable: false },
        { pubkey: agentKey, isSigner: false, isWritable: true },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = clientKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  /**
   * Build cancel transaction (client cancels after deadline, gets refund).
   * @param {PublicKey|string} client - Client wallet (signer)
   * @param {PublicKey|string} escrowPDA - Escrow account address
   * @returns {{ transaction: Transaction }}
   */
  async buildCancelEscrow(client, escrowPDA) {
    const clientKey = new PublicKey(client);
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
   * Build raiseDispute transaction (either client or agent).
   * @param {PublicKey|string} signer - Client or agent wallet (signer)
   * @param {PublicKey|string} escrowPDA - Escrow account address
   * @param {string|Buffer} reasonOrHash - Dispute reason string (SHA-256 hashed) or 32-byte hash
   * @returns {{ transaction: Transaction, reasonHash: Buffer }}
   */
  async buildRaiseDispute(signer, escrowPDA, reasonOrHash) {
    const signerKey = new PublicKey(signer);
    const escrowKey = new PublicKey(escrowPDA);
    const reasonHash = Buffer.isBuffer(reasonOrHash) && reasonOrHash.length === 32
      ? reasonOrHash
      : crypto.createHash('sha256').update(typeof reasonOrHash === 'string' ? reasonOrHash : Buffer.from(reasonOrHash)).digest();

    const disc = anchorDiscriminator('raise_dispute');
    const data = Buffer.concat([disc, reasonHash]);

    const ix = new TransactionInstruction({
      programId: this.programIds.ESCROW,
      keys: [
        { pubkey: escrowKey, isSigner: false, isWritable: true },
        { pubkey: signerKey, isSigner: true, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = signerKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx, reasonHash };
  }

  /**
   * Build resolveDispute transaction (arbiter splits funds).
   * @param {PublicKey|string} arbiter - Designated arbiter (signer)
   * @param {PublicKey|string} agent - Agent wallet (receives agent_amount)
   * @param {PublicKey|string} clientWallet - Client wallet (receives client_amount)
   * @param {PublicKey|string} escrowPDA - Escrow account address
   * @param {number} agentAmount - Lamports to release to agent
   * @param {number} clientAmount - Lamports to refund to client
   * @returns {{ transaction: Transaction }}
   */
  async buildResolveDispute(arbiter, agent, clientWallet, escrowPDA, agentAmount, clientAmount) {
    const arbiterKey = new PublicKey(arbiter);
    const agentKey = new PublicKey(agent);
    const clientKey = new PublicKey(clientWallet);
    const escrowKey = new PublicKey(escrowPDA);

    const disc = anchorDiscriminator('resolve_dispute');
    const agentAmtBuf = Buffer.alloc(8);
    agentAmtBuf.writeBigUInt64LE(BigInt(agentAmount));
    const clientAmtBuf = Buffer.alloc(8);
    clientAmtBuf.writeBigUInt64LE(BigInt(clientAmount));

    const data = Buffer.concat([disc, agentAmtBuf, clientAmtBuf]);

    const ix = new TransactionInstruction({
      programId: this.programIds.ESCROW,
      keys: [
        { pubkey: escrowKey, isSigner: false, isWritable: true },
        { pubkey: arbiterKey, isSigner: true, isWritable: false },
        { pubkey: agentKey, isSigner: false, isWritable: true },
        { pubkey: clientKey, isSigner: false, isWritable: true },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = arbiterKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  /**
   * Build extendDeadline transaction (client extends escrow deadline).
   * Only when Active. New deadline must be strictly after current.
   * @param {PublicKey|string} client - Client wallet (signer)
   * @param {PublicKey|string} escrowPDA - Escrow account address
   * @param {number} newDeadline - New Unix timestamp deadline
   * @returns {{ transaction: Transaction }}
   */
  async buildExtendDeadline(client, escrowPDA, newDeadline) {
    const clientKey = new PublicKey(client);
    const escrowKey = new PublicKey(escrowPDA);

    const disc = anchorDiscriminator('extend_deadline');
    const deadlineBuf = Buffer.alloc(8);
    deadlineBuf.writeBigInt64LE(BigInt(newDeadline));

    const data = Buffer.concat([disc, deadlineBuf]);

    const ix = new TransactionInstruction({
      programId: this.programIds.ESCROW,
      keys: [
        { pubkey: escrowKey, isSigner: false, isWritable: true },
        { pubkey: clientKey, isSigner: true, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = clientKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx };
  }

  /**
   * Build closeEscrow transaction (returns rent to client).
   * Only when Released, Cancelled, or Resolved.
   * @param {PublicKey|string} client - Client wallet (signer, receives rent)
   * @param {PublicKey|string} escrowPDA - Escrow account address
   * @returns {{ transaction: Transaction }}
   */
  async buildCloseEscrow(client, escrowPDA) {
    const clientKey = new PublicKey(client);
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
   * Fetch and deserialize an Escrow V3 account.
   * @param {PublicKey|string} escrowPDA - Escrow account address
   * @returns {object|null}
   */
  async getEscrow(escrowPDA) {
    const escrowKey = new PublicKey(escrowPDA);
    const acct = await this.connection.getAccountInfo(escrowKey);
    if (!acct) return null;

    try {
      const data = acct.data.slice(8); // skip Anchor discriminator
      let offset = 0;

      const client = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
      const agent = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
      const agentIdHash = data.slice(offset, offset + 32); offset += 32;
      const amount = Number(data.readBigUInt64LE(offset)); offset += 8;
      const releasedAmount = Number(data.readBigUInt64LE(offset)); offset += 8;
      const descriptionHash = data.slice(offset, offset + 32); offset += 32;
      const deadline = Number(data.readBigInt64LE(offset)); offset += 8;
      const nonce = Number(data.readBigUInt64LE(offset)); offset += 8;
      const statusByte = data[offset]; offset += 1;
      const minVerificationLevel = data[offset]; offset += 1;
      const requireBorn = data[offset] === 1; offset += 1;
      const createdAt = Number(data.readBigInt64LE(offset)); offset += 8;
      const arbiter = new PublicKey(data.slice(offset, offset + 32)); offset += 32;

      // Option<[u8; 32]> work_hash
      const hasWorkHash = data[offset] === 1; offset += 1;
      let workHash = null;
      if (hasWorkHash) {
        workHash = Buffer.from(data.slice(offset, offset + 32)).toString('hex');
      }
      offset += 32;

      // Option<i64> work_submitted_at
      const hasWorkSubmittedAt = data[offset] === 1; offset += 1;
      let workSubmittedAt = null;
      if (hasWorkSubmittedAt) {
        workSubmittedAt = Number(data.readBigInt64LE(offset));
      }
      offset += 8;

      // Option<[u8; 32]> dispute_reason_hash
      const hasDisputeHash = data[offset] === 1; offset += 1;
      let disputeReasonHash = null;
      if (hasDisputeHash) {
        disputeReasonHash = Buffer.from(data.slice(offset, offset + 32)).toString('hex');
      }
      offset += 32;

      // Option<i64> disputed_at
      const hasDisputedAt = data[offset] === 1; offset += 1;
      let disputedAt = null;
      if (hasDisputedAt) {
        disputedAt = Number(data.readBigInt64LE(offset));
      }
      offset += 8;

      // Option<Pubkey> disputed_by
      const hasDisputedBy = data[offset] === 1; offset += 1;
      let disputedBy = null;
      if (hasDisputedBy) {
        disputedBy = new PublicKey(data.slice(offset, offset + 32)).toBase58();
      }
      offset += 32;

      const bump = data[offset]; offset += 1;

      const STATUS_MAP = ['Active', 'WorkSubmitted', 'Released', 'Cancelled', 'Disputed', 'Resolved'];

      return {
        pda: escrowKey.toBase58(),
        client: client.toBase58(),
        agent: agent.toBase58(),
        agentIdHash: Buffer.from(agentIdHash).toString('hex'),
        amount,
        releasedAmount,
        remaining: amount - releasedAmount,
        descriptionHash: Buffer.from(descriptionHash).toString('hex'),
        deadline,
        nonce,
        status: STATUS_MAP[statusByte] || `Unknown(${statusByte})`,
        statusCode: statusByte,
        minVerificationLevel,
        requireBorn,
        createdAt,
        arbiter: arbiter.toBase58(),
        workHash,
        workSubmittedAt,
        disputeReasonHash,
        disputedAt,
        disputedBy,
        bump,
      };
    } catch (e) {
      return { pda: escrowKey.toBase58(), raw: acct.data.toString('hex'), error: e.message };
    }
  }

  /**
   * Derive Escrow V3 PDA without RPC calls.
   * @param {PublicKey|string} client - Client wallet
   * @param {string|Buffer} descriptionOrHash - Job description or 32-byte hash
   * @param {number} [nonce=0]
   * @returns {{ escrowPDA: string, bump: number, descriptionHash: string }}
   */
  getEscrowPDA(client, descriptionOrHash, nonce = 0) {
    const descriptionHash = Buffer.isBuffer(descriptionOrHash) && descriptionOrHash.length === 32
      ? descriptionOrHash
      : crypto.createHash('sha256').update(typeof descriptionOrHash === 'string' ? descriptionOrHash : Buffer.from(descriptionOrHash)).digest();
    const [pda, bump] = getV3EscrowPDA(client, descriptionHash, nonce, this.network);
    return {
      escrowPDA: pda.toBase58(),
      bump,
      descriptionHash: descriptionHash.toString('hex'),
    };
  }

  // ═══════════════════════════════════════════════════
  //  V2 → V3 MIGRATION
  // ═══════════════════════════════════════════════════

  /**
   * Build migrateV2ToV3 transaction.
   * @param {PublicKey|string} v2Authority - V2 identity authority (signer + payer)
   * @param {string} agentId - Agent identifier
   * @param {object} meta - { name, description, category, capabilities, metadataUri }
   * @returns {{ transaction: Transaction, genesisPDA: PublicKey }}
   */
  async buildMigrateV2ToV3(v2Authority, agentId, meta) {
    const v2AuthKey = new PublicKey(v2Authority);
    const agentIdHash = hashAgentId(agentId);
    const [genesisPDA] = getGenesisPDA(agentIdHash, this.network);

    const disc = anchorDiscriminator('migrate_v2_to_v3');
    const data = Buffer.concat([
      disc,
      agentIdHash,
      serializeString(meta.name || ''),
      serializeString(meta.description || ''),
      serializeString(meta.category || ''),
      serializeVecString(meta.capabilities || []),
      serializeString(meta.metadataUri || ''),
    ]);

    const ix = new TransactionInstruction({
      programId: this.programIds.IDENTITY,
      keys: [
        { pubkey: genesisPDA, isSigner: false, isWritable: true },
        { pubkey: v2AuthKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = v2AuthKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    return { transaction: tx, genesisPDA };
  }

  // ═══════════════════════════════════════════════════
  //  READ — Fetch On-Chain State
  // ═══════════════════════════════════════════════════

  /**
   * Fetch Genesis Record data.
   * @param {string|Buffer} agentIdOrHash
   * @returns {object|null}
   */
  async getGenesisRecord(agentIdOrHash) {
    const [pda] = getGenesisPDA(agentIdOrHash, this.network);
    const acct = await this.connection.getAccountInfo(pda);
    if (!acct) return null;

    try {
      const data = acct.data.slice(8); // skip Anchor discriminator
      let offset = 0;

      const agentIdHash = data.slice(offset, offset + 32); offset += 32;

      // Read strings
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
      const isActive = data[offset] === 1; offset += 1;
      const authority = new PublicKey(data.slice(offset, offset + 32)); offset += 32;

      // Option<Pubkey>
      const hasPending = data[offset] === 1; offset += 1;
      let pendingAuthority = null;
      if (hasPending) {
        pendingAuthority = new PublicKey(data.slice(offset, offset + 32)).toBase58();
      }
      offset += 32;

      const reputationScore = Number(data.readBigUInt64LE(offset)); offset += 8;
      const verificationLevel = data[offset]; offset += 1;
      const reputationUpdatedAt = Number(data.readBigInt64LE(offset)); offset += 8;
      const verificationUpdatedAt = Number(data.readBigInt64LE(offset)); offset += 8;
      const createdAt = Number(data.readBigInt64LE(offset)); offset += 8;
      const updatedAt = Number(data.readBigInt64LE(offset)); offset += 8;
      const bump = data[offset]; offset += 1;

      const isBorn = genesisRecord !== 0;

      return {
        pda: pda.toBase58(),
        agentIdHash: Buffer.from(agentIdHash).toString('hex'),
        agentName,
        description,
        category,
        capabilities,
        metadataUri,
        faceImage: faceImage || null,
        faceMint: faceMint.equals(PublicKey.default) ? null : faceMint.toBase58(),
        faceBurnTx: faceBurnTx || null,
        genesisRecord,
        isBorn,
        isActive,
        authority: authority.toBase58(),
        pendingAuthority,
        reputationScore,
        verificationLevel,
        reputationUpdatedAt,
        verificationUpdatedAt,
        createdAt,
        updatedAt,
        bump,
      };
    } catch (e) {
      return { pda: pda.toBase58(), raw: acct.data.toString('hex'), error: e.message };
    }
  }

  /**
   * Check if a name is available.
   * @param {string} name
   * @returns {boolean} true if available (not registered)
   */
  async isNameAvailable(name) {
    const [pda] = getNameRegistryPDA(name, this.network);
    const acct = await this.connection.getAccountInfo(pda);
    if (!acct) return true;
    // Account exists — check if still active
    try {
      const data = acct.data.slice(8);
      // NameRegistry: name (string), name_hash (32), identity (32), authority (32), registered_at (8), is_active (1), bump (1)
      let offset = 0;
      const len = data.readUInt32LE(offset); offset += 4 + len;
      offset += 32; // name_hash
      offset += 32; // identity
      offset += 32; // authority
      offset += 8;  // registered_at
      const isActive = data[offset] === 1;
      return !isActive; // available if released
    } catch {
      return false;
    }
  }

  // ═══════════════════════════════════════════════════
  //  UTILITY — PDA Derivation (no RPC)
  // ═══════════════════════════════════════════════════

  /**
   * Derive all V3 PDAs for an agent.
   * @param {string} agentId
   * @returns {object}
   */
  getV3PDAs(agentId) {
    const hash = hashAgentId(agentId);
    const [genesis] = getGenesisPDA(hash, this.network);
    const [mintTracker] = getV3MintTrackerPDA(genesis, this.network);
    const [repAuthority] = getV3ReputationAuthorityPDA(this.network);
    const [valAuthority] = getV3ValidationAuthorityPDA(this.network);

    return {
      agentIdHash: hash.toString('hex'),
      genesis: genesis.toBase58(),
      mintTracker: mintTracker.toBase58(),
      reputationAuthority: repAuthority.toBase58(),
      validationAuthority: valAuthority.toBase58(),
    };
  }

  /**
   * Hash an agent ID to 32-byte seed.
   * @param {string} agentId
   * @returns {Buffer}
   */
  hashAgentId(agentId) {
    return hashAgentId(agentId);
  }

  /**
   * Check if an agent has a registered identity.
   * @param {string} agentId
   * @returns {boolean}
   */
  async hasIdentity(agentId) {
    const record = await this.getGenesisRecord(agentId);
    return record !== null && !record.error;
  }
}

module.exports = {
  SATPV3SDK,
  anchorDiscriminator,
  serializeString,
  serializeVecString,
};