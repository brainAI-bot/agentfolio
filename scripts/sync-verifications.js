#!/usr/bin/env node
/**
 * sync-verifications.js — Scan all profile JSONs, insert missing verifications into SQLite
 * Fix for: Only 6/12 verifications made it to DB for brainkid (and similar for other profiles)
 * 
 * Run: node scripts/sync-verifications.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const crypto = require('crypto');

const PROFILES_DIR = path.join(__dirname, '../data/profiles');
const DB_PATH = path.join(__dirname, '../data/agentfolio.db');
const DRY_RUN = process.argv.includes('--dry-run');

function genId(prefix = 'ver') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function main() {
  console.log(`🔄 Sync Verifications: JSON → SQLite ${DRY_RUN ? '(DRY RUN)' : ''}\n`);
  
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  
  // Get all existing verifications from DB
  const existingVerifs = db.prepare('SELECT profile_id, platform FROM verifications').all();
  const existingSet = new Set(existingVerifs.map(v => `${v.profile_id}|${v.platform}`));
  console.log(`📊 DB currently has ${existingVerifs.length} verifications\n`);
  
  // Get all JSON profile files
  const files = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json') && !f.endsWith('.bak'));
  
  let added = 0;
  let skipped = 0;
  let errors = 0;
  
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO verifications (id, profile_id, platform, identifier, proof, verified_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  for (const file of files) {
    const profileId = file.replace('.json', '');
    const filePath = path.join(PROFILES_DIR, file);
    
    try {
      const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const vd = profile.verificationData || {};
      
      for (const [platform, data] of Object.entries(vd)) {
        if (!data || !data.verified) continue;
        
        // Skip test platforms
        if (platform.startsWith('test_')) {
          console.log(`  ⚠️  SKIP test platform: ${profileId} / ${platform}`);
          continue;
        }
        
        const key = `${profileId}|${platform}`;
        if (existingSet.has(key)) {
          skipped++;
          continue;
        }
        
        // Determine identifier
        const identifier = data.address || data.email || data.username || data.url || data.domain || data.wallet || platform;
        const verifiedAt = data.verifiedAt || new Date().toISOString();
        const proof = JSON.stringify(data.proof || {});
        
        if (!DRY_RUN) {
          insertStmt.run(genId(), profileId, platform, identifier, proof, verifiedAt);
        }
        console.log(`  ✅ ${DRY_RUN ? 'WOULD ADD' : 'ADDED'}: ${profileId} / ${platform} = ${identifier}`);
        existingSet.add(key);
        added++;
      }
    } catch (err) {
      console.error(`  ❌ Error reading ${file}: ${err.message}`);
      errors++;
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`📊 Sync Complete:`);
  console.log(`   ✅ Added: ${added}`);
  console.log(`   ⏭️  Skipped (already in DB): ${skipped}`);
  console.log(`   ❌ Errors: ${errors}`);
  
  // Show final counts per profile
  if (!DRY_RUN && added > 0) {
    console.log('\n📊 Verification counts per profile (after sync):');
    const counts = db.prepare(`
      SELECT profile_id, COUNT(*) as count, GROUP_CONCAT(platform, ', ') as platforms
      FROM verifications 
      GROUP BY profile_id 
      ORDER BY count DESC
    `).all();
    for (const row of counts) {
      console.log(`   ${row.profile_id}: ${row.count} — ${row.platforms}`);
    }
  }
  
  db.close();
}

main();
