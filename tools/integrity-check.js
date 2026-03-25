#!/usr/bin/env node
/**
 * Genesis Record Integrity Checker
 * 
 * Validates on-chain Genesis Records against explorer API for all team agents.
 * Catches any drift between on-chain state and API-served data.
 * 
 * Usage:
 *   node integrity-check.js
 *   node integrity-check.js --json
 *   node integrity-check.js agent_brainkid   # Single agent
 * 
 * brainChain — 2026-03-25
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const crypto = require('crypto');

// ── Config ──────────────────────────────────────────────
const API_BASE = process.env.AGENTFOLIO_API || 'https://agentfolio.bot';
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const GENESIS_PROGRAM = new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');

const TEAM_AGENTS = [
  'agent_brainkid',
  'agent_braingrowth',
  'agent_braintrade',
  'agent_brainchain',
  'agent_brainforge',
  'agent_suppi',
  'agent_aremes',
  'braintest',
];

const LEVEL_LABELS = ['Unverified', 'Registered', 'Verified', 'Established', 'Trusted', 'Sovereign'];

// ── Helpers ─────────────────────────────────────────────
function agentIdHash(agentId) {
  return crypto.createHash('sha256').update(agentId).digest();
}

function getGenesisPDA(agentId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('genesis'), agentIdHash(agentId)],
    GENESIS_PROGRAM
  )[0];
}

function parseGenesisRecord(data) {
  if (!data || data.length < 8) return null;
  try {
    let offset = 8;
    offset += 32; // agent_id_hash

    const readString = () => {
      const len = data.readUInt32LE(offset);
      offset += 4;
      const str = data.slice(offset, offset + len).toString('utf8');
      offset += len;
      return str;
    };
    const readVecString = () => {
      const count = data.readUInt32LE(offset);
      offset += 4;
      const arr = [];
      for (let i = 0; i < count; i++) arr.push(readString());
      return arr;
    };

    const agentName = readString();
    const description = readString();
    const category = readString();
    const capabilities = readVecString();
    const metadataUri = readString();
    const faceImage = readString();
    const faceMint = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    const faceBurnTx = readString();
    const genesisRecord = Number(data.readBigInt64LE(offset));
    offset += 8;
    const authority = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    const hasPending = data[offset];
    offset += 1;
    let pendingAuthority = null;
    if (hasPending === 1) {
      pendingAuthority = new PublicKey(data.slice(offset, offset + 32)).toBase58();
      offset += 32;
    }
    const reputationScore = Number(data.readBigUInt64LE(offset));
    offset += 8;
    const verificationLevel = data[offset];

    return {
      agentName,
      description,
      authority: authority.toBase58(),
      pendingAuthority,
      reputationScore,
      verificationLevel,
      verificationLabel: LEVEL_LABELS[verificationLevel] || 'Unknown',
      isBorn: genesisRecord > 0,
      bornAt: genesisRecord > 0 ? new Date(genesisRecord * 1000).toISOString() : null,
      faceImage: faceImage || null,
      faceMint: faceMint.toBase58() === '11111111111111111111111111111111' ? null : faceMint.toBase58(),
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function fetchAPI(path) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

// ── Comparison Logic ────────────────────────────────────
function compareField(name, onChain, api, strict = true) {
  const match = strict ? (onChain === api) : (String(onChain) === String(api));
  return { field: name, onChain, api, match };
}

async function auditAgent(conn, agentId) {
  const pda = getGenesisPDA(agentId);
  const result = {
    agentId,
    pda: pda.toBase58(),
    hasGenesisRecord: false,
    hasExplorerData: false,
    checks: [],
    pass: true,
    errors: [],
  };

  // 1. Fetch on-chain Genesis Record
  let genesis = null;
  try {
    const acctInfo = await conn.getAccountInfo(pda);
    if (acctInfo && acctInfo.data) {
      genesis = parseGenesisRecord(Buffer.from(acctInfo.data));
      if (genesis && !genesis.error) {
        result.hasGenesisRecord = true;
      } else {
        result.errors.push(`Genesis parse error: ${genesis?.error || 'unknown'}`);
        genesis = null;
      }
    }
  } catch (e) {
    result.errors.push(`RPC error: ${e.message}`);
  }

  if (!genesis) {
    result.pass = false;
    result.checks.push({ field: 'Genesis Record', onChain: 'MISSING', api: 'N/A', match: false });
    return result;
  }

  // 2. Fetch explorer API data
  let explorer = null;
  try {
    explorer = await fetchAPI(`/api/explorer/${agentId}`);
    if (explorer) result.hasExplorerData = true;
  } catch (e) {
    result.errors.push(`Explorer API error: ${e.message}`);
  }

  // 3. Fetch trust credential for score cross-check
  let credential = null;
  try {
    const credResult = await fetchAPI(`/api/trust-credential/${agentId}`);
    credential = credResult?.decoded?.credentialSubject || null;
  } catch (e) {
    // Trust credential optional
  }

  if (!explorer) {
    result.pass = false;
    result.checks.push({ field: 'Explorer API', onChain: 'available', api: 'MISSING', match: false });
    return result;
  }

  // 4. Run field comparisons
  const v3 = explorer.v3 || {};

  // Score: on-chain vs explorer trustScore vs explorer v3.reputationScore
  result.checks.push(compareField(
    'Trust Score',
    genesis.reputationScore,
    explorer.trustScore
  ));
  
  result.checks.push(compareField(
    'V3 Reputation Score',
    genesis.reputationScore,
    v3.reputationScore
  ));

  // Verification level
  result.checks.push(compareField(
    'Verification Level',
    genesis.verificationLevel,
    v3.verificationLevel
  ));

  // Verification label
  result.checks.push(compareField(
    'Verification Label',
    genesis.verificationLabel,
    v3.verificationLabel,
    false // case-insensitive compare
  ));

  // Authority (on-chain authority vs explorer wallets.solana)
  // If pending authority transfer exists, the API may show intended wallet
  const explorerWallet = explorer.wallets?.solana || null;
  if (explorerWallet) {
    const authorityMatch = genesis.authority === explorerWallet;
    const pendingMatch = genesis.pendingAuthority === explorerWallet;
    result.checks.push({
      field: 'Authority/Wallet',
      onChain: genesis.authority,
      api: explorerWallet,
      match: authorityMatch || pendingMatch,
      note: pendingMatch && !authorityMatch ? 'Pending transfer → API shows intended wallet' : undefined,
    });
  }

  // Born status
  result.checks.push(compareField(
    'Born (Soulbound)',
    genesis.isBorn,
    v3.isBorn
  ));

  // Face image presence
  const chainHasFace = !!genesis.faceImage;
  const apiHasFace = !!v3.faceImage;
  result.checks.push(compareField(
    'Face Image',
    chainHasFace ? 'present' : 'none',
    apiHasFace ? 'present' : 'none'
  ));

  // Face mint — normalize system program address (11111...) to null/none
  const SYSTEM_PROGRAM = '11111111111111111111111111111111';
  const chainFaceMint = genesis.faceMint || null;
  const apiFaceMint = (v3.faceMint && v3.faceMint !== SYSTEM_PROGRAM) ? v3.faceMint : null;
  if (chainFaceMint || apiFaceMint) {
    result.checks.push(compareField(
      'Face Mint',
      chainFaceMint || 'none',
      apiFaceMint || 'none'
    ));
  }

  // Trust credential cross-check
  if (credential) {
    result.checks.push(compareField(
      'Credential Score',
      genesis.reputationScore,
      credential.trustScore
    ));
    result.checks.push(compareField(
      'Credential Tier',
      genesis.verificationLabel.toUpperCase(),
      credential.tier
    ));
    result.checks.push(compareField(
      'Credential onChainRegistered',
      true,
      credential.onChainRegistered
    ));
  }

  // On-chain registered flag
  // Note: explorer's onChainRegistered may be false if agent registered via V3 only
  // (not V2 identity program). The Genesis Record existing IS the proof of on-chain registration.
  const explorerOnChain = explorer.onChainRegistered;
  result.checks.push({
    field: 'On-Chain Registered',
    onChain: true,
    api: explorerOnChain,
    match: explorerOnChain === true,
    severity: explorerOnChain === false ? 'warning' : undefined,
    note: explorerOnChain === false ? 'Explorer shows false but Genesis Record exists — API field needs fixing' : undefined,
  });

  // Pending authority (info only, not a pass/fail)
  if (genesis.pendingAuthority) {
    result.checks.push({
      field: 'Pending Authority Transfer',
      onChain: genesis.pendingAuthority,
      api: 'N/A',
      match: true, // informational
      info: true,
    });
  }

  // Determine overall pass/fail (warnings don't cause failure)
  result.pass = result.checks.every(c => c.match || c.severity === 'warning');
  result.warnings = result.checks.filter(c => !c.match && c.severity === 'warning').length;

  return result;
}

// ── Main ────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
  const jsonOutput = flags.includes('--json');

  const agents = args.length > 0 ? args : TEAM_AGENTS;
  const conn = new Connection(RPC_URL, 'confirmed');

  if (!jsonOutput) {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('  GENESIS RECORD INTEGRITY CHECK');
    console.log(`  Time: ${new Date().toISOString()}`);
    console.log(`  Agents: ${agents.length}`);
    console.log(`  RPC: ${RPC_URL.replace(/api-key=[^&]+/, 'api-key=***')}`);
    console.log(`  API: ${API_BASE}`);
    console.log('═══════════════════════════════════════════════════════════════════\n');
  }

  // Batch fetch all Genesis Records
  const pdas = agents.map(id => getGenesisPDA(id));
  let accounts;
  try {
    accounts = await conn.getMultipleAccountsInfo(pdas);
  } catch (e) {
    console.error(`FATAL: RPC batch fetch failed: ${e.message}`);
    process.exit(1);
  }

  const results = [];
  let totalPass = 0;
  let totalFail = 0;

  for (let i = 0; i < agents.length; i++) {
    const agentId = agents[i];

    if (!jsonOutput) {
      console.log(`┌─────────────────────────────────────────────────────────────────┐`);
      console.log(`│  ${agentId.padEnd(62)}│`);
      console.log(`└─────────────────────────────────────────────────────────────────┘`);
    }

    const result = await auditAgent(conn, agentId);
    results.push(result);

    if (result.pass) totalPass++;
    else totalFail++;

    if (!jsonOutput) {
      if (!result.hasGenesisRecord) {
        console.log(`  ❌ NO GENESIS RECORD ON CHAIN\n`);
        continue;
      }

      for (const check of result.checks) {
        const icon = check.match ? '✅' : (check.severity === 'warning' ? '⚠️ ' : '❌');
        const info = check.info ? ' ℹ️' : '';
        console.log(`  ${icon} ${check.field.padEnd(28)} chain=${String(check.onChain).padEnd(18)} api=${String(check.api)}${info}`);
        if (check.note) {
          console.log(`     ↳ ${check.note}`);
        }
      }

      if (result.errors.length > 0) {
        for (const err of result.errors) {
          console.log(`  ⚠️  ${err}`);
        }
      }

      const warnings = result.warnings || 0;
      const status = result.pass 
        ? (warnings > 0 ? `✅ PASS (${warnings} warning${warnings > 1 ? 's' : ''})` : '✅ PASS')
        : '❌ FAIL';
      console.log(`\n  Result: ${status}\n`);
    }

    // Small delay to avoid API rate limits
    await new Promise(r => setTimeout(r, 200));
  }

  // Summary
  if (jsonOutput) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      agents: results,
      summary: {
        total: agents.length,
        pass: totalPass,
        fail: totalFail,
        integrity: totalFail === 0 ? 'CLEAN' : 'DRIFT_DETECTED',
      },
    }, null, 2));
  } else {
    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('  SUMMARY');
    console.log(`  Total:   ${agents.length} agents`);
    console.log(`  Pass:    ${totalPass} ✅`);
    console.log(`  Fail:    ${totalFail} ❌`);
    console.log(`  Status:  ${totalFail === 0 ? '✅ ALL CLEAN — no drift detected' : '❌ DRIFT DETECTED — see failures above'}`);
    console.log('═══════════════════════════════════════════════════════════════════');
  }
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
