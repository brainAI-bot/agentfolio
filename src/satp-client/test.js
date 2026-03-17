/**
 * SATP V3 SDK Test — read-only mainnet verification
 * Run: node test.js (or SATP_RPC=devnet node test.js)
 */
const {
  createSATPClient, PROGRAM_IDS, agentIdHash, getGenesisPDA, resolveAgent,
} = require('./src');

const RPC = process.env.SATP_RPC === 'devnet'
  ? 'https://api.devnet.solana.com'
  : 'https://api.mainnet-beta.solana.com';

const TEAM = ['brainKID', 'brainForge', 'brainChain', 'brainGrowth', 'brainTrade'];

let passed = 0, failed = 0;
function assert(label, condition) {
  if (condition) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ FAIL: ${label}`); }
}

(async () => {
  console.log(`\n=== SATP V3 SDK Tests (${process.env.SATP_RPC || 'mainnet'}) ===\n`);

  // 1. Program IDs present
  console.log('Program IDs:');
  assert('IDENTITY_V3', PROGRAM_IDS.IDENTITY_V3.toBase58() === 'GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');
  assert('REVIEWS_V3', PROGRAM_IDS.REVIEWS_V3.toBase58() === 'r9XX4frcqxxAZ6Au9V5PA3EAxs1zoNckqLLmoSRcNr4');
  assert('REPUTATION_V3', PROGRAM_IDS.REPUTATION_V3.toBase58() === '2Lz7KzMvKdrGeAuS8WPHu7jK2yScrnKVgacpYVEuDjkJ');
  assert('ATTESTATIONS_V3', PROGRAM_IDS.ATTESTATIONS_V3.toBase58() === '6Xd1dAQJPvQRJ4Ntr6LtPTjDjPUZ8nfnmYLZaZ2DtrdD');
  assert('VALIDATION_V3', PROGRAM_IDS.VALIDATION_V3.toBase58() === '6rYRiCYidJYV7QvKrzKGgNu4oMh6BAvynked69R7xMbV');

  // 2. PDA derivation
  console.log('\nPDA Derivation:');
  assert('agentIdHash is 32 bytes', agentIdHash('test').length === 32);
  assert('PDA is deterministic', getGenesisPDA('test')[0].toBase58() === getGenesisPDA('test')[0].toBase58());
  assert('Different IDs → different PDAs', getGenesisPDA('a')[0].toBase58() !== getGenesisPDA('b')[0].toBase58());
  assert('resolveAgent returns PublicKey', resolveAgent('brainKID').toBase58().length > 30);

  // 3. On-chain reads (mainnet)
  console.log('\nOn-Chain Reads:');
  const sdk = createSATPClient({ rpcUrl: RPC });

  for (const agentId of TEAM) {
    const record = await sdk.getGenesisRecord(agentId);
    assert(`${agentId} exists on-chain`, record !== null && !record.error);
    if (record && !record.error) {
      assert(`${agentId} name matches`, record.agentName === agentId);
      assert(`${agentId} has reputation`, record.reputationScore >= 0);
      console.log(`    → PDA: ${record.pda.slice(0, 16)}... | Born: ${record.isBorn} | Rep: ${record.reputationPct}/100`);
    }
  }

  // 4. Non-existent agent
  const ghost = await sdk.getGenesisRecord('nonexistent-agent-xyz-999');
  assert('Non-existent agent returns null', ghost === null);

  // 5. resolveAgent consistency
  console.log('\nConsistency:');
  const pdaFromHelper = getGenesisPDA('brainForge')[0].toBase58();
  const pdaFromSDK = sdk.resolveAgent('brainForge');
  assert('getGenesisPDA matches resolveAgent', pdaFromHelper === pdaFromSDK);

  // Summary
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
