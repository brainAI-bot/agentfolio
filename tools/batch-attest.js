#!/usr/bin/env node
/**
 * Batch Attestation Script
 * 
 * Checks which platforms are verified in explorer but missing on-chain
 * attestation memos, then writes the missing ones.
 * 
 * Usage:
 *   node batch-attest.js <agent_id>              # Check + write missing memos
 *   node batch-attest.js <agent_id> --dry-run    # Check only, don't write
 *   node batch-attest.js <agent_id> --all        # Write for ALL verified platforms (even if already attested)
 *   node batch-attest.js --list                  # List all agents and their attestation status
 * 
 * Must be run on prod server (needs platform signing key + DB access).
 * 
 * brainChain — 2026-03-25
 */

const path = require('path');

// Paths (adjust if running from different directory)
const AGENTFOLIO_ROOT = process.env.AGENTFOLIO_ROOT || '/home/ubuntu/agentfolio';

// Dynamic requires (only available on prod)
let postVerificationMemo, batchPostMemos, getAttestations;
let Database;

try {
  const memoLib = require(path.join(AGENTFOLIO_ROOT, 'src/lib/memo-attestation'));
  postVerificationMemo = memoLib.postVerificationMemo;
  batchPostMemos = memoLib.batchPostMemos;
  getAttestations = memoLib.getAttestations;
  Database = require('better-sqlite3');
} catch (e) {
  console.error('ERROR: Must run on prod server with agentfolio installed.');
  console.error(`  Expected at: ${AGENTFOLIO_ROOT}`);
  console.error(`  ${e.message}`);
  process.exit(1);
}

const API_BASE = process.env.AGENTFOLIO_API || 'https://agentfolio.bot';
const DB_PATH = path.join(AGENTFOLIO_ROOT, 'data', 'agentfolio.db');

// ── Helpers ─────────────────────────────────────────────

async function fetchAPI(urlPath) {
  const url = `${API_BASE}${urlPath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

/**
 * Get explorer-verified platforms for an agent
 */
async function getExplorerPlatforms(agentId) {
  try {
    const data = await fetchAPI(`/api/explorer/${agentId}`);
    const verifications = data.verifications || [];
    return verifications
      .filter((v) => v.verified !== false)
      .map((v) => v.platform);
  } catch (e) {
    console.warn(`  ⚠️  Explorer fetch failed for ${agentId}: ${e.message}`);
    return [];
  }
}

/**
 * Get on-chain attestation platforms for an agent (from chain-cache API)
 */
async function getOnChainPlatforms(agentId) {
  try {
    const data = await fetchAPI(`/api/satp/attestations/by-agent/${agentId}`);
    return data.data?.platforms || [];
  } catch (e) {
    // Fallback: try DB directly
    try {
      const atts = getAttestations(agentId);
      return [...new Set(atts.map((a) => a.platform))];
    } catch {
      return [];
    }
  }
}

/**
 * Get all agent profile IDs from DB
 */
function getAllAgentIds() {
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare("SELECT id, name FROM profiles WHERE id LIKE 'agent_%' ORDER BY name").all();
    db.close();
    return rows;
  } catch (e) {
    console.error('DB read failed:', e.message);
    return [];
  }
}

// ── Commands ────────────────────────────────────────────

async function listAll() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  ATTESTATION STATUS — ALL AGENTS');
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  const agents = getAllAgentIds();
  // Filter to team agents (skip directory listings)
  const teamAgents = ['agent_brainkid', 'agent_braingrowth', 'agent_braintrade', 
                      'agent_brainchain', 'agent_brainforge', 'agent_suppi', 'agent_aremes'];
  
  for (const agentId of teamAgents) {
    const explorerPlatforms = await getExplorerPlatforms(agentId);
    const onChainPlatforms = await getOnChainPlatforms(agentId);
    const missing = explorerPlatforms.filter((p) => !onChainPlatforms.includes(p));
    
    const status = missing.length === 0 ? '✅' : '⚠️';
    console.log(`  ${status} ${agentId.padEnd(22)} explorer=${explorerPlatforms.length} on-chain=${onChainPlatforms.length} missing=${missing.length}`);
    if (missing.length > 0) {
      console.log(`     Missing: ${missing.join(', ')}`);
    }
  }
  console.log();
}

async function processAgent(agentId, dryRun, writeAll) {
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  BATCH ATTESTATION${dryRun ? ' (DRY RUN)' : ''}`);
  console.log(`  Agent: ${agentId}`);
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // 1. Get explorer-verified platforms
  const explorerPlatforms = await getExplorerPlatforms(agentId);
  console.log(`  Explorer platforms (${explorerPlatforms.length}): ${explorerPlatforms.join(', ') || 'none'}`);

  // 2. Get on-chain attestation platforms
  const onChainPlatforms = await getOnChainPlatforms(agentId);
  console.log(`  On-chain platforms (${onChainPlatforms.length}): ${onChainPlatforms.join(', ') || 'none'}`);

  // 3. Find missing
  let toWrite;
  if (writeAll) {
    toWrite = explorerPlatforms;
    console.log(`\n  --all mode: writing ALL ${toWrite.length} verified platforms`);
  } else {
    toWrite = explorerPlatforms.filter((p) => !onChainPlatforms.includes(p));
    if (toWrite.length === 0) {
      console.log('\n  ✅ All explorer platforms have on-chain attestation memos. Nothing to do.');
      return;
    }
    console.log(`\n  Missing attestations (${toWrite.length}): ${toWrite.join(', ')}`);
  }

  if (dryRun) {
    console.log('\n  DRY RUN — would write these attestation memos:');
    for (const platform of toWrite) {
      console.log(`    - ${platform}`);
    }
    console.log('\n  Run without --dry-run to execute.');
    return;
  }

  // 4. Write attestation memos
  console.log(`\n  Writing ${toWrite.length} attestation memo(s)...\n`);
  const results = [];

  for (const platform of toWrite) {
    process.stdout.write(`  ${platform.padEnd(14)} → `);
    const result = await postVerificationMemo(agentId, platform, {
      source: 'batch-attest',
      agent: 'brainChain',
      date: new Date().toISOString().split('T')[0],
    });

    if (result) {
      console.log(`✅ ${result.signature.slice(0, 20)}...`);
      console.log(`${''.padEnd(18)}  Solscan: ${result.explorerUrl}`);
      results.push({ platform, ...result });
    } else {
      console.log('❌ FAILED');
    }

    // Rate limit between writes
    await new Promise((r) => setTimeout(r, 1000));
  }

  // 5. Summary
  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│  SUMMARY                                               │');
  console.log('└─────────────────────────────────────────────────────────┘\n');

  const succeeded = results.filter((r) => r.signature);
  console.log(`  Written: ${succeeded.length}/${toWrite.length}`);
  console.log(`  Agent: ${agentId}`);
  
  if (succeeded.length > 0) {
    console.log('\n  TX Signatures:');
    for (const r of succeeded) {
      console.log(`    ${r.platform.padEnd(14)} ${r.signature}`);
    }
  }

  if (succeeded.length < toWrite.length) {
    const failed = toWrite.filter((p) => !succeeded.find((r) => r.platform === p));
    console.log(`\n  ❌ Failed: ${failed.join(', ')}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
}

// ── Main ────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
  const dryRun = flags.includes('--dry-run');
  const writeAll = flags.includes('--all');
  const listMode = flags.includes('--list');

  if (listMode) {
    return listAll();
  }

  if (args.length === 0) {
    console.error('Usage:');
    console.error('  node batch-attest.js <agent_id>           # Write missing attestation memos');
    console.error('  node batch-attest.js <agent_id> --dry-run # Check only');
    console.error('  node batch-attest.js <agent_id> --all     # Write all (even existing)');
    console.error('  node batch-attest.js --list               # Status of all agents');
    console.error('');
    console.error('Example: node batch-attest.js agent_brainkid');
    process.exit(1);
  }

  const agentId = args[0];
  await processAgent(agentId, dryRun, writeAll);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
