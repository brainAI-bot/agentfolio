#!/usr/bin/env node
/**
 * Backfill on-chain Memo attestations for all existing verifications
 * Creates Memo TXs on Solana mainnet for every verified platform
 * 
 * Run: node scripts/backfill-attestations.js [--dry-run]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const Database = require('better-sqlite3');
const path = require('path');
const { postVerificationMemo, initAttestationsTable } = require('../src/lib/memo-attestation');

const DB_PATH = path.join(__dirname, '../data/agentfolio.db');
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`🔗 Backfill Verification Attestations ${DRY_RUN ? '(DRY RUN)' : ''}\n`);
  
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  initAttestationsTable(db);
  
  // Get all verifications from DB
  const verifications = db.prepare(`
    SELECT v.profile_id, v.platform, v.identifier, v.proof, v.verified_at
    FROM verifications v
    ORDER BY v.profile_id, v.platform
  `).all();
  
  console.log(`📊 Found ${verifications.length} verifications total\n`);
  
  // Check which already have attestations
  const existing = new Set();
  try {
    const rows = db.prepare('SELECT profile_id, platform FROM attestations').all();
    for (const r of rows) existing.add(`${r.profile_id}|${r.platform}`);
    console.log(`📊 ${existing.size} already have attestations\n`);
  } catch (e) {
    // Table might not exist yet
  }
  
  let created = 0;
  let skipped = 0;
  let failed = 0;
  
  for (const v of verifications) {
    const key = `${v.profile_id}|${v.platform}`;
    
    if (existing.has(key)) {
      skipped++;
      continue;
    }
    
    // Skip test platforms
    if (v.platform.startsWith('test_')) {
      console.log(`  ⏭️  Skip test: ${v.profile_id}/${v.platform}`);
      skipped++;
      continue;
    }
    
    const proofData = {
      identifier: v.identifier,
      verified_at: v.verified_at,
    };
    
    if (DRY_RUN) {
      console.log(`  📋 WOULD attest: ${v.profile_id} / ${v.platform} = ${v.identifier}`);
      created++;
      continue;
    }
    
    console.log(`  📤 Attesting: ${v.profile_id} / ${v.platform}...`);
    const result = await postVerificationMemo(v.profile_id, v.platform, proofData);
    
    if (result) {
      console.log(`  ✅ ${result.explorerUrl}`);
      created++;
    } else {
      console.log(`  ❌ Failed`);
      failed++;
    }
    
    // Rate limit: 500ms between TXs
    await new Promise(r => setTimeout(r, 500));
  }
  
  db.close();
  
  console.log('\n' + '='.repeat(60));
  console.log(`📊 Backfill Complete:`);
  console.log(`   ✅ Created: ${created}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Failed: ${failed}`);
}

main().catch(console.error);
