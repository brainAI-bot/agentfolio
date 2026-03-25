#!/usr/bin/env node
/**
 * Score Sync — On-Chain Score Refresh Tool
 * 
 * Compares V3 on-chain Genesis Record scores against computed "expected" scores
 * from attestation data. If any differ by >10 points, updates on-chain.
 * 
 * Usage:
 *   node score-sync.js                  # Dry run — compare only
 *   node score-sync.js --write          # Actually update on-chain scores
 *   node score-sync.js --write --force  # Update even if diff <= 10
 * 
 * Requires: run on prod (13.53.199.22) where authority keys + DB are available
 * 
 * brainChain — 2026-03-25
 */

const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY';
const GENESIS_PROGRAM = new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');
const DB_PATH = process.env.DB_PATH || '/home/ubuntu/agentfolio/data/agentfolio.db';
const THRESHOLD = 10; // Points difference to trigger update

// ── Score History DB ────────────────────────────────────
const TIER_LABELS = ["UNVERIFIED","REGISTERED","VERIFIED","ESTABLISHED","TRUSTED","SOVEREIGN"];
function recordScoreHistory(agentId, score, tier, breakdown, reason) {
  try {
    const Database = require("better-sqlite3");
    const db = new Database(DB_PATH);
    db.prepare("INSERT INTO score_history (agent_id, score, tier, breakdown, reason) VALUES (?, ?, ?, ?, ?)").run(
      agentId, score, tier || "", typeof breakdown === "string" ? breakdown : JSON.stringify(breakdown || {}), reason || "score_sync"
    );
    db.close();
    console.log("  📝 [ScoreHistory] Recorded: " + agentId + " score=" + score + " tier=" + tier);
  } catch (e) { console.error("  ⚠️  [ScoreHistory] Write error:", e.message); }
}


// Available authority keypairs on prod
const AUTHORITY_KEYS = {
  'JAbcYnKy4p2c5SYV3bHu14VtD6EDDpzj44uGYW8BMud4': '/home/ubuntu/.config/solana/brainforge-personal.json',
  'Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc': '/home/ubuntu/.config/solana/mainnet-deployer.json',
};

// Known agents
const AGENTS = [
  'agent_brainkid',
  'agent_braingrowth',
  'agent_braintrade',
  'agent_brainchain',
  'agent_brainforge',
  'agent_suppi',
  'agent_aremes',
  'agent_braintest',
];

// Verification categories (matching scoring-v2.js)
const VERIFICATION_CATEGORIES = {
  wallets: ['solana', 'ethereum', 'hyperliquid', 'polymarket', 'bitcoin'],
  platforms: ['agentmail', 'moltbook', 'github', 'x', 'discord', 'telegram', 'farcaster'],
  infrastructure: ['domain', 'mcp', 'a2a', 'website', 'openclaw', 'did'],
  onchain: ['satp', 'ens', 'eas'],
};

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
    offset += 32; // faceMint
    const faceBurnTx = readString();
    const genesisRecord = Number(data.readBigInt64LE(offset));
    offset += 8;
    const authority = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    const hasPending = data[offset];
    offset += 1;
    if (hasPending === 1) offset += 32;
    const reputationScore = Number(data.readBigUInt64LE(offset));
    offset += 8;
    const verificationLevel = data[offset];
    offset += 1;

    return {
      agentName,
      authority: authority.toBase58(),
      reputationScore,
      verificationLevel,
      isBorn: genesisRecord > 0,
      faceImage: !!faceImage,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Compute expected verification level from attestation count + categories
 */
function computeExpectedLevel(platforms, profileData) {
  const categoryCounts = {};
  for (const platform of platforms) {
    for (const [category, types] of Object.entries(VERIFICATION_CATEGORIES)) {
      if (types.includes(platform)) {
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
        break;
      }
    }
  }
  const categoryCount = Object.keys(categoryCounts).length;
  const totalVerifications = platforms.length;

  const profileComplete = profileData && profileData.bio && profileData.bio.length >= 50 &&
    profileData.avatar && profileData.skills && profileData.skills.length >= 3;
  
  const hasJobs = profileData?.completedJobs > 0;
  const hasReviews = profileData?.reviewCount >= 1;
  const has3Reviews = profileData?.reviewCount >= 3;
  const hasBurn = profileData?.burnedAvatar;
  const hasHuman = platforms.includes('github') || platforms.includes('x');

  if (totalVerifications >= 5 && categoryCount >= 2 && profileComplete &&
      hasJobs && has3Reviews && hasBurn && hasHuman) {
    return 5; // Sovereign
  }
  if (totalVerifications >= 5 && categoryCount >= 2 && profileComplete &&
      hasJobs && hasReviews) {
    return 4; // Trusted
  }
  if (totalVerifications >= 5 && categoryCount >= 2 && profileComplete) {
    return 3; // Established
  }
  if (totalVerifications >= 2) {
    return 2; // Verified
  }
  if (totalVerifications >= 0) {
    return 1; // Registered
  }
  return 0;
}

/**
 * Compute expected reputation score from profile data + verifications
 * Simplified version of scoring-v2.js calculateTrustScore
 */
function computeExpectedScore(platforms, profileData) {
  let score = 0;

  // Profile completeness (max 30)
  if (profileData) {
    if (profileData.bio && profileData.bio.length >= 50) score += 5;
    if (profileData.avatar) score += 5;
    if (profileData.skills && profileData.skills.length >= 3) score += 5;
    if (profileData.handle) score += 5;
    score += Math.min((profileData.portfolioCount || 0), 2) * 5;
  }

  // On-chain (SATP registration = 10)
  if (platforms.includes('satp')) score += 10;

  // Tenure based on account age
  if (profileData?.accountAgeDays) {
    const days = profileData.accountAgeDays;
    if (days >= 365) score += 170;
    else if (days >= 180) score += 120;
    else if (days >= 90) score += 70;
    else if (days >= 30) score += 40;
    else if (days >= 7) score += 10;
  }

  // Per-verification score bump
  // Each attestation adds ~25 pts (based on chain-cache scoring logic)
  score += platforms.length * 25;

  return Math.min(score, 800);
}

// ── Build update TX ─────────────────────────────────────
function buildUpdateReputationIx(authority, agentId, newScore) {
  const authKey = new PublicKey(authority);
  const hashBuf = agentIdHash(agentId);
  const [genesisPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('genesis'), hashBuf],
    GENESIS_PROGRAM
  );

  const disc = crypto.createHash('sha256')
    .update('global:update_reputation')
    .digest().slice(0, 8);

  const scoreBuf = Buffer.alloc(8);
  scoreBuf.writeBigUInt64LE(BigInt(newScore));
  const data = Buffer.concat([disc, scoreBuf]);

  const { TransactionInstruction } = require('@solana/web3.js');
  return new TransactionInstruction({
    programId: GENESIS_PROGRAM,
    keys: [
      { pubkey: genesisPda, isSigner: false, isWritable: true },
      { pubkey: authKey, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function buildUpdateVerificationIx(authority, agentId, newLevel) {
  const authKey = new PublicKey(authority);
  const hashBuf = agentIdHash(agentId);
  const [genesisPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('genesis'), hashBuf],
    GENESIS_PROGRAM
  );

  const disc = crypto.createHash('sha256')
    .update('global:update_verification')
    .digest().slice(0, 8);

  const data = Buffer.concat([disc, Buffer.from([newLevel])]);

  const { TransactionInstruction } = require('@solana/web3.js');
  return new TransactionInstruction({
    programId: GENESIS_PROGRAM,
    keys: [
      { pubkey: genesisPda, isSigner: false, isWritable: true },
      { pubkey: authKey, isSigner: true, isWritable: false },
    ],
    data,
  });
}

// ── Main ────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const doWrite = args.includes('--write');
  const forceAll = args.includes('--force');

  const conn = new Connection(RPC_URL, 'confirmed');

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SCORE SYNC — On-Chain Score Refresh');
  console.log(`  Mode: ${doWrite ? '🔴 LIVE WRITE' : '🟢 DRY RUN (comparison only)'}`);
  console.log(`  Threshold: ${forceAll ? 'FORCE ALL' : `>${THRESHOLD} point difference`}`);
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // ── 1. Fetch on-chain Genesis Records ────────────────
  console.log('[1/4] Fetching on-chain Genesis Records...');
  const pdas = AGENTS.map(id => getGenesisPDA(id));
  const accounts = await conn.getMultipleAccountsInfo(pdas);

  const onChainData = {};
  for (let i = 0; i < AGENTS.length; i++) {
    const acct = accounts[i];
    if (acct && acct.data) {
      const parsed = parseGenesisRecord(Buffer.from(acct.data));
      if (parsed) {
        onChainData[AGENTS[i]] = parsed;
      }
    }
  }
  console.log(`  Found ${Object.keys(onChainData).length} Genesis Records on-chain\n`);

  // ── 2. Fetch attestation data from DB ────────────────
  console.log('[2/4] Fetching attestation data from DB...');
  let attestationData = {};
  let profileData = {};

  try {
    const Database = require('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });

    // Get attestation platforms per agent (all time — no date filter)
    const atts = db.prepare(`
      SELECT profile_id, GROUP_CONCAT(DISTINCT platform) as platforms, COUNT(DISTINCT platform) as count
      FROM attestations
      GROUP BY profile_id
    `).all();

    for (const row of atts) {
      attestationData[row.profile_id] = {
        platforms: row.platforms.split(','),
        count: row.count,
      };
    }

    // Get profile data for scoring
    const profiles = db.prepare('SELECT id, name, bio, avatar, skills, handle, portfolio, created_at FROM profiles').all();
    for (const p of profiles) {
      let skills = [];
      let portfolioCount = 0;
      try { skills = JSON.parse(p.skills || '[]'); } catch {}
      try { portfolioCount = JSON.parse(p.portfolio || '[]').length; } catch {}

      profileData[p.id] = {
        name: p.name,
        bio: p.bio,
        avatar: p.avatar,
        skills,
        handle: p.handle,
        portfolioCount,
        accountAgeDays: p.created_at ? Math.floor((Date.now() - new Date(p.created_at)) / (1000 * 60 * 60 * 24)) : 0,
        // These require checking reviews table — simplified for now
        completedJobs: 0,
        reviewCount: 0,
        burnedAvatar: false,
      };
    }

    // Check reviews if table exists
    try {
      const reviews = db.prepare(`
        SELECT target_agent_id, COUNT(*) as count 
        FROM reviews 
        GROUP BY target_agent_id
      `).all();
      for (const r of reviews) {
        if (profileData[r.target_agent_id]) {
          profileData[r.target_agent_id].reviewCount = r.count;
        }
      }
    } catch {}

    db.close();
    console.log(`  Found attestations for ${Object.keys(attestationData).length} agents\n`);
  } catch (e) {
    console.log(`  ⚠️  DB read failed: ${e.message}`);
    console.log(`  Falling back to on-chain-only comparison\n`);
  }

  // ── 3. Compare scores ────────────────────────────────
  console.log('[3/4] Comparing on-chain vs expected scores...\n');

  const levelLabels = ['Unverified', 'Registered', 'Verified', 'Established', 'Trusted', 'Sovereign'];
  const updates = [];

  for (const agentId of AGENTS) {
    const onChain = onChainData[agentId];
    if (!onChain) {
      console.log(`  ⏭️  ${agentId.padEnd(22)} — NO GENESIS RECORD (skipped)`);
      continue;
    }

    const atts = attestationData[agentId] || { platforms: [], count: 0 };
    const profile = profileData[agentId] || {};

    // Check if this agent has burn-to-become
    if (onChain.isBorn) profile.burnedAvatar = true;

    const expectedScore = computeExpectedScore(atts.platforms, profile);
    const expectedLevel = computeExpectedLevel(atts.platforms, profile);

    // Only flag upward drift — scores should never go DOWN
    // On-chain scores were deliberately set by audit; only update if new verifications push expected higher
    const scoreUp = expectedScore > onChain.reputationScore;
    const levelUp = expectedLevel > onChain.verificationLevel;
    const scoreDiff = expectedScore - onChain.reputationScore;

    const needsUpdate = forceAll || (scoreUp && scoreDiff > THRESHOLD) || levelUp;
    const canUpdate = !!AUTHORITY_KEYS[onChain.authority];

    let status;
    if (expectedScore < onChain.reputationScore) {
      status = '✅ OK (chain > computed — audit-set score preserved)';
    } else if (!needsUpdate) {
      status = '✅ OK';
    } else if (canUpdate) {
      status = '🔄 UPDATE';
    } else {
      status = '⚠️  STALE (no authority key on this server)';
    }

    console.log(`  ${status}`);
    console.log(`     ${agentId.padEnd(22)} chain=${onChain.reputationScore}/L${onChain.verificationLevel} computed=${expectedScore}/L${expectedLevel} diff=${scoreDiff > 0 ? '+' : ''}${scoreDiff}pts atts=[${atts.platforms.join(',')}]`);

    if (needsUpdate && canUpdate) {
      // Use max(current, expected) — never downgrade
      const newScore = Math.max(expectedScore, onChain.reputationScore);
      const newLevel = Math.max(expectedLevel, onChain.verificationLevel);
      updates.push({
        agentId,
        authority: onChain.authority,
        currentScore: onChain.reputationScore,
        currentLevel: onChain.verificationLevel,
        newScore,
        newLevel,
        scoreDiff: newScore - onChain.reputationScore,
      });
    }
  }

  // ── 4. Apply updates (if --write) ────────────────────
  console.log(`\n[4/4] Updates needed: ${updates.length}`);

  if (updates.length === 0) {
    console.log('  All scores are within threshold. Nothing to do.\n');
  } else if (!doWrite) {
    console.log('  DRY RUN — no changes written. Use --write to apply.\n');
    console.log('  Pending updates:');
    for (const u of updates) {
      console.log(`    ${u.agentId}: ${u.currentScore}→${u.newScore} (score), L${u.currentLevel}→L${u.newLevel} (level)`);
    }
  } else {
    console.log('  Writing updates to chain...\n');
    const { Transaction } = require('@solana/web3.js');
    const txResults = [];

    for (const u of updates) {
      try {
        const keyPath = AUTHORITY_KEYS[u.authority];
        const raw = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
        const signer = Keypair.fromSecretKey(Uint8Array.from(raw));

        // Update reputation score
        if (u.currentScore !== u.newScore) {
          const repIx = buildUpdateReputationIx(u.authority, u.agentId, u.newScore);
          const repTx = new Transaction().add(repIx);
          repTx.feePayer = signer.publicKey;
          repTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
          repTx.sign(signer);
          const repSig = await conn.sendRawTransaction(repTx.serialize());
          await conn.confirmTransaction(repSig, 'confirmed');
          console.log(`  ✅ ${u.agentId} reputation: ${u.currentScore}→${u.newScore} TX: ${repSig}`);
          txResults.push({ agentId: u.agentId, type: 'reputation', sig: repSig });
          // Record to score_history
          recordScoreHistory(u.agentId, u.newScore, TIER_LABELS[u.newLevel] || 'UNKNOWN', { reputationScore: u.newScore, verificationLevel: u.newLevel, prevScore: u.currentScore, txSig: repSig }, 'score_sync_chain_update');
          await new Promise(r => setTimeout(r, 1500)); // rate limit
        }

        // Update verification level
        if (u.currentLevel !== u.newLevel) {
          const verIx = buildUpdateVerificationIx(u.authority, u.agentId, u.newLevel);
          const verTx = new Transaction().add(verIx);
          verTx.feePayer = signer.publicKey;
          verTx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
          verTx.sign(signer);
          const verSig = await conn.sendRawTransaction(verTx.serialize());
          await conn.confirmTransaction(verSig, 'confirmed');
          console.log(`  ✅ ${u.agentId} verification: L${u.currentLevel}→L${u.newLevel} TX: ${verSig}`);
          txResults.push({ agentId: u.agentId, type: 'verification', sig: verSig });
          // Record level change to score_history
          if (u.currentScore === u.newScore) {
            recordScoreHistory(u.agentId, u.newScore, TIER_LABELS[u.newLevel] || 'UNKNOWN', { reputationScore: u.newScore, verificationLevel: u.newLevel, prevLevel: u.currentLevel, txSig: verSig }, 'score_sync_level_update');
          }
          await new Promise(r => setTimeout(r, 1500));
        }
      } catch (e) {
        console.error(`  ❌ ${u.agentId} FAILED: ${e.message}`);
        txResults.push({ agentId: u.agentId, type: 'error', error: e.message });
      }
    }

    // Summary
    console.log('\n  ── TX Summary ──');
    for (const r of txResults) {
      if (r.sig) {
        console.log(`  ${r.agentId} [${r.type}]: https://solscan.io/tx/${r.sig}`);
      } else {
        console.log(`  ${r.agentId} [${r.type}]: ERROR — ${r.error}`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  DONE');
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
