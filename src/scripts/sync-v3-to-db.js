#!/usr/bin/env node
/**
 * One-time migration: Sync V3 on-chain Genesis Record scores → DB
 * 
 * Problem: satp_trust_scores has stale V2 scores (e.g. 27.7 for brainKID).
 *          V3 Genesis Records on-chain have the real scores (e.g. 550).
 *          Directory listing uses satp_trust_scores → shows wrong numbers.
 * 
 * Solution: For each profile, fetch V3 on-chain score via Genesis Record PDA,
 *           update satp_trust_scores.overall_score + level to match.
 *           Also update profiles.verification JSON.
 */

const Database = require('better-sqlite3');
const path = require('path');

// Detect prod vs dev
const PROD_DB = '/home/ubuntu/agentfolio/data/agentfolio.db';
const DEV_DB = path.join(__dirname, '..', '..', 'data', 'agentfolio.db');
const fs = require('fs');
const DB_PATH = fs.existsSync(PROD_DB) ? PROD_DB : DEV_DB;

// V3 score service
let getV3Scores;
try {
  ({ getV3Scores } = require(path.join(path.dirname(DB_PATH), '..', 'v3-score-service')));
} catch (_) {
  try {
    ({ getV3Scores } = require('../../v3-score-service'));
  } catch (_2) {
    console.error('Cannot load v3-score-service. Run on prod or copy the module.');
    process.exit(1);
  }
}

async function main() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  console.log('=== V3 On-Chain Score → DB Sync Migration ===');
  console.log(`DB: ${DB_PATH}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  // Get all profile IDs
  const profiles = db.prepare('SELECT id FROM profiles WHERE status = ?').all('active');
  const agentIds = profiles.map(p => p.id);
  console.log(`Fetching V3 scores for ${agentIds.length} profiles from on-chain...\n`);

  // Batch fetch V3 on-chain scores
  const v3Scores = await getV3Scores(agentIds);

  const updateTrust = db.prepare(`
    UPDATE satp_trust_scores 
    SET overall_score = ?, level = ?, last_computed = ?
    WHERE agent_id = ?
  `);
  const insertTrust = db.prepare(`
    INSERT OR IGNORE INTO satp_trust_scores (agent_id, overall_score, level, last_computed, verification_score, activity_score, social_score)
    VALUES (?, ?, ?, ?, 0, 0, 0)
  `);
  const updateVerification = db.prepare(`
    UPDATE profiles SET verification = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  let updated = 0;
  let noV3 = 0;
  let created = 0;

  const now = new Date().toISOString();

  const txn = db.transaction(() => {
    for (const [agentId, v3] of v3Scores.entries()) {
      if (!v3 || !v3.isBorn) {
        noV3++;
        continue;
      }

      const score = v3.reputationScore;
      const level = v3.verificationLabel.toUpperCase();

      // Check existing satp_trust_scores row
      const existing = db.prepare('SELECT overall_score, level FROM satp_trust_scores WHERE agent_id = ?').get(agentId);

      if (existing) {
        if (existing.overall_score !== score || existing.level !== level) {
          updateTrust.run(score, level, now, agentId);
          console.log(`  ✓ ${agentId}: satp_trust_scores ${existing.overall_score}/${existing.level} → ${score}/${level}`);
          updated++;
        } else {
          // Already matches
        }
      } else {
        insertTrust.run(agentId, score, level, now);
        console.log(`  + ${agentId}: created satp_trust_scores ${score}/${level}`);
        created++;
      }

      // Also sync profiles.verification JSON
      const row = db.prepare('SELECT verification FROM profiles WHERE id = ?').get(agentId);
      if (row) {
        let ver = {};
        try { ver = JSON.parse(row.verification || '{}'); } catch (_) {}
        ver.score = score;
        ver.level = level;
        ver.scoreVersion = 'v3';
        ver.scoreSyncedAt = now;
        updateVerification.run(JSON.stringify(ver), agentId);
      }
    }
  });

  txn();

  console.log(`\n=== Migration Complete ===`);
  console.log(`V3 scores found:    ${v3Scores.size - noV3}/${v3Scores.size}`);
  console.log(`Updated:            ${updated}`);
  console.log(`Created:            ${created}`);
  console.log(`No V3 Genesis:      ${noV3}`);

  // Spot check
  console.log('\n--- Post-Migration Spot Check ---');
  const check = db.prepare(`
    SELECT p.id, 
           json_extract(p.verification, '$.score') as ver_score,
           t.overall_score as trust_score, t.level
    FROM profiles p
    LEFT JOIN satp_trust_scores t ON t.agent_id = p.id
    WHERE t.overall_score > 10
    ORDER BY t.overall_score DESC
    LIMIT 10
  `).all();

  for (const r of check) {
    const match = r.ver_score === r.trust_score;
    console.log(`  ${match ? '✓' : '✗'} ${r.id}: verification.score=${r.ver_score}, trust_scores=${r.trust_score}, level=${r.level}`);
  }

  db.close();
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
