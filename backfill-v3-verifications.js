/**
 * Backfill V3 on-chain verification levels and trust scores
 * for all agents that have Genesis Records but stale on-chain scores.
 * 
 * Reads from DB verifications + Scoring Engine V2, writes to Solana V3.
 * Uses the deployer keypair (Bq1ni...broc) which is the Genesis Record authority.
 */

require('dotenv').config();
const { Connection, Keypair } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Config
const DEPLOYER_KEY_PATH = '/home/ubuntu/.config/solana/mainnet-deployer.json';
const DB_PATH = path.join(__dirname, 'data', 'agentfolio.db');
const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED';

async function main() {
  // Load SDK + signer
  const { createSATPClient } = require('./src/satp-client/src');
  const client = createSATPClient({ rpcUrl: RPC });
  const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(DEPLOYER_KEY_PATH, 'utf8'))));
  console.log(`Signer: ${signer.publicKey.toBase58()}`);

  // Load scoring engine
  let scoringEngine;
  try {
    scoringEngine = require('./src/scoring-engine-v2');
    console.log('Scoring Engine V2 loaded');
  } catch (e) {
    console.log('No scoring engine, will use simple calc');
  }

  const db = new Database(DB_PATH, { readonly: true });

  // Get all profiles with wallets
  const profiles = db.prepare("SELECT id, name, json_extract(wallets, '$.solana') as sw FROM profiles WHERE json_extract(wallets, '$.solana') IS NOT NULL").all();
  console.log(`Found ${profiles.length} profiles with Solana wallets`);

  let updated = 0, skipped = 0, noGenesis = 0;

  for (const profile of profiles) {
    const { id: profileId, name, sw: wallet } = profile;

    // Check V3 Genesis Record
    let genesis;
    try {
      genesis = await client.getGenesisRecord(profileId);
    } catch (e) {
      console.log(`  ${name}: No genesis record`);
      noGenesis++;
      continue;
    }
    if (!genesis) {
      noGenesis++;
      continue;
    }

    // Get all verifications
    const verifs = db.prepare('SELECT platform FROM verifications WHERE profile_id = ?').all(profileId);
    const verifCount = verifs.length;
    if (verifCount === 0) {
      skipped++;
      continue;
    }

    // Calculate verification level
    const CATEGORY_MAP = {
      solana: 'wallets', ethereum: 'wallets', hyperliquid: 'wallets', polymarket: 'wallets',
      moltbook: 'platforms', agentmail: 'platforms', github: 'platforms', x: 'platforms', twitter: 'platforms', discord: 'platforms', telegram: 'platforms',
      domain: 'infrastructure', mcp: 'infrastructure', a2a: 'infrastructure', website: 'infrastructure',
      satp: 'onchain',
    };
    const categories = new Set(verifs.map(v => CATEGORY_MAP[v.platform] || 'other'));
    const catCount = categories.size;
    const HUMAN_PLATFORMS = ['github', 'x', 'twitter'];
    const hasHumanProof = verifs.some(v => HUMAN_PLATFORMS.includes(v.platform));

    let newLevel = 0;
    if (verifCount >= 8 && catCount >= 3 && hasHumanProof) newLevel = 5;
    else if (verifCount >= 8 && catCount >= 3) newLevel = 4;
    else if (verifCount >= 5 && catCount >= 2) newLevel = 3;
    else if (verifCount >= 2) newLevel = 2;
    else if (verifCount >= 1) newLevel = 1;

    // Calculate trust score
    let newTrustScore = Math.min(800, verifCount * 50); // fallback
    if (scoringEngine) {
      try {
        const profileRow = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
        const endorsements = db.prepare('SELECT * FROM endorsements WHERE profile_id = ?').all(profileId);
        let reviews = [];
        try { reviews = db.prepare('SELECT * FROM reviews WHERE profile_id = ?').all(profileId); } catch {}
        let jobCount = 0;
        try { jobCount = db.prepare("SELECT COUNT(*) as c FROM jobs WHERE selected_agent_id = ? AND status = 'completed'").get(profileId)?.c || 0; } catch {}

        const verifData = {};
        for (const v of verifs) verifData[v.platform] = { verified: true };

        const profileObj = {
          id: profileId, name: profileRow?.name || '', handle: profileRow?.handle || '',
          bio: profileRow?.bio || '', avatar: profileRow?.avatar || '',
          skills: JSON.parse(profileRow?.skills || '[]'),
          verificationData: verifData, endorsements,
          stats: { jobsCompleted: jobCount, reviewsReceived: reviews.length, rating: reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0 },
          lastActivity: profileRow?.updated_at, createdAt: profileRow?.created_at,
          nftAvatar: JSON.parse(profileRow?.nft_avatar || '{}'),
        };
        const scoreResult = scoringEngine.getCompleteScore(profileObj);
        newTrustScore = scoreResult.reputationScore.score;
      } catch (e) {
        console.log(`  ${name}: Score calc error: ${e.message}`);
      }
    }

    const currentLevel = genesis.verificationLevel;
    const currentScore = genesis.reputationScore;

    if (newLevel <= currentLevel && newTrustScore <= currentScore) {
      console.log(`  ${name}: L${currentLevel}/${currentScore} — up to date`);
      skipped++;
      continue;
    }

    console.log(`  ${name}: L${currentLevel}/${currentScore} → L${newLevel}/${newTrustScore} (${verifCount} verifs, ${catCount} categories)`);

    // Update verification level
    if (newLevel > currentLevel) {
      try {
        const { transaction } = await client.buildUpdateVerification(signer.publicKey, profileId, newLevel);
        transaction.sign(signer);
        const sig = await client.connection.sendRawTransaction(transaction.serialize());
        console.log(`    ✅ Verification L${currentLevel} → L${newLevel}: ${sig}`);
      } catch (e) {
        console.log(`    ❌ Verification update failed: ${e.message}`);
      }
    }

    // Update reputation score
    if (newTrustScore > currentScore) {
      try {
        const repTx = await client.buildUpdateReputation(signer.publicKey, profileId, newTrustScore);
        repTx.transaction.sign(signer);
        const sig = await client.connection.sendRawTransaction(repTx.transaction.serialize());
        console.log(`    ✅ Reputation ${currentScore} → ${newTrustScore}: ${sig}`);
      } catch (e) {
        console.log(`    ❌ Reputation update failed: ${e.message}`);
      }
    }

    updated++;
    // Rate limit — 500ms between agents
    await new Promise(r => setTimeout(r, 500));
  }

  db.close();
  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}, No Genesis: ${noGenesis}`);
}

main().catch(e => { console.error(e); process.exit(1); });
