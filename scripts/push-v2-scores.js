#!/usr/bin/env node
/**
 * Push V2 reputation scores on-chain for all profiles with genesis records
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { Keypair } = require('@solana/web3.js');

const { createSATPClient, agentIdHash } = require('../src/satp-client/src');
const scoringV2 = require('../src/lib/scoring-engine-v2');

const satpClient = createSATPClient({ rpcUrl: process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb' });
const PLATFORM_KEYPAIR_PATH = process.env.SATP_PLATFORM_KEYPAIR || '/home/ubuntu/.config/solana/brainforge-personal.json';
const PROFILES_DIR = path.join(__dirname, '../data/profiles');

async function main() {
  const signer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(PLATFORM_KEYPAIR_PATH, 'utf-8'))));
  console.log(`Signer: ${signer.publicKey.toBase58()}\n`);

  const files = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json') && !f.endsWith('.bak'));

  for (const file of files) {
    const profileId = file.replace('.json', '');
    try {
      const profile = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, file), 'utf8'));
      const genesis = await satpClient.getGenesisRecord(profileId);
      if (!genesis || genesis.error) continue;

      const result = scoringV2.getCompleteScore(profile);
      const newScore = result.reputationScore.score;
      const currentScore = genesis.reputationScore;

      console.log(`${profileId}: on-chain=${currentScore}, v2=${newScore} (${result.reputationScore.rank})`);

      if (newScore > currentScore) {
        console.log(`  📤 Updating ${currentScore} → ${newScore}...`);
        const repTx = await satpClient.buildUpdateReputation(signer.publicKey, profileId, newScore);
        repTx.transaction.sign(signer);
        const sig = await satpClient.connection.sendRawTransaction(repTx.transaction.serialize());
        await satpClient.connection.confirmTransaction(sig, 'confirmed');
        console.log(`  ✅ tx=${sig}`);
        await new Promise(r => setTimeout(r, 1000));
      } else {
        console.log(`  ✓ Already >= v2 score`);
      }
    } catch (e) {
      // skip silently for profiles without genesis
    }
  }
  console.log('\n✅ Done');
}

main().catch(console.error);
