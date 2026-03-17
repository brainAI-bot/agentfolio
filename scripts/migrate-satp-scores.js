#!/usr/bin/env node
/**
 * SATP Score Migration Script
 * Reads all profiles from agentfolio.db, fetches on-chain SATP data,
 * recomputes scores with on-chain integration, and updates satp_trust_scores table.
 * 
 * Usage:
 *   node scripts/migrate-satp-scores.js              # Dry run (default)
 *   node scripts/migrate-satp-scores.js --apply       # Apply changes
 *   node scripts/migrate-satp-scores.js --profile agent_brainkid  # Single profile
 */

const path = require('path');
const Database = require('better-sqlite3');
const { computeScore, fetchOnChainData } = require('../src/scoring');

const DB_PATH = path.join(__dirname, '..', 'data', 'agentfolio.db');
const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const SINGLE = args.find(a => a === '--profile') ? args[args.indexOf('--profile') + 1] : null;

// Rate limit helper — 200ms between RPC calls
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const db = new Database(DB_PATH);
  
  // Ensure satp_trust_scores has the new columns
  if (!DRY_RUN) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS satp_trust_scores (
        agent_id TEXT PRIMARY KEY,
        overall_score REAL,
        verification_score REAL,
        activity_score REAL,
        social_score REAL,
        last_computed TEXT
      );
    `);
    
    // Add new columns if missing
    const cols = db.prepare('PRAGMA table_info(satp_trust_scores)').all().map(c => c.name);
    if (!cols.includes('onchain_reputation')) {
      db.exec('ALTER TABLE satp_trust_scores ADD COLUMN onchain_reputation REAL DEFAULT 0');
    }
    if (!cols.includes('onchain_level')) {
      db.exec('ALTER TABLE satp_trust_scores ADD COLUMN onchain_level INTEGER DEFAULT 0');
    }
    if (!cols.includes('onchain_pda')) {
      db.exec('ALTER TABLE satp_trust_scores ADD COLUMN onchain_pda TEXT');
    }
    if (!cols.includes('level')) {
      db.exec('ALTER TABLE satp_trust_scores ADD COLUMN level TEXT');
    }
    if (!cols.includes('score_breakdown')) {
      db.exec('ALTER TABLE satp_trust_scores ADD COLUMN score_breakdown TEXT');
    }
  }
  
  // Get profiles
  let profiles;
  if (SINGLE) {
    profiles = db.prepare('SELECT * FROM profiles WHERE id = ?').all(SINGLE);
  } else {
    profiles = db.prepare('SELECT * FROM profiles').all();
  }
  
  console.log(`\n📊 SATP Score Migration${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`   Profiles: ${profiles.length}`);
  console.log('─'.repeat(80));
  
  const upsert = DRY_RUN ? null : db.prepare(`
    INSERT INTO satp_trust_scores (agent_id, overall_score, verification_score, activity_score, social_score, onchain_reputation, onchain_level, onchain_pda, level, score_breakdown, last_computed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      overall_score = excluded.overall_score,
      verification_score = excluded.verification_score,
      activity_score = excluded.activity_score,
      social_score = excluded.social_score,
      onchain_reputation = excluded.onchain_reputation,
      onchain_level = excluded.onchain_level,
      onchain_pda = excluded.onchain_pda,
      level = excluded.level,
      score_breakdown = excluded.score_breakdown,
      last_computed = excluded.last_computed
  `);
  
  let updated = 0, onChainFound = 0, errors = 0;
  
  for (const profile of profiles) {
    try {
      // Parse wallets
      let wallet = null;
      try {
        const wallets = typeof profile.wallets === 'string' ? JSON.parse(profile.wallets) : profile.wallets;
        wallet = wallets?.solana || null;
      } catch (e) { /* no wallet */ }
      
      // Parse verification_data for off-chain verifications
      let verifications = [];
      try {
        const vd = typeof profile.verification_data === 'string' ? JSON.parse(profile.verification_data || '{}') : (profile.verification_data || {});
        for (const [type, data] of Object.entries(vd)) {
          if (data && data.verified) verifications.push({ type, ...data });
        }
      } catch (e) { /* skip */ }
      profile.verifications = verifications;
      
      // Fetch on-chain data (with rate limiting)
      let onChainData = null;
      if (wallet) {
        await sleep(300); // rate limit
        onChainData = await fetchOnChainData(wallet);
        if (onChainData?.identity) onChainFound++;
      }
      
      // Compute score
      const result = computeScore(profile, onChainData);
      const bd = result.breakdown;
      
      const row = {
        agent_id: profile.id,
        overall_score: result.score,
        verification_score: bd.verifications.score,
        activity_score: bd.activity.score,
        social_score: bd.reviews.score,
        onchain_reputation: bd.onChainReputation.satpScore,
        onchain_level: bd.onChainReputation.satpLevel,
        onchain_pda: bd.onChainReputation.pda,
        level: result.level,
        score_breakdown: JSON.stringify(bd),
        last_computed: result.computedAt,
      };
      
      const onChainTag = onChainData?.identity ? ` 🔗 SATP:${bd.onChainReputation.satpScore}` : '';
      console.log(`  ${profile.id.padEnd(30)} score:${result.score.toString().padStart(5)} level:${result.level.padEnd(8)} wallet:${wallet ? wallet.slice(0,8) + '...' : 'none'}${onChainTag}`);
      
      if (!DRY_RUN) {
        upsert.run(
          row.agent_id, row.overall_score, row.verification_score,
          row.activity_score, row.social_score, row.onchain_reputation,
          row.onchain_level, row.onchain_pda, row.level,
          row.score_breakdown, row.last_computed
        );
        updated++;
      }
    } catch (e) {
      console.error(`  ❌ ${profile.id}: ${e.message}`);
      errors++;
    }
  }
  
  console.log('─'.repeat(80));
  console.log(`\n✅ Done: ${updated} updated, ${onChainFound} with on-chain data, ${errors} errors`);
  if (DRY_RUN) console.log('   (Dry run — use --apply to write changes)');
  
  db.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
