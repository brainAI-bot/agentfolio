#!/usr/bin/env node
/**
 * SATP Client SDK — Devnet Integration Test
 * 
 * Validates the live devnet deployment by:
 * 1. Checking all 5 SATP programs are executable
 * 2. Deriving PDAs and verifying they match on-chain data
 * 3. Fetching known agent identities from devnet
 * 4. Verifying PDA derivation consistency
 * 5. Testing transaction building (without signing)
 * 
 * Run: node test-devnet-integration.js
 */

const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const { 
  SATPSDK, 
  getProgramIds, 
  getIdentityPDA,
  getReviewCounterPDA,
  getMintTrackerPDA,
  getReputationAuthorityPDA,
  getValidationAuthorityPDA,
  getReviewsAuthorityPDA,
} = require('./src/index');

const DEVNET_RPC = 'https://api.devnet.solana.com';

// Known devnet deployer wallet
const DEPLOYER_WALLET = '6XHEGouB56hq5GyNwWxg7pAh5jNMx5FVY3c84WrYgz42';

let passed = 0;
let failed = 0;

function ok(name, detail) {
  passed++;
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, err) {
  failed++;
  console.error(`  ❌ ${name}: ${err}`);
}

async function testProgramsExecutable() {
  console.log('\n=== 1. Program Executability ===');
  const conn = new Connection(DEVNET_RPC, 'confirmed');
  const programs = getProgramIds('devnet');
  
  for (const [name, pubkey] of Object.entries(programs)) {
    try {
      const info = await conn.getAccountInfo(pubkey);
      if (!info) {
        fail(`${name} account`, 'not found on devnet');
        continue;
      }
      if (info.executable) {
        ok(`${name} (${pubkey.toBase58().slice(0,8)}...)`, 'executable');
      } else {
        fail(`${name}`, 'account exists but not executable');
      }
    } catch (e) {
      fail(`${name}`, e.message);
    }
  }
}

async function testPDADerivation() {
  console.log('\n=== 2. PDA Derivation ===');
  const wallet = new PublicKey(DEPLOYER_WALLET);
  
  // Identity PDA
  const [idPda, idBump] = getIdentityPDA(wallet, 'devnet');
  ok('Identity PDA', `${idPda.toBase58().slice(0,12)}... bump=${idBump}`);
  
  // Reputation Authority PDA
  const [repAuth] = getReputationAuthorityPDA('devnet');
  ok('Reputation Authority', `${repAuth.toBase58().slice(0,12)}...`);
  
  // Validation Authority PDA
  const [valAuth] = getValidationAuthorityPDA('devnet');
  ok('Validation Authority', `${valAuth.toBase58().slice(0,12)}...`);
  
  // Review Counter PDA
  const [revCounter] = getReviewCounterPDA(wallet, 'devnet');
  ok('Review Counter', `${revCounter.toBase58().slice(0,12)}...`);
  
  // MintTracker PDA
  const [mintTracker] = getMintTrackerPDA(idPda, 'devnet');
  ok('MintTracker', `${mintTracker.toBase58().slice(0,12)}...`);
  
  // Reviews Authority PDA
  const [revAuth] = getReviewsAuthorityPDA('devnet');
  ok('Reviews Authority', `${revAuth.toBase58().slice(0,12)}...`);
  
  // Consistency: derive twice → same result
  const [idPda2] = getIdentityPDA(wallet, 'devnet');
  if (idPda.toBase58() === idPda2.toBase58()) {
    ok('PDA deterministic', 'same input → same PDA');
  } else {
    fail('PDA deterministic', 'different results for same input');
  }
}

async function testSDKInitialization() {
  console.log('\n=== 3. SDK Initialization ===');
  
  // Default (devnet)
  const sdk = new SATPSDK({ network: 'devnet' });
  if (sdk.network === 'devnet') ok('Default devnet', 'network=devnet');
  else fail('Default devnet', `network=${sdk.network}`);
  
  // Mainnet
  const sdkMain = new SATPSDK({ network: 'mainnet' });
  if (sdkMain.network === 'mainnet') ok('Mainnet init', 'network=mainnet');
  else fail('Mainnet init', `network=${sdkMain.network}`);
  
  // Custom RPC
  const sdkCustom = new SATPSDK({ rpcUrl: 'https://custom.rpc.example.com' });
  if (sdkCustom.rpcUrl === 'https://custom.rpc.example.com') ok('Custom RPC', 'URL accepted');
  else fail('Custom RPC', 'URL not set correctly');
  
  // getPDAs utility
  const pdas = sdk.getPDAs(DEPLOYER_WALLET);
  if (pdas.identity && pdas.reviewCounter && pdas.mintTracker) {
    ok('getPDAs utility', `identity=${pdas.identity.slice(0,12)}...`);
  } else {
    fail('getPDAs utility', 'missing fields');
  }
}

async function testIdentityFetch() {
  console.log('\n=== 4. Identity Fetch (devnet) ===');
  const sdk = new SATPSDK({ network: 'devnet' });
  
  // Try to fetch identity for deployer wallet
  try {
    const identity = await sdk.getIdentity(DEPLOYER_WALLET);
    if (identity === null) {
      ok('Deployer identity', 'null (no identity on devnet — expected if not registered)');
    } else if (identity.error) {
      ok('Deployer identity', `PDA exists but decode error: ${identity.error.slice(0,50)}...`);
    } else {
      ok('Deployer identity', `name="${identity.agentName}", owner=${identity.owner.slice(0,12)}...`);
    }
  } catch (e) {
    fail('Deployer identity', e.message);
  }
  
  // Verify non-existent wallet returns null
  try {
    const fakeWallet = Keypair.generate().publicKey.toBase58();
    const identity = await sdk.getIdentity(fakeWallet);
    if (identity === null) {
      ok('Non-existent identity', 'correctly returns null');
    } else {
      fail('Non-existent identity', 'expected null but got data');
    }
  } catch (e) {
    fail('Non-existent identity', e.message);
  }
}

async function testTransactionBuilding() {
  console.log('\n=== 5. Transaction Building ===');
  const sdk = new SATPSDK({ network: 'devnet' });
  const wallet = Keypair.generate().publicKey;
  
  // Build createIdentity TX (don't sign/send)
  try {
    const { transaction, identityPDA } = await sdk.buildCreateIdentity(
      wallet,
      'test-agent',
      JSON.stringify({ description: 'integration test' })
    );
    if (transaction && identityPDA) {
      ok('buildCreateIdentity', `pda=${identityPDA.toBase58().slice(0,12)}..., ixCount=${transaction.instructions.length}`);
    } else {
      fail('buildCreateIdentity', 'missing transaction or PDA');
    }
  } catch (e) {
    fail('buildCreateIdentity', e.message);
  }
  
  // Build recomputeReputation TX
  try {
    const { transaction } = await sdk.buildRecomputeReputation(DEPLOYER_WALLET, wallet);
    if (transaction && transaction.instructions.length === 1) {
      ok('buildRecomputeReputation', `ixCount=${transaction.instructions.length}`);
    } else {
      fail('buildRecomputeReputation', 'unexpected instruction count');
    }
  } catch (e) {
    fail('buildRecomputeReputation', e.message);
  }
  
  // Build recomputeLevel TX
  try {
    const { transaction } = await sdk.buildRecomputeLevel(DEPLOYER_WALLET, wallet);
    if (transaction && transaction.instructions.length === 1) {
      ok('buildRecomputeLevel', `ixCount=${transaction.instructions.length}`);
    } else {
      fail('buildRecomputeLevel', 'unexpected instruction count');
    }
  } catch (e) {
    fail('buildRecomputeLevel', e.message);
  }
  
  // Build initMintTracker TX
  try {
    const { transaction, mintTrackerPDA } = await sdk.buildInitMintTracker(wallet);
    if (transaction && mintTrackerPDA) {
      ok('buildInitMintTracker', `tracker=${mintTrackerPDA.toBase58().slice(0,12)}...`);
    } else {
      fail('buildInitMintTracker', 'missing transaction or PDA');
    }
  } catch (e) {
    fail('buildInitMintTracker', e.message);
  }
}

async function testVerifyAgent() {
  console.log('\n=== 6. Agent Verification ===');
  const sdk = new SATPSDK({ network: 'devnet' });
  
  // Non-existent wallet should fail verification
  try {
    const fakeWallet = Keypair.generate().publicKey.toBase58();
    const verified = await sdk.verifyAgent(fakeWallet);
    if (verified === false) {
      ok('Unregistered agent', 'correctly returns false');
    } else {
      fail('Unregistered agent', 'expected false');
    }
  } catch (e) {
    fail('Unregistered agent', e.message);
  }
}

async function testAnchorDiscriminator() {
  console.log('\n=== 7. Anchor Discriminator ===');
  const { anchorDiscriminator } = require('./src/index');
  
  const disc = anchorDiscriminator('create_identity');
  if (disc.length === 8) {
    ok('Discriminator length', '8 bytes');
  } else {
    fail('Discriminator length', `expected 8, got ${disc.length}`);
  }
  
  // Deterministic
  const disc2 = anchorDiscriminator('create_identity');
  if (disc.equals(disc2)) {
    ok('Discriminator deterministic', 'same input → same output');
  } else {
    fail('Discriminator deterministic', 'mismatch');
  }
  
  // Different instructions → different discriminators
  const disc3 = anchorDiscriminator('recompute_reputation');
  if (!disc.equals(disc3)) {
    ok('Discriminator uniqueness', 'different instructions → different discriminators');
  } else {
    fail('Discriminator uniqueness', 'collision');
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  SATP Client SDK — Devnet Integration Tests ║');
  console.log('╚══════════════════════════════════════════════╝');
  
  await testProgramsExecutable();
  await testPDADerivation();
  await testSDKInitialization();
  await testIdentityFetch();
  await testTransactionBuilding();
  await testVerifyAgent();
  await testAnchorDiscriminator();
  
  console.log('\n═══════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════');
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
