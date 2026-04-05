/**
 * SATP BOA Linker V3
 * 
 * Links a soulbound BOA (Burn-to-Become) token to a V3 Genesis Record.
 * 
 * V3 has a native `burn_to_become` instruction that sets the agent's permanent
 * face (face_image, face_mint, face_burn_tx). This is the "birth event" —
 * once set, face data is immutable on-chain.
 * 
 * Flow:
 *   1. Agent registers via V3 auto-identity → genesis_record = 0 (unborn)
 *   2. Agent burns a BOA NFT via the burn-to-become flow
 *   3. This linker calls burn_to_become on the V3 identity program
 *   4. Optionally creates an attestation recording the BOA link
 *   5. Agent is now "born" — face is permanent on-chain
 * 
 * Key differences from V2 linker:
 *   - Uses V3 program (GTppU4...) with agent_id-based PDAs
 *   - Calls burn_to_become instruction (V2 had no equivalent — used update_identity)
 *   - PDA: ["genesis", SHA256(agent_id)] instead of ["identity", wallet_pubkey]
 *   - burn_to_become requires authority signer (the agent's wallet, NOT deployer)
 *   - Server builds the TX, agent signs client-side
 * 
 * Backward compat:
 *   - V2 linker (satp-boa-linker.js) still works for V2 identities
 *   - V3 linker handles V3 genesis records only
 *   - If agent has V2 identity but no V3, suggests migration first
 */

const { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, Keypair, ComputeBudgetProgram } = require('@solana/web3.js');
const crypto = require('crypto');
const fs = require('fs');

// ─────────────────────────────────────────────
//  PROGRAM IDs
// ─────────────────────────────────────────────

// SATP V3 Identity Program — Mainnet
const SATP_V3_IDENTITY_PROGRAM = new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');

// SATP Attestations Program (still V2 — V3 attestations not deployed yet)
const SATP_ATTESTATIONS_PROGRAM = new PublicKey('ENvaD19QzwWWMJFu5r5xJ9SmHqWN6GvyzxACRejqbdug');

// SATP V2 Identity Program (for legacy check)
const SATP_V2_IDENTITY_PROGRAM = new PublicKey('97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq');

const NETWORK = process.env.SATP_NETWORK || 'mainnet';
const RPC_URL = NETWORK === 'devnet'
  ? 'https://api.devnet.solana.com'
  : (process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');

const DEPLOYER_KEY_PATH = process.env.DEPLOYER_KEY_PATH || '/home/ubuntu/.config/solana/devnet-deployer.json';

const connection = new Connection(RPC_URL, 'confirmed');

// ─────────────────────────────────────────────
//  ENCODING HELPERS
// ─────────────────────────────────────────────

/** Anchor instruction discriminator: SHA256("global:<name>")[0..8] */
function anchorDisc(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

/** SHA-256 hash (matches solana_sha256_hasher::hash on-chain) */
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

/** Borsh-encode a string: u32 LE length + utf8 bytes */
function encodeString(s) {
  const buf = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(buf.length);
  return Buffer.concat([len, buf]);
}

/** Borsh-encode a Pubkey (32 bytes, no length prefix) */
function encodePubkey(pubkey) {
  return new PublicKey(pubkey).toBuffer();
}

// ─────────────────────────────────────────────
//  PDA DERIVATION
// ─────────────────────────────────────────────

/**
 * Compute agent_id_hash: SHA-256 of agent_id string.
 * Must match on-chain: hash(agent_id.as_bytes()).to_bytes()
 */
function computeAgentIdHash(agentId) {
  return sha256(Buffer.from(agentId, 'utf8'));
}

/**
 * Derive V3 Genesis Record PDA: ["genesis", agent_id_hash]
 */
function getV3GenesisRecordPDA(agentId) {
  const agentIdHash = computeAgentIdHash(agentId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('genesis'), agentIdHash],
    SATP_V3_IDENTITY_PROGRAM
  );
}

/**
 * Derive V2 Identity PDA: ["identity", authority_pubkey]
 */
function getV2IdentityPDA(authority) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('identity'), new PublicKey(authority).toBuffer()],
    SATP_V2_IDENTITY_PROGRAM
  );
}

/**
 * Derive attestation PDA
 */
function getAttestationPDA(agentId, issuerPubkey, attestationType) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('attestation'),
      new PublicKey(agentId).toBuffer(),
      issuerPubkey.toBuffer(),
      Buffer.from(attestationType),
    ],
    SATP_ATTESTATIONS_PROGRAM
  );
}

// ─────────────────────────────────────────────
//  V3 GENESIS RECORD PARSER
// ─────────────────────────────────────────────

/**
 * Parse essential fields from a V3 GenesisRecord account.
 * Used to check birth status and authority.
 */
function parseGenesisRecordPartial(data) {
  if (!data || data.length < 100) return null;
  
  let offset = 8; // skip discriminator
  
  // agent_id_hash: [u8; 32]
  const agentIdHash = data.slice(offset, offset + 32);
  offset += 32;
  
  // agent_name: String (4-byte len + data)
  const nameLen = data.readUInt32LE(offset);
  offset += 4;
  const agentName = data.slice(offset, offset + nameLen).toString('utf8');
  offset += nameLen;
  
  // description: String
  const descLen = data.readUInt32LE(offset);
  offset += 4 + descLen;
  
  // category: String
  const catLen = data.readUInt32LE(offset);
  offset += 4 + catLen;
  
  // capabilities: Vec<String>
  const capCount = data.readUInt32LE(offset);
  offset += 4;
  for (let i = 0; i < capCount; i++) {
    const sLen = data.readUInt32LE(offset);
    offset += 4 + sLen;
  }
  
  // metadata_uri: String
  const uriLen = data.readUInt32LE(offset);
  offset += 4 + uriLen;
  
  // face_image: String
  const faceImageLen = data.readUInt32LE(offset);
  offset += 4;
  const faceImage = data.slice(offset, offset + faceImageLen).toString('utf8');
  offset += faceImageLen;
  
  // face_mint: Pubkey (32 bytes)
  const faceMint = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  
  // face_burn_tx: String
  const burnTxLen = data.readUInt32LE(offset);
  offset += 4;
  const faceBurnTx = data.slice(offset, offset + burnTxLen).toString('utf8');
  offset += burnTxLen;
  
  // genesis_record: i64
  const genesisRecord = Number(data.readBigInt64LE(offset));
  offset += 8;
  
  // is_active: bool
  const isActive = data[offset] === 1;
  offset += 1;
  
  // authority: Pubkey (32 bytes)
  const authority = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  
  return {
    agentIdHash: agentIdHash.toString('hex'),
    agentName,
    faceImage,
    faceMint: faceMint.toBase58(),
    faceBurnTx,
    genesisRecord,
    isBorn: genesisRecord > 0,
    isActive,
    authority: authority.toBase58(),
  };
}

// ─────────────────────────────────────────────
//  BURN-TO-BECOME TX BUILDER
// ─────────────────────────────────────────────

/**
 * Build an unsigned burn_to_become TX for the V3 identity program.
 * The authority wallet must sign client-side.
 * 
 * This is the agent's "birth event" — sets permanent face data on-chain.
 * 
 * @param {string} agentId — The agent's unique ID (profileId)
 * @param {string} walletAddress — The authority wallet (must match genesis record authority)
 * @param {string} faceImage — Permanent face image URL (Arweave recommended, max 200 chars)
 * @param {string} faceMint — The soulbound Token-2022 mint address
 * @param {string} faceBurnTx — The burn transaction signature (max 88 chars)
 * @returns {object} { transaction (base64), genesisPDA, status, ... }
 */
async function buildBurnToBecomeTx(agentId, walletAddress, faceImage, faceMint, faceBurnTx) {
  const wallet = new PublicKey(walletAddress);
  const [genesisPDA] = getV3GenesisRecordPDA(agentId);
  const agentIdHash = computeAgentIdHash(agentId);

  // Check genesis record exists and is unborn
  const genesisAcct = await connection.getAccountInfo(genesisPDA);
  if (!genesisAcct || genesisAcct.data.length === 0) {
    return {
      transaction: null,
      error: 'no_genesis_record',
      message: `No V3 genesis record found for agent ${agentId}. Create identity first via /api/satp-auto/v3/identity/create`,
      genesisPDA: genesisPDA.toBase58(),
    };
  }

  // Parse to check birth status and authority
  const parsed = parseGenesisRecordPartial(genesisAcct.data);
  if (!parsed) {
    return {
      transaction: null,
      error: 'parse_failed',
      message: 'Failed to parse genesis record',
      genesisPDA: genesisPDA.toBase58(),
    };
  }

  if (parsed.isBorn) {
    return {
      transaction: null,
      error: 'already_born',
      message: `Agent ${agentId} is already born (genesis_record=${parsed.genesisRecord}). Face data is immutable.`,
      genesisPDA: genesisPDA.toBase58(),
      faceImage: parsed.faceImage,
      faceMint: parsed.faceMint,
      genesisRecord: parsed.genesisRecord,
    };
  }

  if (parsed.authority !== walletAddress) {
    return {
      transaction: null,
      error: 'wrong_authority',
      message: `Wallet ${walletAddress} is not the authority for this genesis record. Authority: ${parsed.authority}`,
      genesisPDA: genesisPDA.toBase58(),
      expectedAuthority: parsed.authority,
    };
  }

  if (!parsed.isActive) {
    return {
      transaction: null,
      error: 'deactivated',
      message: `Agent ${agentId} is deactivated. Reactivate first.`,
      genesisPDA: genesisPDA.toBase58(),
    };
  }

  // Build burn_to_become instruction
  // Signature: burn_to_become(face_image: String, face_mint: Pubkey, face_burn_tx: String)
  const disc = anchorDisc('burn_to_become');
  const data = Buffer.concat([
    disc,
    encodeString(faceImage.slice(0, 200)),    // String
    encodePubkey(faceMint),                    // Pubkey (32 bytes, no length prefix)
    encodeString(faceBurnTx.slice(0, 88)),     // String
  ]);

  // Accounts: genesis (mut, has_one = authority), authority (signer)
  const ix = new TransactionInstruction({
    programId: SATP_V3_IDENTITY_PROGRAM,
    keys: [
      { pubkey: genesisPDA, isSigner: false, isWritable: true },
      { pubkey: wallet, isSigner: true, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));
  tx.add(ix);
  tx.feePayer = wallet;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;

  return {
    transaction: tx.serialize({ requireAllSignatures: false }).toString('base64'),
    genesisPDA: genesisPDA.toBase58(),
    agentIdHash: agentIdHash.toString('hex'),
    authority: wallet.toBase58(),
    agentName: parsed.agentName,
    faceImage,
    faceMint,
    faceBurnTx,
    network: NETWORK,
    programVersion: 'v3',
    program: SATP_V3_IDENTITY_PROGRAM.toBase58(),
    blockhash,
    lastValidBlockHeight,
  };
}

// ─────────────────────────────────────────────
//  ATTESTATION CREATOR (server-side, deployer-signed)
// ─────────────────────────────────────────────

/**
 * Create an attestation recording the BOA → SATP V3 link.
 * This is a server-side operation signed by the deployer key.
 * The attestation records the soulbound mint, burn TX, and artwork.
 * 
 * @param {string} agentId — Agent identifier
 * @param {string} walletAddress — Agent's wallet
 * @param {string} soulboundMint — The soulbound Token-2022 mint address
 * @param {string} burnTx — The burn transaction signature
 * @param {string} artworkUri — The artwork/image URI
 * @returns {object} { attestationTx, attestationPDA, ... }
 */
async function createBoaAttestation(agentId, walletAddress, soulboundMint, burnTx, artworkUri) {
  let deployerKeypair;
  try {
    const keyData = JSON.parse(fs.readFileSync(DEPLOYER_KEY_PATH));
    deployerKeypair = Keypair.fromSecretKey(Uint8Array.from(keyData));
  } catch (e) {
    console.warn('[SATP BOA Linker V3] Deployer key not found, skipping attestation');
    return { attestationTx: null, reason: 'no_deployer_key' };
  }

  const wallet = new PublicKey(walletAddress);
  const attestationType = 'boa_soulbound_v3';
  const proofData = JSON.stringify({
    agentId,
    soulboundMint,
    burnTx,
    artworkUri,
    programVersion: 'v3',
    linkedAt: new Date().toISOString(),
  });

  const [attestationPDA] = getAttestationPDA(wallet, deployerKeypair.publicKey, attestationType);

  // Check if attestation already exists
  const existing = await connection.getAccountInfo(attestationPDA);
  if (existing && existing.data.length > 0) {
    console.log(`[SATP BOA Linker V3] Attestation already exists for ${agentId}`);
    return {
      attestationTx: null,
      attestationPDA: attestationPDA.toBase58(),
      reason: 'already_exists',
    };
  }

  try {
    const disc = anchorDisc('create_attestation');
    // create_attestation(agent_id: Pubkey, attestation_type: String, proof_data: String, expires_at: Option<i64>)
    const data = Buffer.concat([
      disc,
      wallet.toBuffer(),                                     // agent_id: Pubkey (32 bytes)
      encodeString(attestationType),                          // attestation_type: String
      encodeString(proofData.slice(0, 256)),                  // proof_data: String (limited)
      Buffer.from([0]),                                       // None for expires_at (Option<i64>)
    ]);

    const ix = new TransactionInstruction({
      programId: SATP_ATTESTATIONS_PROGRAM,
      keys: [
        { pubkey: attestationPDA, isSigner: false, isWritable: true },
        { pubkey: deployerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000 }));
    tx.add(ix);
    tx.feePayer = deployerKeypair.publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;

    const attestationTxSig = await connection.sendTransaction(tx, [deployerKeypair]);
    await connection.confirmTransaction(attestationTxSig, 'confirmed');

    console.log(`[SATP BOA Linker V3] Attestation created for ${agentId}: ${attestationTxSig}`);

    return {
      attestationTx: attestationTxSig,
      attestationPDA: attestationPDA.toBase58(),
      attestationType,
    };
  } catch (e) {
    console.warn('[SATP BOA Linker V3] Attestation creation failed (non-blocking):', e.message);
    return {
      attestationTx: null,
      attestationPDA: attestationPDA.toBase58(),
      error: e.message,
    };
  }
}

// ─────────────────────────────────────────────
//  COMBINED FLOW
// ─────────────────────────────────────────────

/**
 * Full V3 BOA linking flow:
 *   1. Build unsigned burn_to_become TX (agent signs client-side)
 *   2. After agent submits signed TX, call confirmBurnToBecome()
 *   3. Server creates attestation (deployer-signed)
 * 
 * This function handles step 1 (build TX) and step 3 (attestation).
 * Step 2 happens client-side.
 * 
 * @param {string} agentId — Agent identifier (profileId)
 * @param {string} walletAddress — Agent's wallet (must be authority)
 * @param {string} soulboundMint — Soulbound Token-2022 mint address
 * @param {string} burnTx — Burn transaction signature
 * @param {string} artworkUri — Artwork/face image URI (Arweave recommended)
 * @returns {object} { burnToBecomeTx (base64 unsigned), attestationResult, ... }
 */
async function linkBoaToV3Identity(agentId, walletAddress, soulboundMint, burnTx, artworkUri) {
  // Step 1: Build burn_to_become TX
  const burnResult = await buildBurnToBecomeTx(
    agentId,
    walletAddress,
    artworkUri,         // face_image = artwork URI
    soulboundMint,      // face_mint = soulbound mint address
    burnTx              // face_burn_tx = burn transaction signature
  );

  if (burnResult.error) {
    return {
      ok: false,
      burnToBecome: burnResult,
      attestation: null,
    };
  }

  // Step 3: Create attestation (server-side, non-blocking)
  let attestationResult = null;
  try {
    attestationResult = await createBoaAttestation(
      agentId,
      walletAddress,
      soulboundMint,
      burnTx,
      artworkUri
    );
  } catch (e) {
    console.warn('[SATP BOA Linker V3] Attestation failed (non-blocking):', e.message);
    attestationResult = { error: e.message };
  }

  return {
    ok: true,
    burnToBecome: burnResult,
    attestation: attestationResult,
    genesisPDA: burnResult.genesisPDA,
    agentId,
    network: NETWORK,
    programVersion: 'v3',
  };
}

/**
 * Check V3 birth status for an agent.
 * @param {string} agentId
 * @returns {object} { exists, isBorn, faceImage, faceMint, authority, ... }
 */
async function checkV3BirthStatus(agentId) {
  const [genesisPDA] = getV3GenesisRecordPDA(agentId);
  const acct = await connection.getAccountInfo(genesisPDA);

  if (!acct || acct.data.length === 0) {
    return {
      exists: false,
      genesisPDA: genesisPDA.toBase58(),
      agentIdHash: computeAgentIdHash(agentId).toString('hex'),
    };
  }

  const parsed = parseGenesisRecordPartial(acct.data);
  return {
    exists: true,
    genesisPDA: genesisPDA.toBase58(),
    agentIdHash: computeAgentIdHash(agentId).toString('hex'),
    ...(parsed || {}),
  };
}

// ─────────────────────────────────────────────
//  EXPRESS ROUTES
// ─────────────────────────────────────────────

/**
 * Register V3 BOA linker routes on Express app.
 * Routes live at /api/satp-auto/v3/boa/*
 */
function registerBoaLinkerV3Routes(app) {

  /**
   * POST /api/satp-auto/v3/boa/burn-to-become
   * Build an unsigned burn_to_become TX for the agent to sign.
   * 
   * Body: { agentId, walletAddress, faceImage, faceMint, faceBurnTx }
   */
  app.post('/api/satp-auto/v3/boa/burn-to-become', async (req, res) => {
    try {
      const { agentId, walletAddress, faceImage, faceMint, faceBurnTx } = req.body;

      if (!agentId) return res.status(400).json({ error: 'agentId required' });
      if (!walletAddress) return res.status(400).json({ error: 'walletAddress required' });
      if (!faceImage) return res.status(400).json({ error: 'faceImage required (Arweave URL)' });
      if (!faceMint) return res.status(400).json({ error: 'faceMint required (soulbound mint address)' });
      if (!faceBurnTx) return res.status(400).json({ error: 'faceBurnTx required (burn TX signature)' });

      const result = await buildBurnToBecomeTx(agentId, walletAddress, faceImage, faceMint, faceBurnTx);

      if (result.error) {
        return res.status(400).json({ ok: false, ...result });
      }

      console.log(`[SATP BOA V3] Built burn_to_become TX for agent=${agentId} wallet=${walletAddress}`);
      res.json({ ok: true, data: result });
    } catch (err) {
      console.error('[SATP BOA V3] burn-to-become error:', err.message);
      res.status(500).json({ error: 'Failed to build burn_to_become TX', detail: err.message });
    }
  });

  /**
   * POST /api/satp-auto/v3/boa/confirm
   * Called after agent signs and submits the burn_to_become TX.
   * Creates an attestation and updates the DB.
   * 
   * Body: { agentId, walletAddress, soulboundMint, burnTxSignature, artworkUri, birthTxSignature }
   */
  app.post('/api/satp-auto/v3/boa/confirm', async (req, res) => {
    try {
      const { agentId, walletAddress, soulboundMint, burnTxSignature, artworkUri, birthTxSignature } = req.body;

      if (!agentId) return res.status(400).json({ error: 'agentId required' });
      if (!walletAddress) return res.status(400).json({ error: 'walletAddress required' });

      // Verify the agent is now born on-chain
      const status = await checkV3BirthStatus(agentId);
      if (!status.exists) {
        return res.status(400).json({ error: 'No V3 genesis record found for this agent' });
      }

      // Create attestation
      let attestation = null;
      if (soulboundMint && burnTxSignature) {
        attestation = await createBoaAttestation(
          agentId,
          walletAddress,
          soulboundMint,
          burnTxSignature,
          artworkUri || ''
        );
      }

      // Update DB with birth info
      try {
        const path = require('path');
        const Database = require('better-sqlite3');
        const db = new Database(path.join(__dirname, '../../data/agentfolio.db'));

        const profile = db.prepare('SELECT verification_data FROM profiles WHERE id = ?').get(agentId);
        if (profile) {
          let vd = {};
          try { vd = JSON.parse(profile.verification_data || '{}'); } catch {}
          vd.boa_v3 = {
            born: status.isBorn,
            genesisRecord: status.genesisRecord,
            faceImage: status.faceImage,
            faceMint: status.faceMint,
            soulboundMint,
            burnTxSignature,
            birthTxSignature,
            artworkUri,
            attestationTx: attestation?.attestationTx || null,
            genesisPDA: status.genesisPDA,
            confirmedAt: new Date().toISOString(),
          };
          db.prepare('UPDATE profiles SET verification_data = ? WHERE id = ?')
            .run(JSON.stringify(vd), agentId);
        }

        db.close();
        console.log(`[SATP BOA V3] Birth confirmed for ${agentId}: born=${status.isBorn}`);
      } catch (dbErr) {
        console.warn('[SATP BOA V3] DB update failed (non-blocking):', dbErr.message);
      }

      res.json({
        ok: true,
        data: {
          agentId,
          ...status,
          attestation,
          birthTxSignature,
          network: NETWORK,
          programVersion: 'v3',
        },
      });
    } catch (err) {
      console.error('[SATP BOA V3] confirm error:', err.message);
      res.status(500).json({ error: 'Failed to confirm birth', detail: err.message });
    }
  });

  /**
   * GET /api/satp-auto/v3/boa/status/:agentId
   * Check birth status of an agent.
   */
  app.get('/api/satp-auto/v3/boa/status/:agentId', async (req, res) => {
    try {
      const status = await checkV3BirthStatus(req.params.agentId);
      res.json({ ok: true, data: status, network: NETWORK });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/satp-auto/v3/boa/link
   * Combined flow: build burn_to_become TX + create attestation.
   * Returns unsigned TX for client-side signing.
   * 
   * Body: { agentId, walletAddress, soulboundMint, burnTx, artworkUri }
   */
  app.post('/api/satp-auto/v3/boa/link', async (req, res) => {
    try {
      const { agentId, walletAddress, soulboundMint, burnTx, artworkUri } = req.body;

      if (!agentId) return res.status(400).json({ error: 'agentId required' });
      if (!walletAddress) return res.status(400).json({ error: 'walletAddress required' });
      if (!soulboundMint) return res.status(400).json({ error: 'soulboundMint required' });
      if (!burnTx) return res.status(400).json({ error: 'burnTx required' });
      if (!artworkUri) return res.status(400).json({ error: 'artworkUri required (face image URL)' });

      const result = await linkBoaToV3Identity(agentId, walletAddress, soulboundMint, burnTx, artworkUri);

      console.log(`[SATP BOA V3] Link flow for agent=${agentId}: ok=${result.ok}`);
      res.json(result);
    } catch (err) {
      console.error('[SATP BOA V3] link error:', err.message);
      res.status(500).json({ error: 'Failed to link BOA to V3 identity', detail: err.message });
    }
  });

  console.log(`[SATP BOA V3] Routes registered (network: ${NETWORK}): /api/satp-auto/v3/boa/{burn-to-become, confirm, status/:agentId, link}`);
}

// ─────────────────────────────────────────────
//  EXPORTS
// ─────────────────────────────────────────────

module.exports = {
  registerBoaLinkerV3Routes,
  buildBurnToBecomeTx,
  createBoaAttestation,
  linkBoaToV3Identity,
  checkV3BirthStatus,
  parseGenesisRecordPartial,
  getV3GenesisRecordPDA,
  getV2IdentityPDA,
  computeAgentIdHash,
  SATP_V3_IDENTITY_PROGRAM,
  SATP_V2_IDENTITY_PROGRAM,
  SATP_ATTESTATIONS_PROGRAM,
};