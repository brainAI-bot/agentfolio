#!/usr/bin/env node
/**
 * One-time migration: sync profiles.verification.score/tier with satp_trust_scores (V3).
 * 
 * For each agent that has a row in satp_trust_scores, updates the profiles.verification
 * JSON to include { score, tier, level, lastSynced } from the V3 trust score.
 * Preserves existing fields in verification (e.g. verifiedPlatforms, lastVerified).
 * 
 * Usage: node src/scripts/migrate-v3-scores.js [--dry-run]
 */

const Database = require('better-sqlite3');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const DB_PATH = path.join(__dirname, '../../data/agentfolio.db');

console.log(`[migrate-v3-scores] DB: ${DB_PATH}`);
console.log(`[migrate-v3-scores] Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
console.log('');

const db = new Database(DB_PATH);

// Get all V3 trust scores
const trustScores = db.prepare(`
  SELECT agent_id, overall_score, level, score_breakdown
  FROM satp_trust_scores
`).all();

console.log(`[migrate-v3-scores] Found ${trustScores.length} agents in satp_trust_scores`);

const updateStmt = db.prepare(`
  UPDATE profiles SET verification = ?, updated_at = datetime('now')
  WHERE id = ?
`);

let updated = 0;
let skipped = 0;
let errors = 0;

const now = new Date().toISOString();

for (const ts of trustScores) {
  try {
    // Get current verification JSON
    const row = db.prepare('SELECT verification FROM profiles WHERE id = ?').get(ts.agent_id);
    if (!row) {
      console.log(`  SKIP ${ts.agent_id} — no profile found`);
      skipped++;
      continue;
    }

    let verification = {};
    try {
      verification = JSON.parse(row.verification || '{}');
    } catch (e) {
      verification = {};
    }

    // Merge V3 score into verification object
    const updated_verification = {
      ...verification,
      score: ts.overall_score,
      tier: ts.level || 'NEW',
      level: ts.level || 'NEW',
      v3Synced: true,
      lastScoreSync: now,
    };

    if (DRY_RUN) {
      console.log(`  DRY ${ts.agent_id}: score=${ts.overall_score}, level=${ts.level}`);
      console.log(`    before: ${row.verification}`);
      console.log(`    after:  ${JSON.stringify(updated_verification)}`);
    } else {
      updateStmt.run(JSON.stringify(updated_verification), ts.agent_id);
      console.log(`  OK  ${ts.agent_id}: score=${ts.overall_score}, level=${ts.level}`);
    }
    updated++;
  } catch (e) {
    console.error(`  ERR ${ts.agent_id}: ${e.message}`);
    errors++;
  }
}

console.log('');
console.log(`[migrate-v3-scores] Done. Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);
if (DRY_RUN) console.log('[migrate-v3-scores] (Dry run — no changes written)');

db.close();
