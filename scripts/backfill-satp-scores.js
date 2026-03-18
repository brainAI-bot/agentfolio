#!/usr/bin/env node

/**
 * One-time backfill script for existing agents' SATP on-chain scores
 * Calculates trust scores + verification levels for all profiles with verifications
 * and writes them to SATP on-chain
 */

const Database = require("better-sqlite3");
const path = require("path");
const { Keypair } = require('@solana/web3.js');
const fs = require('fs');
// Initialize SATP v3 client (same as in profile-store.js)
let satpV3;
try {
  const { createSATPClient, agentIdHash } = require("../src/satp-client/src");
  satpV3 = { 
    client: createSATPClient({ 
      rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
    }), 
    agentIdHash 
  };
} catch (err) {
  console.error("❌ Failed to initialize SATP v3 client:", err.message);
  process.exit(1);
}

// Initialize database
const d = new Database(path.join(__dirname, "../data/agentfolio.db"));

// Initialize SATP platform signer (same as in profile-store.js)
const PLATFORM_KEYPAIR_PATH = process.env.SATP_PLATFORM_KEYPAIR ||
  '/home/ubuntu/.config/solana/brainforge-personal.json';
const signerKey = JSON.parse(fs.readFileSync(PLATFORM_KEYPAIR_PATH, 'utf-8'));
const platformSigner = Keypair.fromSecretKey(Uint8Array.from(signerKey));

async function backfillSATPScores() {
  console.log("🔄 Starting SATP on-chain score backfill...");

  try {
    // Get all profiles with verifications
    const profiles = d.prepare(`
      SELECT DISTINCT p.id, p.name, p.bio, p.skills, p.avatar, p.created_at,
             COUNT(v.id) as verification_count
      FROM profiles p 
      INNER JOIN verifications v ON p.id = v.profile_id 
      GROUP BY p.id
      HAVING verification_count > 0
      ORDER BY verification_count DESC
    `).all();

    console.log(`📊 Found ${profiles.length} profiles with verifications to backfill`);

    for (const profile of profiles) {
      console.log(`\n🔧 Processing ${profile.id} (${profile.name}) - ${profile.verification_count} verifications`);

      try {
        // Get all verifications for this profile
        const allVerifs = d.prepare("SELECT platform FROM verifications WHERE profile_id = ?").all(profile.id);

        // Calculate verification level with category awareness (from profile-store.js)
        const CATEGORY_MAP = {
          solana: "onchain", ethereum: "onchain", satp: "onchain",
          github: "social", x: "social", twitter: "social", discord: "social", telegram: "social",
          polymarket: "marketplace", hyperliquid: "marketplace", mcp: "infrastructure", a2a: "infrastructure",
          domain: "infrastructure", ens: "infrastructure", farcaster: "social", agentmail: "social"
        };
        
        const categories = new Set(allVerifs.map(v => CATEGORY_MAP[v.platform] || "other"));
        const catCount = categories.size;
        const verifCount = allVerifs.length;
        
        let newLevel;
        if (verifCount >= 10 && catCount >= 3) newLevel = 5; // L5 Sovereign
        else if (verifCount >= 8 && catCount >= 3) newLevel = 4; // L4 Trusted  
        else if (verifCount >= 5 && catCount >= 2) newLevel = 3; // L3 Established
        else if (verifCount >= 2) newLevel = 2; // L2 Verified
        else newLevel = 1; // L1 Registered

        // Calculate trust score using v2 formula (from profile-store.js)
        
        // Profile completeness (30 max): name + bio + skills + avatar
        let profileScore = 0;
        if (profile.name) profileScore += 8;
        if (profile.bio && profile.bio.length > 20) profileScore += 8;
        if (profile.skills) profileScore += 8;
        if (profile.avatar) profileScore += 6;
        profileScore = Math.min(30, profileScore);
        
        // Social verifications (200 max): github, x, discord, telegram, etc
        const socialPlatforms = ["github", "x", "twitter", "discord", "telegram", "farcaster", "agentmail"];
        const socialCount = allVerifs.filter(v => socialPlatforms.includes(v.platform)).length;
        const socialScore = Math.min(200, socialCount * 50);
        
        // Marketplace verifications (300 max): polymarket, hyperliquid, mcp, a2a
        const marketplacePlatforms = ["polymarket", "hyperliquid"];
        const marketplaceCount = allVerifs.filter(v => marketplacePlatforms.includes(v.platform)).length;
        const marketplaceScore = Math.min(300, marketplaceCount * 100);
        
        // Infrastructure verifications (100 max): mcp, a2a, domain, ens
        const infraPlatforms = ["mcp", "a2a", "domain", "ens"];
        const infraCount = allVerifs.filter(v => infraPlatforms.includes(v.platform)).length;
        const infraScore = Math.min(100, infraCount * 50);
        
        // On-chain verifications (100 max): solana, ethereum, satp
        const onchainPlatforms = ["solana", "ethereum", "satp"];
        const onchainCount = allVerifs.filter(v => onchainPlatforms.includes(v.platform)).length;
        const onchainScore = Math.min(100, onchainCount * 50);
        
        // Tenure bonus (170 max): based on profile age
        const profileCreated = new Date(profile.created_at || Date.now());
        const ageInDays = Math.floor((Date.now() - profileCreated.getTime()) / (1000 * 60 * 60 * 24));
        const tenureScore = Math.min(170, Math.floor(ageInDays / 7) * 10); // 10 points per week, max 170

        const newTrustScore = profileScore + socialScore + marketplaceScore + infraScore + onchainScore + tenureScore;
        
        console.log(`  📈 Calculated: P=${profileScore} S=${socialScore} M=${marketplaceScore} I=${infraScore} O=${onchainScore} T=${tenureScore} = ${newTrustScore}`);
        console.log(`  🏆 Level: ${newLevel} (${verifCount} verif, ${catCount} categories)`);

        // Check if SATP genesis record exists
        const genesis = await satpV3.client.getGenesisRecord(profile.id);
        if (!genesis) {
          console.log(`  ⚠️  No SATP genesis record for ${profile.id} - skipping`);
          continue;
        }

        console.log(`  🔗 Current on-chain: Level ${genesis.verificationLevel}, Score ${genesis.reputationScore}`);

        let updated = false;

        // Update verification level if different
        if (newLevel !== genesis.verificationLevel) {
          console.log(`  📝 Updating verification level: ${genesis.verificationLevel} → ${newLevel}`);
          const { transaction } = await satpV3.client.buildUpdateVerification(platformSigner.publicKey, profile.id, newLevel);
          transaction.sign(platformSigner);
          const sig = await satpV3.client.connection.sendRawTransaction(transaction.serialize());
          console.log(`  ✅ Verification updated: ${sig}`);
          updated = true;
          await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit
        }

        // Update reputation score if different  
        if (newTrustScore !== genesis.reputationScore) {
          console.log(`  📝 Updating reputation: ${genesis.reputationScore} → ${newTrustScore}`);
          const repTx = await satpV3.client.buildUpdateReputation(platformSigner.publicKey, profile.id, newTrustScore);
          repTx.transaction.sign(platformSigner);
          const repSig = await satpV3.client.connection.sendRawTransaction(repTx.transaction.serialize());
          console.log(`  ✅ Reputation updated: ${repSig}`);
          updated = true;
          await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit
        }

        if (!updated) {
          console.log(`  ✅ Already up to date`);
        }

      } catch (profileErr) {
        console.error(`  ❌ Failed to process ${profile.id}:`, profileErr.message);
      }
    }

    console.log("\n🎉 Backfill complete!");

  } catch (err) {
    console.error("❌ Backfill failed:", err.message);
  } finally {
    d.close();
  }
}

// Run the backfill
backfillSATPScores().catch(console.error);