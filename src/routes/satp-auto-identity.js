/**
 * SATP Auto-Identity — Triggered after Solana wallet verification
 * 
 * POST /api/satp-auto/identity/create
 *   Body: { walletAddress, profileId, name?, description?, category? }
 *   Returns: { transaction (base64), identityPDA } — unsigned TX for client signing
 *   If identity already exists: { alreadyExists: true, identityPDA }
 *
 * POST /api/satp-auto/identity/confirm
 *   Body: { walletAddress, profileId, txSignature }
 *   Records the SATP identity creation in the DB
 */

const { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram } = require('@solana/web3.js');
const crypto = require('crypto');
const path = require('path');

// SATP v2 Identity Registry — MAINNET
const SATP_IDENTITY_PROGRAM = new PublicKey('97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq');
const NETWORK = process.env.SATP_NETWORK || 'mainnet';
const RPC_URL = NETWORK === 'devnet' 
  ? 'https://api.devnet.solana.com' 
  : (process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb');

const connection = new Connection(RPC_URL, 'confirmed');

/**
 * Anchor instruction discriminator
 */
function anchorDisc(name) {
  return crypto.createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

/**
 * Borsh-encode a string (u32 LE length + utf8 bytes)
 */
function encodeString(s) {
  const buf = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(buf.length);
  return Buffer.concat([len, buf]);
}

/**
 * Borsh-encode a Vec<string> (u32 LE count + each string)
 */
function encodeVecString(arr) {
  const count = Buffer.alloc(4);
  count.writeUInt32LE(arr.length);
  const parts = [count];
  for (const s of arr) {
    parts.push(encodeString(s));
  }
  return Buffer.concat(parts);
}

/**
 * Derive SATP Identity PDA: ["identity", authority_pubkey]
 */
function getIdentityPDA(authority) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('identity'), new PublicKey(authority).toBuffer()],
    SATP_IDENTITY_PROGRAM
  );
}

/**
 * Build an unsigned create_identity TX
 */
async function buildCreateIdentityTx(walletAddress, name, description, category, capabilities, metadataUri) {
  const wallet = new PublicKey(walletAddress);
  const [identityPDA] = getIdentityPDA(wallet);

  // Check if already exists
  const existing = await connection.getAccountInfo(identityPDA);
  if (existing && existing.data.length > 0) {
    return {
      transaction: null,
      identityPDA: identityPDA.toBase58(),
      authority: wallet.toBase58(),
      network: NETWORK,
      alreadyExists: true,
    };
  }

  // Build create_identity instruction
  const disc = anchorDisc('create_identity');
  const data = Buffer.concat([
    disc,
    encodeString(name.slice(0, 32)),
    encodeString(description.slice(0, 256)),
    encodeString(category.slice(0, 32)),
    encodeVecString(capabilities.slice(0, 10).map(c => c.slice(0, 32))),
    encodeString(metadataUri.slice(0, 200)),
  ]);

  const ix = new TransactionInstruction({
    programId: SATP_IDENTITY_PROGRAM,
    keys: [
      { pubkey: identityPDA, isSigner: false, isWritable: true },
      { pubkey: wallet, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction();
  // Add priority fee for faster confirmation
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));
  tx.add(ix);
  tx.feePayer = wallet;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;

  return {
    transaction: tx.serialize({ requireAllSignatures: false }).toString('base64'),
    identityPDA: identityPDA.toBase58(),
    authority: wallet.toBase58(),
    network: NETWORK,
    blockhash,
    lastValidBlockHeight,
    alreadyExists: false,
  };
}

/**
 * Check if a wallet has an SATP identity
 */
async function hasIdentity(walletAddress) {
  try {
    const [pda] = getIdentityPDA(new PublicKey(walletAddress));
    const acct = await connection.getAccountInfo(pda);
    return acct !== null && acct.data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Register routes on the Express app
 */
function registerSATPAutoIdentityRoutes(app) {

  /**
   * POST /api/satp-auto/identity/create
   * Builds an unsigned create_identity TX for the wallet to sign
   * Called after Solana wallet verification succeeds
   */
  app.post('/api/satp-auto/identity/create', async (req, res) => {
    try {
      const { walletAddress, profileId, name, description, category } = req.body;

      if (!walletAddress) {
        return res.status(400).json({ error: 'walletAddress required' });
      }

      // Look up profile if profileId given
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
          console.warn('[SATP AutoID] Profile lookup failed:', e.message);
        }
      }

      const result = await buildCreateIdentityTx(
        walletAddress,
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
            message: 'SATP identity already exists for this wallet',
          },
        });
      }

      console.log(`[SATP AutoID] Built create_identity TX for ${walletAddress} (profile: ${profileId || 'none'})`);

      res.json({
        ok: true,
        data: result,
      });
    } catch (err) {
      console.error('[SATP AutoID] auto-create error:', err.message);
      res.status(500).json({ error: 'Failed to build identity TX', detail: err.message });
    }
  });

  /**
   * POST /api/satp-auto/identity/confirm
   * Called after the user signs and submits the create_identity TX
   * Records the SATP identity in the DB for the profile
   */
  app.post('/api/satp-auto/identity/confirm', async (req, res) => {
    try {
      const { walletAddress, profileId, txSignature } = req.body;
      if (!walletAddress || !profileId) {
        return res.status(400).json({ error: 'walletAddress and profileId required' });
      }

      const [identityPDA] = getIdentityPDA(new PublicKey(walletAddress));

      // Update profile with SATP identity info
      try {
        const Database = require('better-sqlite3');
        const db = new Database(path.join(__dirname, '../../data/agentfolio.db'));

        // Store SATP verification in verifications table
        const { v4: uuid } = require('uuid');
        const verificationId = uuid ? uuid() : `satp_${Date.now()}`;
        db.prepare(`
          INSERT OR REPLACE INTO verifications (id, profile_id, platform, identifier, proof, verified_at)
          VALUES (?, ?, 'satp', ?, ?, datetime('now'))
        `).run(
          verificationId,
          profileId,
          walletAddress,
          JSON.stringify({
            identityPDA: identityPDA.toBase58(),
            txSignature,
            network: NETWORK,
            program: SATP_IDENTITY_PROGRAM.toBase58(),
            verifiedAt: new Date().toISOString(),
          })
        );

        // Also update profile's verification_data JSON if it exists
        const profile = db.prepare('SELECT verification_data FROM profiles WHERE id = ?').get(profileId);
        if (profile) {
          let vd = {};
          try { vd = JSON.parse(profile.verification_data || '{}'); } catch {}
          vd.satp = {
            verified: true,
            identityPDA: identityPDA.toBase58(),
            txSignature,
            program: SATP_IDENTITY_PROGRAM.toBase58(),
            network: NETWORK,
            verifiedAt: new Date().toISOString(),
          };
          db.prepare('UPDATE profiles SET verification_data = ? WHERE id = ?')
            .run(JSON.stringify(vd), profileId);
        }

        db.close();
        console.log(`[SATP AutoID] Identity confirmed for ${profileId}: PDA=${identityPDA.toBase58()}, TX=${txSignature}`);
      } catch (dbErr) {
        console.warn('[SATP AutoID] DB update failed (non-blocking):', dbErr.message);
      }

      res.json({
        ok: true,
        data: {
          identityPDA: identityPDA.toBase58(),
          txSignature,
          network: NETWORK,
          walletAddress,
          profileId,
        },
      });
    } catch (err) {
      console.error('[SATP AutoID] confirm error:', err.message);
      res.status(500).json({ error: 'Failed to confirm identity', detail: err.message });
    }
  });

  /**
   * GET /api/satp-auto/identity/check/:wallet
   * Quick check if a wallet has an SATP identity
   */
  app.get('/api/satp-auto/identity/check/:wallet', async (req, res) => {
    try {
      const exists = await hasIdentity(req.params.wallet);
      const [pda] = getIdentityPDA(new PublicKey(req.params.wallet));
      res.json({ ok: true, exists, identityPDA: pda.toBase58(), network: NETWORK });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  console.log(`[SATP AutoID] Routes registered (network: ${NETWORK}): /api/satp-auto/identity/{create, confirm, check/:wallet}`);
}

module.exports = { registerSATPAutoIdentityRoutes, getIdentityPDA, hasIdentity, buildCreateIdentityTx, SATP_IDENTITY_PROGRAM };
