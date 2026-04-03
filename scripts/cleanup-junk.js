#!/usr/bin/env node
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = '/home/ubuntu/agentfolio/data/agentfolio.db';
const PROFILES_DIR = '/home/ubuntu/agentfolio/data/profiles';

// IDs to DELETE — non-AI-agent junk from Universal Registry import
const JUNK_IDS = [
  // Businesses (NOT AI agents)
  'agent_1db475baf67bed72', // Solace Corporation
  'agent_710eb4e15541c100', // Sportking India LLC
  'agent_0dfb68c1696f6562', // TELUGU TEJAM Business
  'agent_5134485883385a40', // SpeedWays
  'agent_f8ff10dbf428f219', // StarSource
  'agent_5641a820c2458ce7', // Team Works Event
  'agent_4c9079de7942d31b', // The Williams Company
  'agent_ceb05b84e8a6be87', // The Wilton Companies
  'agent_7a3599f61c269964', // The Greenhouse St. Pete
  'agent_77a946fd957190c3', // Toshiba American Business Solutions
  'agent_c4238a62dcbf52c6', // Total Signs and Designs
  'agent_31901ba4fa3c0c88', // United Business
  'agent_46eea929f776ae0e', // Tupperware
  'agent_22c38b0a3471d748', // SR Business Solutions

  // LLM models (not agents, these are models listed on NEAR AI / OpenRouter)
  'agent_afd02e24d1f49583', // moonshotai/Kimi-K2-Thinking
  'agent_28dbc837ba245b68', // zai-org/GLM-4.7
  'agent_db1894a54926dfbe', // zai-org/GLM-4.6
  'agent_b0486faf829dd831', // deepseek-ai/DeepSeek-V3.1
  'agent_c3d4caca0d898d05', // anthropic/claude-opus-4-6
  'agent_cb807953f612e861', // anthropic/claude-sonnet-4-5
  'agent_000f67be2554a3f7', // black-forest-labs/FLUX.2-klein-4B
  'agent_2430c3201580c499', // openai/gpt-5.2
  'agent_797ce8a67c2c30e2', // openai/gpt-oss-120b
  'agent_ab83e902df85558c', // openai/whisper-large-v3

  // Junk/test entries
  'agent_05ae498ad7da577b', // test
  'agent_88777e1f3adf75a0', // "Get a greeting for someone else" (not an agent name)
  'agent_2e6853bb0539f0e3', // "acp job budget ($0.001)" (not an agent)
  'agent_e5cbdf196445a824', // Bob (generic placeholder from openconvai)
  'xxx',                     // "xxx" - test entry
  'smartytest',              // "SmartyTest" - "just for fun"
  'lifi-e-ass',              // "Lifi/e-ass" - placeholder

  // x402 bazaar service descriptions (not agent names)
  'agent_88f129e1458a9fbb', // "IPFS content retrieval with x402 payment"
  'agent_77a497eb38202bbf', // "Generate high-quality videos using OpenAI Sora 2 Pro..."
  'agent_e77744a27da00208', // "Web3 Trader | Powered by Questflow"
  'agent_76068ebbe4923b8f', // "x402-mvp.secondstate.io"
  'agent_b1ad02677afabbcc', // "development invest | Powered by Questflow"
  'agent_a172dc1d25dbf6bf', // "Full TOON metrics + commentary"
  'agent_b6ba2abda7c55e20', // "Generate all images (logo, icon...)..."
];

const db = new Database(DB_PATH);
let deleted = 0;

for (const id of JUNK_IDS) {
  const profile = db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(id);
  if (!profile) {
    console.log(`  ⏭️  ${id} — not found`);
    continue;
  }

  // Delete from DB
  db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  try { db.prepare('DELETE FROM endorsements WHERE profile_id = ?').run(id); } catch {}
  try { db.prepare('DELETE FROM reviews WHERE profile_id = ? OR reviewee_id = ?').run(id, id); } catch {}
  try { db.prepare('DELETE FROM verifications WHERE profile_id = ?').run(id); } catch {}
  try { db.prepare('DELETE FROM satp_trust_scores WHERE agent_id = ?').run(id); } catch {}

  // Delete JSON file
  const jsonPath = path.join(PROFILES_DIR, `${id}.json`);
  if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);

  deleted++;
  console.log(`  🗑️  ${profile.name} (${id})`);
}

db.close();
console.log(`\n=== Deleted ${deleted} junk profiles ===`);

// Show remaining count
const db2 = new Database(DB_PATH, { readonly: true });
const count = db2.prepare('SELECT COUNT(*) as c FROM profiles').get().c;
db2.close();
console.log(`Remaining profiles: ${count}`);
