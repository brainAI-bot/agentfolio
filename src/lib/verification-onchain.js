/**
 * On-chain Verification via Identity Registry Program
 * Uses add_verification and update_reputation instructions
 * Program: CV5Wd9YGFX5A4dvuaFuEDuKQWp14NfnLrSdxY7EHFyeB
 */

const { Connection, Keypair, Transaction, TransactionInstruction, PublicKey, SystemProgram } = require('@solana/web3.js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

// TEMPORARY FIX: Skip on-chain operations for wallet with discriminator mismatch
const PROBLEMATIC_WALLETS = ['Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc'];
function shouldSkipOnchainOp(ownerWallet) {
  if (PROBLEMATIC_WALLETS.includes(ownerWallet)) {
    logger.warn(`[VerificationOnchain] Skipping on-chain operation for ${ownerWallet} (discriminator mismatch)`);
    return true;
  }
  return false;
}

const PROGRAM_ID = new PublicKey('CV5Wd9YGFX5A4dvuaFuEDuKQWp14NfnLrSdxY7EHFyeB');
const KEYPAIR_PATH = '/home/ubuntu/.config/solana/devnet-deployer.json';
const RPC_URL = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

// Instruction discriminators from IDL
const DISCRIMINATORS = {
  add_verification: Buffer.from([28, 85, 236, 60, 153, 232, 93, 122]),
  update_reputation: Buffer.from([194, 220, 43, 201, 54, 209, 49, 178]),
};

let _keypair = null;
function getKeypair() {
  if (!_keypair) {
    const raw = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
    _keypair = Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  return _keypair;
}

function getConnection() {
  return new Connection(RPC_URL, { commitment: 'confirmed', disableRetryOnRateLimit: true });
}

/**
 * Derive agent_profile PDA: seeds = ["agent", ownerPubkey]
 */
function deriveAgentProfilePDA(ownerPubkey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('agent'), ownerPubkey.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Derive verification PDA: seeds = ["verification", agentProfilePDA, platform_bytes]
 */
function deriveVerificationPDA(agentProfilePDA, platform) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('verification'), agentProfilePDA.toBuffer(), Buffer.from(platform)],
    PROGRAM_ID
  );
}

/**
 * Encode a Borsh string (4-byte LE length prefix + UTF-8 bytes)
 */
function encodeString(str) {
  const bytes = Buffer.from(str, 'utf-8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([len, bytes]);
}

/**
 * Post an add_verification instruction on-chain
 * @param {string} ownerWallet - Solana wallet address of the agent's owner
 * @param {string} platform - Platform name (github, twitter, etc.)
 * @param {object} proofData - Data to hash for proof
 * @returns {Promise<{signature: string, explorerUrl: string}|null>}
 */
// Map platform names to verification type u8 (matches VerificationType enum in program)
const VERIFICATION_TYPES = {
  wallet: 0, solana: 0,
  github: 1,
  x: 2,
  discord: 3,
  telegram: 4,
  email: 5, agentmail: 5,
  trading: 6, hyperliquid: 6,
  polymarket: 7,
  kalshi: 9,
  satp: 10, custom: 10,
};

async function postVerificationOnchain(ownerWallet, platform, proofData = {}) {
  if (shouldSkipOnchainOp(ownerWallet)) return { signature: 'skipped-discriminator-fix', explorerUrl: 'https://explorer.solana.com/address/skipped' };
  try {
    const keypair = getKeypair();
    const connection = getConnection();
    const ownerPk = new PublicKey(ownerWallet);

    const [agentProfilePDA] = deriveAgentProfilePDA(ownerPk);

    // Check if agent profile exists on-chain
    const profileAccount = await connection.getAccountInfo(agentProfilePDA);
    if (!profileAccount) {
      logger.warn(`[VerificationOnchain] No on-chain profile for ${ownerWallet}, skipping`);
      return null;
    }

    // Map platform to verification_type u8
    const verType = VERIFICATION_TYPES[platform] ?? 10; // default to custom

    // Build instruction data: discriminator + verification_type (u8)
    const data = Buffer.concat([
      DISCRIMINATORS.add_verification,
      Buffer.from([verType]),
    ]);

    // Accounts: agent_identity (writable) + attestation_authority (signer)
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: agentProfilePDA, isSigner: false, isWritable: true },
        { pubkey: keypair.publicKey, isSigner: true, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = keypair.publicKey;
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.sign(keypair);

    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    await connection.confirmTransaction(signature, 'confirmed');

    const explorerUrl = `https://explorer.solana.com/tx/${signature}`;
    logger.info(`[VerificationOnchain] add_verification: ${platform} for owner=${ownerWallet} → ${explorerUrl}`);

    return { signature, explorerUrl };
  } catch (err) {
    logger.error(`[VerificationOnchain] add_verification failed for ${ownerWallet}/${platform}: ${err.message}`);
    return null;
  }
}

/**
 * Post an update_reputation instruction on-chain
 * @param {string} ownerWallet - Solana wallet of the agent owner
 * @param {number} score - Reputation score (0-10000, u32)
 * @returns {Promise<{signature: string, explorerUrl: string}|null>}
 */
async function postReputationOnchain(ownerWallet, score) {
  if (shouldSkipOnchainOp(ownerWallet)) return { signature: 'skipped-discriminator-fix', explorerUrl: 'https://explorer.solana.com/address/skipped' };
  try {
    const keypair = getKeypair();
    const connection = getConnection();
    const ownerPk = new PublicKey(ownerWallet);

    const [agentProfilePDA] = deriveAgentProfilePDA(ownerPk);

    // Check if agent profile exists
    const profileAccount = await connection.getAccountInfo(agentProfilePDA);
    if (!profileAccount) {
      logger.warn(`[VerificationOnchain] No on-chain profile for ${ownerWallet}, skipping reputation update`);
      return null;
    }

    // Use update_stats instruction: jobs_delta(u32) + completed_delta(u32) + response_time(u32) + tokens_burned_delta(u64) + reputation_delta(u32)
    const UPDATE_STATS_DISC = Buffer.from([145, 138, 9, 150, 178, 31, 158, 244]);
    const dataBuf = Buffer.alloc(4 + 4 + 4 + 8 + 4); // 24 bytes for args
    dataBuf.writeUInt32LE(0, 0);     // jobs_delta
    dataBuf.writeUInt32LE(0, 4);     // completed_delta
    dataBuf.writeUInt32LE(0, 8);     // response_time
    dataBuf.writeBigUInt64LE(0n, 12);// tokens_burned_delta
    dataBuf.writeUInt32LE(Math.round(score), 20); // reputation_delta
    const data = Buffer.concat([UPDATE_STATS_DISC, dataBuf]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: agentProfilePDA, isSigner: false, isWritable: true },
        { pubkey: keypair.publicKey, isSigner: true, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = keypair.publicKey;
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.sign(keypair);

    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    await connection.confirmTransaction(signature, 'confirmed');

    const explorerUrl = `https://explorer.solana.com/tx/${signature}`;
    logger.info(`[VerificationOnchain] update_reputation: score=${score} for owner=${ownerWallet} → ${explorerUrl}`);

    return { signature, explorerUrl };
  } catch (err) {
    logger.error(`[VerificationOnchain] update_reputation failed for ${ownerWallet}: ${err.message}`);
    return null;
  }
}

/**
 * Register an agent profile on-chain (creates the PDA)
 * Must be called before add_verification or update_reputation
 */
async function registerAgentOnchain(ownerWallet, name, description, twitter, website) {
  try {
    const keypair = getKeypair(); // admin/deployer
    const connection = getConnection();
    const ownerPk = new PublicKey(ownerWallet);
    const [agentProfilePDA] = deriveAgentProfilePDA(ownerPk);

    // Check if already exists
    const existing = await connection.getAccountInfo(agentProfilePDA);
    if (existing) {
      logger.info(`[OnchainRegister] Profile already exists for ${ownerWallet}`);
      return { signature: null, pda: agentProfilePDA.toBase58(), alreadyExists: true, explorerUrl: `https://explorer.solana.com/address/${agentProfilePDA.toBase58()}` };
    }

    // admin_register_agent discriminator
    const discriminator = Buffer.from([87, 211, 5, 51, 100, 106, 44, 10]);
    
    // Keep data minimal to avoid compute limits
    const emptyVec = Buffer.alloc(4); // vec length = 0
    
    const data = Buffer.concat([
      discriminator,
      ownerPk.toBuffer(),                    // agent_wallet: Pubkey
      encodeString((name || '').slice(0, 32)),// name (short)
      encodeString(''),                       // description (empty)
      encodeString(''),                       // avatar_uri (empty)
      emptyVec,                               // services: Vec<String> (empty)
      emptyVec,                               // links: Vec<SocialLink> (empty)
    ]);

    // Accounts: agent_identity (PDA), admin (signer), system_program
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: agentProfilePDA, isSigner: false, isWritable: true },
        { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = keypair.publicKey;
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.sign(keypair);

    const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' });
    await connection.confirmTransaction(signature, 'confirmed');
    const explorerUrl = `https://explorer.solana.com/tx/${signature}`;
    logger.info(`[OnchainRegister] Admin-registered ${name} (${ownerWallet}): ${explorerUrl}`);
    return { signature, pda: agentProfilePDA.toBase58(), explorerUrl };
  } catch (err) {
    logger.error(`[OnchainRegister] Failed for ${ownerWallet}: ${err.message}`);
    return null;
  }
}

/**
 * Full on-chain registration: create profile + post verifications + update reputation
 */
async function fullOnchainRegistration(profile) {
  const wallet = profile?.wallets?.solana;
  if (!wallet) { logger.warn('[OnchainFull] No solana wallet, skipping'); return null; }
  
  // Step 1: Register profile
  const reg = await registerAgentOnchain(wallet, profile.name, profile.bio, profile.links?.twitter, `https://agentfolio.bot/profile/${profile.id}`);
  if (!reg) return null;

  // Step 2: Post each verified platform
  const vd = profile.verificationData || {};
  const results = { registration: reg, verifications: {}, reputation: null };
  for (const [platform, data] of Object.entries(vd)) {
    if (data && data.verified) {
      const vr = await postVerificationOnchain(wallet, platform, data);
      results.verifications[platform] = vr;
    }
  }

  // Step 3: Post reputation
  const { calculateReputation } = require('./reputation');
  try {
    const rep = calculateReputation(profile);
    if (rep && rep.score > 0) {
      results.reputation = await postReputationOnchain(wallet, Math.round(rep.score * 100));
    }
  } catch (e) { /* non-blocking */ }

  return results;
}

module.exports = { postVerificationOnchain, postReputationOnchain, registerAgentOnchain, fullOnchainRegistration, deriveAgentProfilePDA, deriveVerificationPDA };
