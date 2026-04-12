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

const { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram, Keypair } = require('@solana/web3.js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// SATP v2 Identity Registry — MAINNET (kept for backward compat)
const SATP_IDENTITY_PROGRAM = new PublicKey('97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq');

// V3 SDK for Genesis Record creation
let SATPV3SDK, hashAgentId, getGenesisPDA;
try {
  const idx = require('../../satp-client/src/index');
  SATPV3SDK = idx.SATPV3SDK;
  hashAgentId = idx.hashAgentId;
  getGenesisPDA = idx.getGenesisPDA;
  console.log('[SATP AutoID] V3 SDK loaded — Genesis Record creation available');
} catch (e) {
  console.warn('[SATP AutoID] V3 SDK not available:', e.message);
}
const NETWORK = process.env.SATP_NETWORK || 'mainnet';
const PLATFORM_KEYPAIR_PATH = process.env.SATP_PLATFORM_KEYPAIR || '/home/ubuntu/agentfolio/config/platform-keypair.json';
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
 * Build an unsigned create_identity TX.
 * V3 path: creates a Genesis Record using agent_id-based PDA derivation.
 * V2 fallback: creates V2 identity using wallet-based PDA.
 */
async function buildCreateIdentityTx(walletAddress, name, description, category, capabilities, metadataUri, agentId) {
  const wallet = new PublicKey(walletAddress);
  
  // V3 path: use SATPV3SDK if available and agentId is provided
  if (SATPV3SDK && agentId) {
    try {
      const sdk = new SATPV3SDK({ network: NETWORK, rpcUrl: RPC_URL });
      const { transaction, genesisPDA } = await sdk.buildCreateIdentity(
        wallet, agentId,
        { name: name.slice(0, 32), description: description.slice(0, 256), category: category.slice(0, 32), capabilities: capabilities.slice(0, 10).map(c => c.slice(0, 32)), metadataUri: metadataUri.slice(0, 200) }
      );
      
      // Check if V3 record already exists
      const existingV3 = await connection.getAccountInfo(genesisPDA);
      if (existingV3 && existingV3.data.length > 0) {
        return {
          transaction: null,
          identityPDA: genesisPDA.toBase58(),
          authority: wallet.toBase58(),
          network: NETWORK,
          alreadyExists: true,
          version: 3,
        };
      }
      
      // Add priority fee
      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));
      // Copy instructions from SDK-built transaction
      for (const ix of transaction.instructions) {
        tx.add(ix);
      }
      const platformKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(PLATFORM_KEYPAIR_PATH, 'utf8'))));
      tx.feePayer = platformKeypair.publicKey;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      tx.partialSign(platformKeypair);
      
      return {
        transaction: tx.serialize({ requireAllSignatures: false }).toString('base64'),
        identityPDA: genesisPDA.toBase58(),
        authority: wallet.toBase58(),
        network: NETWORK,
        blockhash,
        lastValidBlockHeight,
        alreadyExists: false,
        version: 3,
        agentId,
      };
    } catch (v3err) {
      console.warn('[SATP AutoID] V3 create failed, falling back to V2:', v3err.message);
    }
  }
  
  // V2 fallback path
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
 * Check if a wallet has an SATP identity (V2 or V3)
 */
async function hasIdentity(walletAddress) {
  try {
    // Check V2
    const [pda] = getIdentityPDA(new PublicKey(walletAddress));
    const acct = await connection.getAccountInfo(pda);
    if (acct && acct.data.length > 0) return true;
    
    // Check V3 by wallet (try as agent_id)
    if (hashAgentId && getGenesisPDA) {
      try {
        const [v3pda] = getGenesisPDA(walletAddress, NETWORK);
        const v3acct = await connection.getAccountInfo(v3pda);
        if (v3acct && v3acct.data.length > 0) return true;
      } catch { /* not a valid V3 lookup */ }
    }
    
    return false;
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

      // Derive agentId from profileId for V3 Genesis Record
      const derivedAgentId = profileId ? `agent_${profileId.replace(/[^a-zA-Z0-9_-]/g, '')}` : null;
      
      const result = await buildCreateIdentityTx(
        walletAddress,
        agentName,
        agentDescription,
        agentCategory,
        capabilities,
        metadataUri,
        req.body.agentId || derivedAgentId
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
      const existsOnChain = await hasIdentity(walletAddress);
      if (!existsOnChain) {
        return res.status(400).json({ error: 'SATP identity not found on-chain for wallet. Complete the real create_identity transaction first.' });
      }

      // Update profile with SATP identity info
      try {
        const Database = require('better-sqlite3');
        const db = new Database(path.join(__dirname, '../../data/agentfolio.db'));
        const profile = db.prepare('SELECT verification_data FROM profiles WHERE id = ?').get(profileId);
        if (!profile) {
          db.close();
          return res.status(404).json({ error: 'Profile not found' });
        }

        let vd = {};
        try { vd = JSON.parse(profile.verification_data || '{}'); } catch {}
        const verifiedSolana = vd?.solana?.address || vd?.solana?.identifier || null;
        if (!verifiedSolana) {
          db.close();
          return res.status(400).json({ error: 'Profile has no verified Solana wallet to bind SATP identity to' });
        }
        if (verifiedSolana !== walletAddress) {
          db.close();
          return res.status(403).json({ error: 'walletAddress must match the profile\'s verified Solana wallet' });
        }

        const existingSatp = vd?.satp || {};
        const satpRecord = {
          ...existingSatp,
          verified: true,
          linked: true,
          address: verifiedSolana,
          identifier: verifiedSolana,
          identityPDA: identityPDA.toBase58(),
          program: SATP_IDENTITY_PROGRAM.toBase58(),
          network: NETWORK,
          verifiedAt: existingSatp.verifiedAt || new Date().toISOString(),
          source: existingSatp.source || 'satp-auto-identity-confirm',
        };
        if (txSignature && !existingSatp.txSignature) satpRecord.txSignature = txSignature;

        // Store SATP verification in verifications table
        const { v4: uuid } = require('uuid');
        const verificationId = uuid ? uuid() : `satp_${Date.now()}`;
        db.prepare(`
          INSERT OR REPLACE INTO verifications (id, profile_id, platform, identifier, proof, verified_at)
          VALUES (?, ?, 'satp', ?, ?, datetime('now'))
        `).run(
          verificationId,
          profileId,
          verifiedSolana,
          JSON.stringify(satpRecord)
        );

        vd.satp = satpRecord;
        db.prepare('UPDATE profiles SET verification_data = ? WHERE id = ?')
          .run(JSON.stringify(vd), profileId);
        db.close();

        try {
          const profileJsonPath = path.join(__dirname, '../../data/profiles', `${profileId}.json`);
          if (fs.existsSync(profileJsonPath)) {
            const profileJson = JSON.parse(fs.readFileSync(profileJsonPath, 'utf8'));
            if (!profileJson.verificationData) profileJson.verificationData = {};
            profileJson.verificationData.satp = satpRecord;
            fs.writeFileSync(profileJsonPath, JSON.stringify(profileJson, null, 2));
          }
        } catch (syncErr) {
          console.warn('[SATP AutoID] JSON sync failed (non-blocking):', syncErr.message);
        }

        console.log(`[SATP AutoID] Identity confirmed for ${profileId}: PDA=${identityPDA.toBase58()}, wallet=${walletAddress}`);
      } catch (dbErr) {
        console.warn('[SATP AutoID] DB update failed:', dbErr.message);
        return res.status(500).json({ error: 'Failed to persist SATP identity', detail: dbErr.message });
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
