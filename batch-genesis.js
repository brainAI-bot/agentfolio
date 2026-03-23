#!/usr/bin/env node
/**
 * Batch Genesis Record Creator
 * Creates V3 Genesis Records for agents with 2+ verifications but no existing record.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');

const PROFILES_DIR = '/home/ubuntu/agentfolio/data/profiles';
const KEYPAIR_PATH = process.env.SATP_PLATFORM_KEYPAIR || '/home/ubuntu/.config/solana/brainforge-personal.json';
const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED';
const IDENTITY_V3 = new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');

function agentIdHash(agentId) {
  return crypto.createHash('sha256').update(agentId).digest();
}

function getGenesisPDA(agentId) {
  return PublicKey.findProgramAddressSync([Buffer.from('genesis'), agentIdHash(agentId)], IDENTITY_V3);
}

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  const raw = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
  const signer = Keypair.fromSecretKey(Uint8Array.from(raw));
  console.log('Signer:', signer.publicKey.toBase58());

  // Load SATP client
  const { createSATPClient } = require('/home/ubuntu/agentfolio/src/satp-client/src');
  const client = createSATPClient({ rpcUrl: RPC });

  // Find eligible profiles: 2+ verifications, no genesis record
  const files = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json'));
  const eligible = [];

  for (const f of files) {
    const p = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, f), 'utf8'));
    const vd = p.verificationData || {};
    const verifiedCount = Object.values(vd).filter(v => v && v.verified).length;
    if (verifiedCount >= 2) {
      eligible.push({ id: p.id, name: p.name, verifiedCount, skills: (p.skills || []).slice(0, 5).map(s => s.name || s), bio: p.bio || '', category: 'ai-agent' });
    }
  }

  console.log(`Found ${eligible.length} profiles with 2+ verifications`);

  // Batch check which already have Genesis Records
  const pdas = eligible.map(e => getGenesisPDA(e.id)[0]);
  const toCreate = [];
  
  for (let i = 0; i < pdas.length; i += 100) {
    const batch = pdas.slice(i, i + 100);
    const batchEligible = eligible.slice(i, i + 100);
    const accts = await conn.getMultipleAccountsInfo(batch);
    for (let j = 0; j < batch.length; j++) {
      if (!accts[j]) {
        toCreate.push(batchEligible[j]);
      }
    }
  }

  console.log(`${toCreate.length} need Genesis Records (${eligible.length - toCreate.length} already have one)`);

  if (toCreate.length === 0) {
    console.log('Nothing to create!');
    return;
  }

  // DRY RUN mode unless --execute is passed
  const execute = process.argv.includes('--execute');
  if (!execute) {
    console.log('\nDRY RUN — would create Genesis Records for:');
    toCreate.forEach(e => console.log(`  ${e.id} (${e.name}) — ${e.verifiedCount} verifications`));
    console.log(`\nRun with --execute to create on-chain.`);
    return;
  }

  // Create Genesis Records
  let created = 0;
  let failed = 0;
  for (const agent of toCreate) {
    try {
      const hashBuf = agentIdHash(agent.id);
      const { transaction, genesisPda } = await client.buildCreateGenesisRecord(
        signer.publicKey,
        hashBuf,
        (agent.name || agent.id).substring(0, 32),
        (agent.bio || 'AgentFolio registered agent').substring(0, 256),
        agent.category || 'ai-agent',
        agent.skills.slice(0, 5),
        ''
      );
      transaction.sign(signer);
      const sig = await conn.sendRawTransaction(transaction.serialize(), { skipPreflight: true, maxRetries: 3 });
      await conn.confirmTransaction(sig, 'confirmed');
      console.log(`✅ ${agent.id} (${agent.name}) → ${sig.slice(0, 30)}... pda=${genesisPda.toBase58()}`);
      created++;
      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.error(`❌ ${agent.id}: ${e.message}`);
      failed++;
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`\nDone: ${created} created, ${failed} failed`);
}

main().catch(e => console.error('Fatal:', e));
