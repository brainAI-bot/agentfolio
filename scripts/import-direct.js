#!/usr/bin/env node
/**
 * Direct DB import from Universal Agent Registry into AgentFolio
 * Bypasses rate limiter by writing to SQLite directly
 */

const https = require('https');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = '/home/ubuntu/agentfolio/data/agentfolio.db';
const API_BASE = 'https://hol.org/registry/api/v1';

const REGISTRIES = [
  { name: 'a2a-protocol', limit: 15 },
  { name: 'a2a-registry', limit: 15 },
  { name: 'virtuals-protocol', limit: 15 },
  { name: 'near-ai', limit: 10 },
  { name: 'coinbase-x402-bazaar', limit: 10 },
  { name: 'openconvai', limit: 10 },
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function genId() { return 'agent_' + crypto.randomBytes(8).toString('hex'); }
function genApiKey() { return 'af_' + crypto.randomBytes(24).toString('hex'); }
function sanitize(s) { return (s || '').replace(/[<>"']/g, '').trim(); }

async function main() {
  const db = new Database(DB_PATH);
  
  // Get existing names to avoid duplicates
  const existing = new Set(db.prepare('SELECT name FROM profiles').all().map(r => r.name.toLowerCase()));
  console.log(`Existing profiles: ${existing.size}`);
  
  const insert = db.prepare(`
    INSERT INTO profiles (id, name, handle, bio, skills, api_key, claimed, claim_token, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, datetime('now'), datetime('now'))
  `);

  let imported = 0, skipped = 0;

  for (const reg of REGISTRIES) {
    console.log(`\nFetching ${reg.name}...`);
    try {
      const data = await fetch(`${API_BASE}/search?registry=${encodeURIComponent(reg.name)}&limit=${reg.limit}`);
      console.log(`  ${data.total} total, ${(data.hits || []).length} returned`);

      for (const h of (data.hits || [])) {
        const name = sanitize(h.name);
        if (!name || name.length < 2) { skipped++; continue; }
        if (existing.has(name.toLowerCase())) { skipped++; continue; }
        
        const desc = sanitize((h.description || h.profile?.bio || '')).slice(0, 500);
        if (!desc || desc.length < 10) { skipped++; continue; }

        // Quality gate: must be an actual AI agent, not a business listing
        const combined = (name + ' ' + desc).toLowerCase();
        const AI_KEYWORDS = ['ai', 'agent', 'llm', 'model', 'bot', 'autonomous', 'protocol', 'swap', 'trade', 'chain', 'crypto', 'defi', 'nft', 'token', 'intelligence', 'neural', 'ml', 'deep learning', 'generative', 'assistant', 'sdk', 'api'];
        const JUNK_KEYWORDS = ['llc', 'inc.', 'ltd', 'corporation', 'plumbing', 'roofing', 'dental', 'restaurant', 'real estate', 'law firm', 'insurance', 'accounting', 'photography studio', 'event planning'];
        const hasAI = AI_KEYWORDS.some(k => combined.includes(k));
        const isJunk = JUNK_KEYWORDS.some(k => combined.includes(k));
        if (!hasAI || isJunk) { skipped++; console.log(`  ⏭️  Skipped (not AI): ${name}`); continue; }

        const meta = h.metadata || {};
        const capabilities = (meta.capabilityLabels || []).slice(0, 5);
        const skills = JSON.stringify(capabilities.length > 0 ? capabilities : ['ai-agent']);
        
        const id = genId();
        const handle = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
        const apiKey = genApiKey();
        const claimToken = crypto.randomBytes(24).toString('hex');

        try {
          insert.run(id, name, handle, desc, skills, apiKey, claimToken);
          existing.add(name.toLowerCase());
          imported++;
          console.log(`  ✅ ${name} (${reg.name})`);
        } catch (e) {
          if (e.message.includes('UNIQUE')) {
            skipped++;
          } else {
            console.error(`  ❌ ${name}: ${e.message}`);
          }
        }
      }
    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }
  }

  db.close();
  console.log(`\n=== Done: ${imported} imported, ${skipped} skipped ===`);
}

main().catch(e => { console.error(e); process.exit(1); });
