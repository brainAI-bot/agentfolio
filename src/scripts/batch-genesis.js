#!/usr/bin/env node
/**
 * batch-genesis.js — Find all profiles with 2+ verifications,
 * create Genesis Record PDAs on-chain (if missing), set initial scores.
 *
 * Usage:
 *   node batch-genesis.js              # Dry run (report only)
 *   node batch-genesis.js --execute    # Actually create missing records
 *
 * Requires: SATP_SIGNER_PATH env or default keypair at ~/.config/solana/id.json
 */

const path = require('path');
const Database = require('better-sqlite3');
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { Program, AnchorProvider, Wallet, BN } = require('@coral-xyz/anchor');
const crypto = require('crypto');
const fs = require('fs');

// ─── Config ──────────────────────────────────────────────
const DB_PATH = path.resolve(__dirname, '../../data/agentfolio.db');
const GENESIS_PROGRAM_ID = new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');
const GENESIS_SEED = 'genesis';
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED';
const SIGNER_PATH = process.env.SATP_SIGNER_PATH || path.join(process.env.HOME, '.config/solana/id.json');

const EXECUTE = process.argv.includes('--execute');

// ─── Helpers ─────────────────────────────────────────────
function agentIdHash(agentId) {
  return crypto.createHash('sha256').update(agentId).digest();
}

function getGenesisPDA(agentId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(GENESIS_SEED), agentIdHash(agentId)],
    GENESIS_PROGRAM_ID
  )[0];
}

function loadKeypair(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function parseGenesisRecord(data) {
  if (!data || data.length < 8) return null;
  try {
    let offset = 8; // skip discriminator
    offset += 32; // agent_id_hash

    const readString = () => {
      const len = data.readUInt32LE(offset);
      offset += 4;
      const str = data.slice(offset, offset + len).toString('utf8');
      offset += len;
      return str;
    };

    const agentName = readString();
    const description = readString();
    readString(); // category
    const count = data.readUInt32LE(offset); offset += 4;
    for (let i = 0; i < count; i++) readString(); // capabilities
    readString(); // metadataUri
    readString(); // faceImage
    offset += 32; // faceMint
    readString(); // faceBurnTx
    const genesisRecord = Number(data.readBigInt64LE(offset)); offset += 8;
    offset += 32; // authority
    const hasPending = data[offset]; offset += 1;
    if (hasPending === 1) offset += 32;
    const reputationScore = Number(data.readBigUInt64LE(offset)); offset += 8;
    const verificationLevel = data[offset]; offset += 1;

    return { agentName, reputationScore, verificationLevel, genesisRecord };
  } catch (e) {
    return null;
  }
}

// ─── Main ────────────────────────────────────────────────
async function main() {
  console.log('=== batch-genesis.js ===');
  console.log(`Mode: ${EXECUTE ? '🔴 EXECUTE (will write on-chain)' : '🟢 DRY RUN (report only)'}`);
  console.log();

  // 1. Find profiles with 2+ verifications
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare(`
    SELECT profile_id, COUNT(*) as verif_count 
    FROM verifications 
    GROUP BY profile_id 
    HAVING verif_count >= 2
    ORDER BY verif_count DESC
  `).all();

  console.log(`Found ${rows.length} profiles with 2+ verifications:`);
  rows.forEach(r => console.log(`  ${r.profile_id} — ${r.verif_count} verifications`));
  console.log();

  // 2. Check which have Genesis Records on-chain
  const connection = new Connection(RPC_URL, 'confirmed');
  const pdas = rows.map(r => getGenesisPDA(r.profile_id));
  const accounts = await connection.getMultipleAccountsInfo(pdas);

  const missing = [];
  const existing = [];

  for (let i = 0; i < rows.length; i++) {
    const profileId = rows[i].profile_id;
    const verifCount = rows[i].verif_count;
    const account = accounts[i];

    if (account) {
      const parsed = parseGenesisRecord(account.data);
      existing.push({ profileId, verifCount, ...parsed });
      console.log(`✅ ${profileId} — Genesis Record EXISTS (score: ${parsed?.reputationScore || 0}, level: ${parsed?.verificationLevel || 0})`);
    } else {
      missing.push({ profileId, verifCount });
      console.log(`❌ ${profileId} — NO Genesis Record (${verifCount} verifications)`);
    }
  }

  console.log();
  console.log(`Summary: ${existing.length} exist, ${missing.length} missing`);

  // 3. Check for score mismatches (verif count vs on-chain level)
  const mismatched = existing.filter(e => {
    const expectedMinLevel = Math.min(e.verifCount, 5);
    return e.verificationLevel < expectedMinLevel;
  });

  if (mismatched.length > 0) {
    console.log();
    console.log('⚠️  Score mismatches (on-chain level < verification count):');
    mismatched.forEach(m => {
      console.log(`  ${m.profileId}: on-chain level ${m.verificationLevel}, has ${m.verifCount} verifications`);
    });
  }

  // 4. Create missing Genesis Records
  if (missing.length === 0) {
    console.log('\n🎉 All profiles with 2+ verifications have Genesis Records. Nothing to do.');
    db.close();
    return;
  }

  if (!EXECUTE) {
    console.log('\n⚡ Run with --execute to create missing Genesis Records on-chain.');
    db.close();
    return;
  }

  // Load signer
  if (!fs.existsSync(SIGNER_PATH)) {
    console.error(`❌ Signer keypair not found at ${SIGNER_PATH}`);
    console.error('Set SATP_SIGNER_PATH env or place keypair at ~/.config/solana/id.json');
    db.close();
    process.exit(1);
  }

  const signer = loadKeypair(SIGNER_PATH);
  console.log(`\nSigner: ${signer.publicKey.toBase58()}`);

  // Load the satp-write-client for creating records
  const satpWrite = require('../satp-write-client');

  for (const { profileId, verifCount } of missing) {
    // Get profile info from DB
    const profile = db.prepare('SELECT id, name, description, wallets FROM profiles WHERE id = ?').get(profileId);
    if (!profile) {
      console.log(`⚠️  Skipping ${profileId} — profile not found in DB`);
      continue;
    }

    const initialScore = Math.min(verifCount * 50, 500); // 50 points per verification, max 500
    const verifLevel = Math.min(verifCount, 5);

    console.log(`\n📝 Creating Genesis Record for ${profileId} (${profile.name})...`);
    console.log(`   Initial score: ${initialScore}, Verification level: ${verifLevel}`);

    try {
      // Register identity (creates Genesis Record PDA)
      const result = await satpWrite.registerIdentity({
        name: profile.name || profileId,
        description: profile.description || `AgentFolio agent: ${profile.name}`,
        category: 'agent',
        capabilities: [],
        metadataUri: `https://agentfolio.bot/api/profile/${profileId}`,
      }, signer, 'mainnet');

      console.log(`   ✅ Genesis Record created: TX ${result.txSignature}`);
      console.log(`   PDA: ${result.identityPDA || getGenesisPDA(profileId).toBase58()}`);
    } catch (err) {
      if (err.message?.includes('already in use') || err.message?.includes('already exists')) {
        console.log(`   ⚠️  PDA already exists (race condition?) — skipping`);
      } else {
        console.error(`   ❌ Failed: ${err.message}`);
      }
    }
  }

  db.close();
  console.log('\n✅ batch-genesis.js complete');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
