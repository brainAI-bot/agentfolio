#!/usr/bin/env node
/**
 * Bulk re-score all profiles using DB attestations + verification_data.
 * Uses Helius RPC for on-chain lookups where wallets exist.
 */
const path = require('path');
const Database = require('better-sqlite3');
const { computeScore, fetchOnChainData } = require('../src/scoring');

const DB_PATH = path.join(__dirname, '..', 'data', 'agentfolio.db');
const db = new Database(DB_PATH);

const upsert = db.prepare(`
  INSERT INTO satp_trust_scores (agent_id, overall_score, verification_score, activity_score, social_score, last_computed, onchain_reputation, onchain_level, onchain_pda, level, score_breakdown)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(agent_id) DO UPDATE SET
    overall_score=excluded.overall_score, verification_score=excluded.verification_score,
    activity_score=excluded.activity_score, social_score=excluded.social_score,
    last_computed=excluded.last_computed, onchain_reputation=excluded.onchain_reputation,
    onchain_level=excluded.onchain_level, onchain_pda=excluded.onchain_pda,
    level=excluded.level, score_breakdown=excluded.score_breakdown
`);

async function main() {
  const rows = db.prepare('SELECT * FROM profiles').all();
  console.log(`Scoring ${rows.length} profiles...`);
  
  let updated = 0;
  for (const row of rows) {
    const profile = {
      id: row.id, name: row.name, description: row.bio, avatar: row.avatar,
      wallets: row.wallets, skills: row.skills, verifications: [],
      created_at: row.created_at, last_active_at: row.last_active_at,
      links: row.links, tags: row.tags,
    };

    // Parse verification_data
    if (row.verification_data) {
      try {
        const vd = JSON.parse(row.verification_data);
        for (const [type, data] of Object.entries(vd)) {
          if (data && (data.verified || data.linked || data.success)) {
            profile.verifications.push({ type, ...data });
          }
        }
      } catch (e) { /* skip */ }
    }

    // Try on-chain lookup
    let onChainData = null;
    try {
      const w = typeof row.wallets === 'string' ? JSON.parse(row.wallets) : row.wallets;
      const solWallet = w?.solana || null;
      if (solWallet) {
        onChainData = await fetchOnChainData(solWallet);
      }
    } catch (e) { /* no wallet */ }

    const result = computeScore(profile, onChainData);
    const bd = result.breakdown;
    
    upsert.run(
      row.id,
      result.score,
      bd.verifications?.score || 0,
      bd.activity?.score || 0,
      0, // social_score
      result.computedAt,
      bd.onChainReputation?.satpScore || 0,
      bd.onChainReputation?.satpLevel || 0,
      bd.onChainReputation?.pda || null,
      result.level,
      JSON.stringify(bd)
    );
    updated++;
    
    const verifs = profile.verifications.map(v => v.type).join(',');
    if (result.score > 6.7) {
      console.log(`  ${row.id}: ${result.score}/100 [${result.level}] verifs: ${verifs || 'none'}`);
    }
  }
  
  console.log(`\nDone. ${updated} profiles scored.`);
  
  // Summary
  const levels = db.prepare('SELECT level, COUNT(*) as c FROM satp_trust_scores GROUP BY level ORDER BY c DESC').all();
  console.log('\nLevel distribution:');
  levels.forEach(l => console.log(`  ${l.level}: ${l.c}`));
  
  const top = db.prepare('SELECT agent_id, overall_score, level FROM satp_trust_scores ORDER BY overall_score DESC LIMIT 10').all();
  console.log('\nTop 10:');
  top.forEach((r, i) => console.log(`  ${i+1}. ${r.agent_id}: ${r.overall_score} [${r.level}]`));
}

main().catch(e => { console.error(e); process.exit(1); });
