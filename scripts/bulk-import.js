#!/usr/bin/env node
/**
 * Bulk Import Script for AgentFolio
 * 
 * Import agent profiles from JSON or CSV files.
 * 
 * Usage:
 *   node bulk-import.js <input-file> [--dry-run] [--skip-existing] [--batch-size 10]
 * 
 * Input JSON format (array of objects):
 *   [
 *     {
 *       "name": "Agent Name",          // REQUIRED
 *       "handle": "@agent_handle",     // optional (auto-generated from name if missing)
 *       "bio": "Agent description",    // optional
 *       "skills": ["solana", "defi"],  // optional
 *       "wallets": { "solana": "..." },// optional
 *       "links": { "github": "...", "website": "...", "x": "@handle" }  // optional
 *     }
 *   ]
 * 
 * Input CSV format (first row = headers):
 *   name,handle,bio,skills,wallets.solana,links.github,links.website
 *   "Agent 1","@agent1","Bio text","skill1;skill2","SolAddr","https://github.com/x","https://x.com"
 * 
 * Examples:
 *   node bulk-import.js agents.json --dry-run          # Preview without creating
 *   node bulk-import.js agents.json --skip-existing     # Skip if name already exists
 *   node bulk-import.js agents.csv --batch-size 5       # Process 5 at a time
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

// ─── CLI Args ────────────────────────────────────────
const args = process.argv.slice(2);
const inputFile = args.find(a => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const skipExisting = args.includes('--skip-existing');
const batchSizeIdx = args.indexOf('--batch-size');
const batchSize = batchSizeIdx >= 0 ? parseInt(args[batchSizeIdx + 1]) || 10 : 10;

if (!inputFile) {
  console.error('Usage: node bulk-import.js <input-file.json|csv> [--dry-run] [--skip-existing] [--batch-size N]');
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error(`File not found: ${inputFile}`);
  process.exit(1);
}

// ─── Parse Input ─────────────────────────────────────
function parseCSV(content) {
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const agents = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (const char of lines[i]) {
      if (char === '"') { inQuotes = !inQuotes; continue; }
      if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; continue; }
      current += char;
    }
    values.push(current.trim());
    
    const agent = {};
    headers.forEach((h, idx) => {
      const val = values[idx] || '';
      if (!val) return;
      
      if (h.includes('.')) {
        const [parent, child] = h.split('.');
        if (!agent[parent]) agent[parent] = {};
        agent[parent][child] = val;
      } else if (h === 'skills') {
        agent.skills = val.split(';').map(s => s.trim()).filter(Boolean);
      } else {
        agent[h] = val;
      }
    });
    
    if (agent.name) agents.push(agent);
  }
  
  return agents;
}

function parseJSON(content) {
  const data = JSON.parse(content);
  return Array.isArray(data) ? data : [data];
}

function parseInput(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();
  
  if (ext === '.csv') return parseCSV(content);
  return parseJSON(content);
}

// ─── API Call ────────────────────────────────────────
function registerAgent(agentData) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(agentData);
    const url = new URL(`${API_BASE}/api/register`);
    
    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: { error: data } });
        }
      });
    });
    
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Batch Processing ────────────────────────────────
async function processBatch(agents, startIdx) {
  const batch = agents.slice(startIdx, startIdx + batchSize);
  const results = [];
  
  for (const agent of batch) {
    if (!agent.name) {
      results.push({ name: '(unnamed)', status: 'SKIP', reason: 'No name' });
      continue;
    }
    
    if (dryRun) {
      results.push({
        name: agent.name,
        handle: agent.handle || `@${agent.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        status: 'DRY_RUN',
        skills: agent.skills || [],
        wallets: agent.wallets || {},
      });
      continue;
    }
    
    try {
      const res = await registerAgent(agent);
      
      if (res.body.success) {
        results.push({
          name: agent.name,
          status: 'CREATED',
          profileId: res.body.profile_id,
          url: res.body.profile_url,
        });
      } else if (res.body.error && res.body.error.includes('already exists') && skipExisting) {
        results.push({ name: agent.name, status: 'SKIPPED', reason: 'Already exists' });
      } else {
        results.push({ name: agent.name, status: 'ERROR', error: res.body.error });
      }
    } catch (err) {
      results.push({ name: agent.name, status: 'ERROR', error: err.message });
    }
    
    // Small delay between registrations to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }
  
  return results;
}

// ─── Main ────────────────────────────────────────────
async function main() {
  console.log(`\n🤖 AgentFolio Bulk Import`);
  console.log(`   File: ${inputFile}`);
  console.log(`   Mode: ${dryRun ? 'DRY RUN (preview only)' : 'LIVE'}`);
  console.log(`   Skip existing: ${skipExisting}`);
  console.log(`   Batch size: ${batchSize}`);
  console.log('');
  
  const agents = parseInput(inputFile);
  console.log(`📋 Found ${agents.length} agent(s) to import\n`);
  
  if (agents.length === 0) {
    console.log('Nothing to import.');
    return;
  }
  
  // Show preview of first 3
  console.log('Preview (first 3):');
  for (const a of agents.slice(0, 3)) {
    console.log(`  - ${a.name} (${a.handle || 'auto-handle'}) skills: ${(a.skills || []).join(', ') || 'none'}`);
  }
  if (agents.length > 3) console.log(`  ... and ${agents.length - 3} more`);
  console.log('');
  
  const allResults = [];
  let processed = 0;
  
  while (processed < agents.length) {
    const results = await processBatch(agents, processed);
    allResults.push(...results);
    processed += results.length;
    
    const created = results.filter(r => r.status === 'CREATED').length;
    const skipped = results.filter(r => r.status === 'SKIPPED' || r.status === 'SKIP').length;
    const errors = results.filter(r => r.status === 'ERROR').length;
    const dryRuns = results.filter(r => r.status === 'DRY_RUN').length;
    
    console.log(`Batch ${Math.ceil(processed / batchSize)}: ${created} created, ${skipped} skipped, ${errors} errors${dryRuns ? `, ${dryRuns} previewed` : ''}`);
    
    for (const r of results) {
      if (r.status === 'CREATED') console.log(`  ✅ ${r.name} → ${r.profileId}`);
      else if (r.status === 'ERROR') console.log(`  ❌ ${r.name}: ${r.error}`);
      else if (r.status === 'SKIPPED') console.log(`  ⏭️  ${r.name}: ${r.reason}`);
      else if (r.status === 'DRY_RUN') console.log(`  📋 ${r.name} (${r.handle}) — would create`);
    }
  }
  
  // Summary
  console.log('\n════════════════════════════════');
  console.log('Summary:');
  const totalCreated = allResults.filter(r => r.status === 'CREATED').length;
  const totalSkipped = allResults.filter(r => r.status === 'SKIPPED' || r.status === 'SKIP').length;
  const totalErrors = allResults.filter(r => r.status === 'ERROR').length;
  const totalDryRun = allResults.filter(r => r.status === 'DRY_RUN').length;
  
  console.log(`  Total: ${agents.length}`);
  if (totalCreated) console.log(`  Created: ${totalCreated}`);
  if (totalSkipped) console.log(`  Skipped: ${totalSkipped}`);
  if (totalErrors) console.log(`  Errors: ${totalErrors}`);
  if (totalDryRun) console.log(`  Previewed: ${totalDryRun}`);
  console.log('');
  
  // Save results
  const resultsFile = inputFile.replace(/\.\w+$/, '-import-results.json');
  fs.writeFileSync(resultsFile, JSON.stringify(allResults, null, 2));
  console.log(`📄 Results saved to: ${resultsFile}`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
