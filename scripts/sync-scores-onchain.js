#!/usr/bin/env node
/**
 * sync-scores-onchain.js
 * 
 * Calculates Trust Score v2 + Verification Level for all agents with genesis records,
 * then writes both to SATP on-chain. This makes SATP the single source of truth.
 * 
 * Run: node sync-scores-onchain.js [--dry-run] [--agent agent_id]
 * 
 * Trust Score v2 formula (max 800):
 *   Profile Completeness: 30 (bio 10 + avatar 5 + skills 10 + links 5)
 *   Social Proof: 200 (endorsements, reviews, ratings)
 *   Marketplace: 300 (jobs completed, earnings)
 *   On-Chain: 100 (SATP genesis 40 + wallet verifications 30 + on-chain activity 30)
 *   Tenure: 170 (age-based, 1pt/day up to 170)
 * 
 * Verification Level:
 *   L0 = no verifications
 *   L1 = 1+ verification
 *   L2 = 2+ verifications
 *   L3 = 5+ verifications AND 2+ categories
 *   L4 = 8+ verifications AND 3+ categories
 *   L5 = sovereign (manual only)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'agentfolio', '.env') });

const fs = require('fs');
const path = require('path');
const { Keypair } = require('@solana/web3.js');
const { createSATPClient, agentIdHash } = require('/home/ubuntu/agentfolio/src/satp-client/src');

const PROFILES_DIR = '/home/ubuntu/agentfolio/data/profiles';
const DB_PATH = '/home/ubuntu/agentfolio/data/agentfolio.db';
const PLATFORM_KEYPAIR_PATH = process.env.SATP_PLATFORM_KEYPAIR || '/home/ubuntu/.config/solana/brainforge-personal.json';

const DRY_RUN = process.argv.includes('--dry-run');
const SINGLE_AGENT = process.argv.find(a => a.startsWith('--agent='))?.split('=')[1] || 
                     (process.argv.indexOf('--agent') >= 0 ? process.argv[process.argv.indexOf('--agent') + 1] : null);

const CATEGORY_MAP = {
  solana: 'wallets', ethereum: 'wallets', hyperliquid: 'wallets', polymarket: 'wallets',
  moltbook: 'platforms', agentmail: 'platforms', github: 'platforms', x: 'platforms',
  twitter: 'platforms', discord: 'platforms', telegram: 'platforms',
  domain: 'infrastructure', mcp: 'infrastructure', a2a: 'infrastructure', website: 'infrastructure',
  satp: 'onchain',
};

function calcTrustScoreV2(profile, verifications) {
  let score = 0;

  // === Profile Completeness (max 30) ===
  if (profile.bio && profile.bio.length > 20) score += 10;
  if (profile.avatar) score += 5;
  const skills = profile.skills || [];
  if (skills.length >= 3) score += 10;
  else if (skills.length >= 1) score += 5;
  const links = profile.links || {};
  if (links.x || links.github || links.moltbook || links.discord) score += 5;

  // === Social Proof (max 200) ===
  const endorsements = profile.endorsements || [];
  score += Math.min(50, endorsements.length * 10);
  const reviews = profile.reviews || [];
  score += Math.min(80, reviews.length * 20);
  const rating = profile.stats?.rating || 0;
  score += Math.min(70, rating * 14);

  // === Marketplace (max 300) ===
  const jobs = profile.stats?.jobsCompleted || 0;
  score += Math.min(200, jobs * 40);
  // Earnings placeholder (not tracked yet)
  score += Math.min(100, jobs * 20);

  // === On-Chain (max 100) ===
  const vd = profile.verificationData || {};
  if (vd.satp?.verified) score += 40;
  const walletVerifs = ['solana', 'ethereum', 'hyperliquid'].filter(w => vd[w]?.verified).length;
  score += Math.min(30, walletVerifs * 15);
  // On-chain activity — based on verification count
  score += Math.min(30, verifications.length * 5);

  // === Tenure (max 170) ===
  if (profile.createdAt) {
    const ageMs = Date.now() - new Date(profile.createdAt).getTime();
    const ageDays = Math.floor(ageMs / 86400000);
    score += Math.min(170, ageDays);
  }

  return Math.min(800, Math.max(0, score));
}

function calcVerificationLevel(verifications) {
  const verifCount = verifications.length;
  const categories = new Set(verifications.map(v => CATEGORY_MAP[v.platform] || 'other'));
  const catCount = categories.size;

  if (verifCount >= 8 && catCount >= 3) return 4;
  if (verifCount >= 5 && catCount >= 2) return 3;
  if (verifCount >= 2) return 2;
  if (verifCount >= 1) return 1;
  return 0;
}

async function main() {
  console.log(`[ScoreSync] Starting ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}`);
  if (SINGLE_AGENT) console.log(`[ScoreSync] Single agent: ${SINGLE_AGENT}`);

  // Load SATP client
  const client = createSATPClient({
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb',
  });

  // Load signer
  let signer;
  try {
    const keyData = JSON.parse(fs.readFileSync(PLATFORM_KEYPAIR_PATH, 'utf-8'));
    signer = Keypair.fromSecretKey(Uint8Array.from(keyData));
    console.log(`[ScoreSync] Signer: ${signer.publicKey.toBase58()}`);
  } catch (e) {
    console.error(`[ScoreSync] Cannot load signer: ${e.message}`);
    process.exit(1);
  }

  // Load DB for verifications
  let db;
  try {
    const Database = require('better-sqlite3');
    db = new Database(DB_PATH, { readonly: true });
  } catch (e) {
    console.error(`[ScoreSync] Cannot open DB: ${e.message}`);
    process.exit(1);
  }

  // Load profiles
  const profileFiles = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json'));
  let updated = 0, skipped = 0, errors = 0;

  for (const file of profileFiles) {
    const profileId = file.replace('.json', '');
    if (SINGLE_AGENT && profileId !== SINGLE_AGENT) continue;

    try {
      const profile = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, file), 'utf-8'));
      
      // Get verifications from DB + JSON verificationData (some are only in JSON)
      const dbVerifs = db.prepare('SELECT platform FROM verifications WHERE profile_id = ?').all(profileId);
      const jsonVd = profile.verificationData || {};
      const jsonVerifs = Object.entries(jsonVd)
        .filter(([, v]) => v && v.verified)
        .map(([platform]) => ({ platform }));
      // Merge: use DB + any JSON-only entries
      const dbPlatforms = new Set(dbVerifs.map(v => v.platform));
      const verifications = [...dbVerifs, ...jsonVerifs.filter(v => !dbPlatforms.has(v.platform))];
      
      // Check if genesis record exists
      let genesis;
      try {
        genesis = await client.getGenesisRecord(profileId);
      } catch (e) {
        // No genesis record — skip
        skipped++;
        continue;
      }

      if (!genesis || genesis.error) {
        skipped++;
        continue;
      }

      // Calculate scores
      const trustScore = calcTrustScoreV2(profile, verifications);
      const level = calcVerificationLevel(verifications);

      // Normalize legacy raw values (e.g. 5120000) into the current 0-800 reputation scale.
      const currentOnChainScore = genesis.reputationScore > 800
        ? Math.min(Math.round(genesis.reputationScore / 10000), 800)
        : Math.max(0, genesis.reputationScore);
      const onChainScore = trustScore;

      console.log(`[ScoreSync] ${profileId}: trust=${trustScore}/800 (write: ${onChainScore}), level=${level} (was: score=${currentOnChainScore}, raw=${genesis.reputationScore}, level=${genesis.verificationLevel})`);

      if (DRY_RUN) {
        updated++;
        continue;
      }

      // Write verification level if changed
      if (level !== genesis.verificationLevel) {
        try {
          const { transaction: levelTx } = await client.buildUpdateVerification(signer.publicKey, profileId, level);
          levelTx.sign(signer);
          const sig = await client.connection.sendRawTransaction(levelTx.serialize(), { skipPreflight: true, maxRetries: 3 });
          console.log(`  → Level: ${genesis.verificationLevel} → ${level} tx=${sig}`);
          // Small delay to avoid rate limits
          await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          console.error(`  → Level update FAILED: ${e.message}`);
          errors++;
        }
      }

      // Write reputation score if changed significantly (>10 points)
      const scoreDiff = Math.abs(onChainScore - currentOnChainScore);
      if (scoreDiff > 10 || currentOnChainScore === 0) {
        try {
          const { transaction: repTx } = await client.buildUpdateReputation(signer.publicKey, profileId, onChainScore);
          repTx.sign(signer);
          const sig = await client.connection.sendRawTransaction(repTx.serialize(), { skipPreflight: true, maxRetries: 3 });
          console.log(`  → Score: ${genesis.reputationScore} → ${onChainScore} tx=${sig}`);
          await new Promise(r => setTimeout(r, 500));
        } catch (e) {
          console.error(`  → Score update FAILED: ${e.message}`);
          errors++;
        }
      }

      updated++;
    } catch (e) {
      console.error(`[ScoreSync] ${profileId}: ${e.message}`);
      errors++;
    }
  }

  db.close();
  console.log(`\n[ScoreSync] Done. Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);
}

main().catch(e => { console.error(e); process.exit(1); });
