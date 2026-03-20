#!/usr/bin/env node
/**
 * AgentFolio Bulk Import Script
 * 
 * Import agent profiles from JSON or CSV files via the registration API.
 * 
 * Usage:
 *   node bulk-import.js <input-file> [options]
 * 
 * Input formats:
 *   JSON: Array of objects [{ name, handle?, bio?, skills?, wallets?, links? }, ...]
 *   CSV:  Header row: name,handle,bio,skills,solana_wallet,github,website
 * 
 * Options:
 *   --dry-run        Validate only, don't actually import
 *   --delay <ms>     Delay between API calls (default: 200ms)
 *   --api-url <url>  Base URL (default: https://agentfolio.bot)
 *   --output <file>  Save results to JSON file
 *   --skip-existing  Skip profiles that already exist (409) instead of failing
 * 
 * Examples:
 *   node bulk-import.js agents.json --dry-run
 *   node bulk-import.js agents.csv --delay 500 --output results.json
 *   node bulk-import.js hackathon-agents.json --skip-existing
 */

const fs = require('fs');
const path = require('path');

// Parse CLI args
const args = process.argv.slice(2);
const inputFile = args.find(a => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const skipExisting = args.includes('--skip-existing');
const delayIdx = args.indexOf('--delay');
const delayMs = delayIdx >= 0 ? parseInt(args[delayIdx + 1]) || 200 : 200;
const apiIdx = args.indexOf('--api-url');
const apiUrl = apiIdx >= 0 ? args[apiIdx + 1] : 'https://agentfolio.bot';
const outIdx = args.indexOf('--output');
const outputFile = outIdx >= 0 ? args[outIdx + 1] : null;

if (!inputFile) {
  console.error('Usage: node bulk-import.js <input-file> [--dry-run] [--delay ms] [--api-url url] [--output file] [--skip-existing]');
  console.error('\nInput format (JSON):');
  console.error('  [{ "name": "AgentX", "bio": "...", "skills": ["solana"], "wallets": { "solana": "..." } }]');
  console.error('\nInput format (CSV):');
  console.error('  name,handle,bio,skills,solana_wallet,github,website');
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error(`File not found: ${inputFile}`);
  process.exit(1);
}

// Parse input file
function parseCSV(content) {
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { values.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    values.push(current.trim());

    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] || ''; });

    // Map CSV columns to API format
    const agent = { name: row.name };
    if (row.handle) agent.handle = row.handle.startsWith('@') ? row.handle : '@' + row.handle;
    if (row.bio) agent.bio = row.bio;
    if (row.skills) agent.skills = row.skills.split(';').map(s => s.trim()).filter(Boolean);
    if (row.solana_wallet || row.wallet) {
      agent.wallets = { solana: row.solana_wallet || row.wallet };
    }
    const links = {};
    if (row.github) links.github = row.github;
    if (row.website) links.website = row.website;
    if (row.twitter || row.x) links.x = row.twitter || row.x;
    if (Object.keys(links).length > 0) agent.links = links;
    return agent;
  });
}

function parseJSON(content) {
  const data = JSON.parse(content);
  return Array.isArray(data) ? data : [data];
}

function loadAgents(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv') return parseCSV(content);
  return parseJSON(content);
}

// Validate agent data
function validateAgent(agent, index) {
  const errors = [];
  if (!agent.name || typeof agent.name !== 'string' || agent.name.length < 1) {
    errors.push(`[${index}] name is required`);
  }
  if (agent.name && agent.name.length > 64) {
    errors.push(`[${index}] name too long (max 64 chars)`);
  }
  if (agent.bio && agent.bio.length > 500) {
    errors.push(`[${index}] bio too long (max 500 chars)`);
  }
  if (agent.wallets?.solana && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(agent.wallets.solana)) {
    errors.push(`[${index}] invalid Solana wallet address`);
  }
  return errors;
}

// Import a single agent via API
async function importAgent(agent) {
  const res = await fetch(`${apiUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(agent),
  });
  const data = await res.json();
  return { status: res.status, data };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log(`\n📦 AgentFolio Bulk Import`);
  console.log(`   File: ${inputFile}`);
  console.log(`   API:  ${apiUrl}`);
  console.log(`   Mode: ${dryRun ? '🔍 DRY RUN (validation only)' : '🚀 LIVE IMPORT'}`);
  console.log(`   Delay: ${delayMs}ms between calls`);
  console.log('');

  const agents = loadAgents(inputFile);
  console.log(`Found ${agents.length} agent(s) to import\n`);

  // Validate all first
  let validationErrors = [];
  for (let i = 0; i < agents.length; i++) {
    const errs = validateAgent(agents[i], i);
    validationErrors = validationErrors.concat(errs);
  }

  if (validationErrors.length > 0) {
    console.error('❌ Validation errors:');
    validationErrors.forEach(e => console.error('  ' + e));
    process.exit(1);
  }
  console.log(`✅ All ${agents.length} agents pass validation\n`);

  if (dryRun) {
    console.log('🔍 Dry run — no changes made.');
    agents.forEach((a, i) => console.log(`  [${i}] ${a.name} (${a.handle || 'auto'})`));
    process.exit(0);
  }

  // Import
  const results = [];
  let success = 0, skipped = 0, failed = 0;

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    process.stdout.write(`  [${i + 1}/${agents.length}] ${agent.name}... `);

    try {
      const result = await importAgent(agent);

      if (result.status === 201) {
        console.log(`✅ ${result.data.profile_id}`);
        results.push({ agent: agent.name, status: 'created', profile_id: result.data.profile_id, api_key: result.data.api_key });
        success++;
      } else if (result.status === 409 && skipExisting) {
        console.log(`⏭️  already exists`);
        results.push({ agent: agent.name, status: 'skipped', reason: 'already exists' });
        skipped++;
      } else {
        console.log(`❌ ${result.data.error || 'Unknown error'}`);
        results.push({ agent: agent.name, status: 'failed', error: result.data.error });
        failed++;
      }
    } catch (err) {
      console.log(`❌ ${err.message}`);
      results.push({ agent: agent.name, status: 'failed', error: err.message });
      failed++;
    }

    if (i < agents.length - 1) await sleep(delayMs);
  }

  console.log(`\n📊 Results: ${success} created, ${skipped} skipped, ${failed} failed (${agents.length} total)\n`);

  if (outputFile) {
    fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
    console.log(`📁 Results saved to ${outputFile}\n`);
  }

  // Print summary table of created profiles
  const created = results.filter(r => r.status === 'created');
  if (created.length > 0) {
    console.log('Created profiles:');
    created.forEach(r => console.log(`  ${r.profile_id} → ${apiUrl}/profile/${r.profile_id}`));
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
