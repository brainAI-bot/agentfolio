// Run on production server: cd /home/ubuntu/agentfolio && node /tmp/seed-v3-scores.js
const Database = require('better-sqlite3');
const path = require('path');
const { getV3Score } = require('./v3-score-service');

async function main() {
  const db = new Database(path.join(__dirname, 'data', 'agentfolio.db'));
  
  // Get all agents
  const agents = db.prepare('SELECT id FROM profiles').all();
  console.log(`Found ${agents.length} agents`);
  
  // Clear old v1 seeds and re-seed with V3
  db.prepare('DELETE FROM score_history WHERE reason = ?').run('initial_seed');
  console.log('Cleared old initial_seed entries');
  
  const insert = db.prepare('INSERT INTO score_history (agent_id, score, tier, breakdown, reason, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))');
  
  let seeded = 0;
  for (const agent of agents) {
    try {
      const v3 = await getV3Score(agent.id);
      if (v3) {
        const tier = v3.verificationLabel.toUpperCase();
        const breakdown = JSON.stringify({
          reputationScore: v3.reputationScore,
          verificationLevel: v3.verificationLevel,
          verificationLabel: v3.verificationLabel,
          isBorn: v3.isBorn,
        });
        insert.run(agent.id, v3.reputationScore, tier, breakdown, 'v3_seed');
        seeded++;
        if (seeded % 10 === 0) console.log(`  Seeded ${seeded}...`);
      } else {
        // No V3 record — use v1 score from satp_trust_scores
        const v1 = db.prepare('SELECT overall_score, level, score_breakdown FROM satp_trust_scores WHERE agent_id = ?').get(agent.id);
        if (v1 && v1.overall_score > 0) {
          insert.run(agent.id, v1.overall_score, v1.level, v1.score_breakdown || '{}', 'v1_seed');
          seeded++;
        }
      }
    } catch (e) {
      console.error(`  Error for ${agent.id}: ${e.message}`);
    }
  }
  
  console.log(`Seeded ${seeded} entries total`);
  
  // Verify brainkid
  const bk = db.prepare('SELECT * FROM score_history WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1').get('agent_brainkid');
  console.log('brainkid:', bk ? `score=${bk.score}, tier=${bk.tier}` : 'NOT FOUND');
  
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
