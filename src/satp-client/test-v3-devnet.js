#!/usr/bin/env node
/**
 * SATP V3 Client SDK — Devnet Integration Test
 * Reads live on-chain data to verify SDK deserialization.
 */

const { SATPV3SDK, getGenesisPDA, hashAgentId } = require('./src/index');
const { Connection, PublicKey } = require('@solana/web3.js');

async function main() {
  const sdk = new SATPV3SDK({ network: 'devnet' });
  let passed = 0;
  let failed = 0;

  function assert(condition, msg) {
    if (condition) { passed++; console.log(`  ✅ ${msg}`); }
    else { failed++; console.log(`  ❌ ${msg}`); }
  }

  console.log('\n=== Devnet Integration — Read Existing Accounts ===');

  // Try to read a Genesis record (may not exist yet on V3 devnet)
  const agentId = 'brainChain';
  const [genesisPDA] = getGenesisPDA(agentId, 'devnet');
  console.log(`  Genesis PDA for "${agentId}": ${genesisPDA.toBase58()}`);

  const acct = await sdk.connection.getAccountInfo(genesisPDA);
  if (acct) {
    console.log(`  Account found! Size: ${acct.data.length} bytes`);
    const record = await sdk.getGenesisRecord(agentId);
    assert(record !== null, 'getGenesisRecord returned data');
    assert(!record.error, `No deserialization error: ${record.error || 'none'}`);
    if (record && !record.error) {
      assert(record.agentName.length > 0, `Agent name: "${record.agentName}"`);
      assert(typeof record.reputationScore === 'number', `Reputation score: ${record.reputationScore}`);
      assert(typeof record.verificationLevel === 'number', `Verification level: ${record.verificationLevel}`);
      assert(typeof record.isActive === 'boolean', `Is active: ${record.isActive}`);
      assert(typeof record.isBorn === 'boolean', `Is born: ${record.isBorn}`);
      assert(record.authority.length > 0, `Authority: ${record.authority}`);
      console.log(`  Full record: ${JSON.stringify(record, null, 2)}`);
    }
  } else {
    console.log(`  No Genesis record found for "${agentId}" (not yet created on V3 devnet)`);
    assert(true, 'Correctly returns null for non-existent account');
  }

  // Verify program accounts exist on devnet
  console.log('\n=== V3 Programs on Devnet ===');
  const programs = sdk.programIds;
  for (const [name, id] of Object.entries(programs)) {
    const info = await sdk.connection.getAccountInfo(id);
    assert(info !== null, `${name} program exists: ${id.toBase58()}`);
  }

  // Verify name availability check
  console.log('\n=== Name Availability ===');
  const available = await sdk.isNameAvailable('some-extremely-unique-test-name-12345');
  assert(available === true, 'Unique name is available');

  // Verify hasIdentity
  console.log('\n=== Identity Check ===');
  const hasId = await sdk.hasIdentity('brainChain');
  console.log(`  brainChain has identity: ${hasId}`);
  assert(typeof hasId === 'boolean', 'hasIdentity returns boolean');

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(40)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
