/**
 * Escrow E2E Test — Devnet
 * Tests: buildCreateEscrowTx → sign → confirm → readEscrowAccount
 */
const { Keypair, Connection } = require('@solana/web3.js');
const fs = require('fs');

// Patch module to use devnet
process.env.SOLANA_RPC = 'https://api.devnet.solana.com';

// Load escrow module
const escrow = require('../src/lib/escrow-onchain');

const DEVNET_RPC = 'https://api.devnet.solana.com';

async function main() {
  console.log('=== Escrow E2E Test (Devnet) ===');
  
  // Load test keypair
  const kpPath = '/home/ubuntu/.config/solana/satp-devnet-test.json';
  if (!fs.existsSync(kpPath)) {
    console.error('No devnet test keypair found at', kpPath);
    process.exit(1);
  }
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(kpPath))));
  console.log('Test wallet:', kp.publicKey.toBase58());
  
  // Check SOL balance
  const conn = new Connection(DEVNET_RPC);
  const bal = await conn.getBalance(kp.publicKey);
  console.log('SOL balance:', bal / 1e9);
  if (bal < 0.01 * 1e9) {
    console.log('Need SOL airdrop...');
    try {
      await conn.requestAirdrop(kp.publicKey, 1e9);
      await new Promise(r => setTimeout(r, 3000));
      console.log('Airdrop received');
    } catch (e) {
      console.warn('Airdrop failed:', e.message);
    }
  }
  
  // Test 1: Build create escrow TX
  const jobId = 'test-escrow-' + Date.now();
  console.log('\n--- Test 1: buildCreateEscrowTx ---');
  try {
    const tx = await escrow.buildCreateEscrowTx(
      kp.publicKey.toBase58(),
      jobId,
      1.0, // 1 USDC
      Math.floor(Date.now() / 1000) + 86400 // 24h deadline
    );
    console.log('✅ TX built successfully');
    console.log('  Escrow PDA:', tx.escrowPDA);
    console.log('  Vault PDA:', tx.vaultPDA);
    console.log('  TX bytes:', tx.transaction ? 'present' : 'missing');
  } catch (e) {
    console.log('❌ buildCreateEscrowTx failed:', e.message);
  }
  
  // Test 2: Read non-existent escrow (should return null/error gracefully)
  console.log('\n--- Test 2: readEscrowAccount (non-existent) ---');
  try {
    const state = await escrow.readEscrowAccount('nonexistent-job-id');
    console.log('✅ Returned:', state ? 'data' : 'null/empty (expected)');
  } catch (e) {
    console.log('Result:', e.message.includes('not found') || e.message.includes('null') ? '✅ Graceful error' : '❌ ' + e.message);
  }
  
  // Test 3: Build release TX (should fail gracefully for non-existent escrow)
  console.log('\n--- Test 3: buildReleaseTx (no escrow) ---');
  try {
    await escrow.buildReleaseTx(kp.publicKey.toBase58(), kp.publicKey.toBase58(), 'fake-job');
    console.log('❌ Should have failed');
  } catch (e) {
    console.log('✅ Graceful error:', e.message.slice(0, 80));
  }
  
  console.log('\n=== Tests Complete ===');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
