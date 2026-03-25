#!/usr/bin/env node
/**
 * Score-Sync PM2 Cron Wrapper
 * 
 * Runs score-sync comparison every 6 hours via PM2 cron.
 * Only logs when scores actually change (no spam).
 * Writes to ~/clawd-brainchain/logs/score-sync.log
 * 
 * PM2 setup:
 *   pm2 start tools/score-sync-cron.js --name score-sync --cron-restart "0 *​/6 * * *" --no-autorestart
 * 
 * brainChain — 2026-03-25
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED';
const GENESIS_PROGRAM = new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');
const DB_PATH = process.env.DB_PATH || '/home/ubuntu/agentfolio/data/agentfolio.db';
const LOG_DIR = process.env.LOG_DIR || '/home/ubuntu/clawd-brainchain/logs';
const LOG_FILE = path.join(LOG_DIR, 'score-sync.log');
const LAST_STATE_FILE = path.join(LOG_DIR, '.score-sync-state.json');

const AGENTS = [
  'agent_brainkid',
  'agent_braingrowth',
  'agent_braintrade',
  'agent_brainchain',
  'agent_brainforge',
  'agent_suppi',
  'agent_aremes',
];

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
    readString(); // description
    readString(); // category
    readVecString(); // capabilities
    readString(); // metadataUri
    readString(); // faceImage
    offset += 32; // faceMint
    readString(); // faceBurnTx
    offset += 8; // genesisRecord
    const authority = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    const hasPending = data[offset];
    offset += 1;
    if (hasPending === 1) offset += 32;
    const reputationScore = Number(data.readBigUInt64LE(offset));
    offset += 8;
    const verificationLevel = data[offset];

    return { agentName, authority: authority.toBase58(), reputationScore, verificationLevel };
  } catch (e) {
    return null;
  }
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

function loadLastState() {
  try {
    return JSON.parse(fs.readFileSync(LAST_STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveLastState(state) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(LAST_STATE_FILE, JSON.stringify(state, null, 2));
  } catch {}
}

// ── Main ────────────────────────────────────────────────
async function main() {
  const conn = new Connection(RPC_URL, 'confirmed');
  const lastState = loadLastState();

  // Fetch all Genesis Records
  const pdas = AGENTS.map(id => getGenesisPDA(id));
  let accounts;
  try {
    accounts = await conn.getMultipleAccountsInfo(pdas);
  } catch (e) {
    log(`ERROR: RPC fetch failed — ${e.message}`);
    process.exit(1);
  }

  const currentState = {};
  const changes = [];
  let allOk = true;

  for (let i = 0; i < AGENTS.length; i++) {
    const agentId = AGENTS[i];
    const acct = accounts[i];

    if (!acct || !acct.data) {
      log(`WARN: ${agentId} — no Genesis Record on-chain`);
      allOk = false;
      continue;
    }

    const parsed = parseGenesisRecord(Buffer.from(acct.data));
    if (!parsed) {
      log(`WARN: ${agentId} — parse error`);
      allOk = false;
      continue;
    }

    currentState[agentId] = {
      score: parsed.reputationScore,
      level: parsed.verificationLevel,
    };

    // Compare with last known state
    const prev = lastState[agentId];
    if (prev) {
      if (prev.score !== parsed.reputationScore || prev.level !== parsed.verificationLevel) {
        changes.push({
          agentId,
          oldScore: prev.score,
          newScore: parsed.reputationScore,
          oldLevel: prev.level,
          newLevel: parsed.verificationLevel,
        });
      }
    } else {
      // First time seeing this agent — count as change for initial log
      changes.push({
        agentId,
        oldScore: null,
        newScore: parsed.reputationScore,
        oldLevel: null,
        newLevel: parsed.verificationLevel,
        firstSeen: true,
      });
    }
  }

  // Also check attestation counts from DB
  let attestationCounts = {};
  try {
    const Database = require('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare(`
      SELECT profile_id, COUNT(DISTINCT platform) as count
      FROM attestations
      GROUP BY profile_id
    `).all();
    for (const r of rows) attestationCounts[r.profile_id] = r.count;
    db.close();
  } catch {}

  // Only log if something changed
  if (changes.length > 0) {
    log('═══ SCORE CHANGES DETECTED ═══');
    for (const c of changes) {
      if (c.firstSeen) {
        log(`  NEW: ${c.agentId} → score=${c.newScore}, level=L${c.newLevel}`);
      } else {
        const scoreDelta = c.newScore - c.oldScore;
        const levelDelta = c.newLevel - c.oldLevel;
        log(`  CHANGED: ${c.agentId} → score=${c.oldScore}→${c.newScore} (${scoreDelta > 0 ? '+' : ''}${scoreDelta}), level=L${c.oldLevel}→L${c.newLevel} (${levelDelta > 0 ? '+' : ''}${levelDelta})`);
      }
    }
    log(`  Total: ${changes.length} changes across ${AGENTS.length} agents`);
  } else {
    // Single silent line — no spam
    log(`SYNC OK — ${AGENTS.length} agents checked, no changes`);
  }

  // Save current state for next comparison
  saveLastState(currentState);

  // Verify score-to-attestation alignment (warning only)
  for (const agentId of AGENTS) {
    const state = currentState[agentId];
    const attCount = attestationCounts[agentId] || 0;
    if (state && state.level === 1 && attCount >= 2) {
      log(`  WARN: ${agentId} has ${attCount} attestations but still L1 — may need level update`);
    }
  }

  process.exit(0);
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
