#!/usr/bin/env node
/**
 * SATP V3 Client SDK — Unit Tests (PDA derivation + SDK instantiation)
 * No on-chain calls — just verifies PDAs match the on-chain program seeds.
 */

const { PublicKey } = require('@solana/web3.js');
const {
  SATPV3SDK,
  hashAgentId,
  hashName,
  getGenesisPDA,
  getV3ReputationAuthorityPDA,
  getV3ValidationAuthorityPDA,
  getV3MintTrackerPDA,
  getNameRegistryPDA,
  getLinkedWalletPDA,
  getV3ReviewPDA,
  getV3AttestationPDA,
  getV3ProgramIds,
} = require('./src/index');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
}

// ─── Program IDs ───────────────────────────────────────
console.log('\n=== V3 Program IDs ===');
const ids = getV3ProgramIds('devnet');
assert(ids.IDENTITY.toBase58() === 'GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG', 'Identity V3 program ID');
assert(ids.REVIEWS.toBase58() === 'r9XX4frcqxxAZ6Au9V5PA3EAxs1zoNckqLLmoSRcNr4', 'Reviews V3 program ID');
assert(ids.REPUTATION.toBase58() === '2Lz7KzMvKdrGeAuS8WPHu7jK2yScrnKVgacpYVEuDjkJ', 'Reputation V3 program ID');
assert(ids.ATTESTATIONS.toBase58() === '6Xd1dAQJPvQRJ4Ntr6LtPTjDjPUZ8nfnmYLZaZ2DtrdD', 'Attestations V3 program ID');
assert(ids.VALIDATION.toBase58() === '6rYRiCYidJYV7QvKrzKGgNu4oMh6BAvynked69R7xMbV', 'Validation V3 program ID');

// ─── Hash Functions ───────────────────────────────────
console.log('\n=== Hash Functions ===');
const hash1 = hashAgentId('brainChain');
assert(hash1.length === 32, 'hashAgentId returns 32 bytes');
assert(Buffer.isBuffer(hash1), 'hashAgentId returns Buffer');

const hash2 = hashAgentId('brainChain');
assert(hash1.equals(hash2), 'hashAgentId is deterministic');

const hash3 = hashAgentId('brainForge');
assert(!hash1.equals(hash3), 'Different agent IDs produce different hashes');

const nameHash = hashName('brainChain');
assert(nameHash.length === 32, 'hashName returns 32 bytes');
const nameHashUpper = hashName('BrainChain');
assert(nameHash.equals(nameHashUpper), 'hashName is case-insensitive');

// ─── Genesis PDA ─────────────────────────────────────
console.log('\n=== Genesis PDA ===');
const [genesis1, bump1] = getGenesisPDA('brainChain', 'devnet');
assert(genesis1 instanceof PublicKey, 'Genesis PDA is PublicKey');
assert(typeof bump1 === 'number' && bump1 >= 0 && bump1 <= 255, 'Genesis bump is valid');

const [genesis2] = getGenesisPDA('brainChain', 'devnet');
assert(genesis1.equals(genesis2), 'Genesis PDA is deterministic');

const [genesis3] = getGenesisPDA('brainForge', 'devnet');
assert(!genesis1.equals(genesis3), 'Different agents get different Genesis PDAs');

// Can also pass pre-computed hash
const [genesis4] = getGenesisPDA(hash1, 'devnet');
assert(genesis1.equals(genesis4), 'Genesis PDA from hash matches Genesis PDA from string');

// ─── Authority PDAs ──────────────────────────────────
console.log('\n=== Authority PDAs ===');
const [repAuth] = getV3ReputationAuthorityPDA('devnet');
assert(repAuth instanceof PublicKey, 'Reputation authority PDA is PublicKey');

const [valAuth] = getV3ValidationAuthorityPDA('devnet');
assert(valAuth instanceof PublicKey, 'Validation authority PDA is PublicKey');
assert(!repAuth.equals(valAuth), 'Rep and Val authority PDAs are different');

// ─── MintTracker PDA ─────────────────────────────────
console.log('\n=== MintTracker PDA ===');
const [mintTracker] = getV3MintTrackerPDA(genesis1, 'devnet');
assert(mintTracker instanceof PublicKey, 'MintTracker PDA is PublicKey');
assert(!mintTracker.equals(genesis1), 'MintTracker PDA ≠ Genesis PDA');

// ─── Name Registry PDA ──────────────────────────────
console.log('\n=== Name Registry PDA ===');
const [nameReg1] = getNameRegistryPDA('brainChain', 'devnet');
assert(nameReg1 instanceof PublicKey, 'NameRegistry PDA is PublicKey');

const [nameReg2] = getNameRegistryPDA('BrainChain', 'devnet');
assert(nameReg1.equals(nameReg2), 'NameRegistry PDA is case-insensitive');

const [nameReg3] = getNameRegistryPDA('brainForge', 'devnet');
assert(!nameReg1.equals(nameReg3), 'Different names get different NameRegistry PDAs');

// ─── Linked Wallet PDA ──────────────────────────────
console.log('\n=== Linked Wallet PDA ===');
const testWallet = new PublicKey('Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc');
const [linked1] = getLinkedWalletPDA(genesis1, testWallet, 'devnet');
assert(linked1 instanceof PublicKey, 'LinkedWallet PDA is PublicKey');

const testWallet2 = new PublicKey('11111111111111111111111111111112');
const [linked2] = getLinkedWalletPDA(genesis1, testWallet2, 'devnet');
assert(!linked1.equals(linked2), 'Different wallets get different LinkedWallet PDAs');

// ─── Review PDA ─────────────────────────────────────
console.log('\n=== Review V3 PDA ===');
const fakeReviewer = new PublicKey('11111111111111111111111111111112');
const [review1] = getV3ReviewPDA('test_agent', fakeReviewer, 'devnet');
assert(review1 instanceof PublicKey, 'Review V3 PDA is PublicKey');
// Verify deterministic — same inputs, same PDA
const [review1b] = getV3ReviewPDA('test_agent', fakeReviewer, 'devnet');
assert(review1.equals(review1b), 'Review V3 PDA is deterministic');
// Different agent → different PDA
const [review2] = getV3ReviewPDA('other_agent', fakeReviewer, 'devnet');
assert(!review1.equals(review2), 'Different agents get different Review V3 PDAs');

console.log('\n=== Review Counter PDA ===');
const { getV3ReviewCounterPDA } = require('./src/v3-pda');
const [counter1] = getV3ReviewCounterPDA('test_agent', 'devnet');
assert(counter1 instanceof PublicKey, 'Review Counter PDA is PublicKey');
const [counter2] = getV3ReviewCounterPDA('other_agent', 'devnet');
assert(!counter1.equals(counter2), 'Different agents get different Counter PDAs');

// ─── Attestation PDA ────────────────────────────────
console.log('\n=== Attestation V3 PDA ===');
const attester = new PublicKey('Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc');
const [att1] = getV3AttestationPDA('brainChain', attester, 'kyc', 'devnet');
assert(att1 instanceof PublicKey, 'Attestation PDA is PublicKey');

const [att2] = getV3AttestationPDA('brainChain', attester, 'audit', 'devnet');
assert(!att1.equals(att2), 'Different attestation types get different PDAs');

// ─── SDK Instantiation ──────────────────────────────
console.log('\n=== SATPV3SDK ===');
const sdk = new SATPV3SDK({ network: 'devnet' });
assert(sdk.network === 'devnet', 'SDK network is devnet');
assert(sdk.rpcUrl === 'https://api.devnet.solana.com', 'SDK RPC URL correct');
assert(sdk.programIds.IDENTITY.equals(ids.IDENTITY), 'SDK uses correct Identity program ID');

const pdas = sdk.getV3PDAs('brainChain');
assert(pdas.genesis === genesis1.toBase58(), 'SDK getV3PDAs matches direct PDA derivation');
assert(pdas.agentIdHash === hash1.toString('hex'), 'SDK returns correct hash');
assert(typeof pdas.mintTracker === 'string', 'SDK returns mintTracker PDA');
assert(typeof pdas.reputationAuthority === 'string', 'SDK returns reputationAuthority PDA');
assert(typeof pdas.validationAuthority === 'string', 'SDK returns validationAuthority PDA');

const sdkHash = sdk.hashAgentId('brainChain');
assert(sdkHash.equals(hash1), 'SDK hashAgentId matches standalone');

// ─── New V3.1 Methods ───────────────────────────────
console.log('\n=== V3.1 SDK Methods ===');

// Verify new methods exist on SDK
assert(typeof sdk.buildUnlinkWallet === 'function', 'SDK has buildUnlinkWallet');
assert(typeof sdk.buildRecordMint === 'function', 'SDK has buildRecordMint');
assert(typeof sdk.buildReleaseName === 'function', 'SDK has buildReleaseName');
assert(typeof sdk.buildCancelAuthorityTransfer === 'function', 'SDK has buildCancelAuthorityTransfer');

// ─── V3.2 Attestation Methods ────────────────────────
console.log('\n=== V3.2 Attestation SDK Methods ===');

assert(typeof sdk.buildCreateAttestation === 'function', 'SDK has buildCreateAttestation');
assert(typeof sdk.buildVerifyAttestation === 'function', 'SDK has buildVerifyAttestation');
assert(typeof sdk.buildRevokeAttestation === 'function', 'SDK has buildRevokeAttestation');

// ─── Escrow V3 PDA ───────────────────────────────────
console.log('\n=== Escrow V3 PDA ===');
const { getV3EscrowPDA } = require('./src/v3-pda');
const fakeClient = new PublicKey('Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc');
const descHash = require('crypto').createHash('sha256').update('Build me an AI agent').digest();

const [escrowPDA1, escrowBump1] = getV3EscrowPDA(fakeClient, descHash, 0, 'devnet');
assert(escrowPDA1 instanceof PublicKey, 'Escrow V3 PDA is PublicKey');
assert(typeof escrowBump1 === 'number' && escrowBump1 >= 0 && escrowBump1 <= 255, 'Escrow V3 bump is valid');

// Deterministic
const [escrowPDA1b] = getV3EscrowPDA(fakeClient, descHash, 0, 'devnet');
assert(escrowPDA1.equals(escrowPDA1b), 'Escrow V3 PDA is deterministic');

// Different nonce → different PDA
const [escrowPDA2] = getV3EscrowPDA(fakeClient, descHash, 1, 'devnet');
assert(!escrowPDA1.equals(escrowPDA2), 'Different nonce produces different Escrow PDA');

// Different client → different PDA
const fakeClient2 = new PublicKey('11111111111111111111111111111112');
const [escrowPDA3] = getV3EscrowPDA(fakeClient2, descHash, 0, 'devnet');
assert(!escrowPDA1.equals(escrowPDA3), 'Different client produces different Escrow PDA');

// Different description → different PDA
const descHash2 = require('crypto').createHash('sha256').update('Different job').digest();
const [escrowPDA4] = getV3EscrowPDA(fakeClient, descHash2, 0, 'devnet');
assert(!escrowPDA1.equals(escrowPDA4), 'Different description produces different Escrow PDA');

// ─── Escrow V3 SDK Methods ──────────────────────────
console.log('\n=== Escrow V3 SDK Methods ===');

// Program ID check
assert(sdk.programIds.ESCROW.toBase58() === 'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C', 'Escrow V3 program ID correct');

// Method existence
assert(typeof sdk.buildCreateEscrow === 'function', 'SDK has buildCreateEscrow');
assert(typeof sdk.buildSubmitWork === 'function', 'SDK has buildSubmitWork');
assert(typeof sdk.buildEscrowRelease === 'function', 'SDK has buildEscrowRelease');
assert(typeof sdk.buildPartialRelease === 'function', 'SDK has buildPartialRelease');
assert(typeof sdk.buildCancelEscrow === 'function', 'SDK has buildCancelEscrow');
assert(typeof sdk.buildRaiseDispute === 'function', 'SDK has buildRaiseDispute');
assert(typeof sdk.buildResolveDispute === 'function', 'SDK has buildResolveDispute');
assert(typeof sdk.buildCloseEscrow === 'function', 'SDK has buildCloseEscrow');
assert(typeof sdk.buildExtendDeadline === 'function', 'SDK has buildExtendDeadline');
assert(typeof sdk.getEscrow === 'function', 'SDK has getEscrow');
assert(typeof sdk.getEscrowPDA === 'function', 'SDK has getEscrowPDA');

// getEscrowPDA helper
const escrowResult = sdk.getEscrowPDA(fakeClient, 'Build me an AI agent', 0);
assert(typeof escrowResult.escrowPDA === 'string', 'getEscrowPDA returns escrowPDA string');
assert(typeof escrowResult.bump === 'number', 'getEscrowPDA returns bump number');
assert(typeof escrowResult.descriptionHash === 'string' && escrowResult.descriptionHash.length === 64, 'getEscrowPDA returns 64-char hex descriptionHash');

// PDA from string description matches PDA from hash
assert(escrowResult.escrowPDA === escrowPDA1.toBase58(), 'getEscrowPDA(string) matches getV3EscrowPDA(hash)');

// Different nonces
const escrowResult2 = sdk.getEscrowPDA(fakeClient, 'Build me an AI agent', 1);
assert(escrowResult.escrowPDA !== escrowResult2.escrowPDA, 'Different nonce produces different escrowPDA via helper');

// ─── Summary ─────────────────────────────────────────
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'='.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
