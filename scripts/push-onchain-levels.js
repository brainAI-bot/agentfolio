#!/usr/bin/env node
/**
 * Push updated verification levels on-chain for all profiles with genesis records
 * Run after sync-verifications.js to update SATP V3 on-chain levels
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { Keypair, PublicKey } = require('@solana/web3.js');

// Load SATP V3 SDK
let satpV3;
try {
  const { createSATPClient, agentIdHash } = require('../src/satp-client/src');
  satpV3 = { 
    client: createSATPClient({ rpcUrl: process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED' }), 
    agentIdHash 
  };
  console.log('[SATP V3] SDK loaded');
} catch (e) {
  console.error('SATP V3 SDK not available:', e.message);
  process.exit(1);
}

const DB_PATH = path.join(__dirname, '../data/agentfolio.db');
const PLATFORM_KEYPAIR_PATH = process.env.SATP_PLATFORM_KEYPAIR || '/home/ubuntu/.config/solana/brainforge-personal.json';

const CATEGORY_MAP = {
  solana: 'wallets', ethereum: 'wallets', hyperliquid: 'wallets', polymarket: 'wallets',
  moltbook: 'platforms', agentmail: 'platforms', github: 'platforms', x: 'platforms', twitter: 'platforms', discord: 'platforms', telegram: 'platforms',
  domain: 'infrastructure', mcp: 'infrastructure', a2a: 'infrastructure', website: 'infrastructure',
  satp: 'onchain',
};
const HUMAN_PLATFORMS = ['github', 'x', 'twitter'];
const LEVEL_NAMES = ['Unregistered', 'Registered', 'Verified', 'Established', 'Trusted', 'Sovereign'];

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  
  const db = new Database(DB_PATH);
  const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(PLATFORM_KEYPAIR_PATH, 'utf-8'))));
  console.log(`Signer: ${signer.publicKey.toBase58()}\n`);

  // Get profiles with verifications
  const profiles = db.prepare(`
    SELECT p.id, p.name, COUNT(v.id) as verif_count,
      GROUP_CONCAT(v.platform, ',') as platforms
    FROM profiles p
    INNER JOIN verifications v ON v.profile_id = p.id
    GROUP BY p.id
    HAVING verif_count > 0
    ORDER BY verif_count DESC
  `).all();

  for (const p of profiles) {
    const platforms = (p.platforms || '').split(',').filter(Boolean);
    const categories = new Set(platforms.map(pl => CATEGORY_MAP[pl] || 'other'));
    const hasHumanProof = platforms.some(pl => HUMAN_PLATFORMS.includes(pl));
    
    let newLevel = 0;
    if (p.verif_count >= 8 && categories.size >= 3 && hasHumanProof) newLevel = 5;
    else if (p.verif_count >= 8 && categories.size >= 3) newLevel = 4;
    else if (p.verif_count >= 5 && categories.size >= 2) newLevel = 3;
    else if (p.verif_count >= 2) newLevel = 2;
    else if (p.verif_count >= 1) newLevel = 1;

    // Check on-chain genesis record
    try {
      const genesis = await satpV3.client.getGenesisRecord(p.id);
      if (!genesis || genesis.error) {
        console.log(`⏭️  ${p.id}: No genesis record — skip`);
        continue;
      }

      const currentLevel = genesis.verificationLevel;
      console.log(`${p.id}: on-chain L${currentLevel}, calculated L${newLevel} ${LEVEL_NAMES[newLevel]}`);

      if (newLevel > currentLevel) {
        console.log(`  📤 Updating L${currentLevel} → L${newLevel}...`);
        const { transaction } = await satpV3.client.buildUpdateVerification(signer.publicKey, p.id, newLevel);
        transaction.sign(signer);
        const sig = await satpV3.client.connection.sendRawTransaction(transaction.serialize());
        await satpV3.client.connection.confirmTransaction(sig, 'confirmed');
        console.log(`  ✅ Updated! tx=${sig}`);
        
        // Small delay to avoid RPC rate limits
        await new Promise(r => setTimeout(r, 1000));
      } else {
        console.log(`  ✓ Already at correct level`);
      }
    } catch (e) {
      console.error(`  ❌ Error for ${p.id}:`, e.message);
    }
  }

  db.close();
  console.log('\n✅ Done');
}

main().catch(console.error);
