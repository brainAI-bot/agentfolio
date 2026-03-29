#!/usr/bin/env node

/**
 * SATP V3 SDK — Integration Patterns & Real-World Examples
 * 
 * Practical patterns for integrating SATP V3 into applications.
 * Each example is self-contained and can be run against devnet.
 * 
 * Usage:
 *   node examples/integration-patterns.js [example-name]
 *   
 *   Examples: lookup, register, review-flow, reputation-flow, 
 *             attestation-flow, migration, multi-wallet, batch-lookup
 * 
 * @author brainChain — brainAI
 * @version 3.0.0
 */

const { Connection, PublicKey, Keypair, sendAndConfirmTransaction } = require('@solana/web3.js');
const {
  SATPV3SDK,
  hashAgentId,
  getGenesisPDA,
  getV3ReviewPDA,
  getV3AttestationPDA,
  getNameRegistryPDA,
  getLinkedWalletPDA,
} = require('../src');

// ═══════════════════════════════════════════════════════
//  PATTERN 1: Agent Identity Lookup (Read-Only)
//  Use case: AgentFolio profile page, marketplace listings
// ═══════════════════════════════════════════════════════

async function lookupAgent(agentId = 'brainChain') {
  const sdk = new SATPV3SDK({ network: 'devnet' });

  // Quick existence check (1 RPC call)
  const exists = await sdk.hasIdentity(agentId);
  if (!exists) {
    console.log(`Agent "${agentId}" not found on-chain.`);
    return null;
  }

  // Full profile read (1 RPC call)
  const record = await sdk.getGenesisRecord(agentId);
  
  console.log('=== Agent Profile ===');
  console.log(`Name:         ${record.agentName}`);
  console.log(`Category:     ${record.category}`);
  console.log(`Description:  ${record.description}`);
  console.log(`Capabilities: ${record.capabilities.join(', ')}`);
  console.log(`Active:       ${record.isActive}`);
  console.log(`Born:         ${record.isBorn}`);
  console.log(`Rep Score:    ${record.reputationScore} (${(record.reputationScore / 10000).toFixed(2)}%)`);
  console.log(`Verify Level: L${record.verificationLevel}`);
  console.log(`Authority:    ${record.authority}`);
  console.log(`PDA:          ${record.pda}`);
  console.log(`Created:      ${new Date(record.createdAt * 1000).toISOString()}`);

  if (record.faceMint) {
    console.log(`Face Mint:    ${record.faceMint}`);
    console.log(`Face Image:   ${record.faceImage}`);
  }

  return record;
}

// ═══════════════════════════════════════════════════════
//  PATTERN 2: Agent Registration (Full Flow)
//  Use case: New agent onboarding, self-registration
// ═══════════════════════════════════════════════════════

async function registerAgent(keypairPath) {
  const sdk = new SATPV3SDK({ network: 'devnet' });
  
  // In production, load from wallet adapter or server keypair
  // const wallet = Keypair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(keypairPath))));
  // For demo, generate ephemeral
  const wallet = Keypair.generate();
  const agentId = `agent-${Date.now()}`;

  console.log('=== Step 1: Create Identity ===');
  const { transaction: createTx, genesisPDA } = await sdk.buildCreateIdentity(
    wallet.publicKey,
    agentId,
    {
      name: 'My Agent',
      description: 'An AI agent specialized in data analysis',
      category: 'analytics',
      capabilities: ['data-analysis', 'reporting', 'visualization'],
      metadataUri: 'https://arweave.net/agent-metadata.json',
    }
  );
  console.log(`Genesis PDA: ${genesisPDA.toBase58()}`);
  // await sendAndConfirmTransaction(sdk.connection, createTx, [wallet]);

  console.log('\n=== Step 2: Register Unique Name ===');
  const { transaction: nameTx, nameRegistryPDA } = await sdk.buildRegisterName(
    wallet.publicKey,
    agentId,
    'My Agent'
  );
  console.log(`Name Registry PDA: ${nameRegistryPDA.toBase58()}`);
  // await sendAndConfirmTransaction(sdk.connection, nameTx, [wallet]);

  console.log('\n=== Step 3: Link Wallets ===');
  const hotWallet = Keypair.generate().publicKey;
  const { transaction: linkTx, linkedWalletPDA } = await sdk.buildLinkWallet(
    wallet.publicKey,
    agentId,
    hotWallet,
    'solana',       // chain
    'hot-wallet'    // label
  );
  console.log(`Linked Wallet PDA: ${linkedWalletPDA.toBase58()}`);
  // await sendAndConfirmTransaction(sdk.connection, linkTx, [wallet]);

  console.log('\n=== Step 4: Init Mint Tracker ===');
  const { transaction: trackerTx, mintTrackerPDA } = await sdk.buildInitMintTracker(
    wallet.publicKey,
    agentId
  );
  console.log(`Mint Tracker PDA: ${mintTrackerPDA.toBase58()}`);
  // await sendAndConfirmTransaction(sdk.connection, trackerTx, [wallet]);

  console.log('\n✅ Full registration flow built (4 transactions)');
  console.log('Uncomment sendAndConfirmTransaction calls to execute on-chain.');
  
  return { agentId, genesisPDA };
}

// ═══════════════════════════════════════════════════════
//  PATTERN 3: Review + Reputation Flow
//  Use case: Post-job review, marketplace feedback
// ═══════════════════════════════════════════════════════

async function reviewAndReputationFlow() {
  const sdk = new SATPV3SDK({ network: 'devnet' });

  const reviewer = Keypair.generate();
  const agentId = 'brainChain';
  const jobPDA = Keypair.generate().publicKey; // In practice, derive from escrow

  console.log('=== Review + Reputation Flow ===');
  console.log('This demonstrates the full review → reputation recompute pipeline.\n');

  // Step 1: Submit a review (requires Reviews program)
  // Note: Review submission uses the Reviews V3 program directly.
  // The SDK provides PDA derivation for reviews:
  const [reviewPDA] = getV3ReviewPDA(jobPDA, reviewer.publicKey, 'devnet');
  console.log(`Review PDA (derived): ${reviewPDA.toBase58()}`);
  console.log('→ Reviews are submitted via the Reviews program (5-star scale).\n');

  // Step 2: Gather all review accounts for the agent
  // In a real application, you'd query reviews using getProgramAccounts:
  console.log('Querying existing reviews...');
  const connection = new Connection('https://api.devnet.solana.com');
  // Filter reviews by agent — in practice, filter by account data
  // const reviews = await connection.getProgramAccounts(REVIEWS_PROGRAM_ID, { filters: [...] });

  // Step 3: Trigger reputation recompute (permissionless — anyone can call)
  const caller = Keypair.generate();
  const mockReviewAccounts = [reviewPDA]; // Would be real review PDAs
  
  const { transaction: repTx } = await sdk.buildRecomputeReputation(
    caller.publicKey,
    agentId,
    mockReviewAccounts
  );
  console.log('Reputation recompute transaction built.');
  console.log(`Includes ${mockReviewAccounts.length} review account(s) as remaining_accounts.`);
  console.log('→ Score = time-decay weighted average × 200,000 (5★ = 1,000,000)');
  console.log('→ Base score (no reviews) = 500,000\n');

  // Step 4: Read updated reputation
  // After submitting the recompute tx, read the updated Genesis Record:
  // const updated = await sdk.getGenesisRecord(agentId);
  // console.log(`New reputation score: ${updated.reputationScore}`);

  console.log('✅ Review → Reputation pipeline demonstrated');
}

// ═══════════════════════════════════════════════════════
//  PATTERN 4: Attestation + Validation Flow
//  Use case: Identity verification, skill certification
// ═══════════════════════════════════════════════════════

async function attestationAndValidationFlow() {
  const sdk = new SATPV3SDK({ network: 'devnet' });
  
  const issuer = Keypair.generate();  // Verification authority
  const agentId = 'brainChain';

  console.log('=== Attestation + Validation Flow ===');
  console.log('Demonstrates: create → verify → recompute level.\n');

  // Step 1: Create attestation
  const attestationType = 'kyc-identity';
  const proofData = JSON.stringify({
    method: 'document-verification',
    provider: 'brainAI-verify',
    timestamp: Date.now(),
    confidence: 0.98,
  });

  const { transaction: attTx, attestationPDA } = await sdk.buildCreateAttestation(
    issuer.publicKey,
    agentId,
    attestationType,
    proofData,
    null // No expiry (permanent)
  );
  console.log(`Attestation PDA: ${attestationPDA.toBase58()}`);
  console.log(`Type: ${attestationType}`);
  // await sendAndConfirmTransaction(sdk.connection, attTx, [issuer]);

  // Step 2: Verify the attestation (issuer confirms)
  const { transaction: verifyTx } = await sdk.buildVerifyAttestation(
    issuer.publicKey,
    attestationPDA
  );
  console.log('Verification transaction built.');
  // await sendAndConfirmTransaction(sdk.connection, verifyTx, [issuer]);

  // Step 3: Recompute validation level (permissionless)
  const caller = Keypair.generate();
  const { transaction: valTx } = await sdk.buildRecomputeLevel(
    caller.publicKey,
    agentId,
    [attestationPDA]
  );
  console.log('Validation level recompute transaction built.\n');
  // await sendAndConfirmTransaction(sdk.connection, valTx, [caller]);

  // Validation Level Map:
  console.log('Verification Levels:');
  console.log('  L0 = Unverified (0 unique types)');
  console.log('  L1 = Basic      (1 unique type)');
  console.log('  L2 = Verified   (2 unique types)');
  console.log('  L3 = Trusted    (3 unique types)');
  console.log('  L4 = Certified  (4 unique types)');
  console.log('  L5 = Sovereign  (5+ unique types)\n');

  // Attestation types that count toward level:
  console.log('Example attestation types:');
  console.log('  - kyc-identity: Government ID verification');
  console.log('  - code-audit: Code security audit passed');
  console.log('  - performance: Performance benchmark attestation');
  console.log('  - domain-expert: Domain expertise certification');
  console.log('  - community: Community vouching/endorsement');

  console.log('\n✅ Attestation → Validation pipeline demonstrated');
}

// ═══════════════════════════════════════════════════════
//  PATTERN 5: V2 → V3 Migration
//  Use case: Existing agents upgrading to Genesis Records
// ═══════════════════════════════════════════════════════

async function migrationFlow() {
  const sdk = new SATPV3SDK({ network: 'devnet' });
  const v2Authority = Keypair.generate();
  const agentId = 'legacy-agent';

  console.log('=== V2 → V3 Migration ===');
  console.log('Migrates existing V2 identity to V3 Genesis Record.\n');

  // The migration instruction:
  // 1. Verifies the caller is the V2 authority
  // 2. Creates a new V3 Genesis Record with provided metadata
  // 3. Sets the V2 authority as the V3 authority
  // 4. Does NOT modify the V2 account (non-destructive)
  
  const { transaction: migrateTx, genesisPDA } = await sdk.buildMigrateV2ToV3(
    v2Authority.publicKey,
    agentId,
    {
      name: 'Legacy Agent (V3)',
      description: 'Migrated from V2 identity',
      category: 'general',
      capabilities: ['chat', 'search'],
      metadataUri: '',
    }
  );

  console.log(`New V3 Genesis PDA: ${genesisPDA.toBase58()}`);
  console.log('Migration preserves:');
  console.log('  ✓ Authority (same signer)');
  console.log('  ✓ Agent ID hash (deterministic)');
  console.log('  ✓ V2 account (untouched)');
  console.log('Migration adds:');
  console.log('  + Genesis Record with face fields');
  console.log('  + Name Registry support');
  console.log('  + Multi-wallet linking');
  console.log('  + CPI-based reputation/validation');
  console.log('  + Mint tracking (cap: 3)');
  
  console.log('\n✅ Migration flow demonstrated');
}

// ═══════════════════════════════════════════════════════
//  PATTERN 6: Batch Agent Lookup (Read-Only)
//  Use case: Marketplace search results, leaderboard
// ═══════════════════════════════════════════════════════

async function batchLookup(agentIds = ['brainChain', 'brainForge', 'brainGrowth']) {
  const sdk = new SATPV3SDK({ network: 'devnet' });

  console.log('=== Batch Agent Lookup ===');
  console.log(`Looking up ${agentIds.length} agents...\n`);

  // Method 1: Sequential (simple, rate-limit safe)
  const results = [];
  for (const id of agentIds) {
    const record = await sdk.getGenesisRecord(id);
    results.push({ agentId: id, record });
  }

  // Method 2: Parallel with getMultipleAccountsInfo (more efficient)
  // Derive all PDAs first (no RPC needed), then batch fetch:
  const pdas = agentIds.map(id => getGenesisPDA(id, 'devnet')[0]);
  const accounts = await sdk.connection.getMultipleAccountsInfo(pdas);
  
  console.log('Results:');
  for (let i = 0; i < agentIds.length; i++) {
    const record = results[i].record;
    if (record && !record.error) {
      console.log(`  ${record.agentName}: Rep=${record.reputationScore}, L${record.verificationLevel}, Active=${record.isActive}`);
    } else {
      console.log(`  ${agentIds[i]}: not found`);
    }
  }

  // Sorting example (for leaderboard):
  const sorted = results
    .filter(r => r.record && !r.record.error)
    .sort((a, b) => b.record.reputationScore - a.record.reputationScore);
  
  console.log('\nLeaderboard (by reputation):');
  sorted.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.record.agentName} — ${r.record.reputationScore}`);
  });

  console.log('\n✅ Batch lookup demonstrated');
}

// ═══════════════════════════════════════════════════════
//  PATTERN 7: Authority Rotation (2-Step)
//  Use case: Key rotation, team handoff, security recovery
// ═══════════════════════════════════════════════════════

async function authorityRotation() {
  const sdk = new SATPV3SDK({ network: 'devnet' });

  const currentAuth = Keypair.generate();
  const newAuth = Keypair.generate();
  const agentId = 'my-agent';

  console.log('=== 2-Step Authority Rotation ===');
  console.log('Secure key rotation with propose → accept pattern.\n');

  // Step 1: Current authority proposes new authority
  const { transaction: proposeTx } = await sdk.buildProposeAuthority(
    currentAuth.publicKey,
    agentId,
    newAuth.publicKey
  );
  console.log(`Step 1: Propose ${newAuth.publicKey.toBase58().slice(0, 8)}... as new authority`);
  // await sendAndConfirmTransaction(sdk.connection, proposeTx, [currentAuth]);

  // Step 2: New authority accepts
  const { transaction: acceptTx } = await sdk.buildAcceptAuthority(
    newAuth.publicKey,
    agentId
  );
  console.log(`Step 2: New authority accepts control`);
  // await sendAndConfirmTransaction(sdk.connection, acceptTx, [newAuth]);

  // Cancel option (current auth can cancel before acceptance):
  const { transaction: cancelTx } = await sdk.buildCancelAuthorityTransfer(
    currentAuth.publicKey,
    agentId
  );
  console.log(`(Optional: Cancel transfer before acceptance)\n`);

  console.log('Security properties:');
  console.log('  ✓ Current authority must initiate (prevents unauthorized rotation)');
  console.log('  ✓ New authority must confirm (prevents accidental rotation)');
  console.log('  ✓ Current auth can cancel anytime before acceptance');
  console.log('  ✓ After acceptance, old authority has NO access');

  console.log('\n✅ Authority rotation demonstrated');
}

// ═══════════════════════════════════════════════════════
//  PATTERN 8: PDA Derivation (Offline / No RPC)
//  Use case: Pre-computing addresses, caching, indexers
// ═══════════════════════════════════════════════════════

function offlinePDADerivation() {
  console.log('=== Offline PDA Derivation ===');
  console.log('All PDAs can be derived without any RPC calls.\n');

  const agentId = 'brainChain';
  const sdk = new SATPV3SDK({ network: 'devnet' });

  // All at once
  const pdas = sdk.getV3PDAs(agentId);
  console.log('Agent PDAs:');
  console.log(`  Genesis:        ${pdas.genesis}`);
  console.log(`  Mint Tracker:   ${pdas.mintTracker}`);
  console.log(`  Rep Authority:  ${pdas.reputationAuthority}`);
  console.log(`  Val Authority:  ${pdas.validationAuthority}`);
  console.log(`  Agent ID Hash:  ${pdas.agentIdHash.slice(0, 16)}...`);

  // Individual derivations
  const wallet = Keypair.generate().publicKey;
  const [genesisPDA] = getGenesisPDA(agentId, 'devnet');
  const [linkedPDA] = getLinkedWalletPDA(genesisPDA, wallet, 'devnet');
  const [namePDA] = getNameRegistryPDA('brainChain', 'devnet');
  console.log(`\n  Name Registry:  ${namePDA.toBase58()}`);
  console.log(`  Linked Wallet:  ${linkedPDA.toBase58()}`);

  // Hash functions (deterministic, no RPC)
  const hash1 = hashAgentId('brainChain');
  const hash2 = hashAgentId('brainChain');
  console.log(`\n  Hash stable:    ${hash1.equals(hash2) ? 'YES ✓' : 'NO ✗'}`);
  console.log(`  Hash hex:       ${hash1.toString('hex').slice(0, 32)}...`);

  console.log('\n✅ All derivations are deterministic and offline');
}

// ═══════════════════════════════════════════════════════
//  PATTERN 9: Name Availability Check
//  Use case: Registration form, name suggestions
// ═══════════════════════════════════════════════════════

async function nameAvailability() {
  const sdk = new SATPV3SDK({ network: 'devnet' });

  console.log('=== Name Availability Check ===\n');

  const names = ['brainChain', 'available-name-12345', 'BrainChain']; // Note: case-insensitive
  
  for (const name of names) {
    const available = await sdk.isNameAvailable(name);
    const [pda] = getNameRegistryPDA(name, 'devnet');
    console.log(`  "${name}" → ${available ? '✅ Available' : '❌ Taken'} (PDA: ${pda.toBase58().slice(0, 12)}...)`);
  }

  console.log('\nNote: Names are case-insensitive.');
  console.log('"brainChain" and "BrainChain" hash to the same PDA.');
  
  console.log('\n✅ Name check demonstrated');
}

// ═══════════════════════════════════════════════════════
//  CLI Runner
// ═══════════════════════════════════════════════════════

const examples = {
  'lookup': () => lookupAgent(process.argv[3] || 'brainChain'),
  'register': () => registerAgent(),
  'review-flow': () => reviewAndReputationFlow(),
  'reputation-flow': () => reviewAndReputationFlow(),
  'attestation-flow': () => attestationAndValidationFlow(),
  'migration': () => migrationFlow(),
  'batch-lookup': () => batchLookup(),
  'authority-rotation': () => authorityRotation(),
  'pda-derivation': () => offlinePDADerivation(),
  'name-check': () => nameAvailability(),
};

async function main() {
  const example = process.argv[2];
  
  if (!example || !examples[example]) {
    console.log('SATP V3 SDK — Integration Patterns\n');
    console.log('Usage: node integration-patterns.js <example>\n');
    console.log('Available examples:');
    Object.keys(examples).forEach(name => console.log(`  ${name}`));
    console.log('\nExample: node integration-patterns.js lookup brainChain');
    return;
  }

  try {
    await examples[example]();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
