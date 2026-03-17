#!/usr/bin/env node
/**
 * Populate on-chain attestations for profiles with verified platforms.
 * Maps off-chain verifications to SATP attestations.
 * 
 * Usage: node scripts/populate-attestations.js [--apply]
 */

const path = require('path');
const Database = require('better-sqlite3');
const satpWrite = require('../src/satp-write-client');

const DB_PATH = path.join(__dirname, '..', 'data', 'agentfolio.db');
const KEYPAIR_PATH = process.env.SATP_PLATFORM_KEYPAIR || 
  path.join(require('os').homedir(), '.config/solana/satp-mainnet-platform.json');
const NETWORK = process.env.SATP_NETWORK || 'mainnet';
const DRY_RUN = !process.argv.includes('--apply');

// Map platform verifications to attestation types
const PLATFORM_TO_ATTESTATION = {
  'twitter': 'twitter_verified',
  'github': 'github_verified',
  'solana': 'solana_wallet_verified',
  'ethereum': 'ethereum_wallet_verified',
  'hyperliquid': 'hyperliquid_verified',
  'discord': 'discord_verified',
  'agentmail': 'agentmail_verified',
  'polymarket': 'polymarket_verified',
  'moltbook': 'moltbook_verified',
};

async function main() {
  console.log(`\n📊 SATP Attestation Population ${DRY_RUN ? '(DRY RUN)' : ''}`);
  console.log(`   Keypair: ${KEYPAIR_PATH}`);
  console.log(`   Network: ${NETWORK}`);
  console.log('─'.repeat(70));

  const db = new Database(DB_PATH, { readonly: true });
  
  // Find profiles with wallets and verifications
  const profiles = db.prepare('SELECT id, name, wallets, verification_data FROM profiles').all();
  
  let totalAttestations = 0;
  let errors = 0;
  let signer;

  if (!DRY_RUN) {
    try {
      signer = satpWrite.loadKeypair(KEYPAIR_PATH);
      console.log(`   Signer: ${signer.publicKey.toBase58()}\n`);
    } catch (e) {
      console.error(`❌ Cannot load keypair: ${e.message}`);
      process.exit(1);
    }
  } else {
    console.log('   (Dry run — no transactions will be sent)\n');
  }

  for (const profile of profiles) {
    let wallets, verData;
    try {
      wallets = JSON.parse(profile.wallets || '{}');
      verData = JSON.parse(profile.verification_data || '{}');
    } catch (e) { continue; }

    // Need a solana wallet as the agent identity
    const solanaWallet = wallets.solana;
    if (!solanaWallet) continue;

    // Find verified/linked platforms
    const verifiedPlatforms = Object.entries(verData)
      .filter(([k, v]) => v && (v.verified || v.linked) && PLATFORM_TO_ATTESTATION[k])
      .map(([k, v]) => ({
        platform: k,
        attestationType: PLATFORM_TO_ATTESTATION[k],
        proofData: v.handle || v.address || v.identifier || k,
      }));

    if (verifiedPlatforms.length === 0) continue;

    console.log(`  ${profile.id} (${profile.name || 'unnamed'}) — wallet: ${solanaWallet.substring(0, 8)}...`);
    
    for (const vp of verifiedPlatforms) {
      if (DRY_RUN) {
        console.log(`    → [DRY] ${vp.attestationType} (proof: ${vp.proofData})`);
        totalAttestations++;
      } else {
        try {
          const result = await satpWrite.createAttestation({
            agentId: solanaWallet,
            attestationType: vp.attestationType,
            proofData: vp.proofData,
          }, signer, NETWORK);
          console.log(`    ✅ ${vp.attestationType} — tx: ${result.txSignature.substring(0, 20)}...`);
          totalAttestations++;
          // Rate limit - wait 2s between transactions to avoid 429s
          await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
          console.log(`    ❌ ${vp.attestationType} — ${e.message}`);
          errors++;
        }
      }
    }
  }

  db.close();
  console.log('\n' + '─'.repeat(70));
  console.log(`✅ Done: ${totalAttestations} attestations ${DRY_RUN ? 'planned' : 'created'}, ${errors} errors`);
  if (DRY_RUN) console.log('   (Use --apply to write on-chain)');
}

main().catch(e => { console.error(e); process.exit(1); });
