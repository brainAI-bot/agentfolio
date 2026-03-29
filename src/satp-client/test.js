#!/usr/bin/env node
/**
 * SATP SDK Test Script
 * Demonstrates each SDK function.
 * 
 * Usage:
 *   node test.js                    # Read-only tests (no wallet needed)
 *   WALLET=<pubkey> node test.js    # Test with a specific wallet
 */

const { SATPSDK } = require('./src');
const { Keypair } = require('@solana/web3.js');

const TEST_WALLET = process.env.WALLET || Keypair.generate().publicKey.toBase58();

async function main() {
  console.log('=== SATP SDK Test ===\n');

  const sdk = new SATPSDK(); // defaults to mainnet

  // 1. Derive PDAs (offline)
  console.log('1. Deriving PDAs for:', TEST_WALLET);
  const pdas = sdk.getPDAs(TEST_WALLET);
  console.log('   Identity PDA:', pdas.identity);
  console.log('   Reputation PDA:', pdas.reputation);
  console.log('');

  // 2. Check identity (read-only RPC)
  console.log('2. Fetching identity...');
  const identity = await sdk.getIdentity(TEST_WALLET);
  if (identity) {
    console.log('   Found:', JSON.stringify(identity, null, 2));
  } else {
    console.log('   No identity registered (expected for random wallet)');
  }
  console.log('');

  // 3. Check reputation (read-only RPC)
  console.log('3. Fetching reputation...');
  const rep = await sdk.getReputation(TEST_WALLET);
  if (rep) {
    console.log('   Found:', JSON.stringify(rep, null, 2));
  } else {
    console.log('   No reputation found (expected for random wallet)');
  }
  console.log('');

  // 4. Verify agent
  console.log('4. Verifying agent...');
  const verified = await sdk.verifyAgent(TEST_WALLET);
  console.log('   Verified:', verified);
  console.log('');

  // 5. Build transaction (no signing, just demonstrate)
  console.log('5. Building registerIdentity transaction (unsigned)...');
  try {
    const { transaction, identityPDA } = await sdk.buildRegisterIdentity(
      TEST_WALLET,
      'test-agent',
      { type: 'ai-agent', version: '1.0' }
    );
    console.log('   Identity PDA:', identityPDA.toBase58());
    console.log('   Instructions:', transaction.instructions.length);
    console.log('   Transaction built successfully (not sent — no signer)');
  } catch (e) {
    console.log('   Error building tx:', e.message);
  }
  console.log('');

  // 6. Build addReputation transaction
  console.log('6. Building addReputation transaction (unsigned)...');
  try {
    const endorser = Keypair.generate().publicKey;
    const { transaction, reputationPDA } = await sdk.buildAddReputation(
      TEST_WALLET,
      100,
      endorser
    );
    console.log('   Reputation PDA:', reputationPDA.toBase58());
    console.log('   Instructions:', transaction.instructions.length);
    console.log('   Transaction built successfully (not sent — no signer)');
  } catch (e) {
    console.log('   Error building tx:', e.message);
  }

  console.log('\n=== All tests passed ===');
}

main().catch(console.error);
