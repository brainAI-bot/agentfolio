/**
 * SATP Auto-Identity V3 — Genesis Record creation after wallet verification
 * 
 * Replaces satp-auto-identity.js (V2). Uses the V3 identity_v3 program
 * with agent_id_hash-based PDAs instead of V2's wallet-based PDAs.
 * 
 * Key differences from V2:
 *   - PDA seed: ["genesis", SHA256(agent_id)] instead of ["identity", wallet_pubkey]
 *   - First instruction arg: agent_id_hash (32 bytes)
 *   - One identity per agent_id (soulbound to creating wallet)
 *   - Agent ID = profileId from AgentFolio
 *   - reputation_score starts at 0 (CPI-updated by reputation_v3 program)
 *
 * Routes:
 *   POST /api/satp-auto/v3/identity/create  — Build unsigned create_identity TX
 *   POST /api/satp-auto/v3/identity/confirm — Record identity creation in DB
 *   GET  /api/satp-auto/v3/identity/check/:agentId — Check if agent has V3 identity
 *   GET  /api/satp-auto/v3/identity/check-wallet/:wallet — Check V2 identity (legacy compat)
 *
 * Backward compatibility:
 *   - V2 routes (/api/satp-auto/identity/*) still work via the original module
 *   - New registrations should use V3 routes
 *   - Existing V2 identities can be migrated via migrate_v2_to_v3 instruction
 */

const { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram } = require('@solana/web3.js');
const crypto = require('crypto');
const { clearV3Cache } = require('../v3-score-service');
const path = require('path');

// ─────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────

// SATP V3 Identity Program — MAINNET
const SATP_V3_IDENTITY_PROGRAM = new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');

// SATP V2 Identity Program (for legacy check/migration)
const SATP_V2_IDENTITY_PROGRAM = new PublicKey('97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq');

const NETWORK = process.env.SATP_NETWORK || 'mainnet';
const RPC_URL = NETWORK === 'devnet'
  ? 'https://api.devnet.solana.com'
  : (process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');

const connection = new Connection(RPC_URL, 'confirmed');

// ─────────────────────────────────────────────
//  ENCODING HELPERS (Borsh-compatible)
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

/** Borsh-encode a Vec<String>: u32 LE count + each string */
function encodeVecString(arr) {
  const count = Buffer.alloc(4);
  count.writeUInt32LE(arr.length);
  const parts = [count];
  for (const s of arr) {
    parts.push(encodeString(s));
  }
  return Buffer.concat(parts);
}

// ─────────────────────────────────────────────
//  PDA DERIVATION
// ─────────────────────────────────────────────

/**
 * Compute agent_id_hash: SHA-256 of agent_id string.
 * Must match on-chain: hash(agent_id.as_bytes()).to_bytes()
 * @param {string} agentId — The agent's unique ID (profileId from AgentFolio)
 * @returns {Buffer} 32-byte hash
 */
function computeAgentIdHash(agentId) {
  return sha256(Buffer.from(agentId, 'utf8'));
}

/**
 * Derive V3 Genesis Record PDA: ["genesis", agent_id_hash]
 * @param {string} agentId — The agent's unique ID
 * @returns {[PublicKey, number]} [pda, bump]
 */
function getV3GenesisRecordPDA(agentId) {
  const agentIdHash = computeAgentIdHash(agentId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('genesis'), agentIdHash],
    SATP_V3_IDENTITY_PROGRAM
  );
}

/**
 * Derive V2 Identity PDA: ["identity", authority_pubkey] (for legacy checks)
 * @param {PublicKey|string} authority
 * @returns {[PublicKey, number]}
 */
function getV2IdentityPDA(authority) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('identity'), new PublicKey(authority).toBuffer()],
    SATP_V2_IDENTITY_PROGRAM
  );
}

// ─────────────────────────────────────────────
//  TX BUILDER
// ─────────────────────────────────────────────

/**
 * Build an unsigned V3 create_identity TX.
 * The wallet (creator) must sign client-side.
 *
 * @param {string} walletAddress — Creator wallet (becomes authority)
 * @param {string} agentId — Unique agent identifier (profileId)
 * @param {string} name — Agent display name (max 32 chars)
 * @param {string} description — Agent description (max 256 chars)
 * @param {string} category — Agent category (max 32 chars)
 * @param {string[]} capabilities — Agent capabilities (max 10, each max 32 chars)
 * @param {string} metadataUri — Metadata URI (max 200 chars)
 * @returns {object} { transaction, genesisPDA, agentIdHash, alreadyExists, ... }
 */
async function buildCreateIdentityV3Tx(walletAddress, agentId, name, description, category, capabilities, metadataUri) {
  const wallet = new PublicKey(walletAddress);
  const agentIdHash = computeAgentIdHash(agentId);
  const [genesisPDA] = getV3GenesisRecordPDA(agentId);

  // Check if V3 identity already exists
  const existing = await connection.getAccountInfo(genesisPDA);
  if (existing && existing.data.length > 0) {
    return {
      transaction: null,
      genesisPDA: genesisPDA.toBase58(),
      agentIdHash: agentIdHash.toString('hex'),
      authority: wallet.toBase58(),
      network: NETWORK,
      programVersion: 'v3',
      alreadyExists: true,
    };
  }

  // Build create_identity instruction
  // V3 signature: create_identity(agent_id_hash: [u8; 32], name, description, category, capabilities, metadata_uri)
  const disc = anchorDisc('create_identity');
  const data = Buffer.concat([
    disc,
    agentIdHash,                                                    // [u8; 32] — raw bytes, no length prefix
    encodeString(name.slice(0, 32)),                                // String
    encodeString(description.slice(0, 256)),                        // String
    encodeString(category.slice(0, 32)),                            // String
    encodeVecString(capabilities.slice(0, 10).map(c => c.slice(0, 32))),  // Vec<String>
    encodeString(metadataUri.slice(0, 200)),                        // String
  ]);

  // V3 account list: genesis (PDA, mut), creator (signer, mut), system_program
  const ix = new TransactionInstruction({
    programId: SATP_V3_IDENTITY_PROGRAM,
    keys: [
      { pubkey: genesisPDA, isSigner: false, isWritable: true },
      { pubkey: wallet, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction();
  // Priority fee for faster confirmation
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
    network: NETWORK,
    programVersion: 'v3',
    program: SATP_V3_IDENTITY_PROGRAM.toBase58(),
    blockhash,
    lastValidBlockHeight,
    alreadyExists: false,
  };
}

/**
 * Check if an agent has a V3 genesis record on-chain
 * @param {string} agentId
 * @returns {Promise<boolean>}
 */
async function hasV3Identity(agentId) {
  try {
    const [pda] = getV3GenesisRecordPDA(agentId);
    const acct = await connection.getAccountInfo(pda);
    return acct !== null && acct.data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Check if a wallet has a V2 identity (legacy backward compat)
 * @param {string} walletAddress
 * @returns {Promise<boolean>}
 */
async function hasV2Identity(walletAddress) {
  try {
    const [pda] = getV2IdentityPDA(new PublicKey(walletAddress));
    const acct = await connection.getAccountInfo(pda);
    return acct !== null && acct.data.length > 0;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
//  EXPRESS ROUTES
// ─────────────────────────────────────────────

/**
 * Register V3 auto-identity routes on Express app.
 * V2 routes remain at /api/satp-auto/identity/* (registered by the V2 module).
 * V3 routes live at /api/satp-auto/v3/identity/*.
 */
function registerSATPAutoIdentityV3Routes(app) {

  /**
   * POST /api/satp-auto/v3/identity/create
   * Build an unsigned V3 create_identity TX for the wallet to sign.
   * 
   * Body: { walletAddress, profileId, name?, description?, category? }
   * 
   * profileId is used as the agent_id for PDA derivation.
   * If the agent already has a V3 identity, returns { alreadyExists: true }.
   * If the agent has a V2 identity but no V3, suggests migration.
   */
  app.post('/api/satp-auto/v3/identity/create', async (req, res) => {
    try {
      const { walletAddress, profileId, name, description, category } = req.body;

      if (!walletAddress) {
        return res.status(400).json({ error: 'walletAddress required' });
      }
      if (!profileId) {
        return res.status(400).json({ error: 'profileId required (used as agent_id for V3 PDA)' });
      }

      // Look up profile for defaults
      let agentName = name || 'Agent';
      let agentDescription = description || 'AgentFolio verified agent';
      let agentCategory = category || 'ai-agent';
      let capabilities = [];
      let metadataUri = '';

      if (profileId) {
        try {
          const Database = require('better-sqlite3');
          const db = new Database(path.join(__dirname, '../../data/agentfolio.db'), { readonly: true });
          const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
          if (profile) {
            agentName = (profile.name || agentName).slice(0, 32);
            agentDescription = (profile.bio || agentDescription).slice(0, 256);
            try { capabilities = JSON.parse(profile.capabilities || '[]').slice(0, 10); } catch {}
            metadataUri = `https://agentfolio.bot/api/profile/${profileId}`;
          }
          db.close();
        } catch (e) {
          console.warn('[SATP AutoID V3] Profile lookup failed:', e.message);
        }
      }

      // Check for existing V2 identity (for migration hint)
      let hasV2 = false;
      try {
        hasV2 = await hasV2Identity(walletAddress);
      } catch {}

      const result = await buildCreateIdentityV3Tx(
        walletAddress,
        profileId,
        agentName,
        agentDescription,
        agentCategory,
        capabilities,
        metadataUri
      );

      if (result.alreadyExists) {
        return res.json({
          ok: true,
          data: {
            ...result,
            hasV2Identity: hasV2,
            message: 'V3 genesis record already exists for this agent',
          },
        });
      }

      console.log(`[SATP AutoID V3] Built create_identity TX for agent=${profileId} wallet=${walletAddress}${hasV2 ? ' (has V2 identity)' : ''}`);

      res.json({
        ok: true,
        data: {
          ...result,
          hasV2Identity: hasV2,
          migrationNote: hasV2
            ? 'This agent has a V2 identity. Consider using migrate_v2_to_v3 instead to preserve lineage.'
            : null,
        },
      });
    } catch (err) {
      console.error('[SATP AutoID V3] create error:', err.message);
      res.status(500).json({ error: 'Failed to build V3 identity TX', detail: err.message });
    }
  });

  /**
   * POST /api/satp-auto/v3/identity/confirm
   * Called after the user signs and submits the V3 create_identity TX.
   * Records the SATP V3 genesis record in the DB.
   */
  app.post('/api/satp-auto/v3/identity/confirm', async (req, res) => {
    try {
      const { walletAddress, profileId, txSignature } = req.body;
      if (!walletAddress || !profileId) {
        return res.status(400).json({ error: 'walletAddress and profileId required' });
      }

      const [genesisPDA] = getV3GenesisRecordPDA(profileId);
      const agentIdHash = computeAgentIdHash(profileId).toString('hex');

      // Update profile with V3 SATP identity info
      try {
        const Database = require('better-sqlite3');
        const db = new Database(path.join(__dirname, '../../data/agentfolio.db'));

        // Store V3 SATP verification
        const { v4: uuid } = require('uuid');
        const verificationId = uuid ? uuid() : `satp_v3_${Date.now()}`;
        db.prepare(`
          INSERT OR REPLACE INTO verifications (id, profile_id, platform, identifier, proof, verified_at)
          VALUES (?, ?, 'satp_v3', ?, ?, datetime('now'))
        `).run(
          verificationId,
          profileId,
          walletAddress,
          JSON.stringify({
            genesisPDA: genesisPDA.toBase58(),
            agentIdHash,
            txSignature,
            network: NETWORK,
            program: SATP_V3_IDENTITY_PROGRAM.toBase58(),
            programVersion: 'v3',
            verifiedAt: new Date().toISOString(),
          })
        );

        // Update profile's verification_data JSON
        const profile = db.prepare('SELECT verification_data FROM profiles WHERE id = ?').get(profileId);
        if (profile) {
          let vd = {};
          try { vd = JSON.parse(profile.verification_data || '{}'); } catch {}
          vd.satp_v3 = {
            verified: true,
            genesisPDA: genesisPDA.toBase58(),
            agentIdHash,
            txSignature,
            program: SATP_V3_IDENTITY_PROGRAM.toBase58(),
            network: NETWORK,
            verifiedAt: new Date().toISOString(),
          };
          // Keep V2 data if present
          db.prepare('UPDATE profiles SET verification_data = ? WHERE id = ?')
            .run(JSON.stringify(vd), profileId);
        }

        db.close();
        console.log(`[SATP AutoID V3] Identity confirmed for ${profileId}: PDA=${genesisPDA.toBase58()}, TX=${txSignature}`);
      } catch (dbErr) {
        console.warn('[SATP AutoID V3] DB update failed (non-blocking):', dbErr.message);
      }

      try { if (typeof clearV3Cache === 'function') clearV3Cache(); } catch (_) {}

      res.json({
        ok: true,
        data: {
          genesisPDA: genesisPDA.toBase58(),
          agentIdHash,
          txSignature,
          network: NETWORK,
          programVersion: 'v3',
          walletAddress,
          profileId,
        },
      });
    } catch (err) {
      console.error('[SATP AutoID V3] confirm error:', err.message);
      res.status(500).json({ error: 'Failed to confirm V3 identity', detail: err.message });
    }
  });

  /**
   * GET /api/satp-auto/v3/identity/check/:agentId
   * Check if an agent has a V3 genesis record on-chain.
   * Also reports V2 identity status for migration planning.
   */
  app.get('/api/satp-auto/v3/identity/check/:agentId', async (req, res) => {
    try {
      const agentId = req.params.agentId;
      const [v3Pda] = getV3GenesisRecordPDA(agentId);
      const v3Exists = await hasV3Identity(agentId);

      const result = {
        ok: true,
        agentId,
        v3: {
          exists: v3Exists,
          genesisPDA: v3Pda.toBase58(),
          agentIdHash: computeAgentIdHash(agentId).toString('hex'),
          program: SATP_V3_IDENTITY_PROGRAM.toBase58(),
        },
        network: NETWORK,
      };

      // Optionally check V2 if wallet provided in query
      const wallet = req.query.wallet;
      if (wallet) {
        try {
          const [v2Pda] = getV2IdentityPDA(new PublicKey(wallet));
          const v2Exists = await hasV2Identity(wallet);
          result.v2 = {
            exists: v2Exists,
            identityPDA: v2Pda.toBase58(),
            program: SATP_V2_IDENTITY_PROGRAM.toBase58(),
          };
          result.needsMigration = v2Exists && !v3Exists;
        } catch (e) {
          result.v2 = { error: e.message };
        }
      }

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/satp-auto/v3/identity/check-wallet/:wallet
   * Legacy compat: check V2 identity by wallet address.
   * Returns V2 status + V3 migration recommendation.
   */
  app.get('/api/satp-auto/v3/identity/check-wallet/:wallet', async (req, res) => {
    try {
      const walletPubkey = new PublicKey(req.params.wallet);
      const [v2Pda] = getV2IdentityPDA(walletPubkey);
      const v2Exists = await hasV2Identity(req.params.wallet);

      res.json({
        ok: true,
        wallet: req.params.wallet,
        v2: {
          exists: v2Exists,
          identityPDA: v2Pda.toBase58(),
          program: SATP_V2_IDENTITY_PROGRAM.toBase58(),
        },
        network: NETWORK,
        recommendation: v2Exists
          ? 'Agent has V2 identity. Use /api/satp-auto/v3/identity/create with profileId to create V3 genesis record, or use migrate_v2_to_v3 instruction.'
          : 'No V2 identity. Use /api/satp-auto/v3/identity/create to create V3 genesis record directly.',
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  console.log(`[SATP AutoID V3] Routes registered (network: ${NETWORK}): /api/satp-auto/v3/identity/{create, confirm, check/:agentId, check-wallet/:wallet}`);
}

// ─────────────────────────────────────────────
//  EXPORTS
// ─────────────────────────────────────────────

module.exports = {
  registerSATPAutoIdentityV3Routes,
  getV3GenesisRecordPDA,
  getV2IdentityPDA,
  computeAgentIdHash,
  hasV3Identity,
  hasV2Identity,
  buildCreateIdentityV3Tx,
  SATP_V3_IDENTITY_PROGRAM,
  SATP_V2_IDENTITY_PROGRAM,
};
