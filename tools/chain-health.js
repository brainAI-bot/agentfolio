#!/usr/bin/env node
/**
 * Chain-Cache Health Report
 * 
 * Diagnostic tool that shows:
 * 1. How many agents have Genesis Records on-chain
 * 2. How many have attestation memos
 * 3. Last sync timestamp
 * 4. Any agents in DB but NOT on-chain (integrity check)
 * 
 * Usage: node chain-health.js [--remote]
 *   --remote: Run against prod (13.53.199.22) via SSH
 *   (default): Run locally if agentfolio is available
 * 
 * brainChain — 2026-03-25
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const crypto = require('crypto');
const path = require('path');

// ── Config ──────────────────────────────────────────────
const GENESIS_PROGRAM = new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');
const SATP_IDENTITY_PROGRAM = new PublicKey('97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const API_BASE = process.env.API_BASE || 'https://agentfolio.bot';

// ── HTTP helper (no deps beyond Node built-ins) ─────────
async function fetchJSON(url) {
  const { default: fetch } = await import('node-fetch').catch(() => {
    // Fallback to Node 18+ built-in fetch
    return { default: globalThis.fetch };
  });
  const res = await fetch(url, { timeout: 15000 });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

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
    let offset = 8; // discriminator
    const agentIdHashBytes = data.slice(offset, offset + 32);
    offset += 32;

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
    offset += 1;

    const levelLabels = ['Unverified', 'Registered', 'Verified', 'Established', 'Trusted', 'Sovereign'];

    return {
      agentName,
      description: description.slice(0, 60),
      authority: authority.toBase58(),
      pendingAuthority,
      reputationScore,
      verificationLevel,
      verificationLabel: levelLabels[verificationLevel] || 'Unknown',
      isBorn: genesisRecord > 0,
      bornAt: genesisRecord > 0 ? new Date(genesisRecord * 1000).toISOString() : null,
      faceImage: faceImage ? '✅' : '❌',
      faceMint: faceMint.toBase58() === '11111111111111111111111111111111' ? null : faceMint.toBase58(),
      dataSize: data.length,
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ── Known agents (source of truth: DB profiles) ────────
const KNOWN_AGENTS = [
  'agent_brainkid',
  'agent_braingrowth',
  'agent_braintrade',
  'agent_brainchain',
  'agent_brainforge',
  'agent_suppi',
  'agent_aremes',
  'agent_braintest',
];

// ── Main ────────────────────────────────────────────────
async function main() {
  const conn = new Connection(RPC_URL, 'confirmed');
  const startTime = Date.now();

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  CHAIN-CACHE HEALTH REPORT');
  console.log(`  Generated: ${new Date().toISOString()}`);
  console.log(`  RPC: ${RPC_URL.replace(/api-key=[^&]+/, 'api-key=***')}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // ── 1. Genesis Records (V3 Program) ──────────────────
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│  1. GENESIS RECORDS (V3 — GTppU4E...)                  │');
  console.log('└─────────────────────────────────────────────────────────┘\n');

  const pdas = KNOWN_AGENTS.map(id => ({ agentId: id, pda: getGenesisPDA(id) }));
  const pdaKeys = pdas.map(p => p.pda);
  const accounts = await conn.getMultipleAccountsInfo(pdaKeys);

  let onChainCount = 0;
  let missingOnChain = [];
  let genesisDetails = [];

  for (let i = 0; i < accounts.length; i++) {
    const agentId = pdas[i].agentId;
    const pda = pdas[i].pda.toBase58();
    const acct = accounts[i];

    if (acct && acct.data) {
      const parsed = parseGenesisRecord(Buffer.from(acct.data));
      if (parsed && !parsed.error) {
        onChainCount++;
        genesisDetails.push({ agentId, pda, ...parsed });
        console.log(`  ✅ ${agentId.padEnd(20)} → L${parsed.verificationLevel}/${parsed.reputationScore} ${parsed.verificationLabel.padEnd(12)} auth=${parsed.authority.slice(0, 8)}... born=${parsed.isBorn ? '✅' : '❌'} face=${parsed.faceImage}`);
      } else {
        missingOnChain.push(agentId);
        console.log(`  ❌ ${agentId.padEnd(20)} → PARSE ERROR: ${parsed?.error || 'unknown'}`);
      }
    } else {
      missingOnChain.push(agentId);
      console.log(`  ❌ ${agentId.padEnd(20)} → NO GENESIS RECORD ON CHAIN`);
    }
  }

  console.log(`\n  Summary: ${onChainCount}/${KNOWN_AGENTS.length} agents have Genesis Records on-chain`);
  if (missingOnChain.length > 0) {
    console.log(`  ⚠️  Missing: ${missingOnChain.join(', ')}`);
  }

  // ── 2. Attestation Memos (via Explorer API) ───────────
  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│  2. ATTESTATION MEMOS (via Explorer API)               │');
  console.log('└─────────────────────────────────────────────────────────┘\n');

  let attestationStats = {};
  try {
    let totalVerifications = 0;
    const agentsWithNoAtts = [];

    for (const agentId of KNOWN_AGENTS) {
      try {
        const data = await fetchJSON(`${API_BASE}/api/explorer/${agentId}`);
        const verifs = (data.verifications || []).filter(v => v.verified !== false);
        const platforms = verifs.map(v => v.platform);
        
        if (platforms.length > 0) {
          attestationStats[agentId] = { count: platforms.length, platforms };
          totalVerifications += platforms.length;
          console.log(`  ${agentId.padEnd(22)} → ${platforms.length} verification(s): ${platforms.join(', ')}`);
        } else {
          agentsWithNoAtts.push(agentId);
        }
      } catch (e) {
        console.log(`  ${agentId.padEnd(22)} → ⚠️  API error: ${e.message}`);
      }
    }

    if (agentsWithNoAtts.length > 0) {
      console.log(`\n  ⚠️  No verifications: ${agentsWithNoAtts.join(', ')}`);
    }

    console.log(`\n  Summary: ${Object.keys(attestationStats).length}/${KNOWN_AGENTS.length} agents with ${totalVerifications} total verifications`);
  } catch (e) {
    console.log(`  ⚠️  Could not fetch attestation data: ${e.message}`);
  }

  // ── 3. V2 Identity Registry ──────────────────────────
  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│  3. V2 IDENTITY REGISTRY (97yL33...)                   │');
  console.log('└─────────────────────────────────────────────────────────┘\n');

  try {
    const v2Accounts = await conn.getProgramAccounts(SATP_IDENTITY_PROGRAM, {
      encoding: 'base64',
    });
    console.log(`  Total V2 identity accounts: ${v2Accounts.length}`);
    
    // Parse names from V2 accounts
    let v2Names = [];
    for (const { pubkey, account } of v2Accounts) {
      try {
        const data = Buffer.isBuffer(account.data) ? account.data : Buffer.from(account.data[0], 'base64');
        if (data.length > 44) {
          const nameLen = data.readUInt32LE(40);
          if (nameLen > 0 && nameLen < 200 && data.length >= 44 + nameLen) {
            const name = data.toString('utf8', 44, 44 + nameLen).replace(/\0/g, '').trim();
            if (name) v2Names.push(name);
          }
        }
      } catch {}
    }
    if (v2Names.length > 0) {
      console.log(`  Named accounts: ${v2Names.join(', ')}`);
    }
  } catch (e) {
    console.log(`  ⚠️  V2 registry fetch failed: ${e.message}`);
  }

  // ── 4. DB vs On-Chain Integrity (via API) ─────────────
  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│  4. INTEGRITY CHECK (API profiles ↔ Chain)             │');
  console.log('└─────────────────────────────────────────────────────────┘\n');

  try {
    const profilesData = await fetchJSON(`${API_BASE}/api/profiles?limit=200`);
    const dbProfiles = Array.isArray(profilesData) ? profilesData : (profilesData.profiles || profilesData.data || []);
    console.log(`  API profiles: ${dbProfiles.length}`);
    
    // Build set of agent names from Genesis Records on-chain
    const onChainNames = new Set(genesisDetails.map(g => g.agentName.toLowerCase().replace(/[^a-z0-9]/g, '')));

    let inDbNotOnChain = [];
    let inDbWithOnChain = [];

    for (const profile of dbProfiles) {
      const id = profile.id || profile.agentId || '';
      const name = profile.name || '';
      const cleanId = id.replace('agent_', '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      
      const hasGenesis = onChainNames.has(cleanId) || onChainNames.has(cleanName);
      
      if (hasGenesis) {
        inDbWithOnChain.push(id);
      } else {
        inDbNotOnChain.push(id);
      }
    }

    if (inDbNotOnChain.length > 0) {
      console.log(`\n  ⚠️  In DB but NOT on-chain (${inDbNotOnChain.length}):`);
      for (const id of inDbNotOnChain) {
        console.log(`     - ${id}`);
      }
    }
    
    if (inDbWithOnChain.length > 0) {
      console.log(`\n  ✅ In DB AND on-chain (${inDbWithOnChain.length}):`);
      for (const id of inDbWithOnChain) {
        console.log(`     - ${id}`);
      }
    }
  } catch (e) {
    console.log(`  ⚠️  Could not fetch profiles for integrity check: ${e.message}`);
  }

  // ── 5. Platform Health ───────────────────────────────
  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│  5. PLATFORM HEALTH                                    │');
  console.log('└─────────────────────────────────────────────────────────┘\n');

  try {
    const startPing = Date.now();
    await fetchJSON(`${API_BASE}/api/profiles`);
    const latency = Date.now() - startPing;
    console.log(`  ✅ API responding (${latency}ms)`);
    console.log(`  Base URL: ${API_BASE}`);
    
    // Check explorer endpoint
    const explorerStart = Date.now();
    const explorerData = await fetchJSON(`${API_BASE}/api/satp/explorer/agents`);
    const explorerLatency = Date.now() - explorerStart;
    const agentCount = Array.isArray(explorerData) ? explorerData.length : (explorerData.agents?.length || 0);
    console.log(`  ✅ Explorer API responding (${explorerLatency}ms) — ${agentCount} agents`);
  } catch (e) {
    console.log(`  ❌ Platform unhealthy: ${e.message}`);
  }

  // ── Summary ──────────────────────────────────────────
  const elapsed = Date.now() - startTime;
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  SUMMARY`);
  console.log(`  Genesis Records on-chain: ${onChainCount}/${KNOWN_AGENTS.length}`);
  console.log(`  Missing on-chain: ${missingOnChain.length > 0 ? missingOnChain.join(', ') : 'none'}`);
  console.log(`  Report generated in ${elapsed}ms`);
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
