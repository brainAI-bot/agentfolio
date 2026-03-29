#!/usr/bin/env node
/**
 * BorshReader Test Suite — SATP V3 Borsh Deserialization Helpers
 *
 * Tests all 8 account type deserializers + auto-detect + batch + utilities.
 * Zero RPC — all tests use synthetic buffers matching exact Rust struct layouts.
 */

const crypto = require('crypto');
const { PublicKey, Keypair } = require('@solana/web3.js');
const {
  BorshReader,
  deserializeGenesisRecord,
  deserializeLinkedWallet,
  deserializeMintTracker,
  deserializeNameRegistry,
  deserializeReview,
  deserializeReviewCounter,
  deserializeAttestation,
  deserializeEscrowV3,
  deserializeAccount,
  deserializeBatch,
  getAccountDiscriminator,
  accountDiscriminator,
  isAccountType,
  DISCRIMINATORS,
} = require('./src/borsh-reader');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

function assertEqual(actual, expected, msg) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg}`);
    console.error(`    expected: ${e}`);
    console.error(`    actual:   ${a}`);
  }
}

// ═══════════════════════════════════════════════════
//  Buffer Helpers (simulate Borsh serialization)
// ═══════════════════════════════════════════════════

function anchorAccountDisc(name) {
  return crypto.createHash('sha256').update(`account:${name}`).digest().slice(0, 8);
}

function writeString(str) {
  const bytes = Buffer.from(str, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
}

function writeVecString(arr) {
  const count = Buffer.alloc(4);
  count.writeUInt32LE(arr.length);
  return Buffer.concat([count, ...arr.map(writeString)]);
}

function writePubkey(pk) {
  return new PublicKey(pk).toBuffer();
}

function writeU8(val) {
  return Buffer.from([val]);
}

function writeU64(val) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(val));
  return buf;
}

function writeI64(val) {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(val));
  return buf;
}

function writeBool(val) {
  return Buffer.from([val ? 1 : 0]);
}

function writeOptionPubkey(pk) {
  if (pk === null) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), writePubkey(pk)]);
}

function writeOptionI64(val) {
  if (val === null) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), writeI64(val)]);
}

function writeOptionBytes32(hex) {
  if (hex === null) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), Buffer.from(hex, 'hex')]);
}

function writeBytes32(hex) {
  return Buffer.from(hex.padEnd(64, '0'), 'hex');
}

// ═══════════════════════════════════════════════════
//  Test Data
// ═══════════════════════════════════════════════════

const TEST_PUBKEY_1 = Keypair.generate().publicKey.toBase58();
const TEST_PUBKEY_2 = Keypair.generate().publicKey.toBase58();
const TEST_PUBKEY_3 = Keypair.generate().publicKey.toBase58();
const TEST_HASH = crypto.createHash('sha256').update('test-agent-id').digest().toString('hex');
const NOW = Math.floor(Date.now() / 1000);

// ═══════════════════════════════════════════════════
//  Tests: BorshReader primitives
// ═══════════════════════════════════════════════════

console.log('\n=== BorshReader Primitives ===');

{
  const buf = Buffer.alloc(1);
  buf.writeUInt8(42);
  const r = new BorshReader(buf);
  assertEqual(r.readU8(), 42, 'readU8');
}

{
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(1234);
  const r = new BorshReader(buf);
  assertEqual(r.readU16(), 1234, 'readU16');
}

{
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(999999);
  const r = new BorshReader(buf);
  assertEqual(r.readU32(), 999999, 'readU32');
}

{
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(1000000000));
  const r = new BorshReader(buf);
  assertEqual(r.readU64Num(), 1000000000, 'readU64Num');
}

{
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(-123456));
  const r = new BorshReader(buf);
  assertEqual(r.readI64(), -123456, 'readI64 negative');
}

{
  const buf = Buffer.from([1]);
  const r = new BorshReader(buf);
  assertEqual(r.readBool(), true, 'readBool true');
}

{
  const buf = Buffer.from([0]);
  const r = new BorshReader(buf);
  assertEqual(r.readBool(), false, 'readBool false');
}

{
  const str = 'Hello Borsh!';
  const buf = writeString(str);
  const r = new BorshReader(buf);
  assertEqual(r.readString(), str, 'readString');
}

{
  const arr = ['one', 'two', 'three'];
  const buf = writeVecString(arr);
  const r = new BorshReader(buf);
  assertDeepEqual(r.readVecString(), arr, 'readVecString');
}

{
  const pk = Keypair.generate().publicKey;
  const buf = pk.toBuffer();
  const r = new BorshReader(buf);
  assertEqual(r.readPubkeyBase58(), pk.toBase58(), 'readPubkeyBase58');
}

{
  // Option<Pubkey> = None
  const buf = Buffer.from([0]);
  const r = new BorshReader(buf);
  assertEqual(r.readOptionPubkey(), null, 'readOptionPubkey None');
}

{
  // Option<Pubkey> = Some
  const pk = Keypair.generate().publicKey;
  const buf = Buffer.concat([Buffer.from([1]), pk.toBuffer()]);
  const r = new BorshReader(buf);
  assertEqual(r.readOptionPubkey(), pk.toBase58(), 'readOptionPubkey Some');
}

{
  // Option<i64> = None
  const buf = Buffer.from([0]);
  const r = new BorshReader(buf);
  assertEqual(r.readOptionI64(), null, 'readOptionI64 None');
}

{
  // Option<i64> = Some
  const buf = Buffer.alloc(9);
  buf.writeUInt8(1, 0);
  buf.writeBigInt64LE(BigInt(1234567890), 1);
  const r = new BorshReader(buf);
  assertEqual(r.readOptionI64(), 1234567890, 'readOptionI64 Some');
}

{
  // skipDiscriminator
  const buf = Buffer.alloc(12);
  buf.writeUInt8(42, 8);
  const r = new BorshReader(buf);
  r.skipDiscriminator();
  assertEqual(r.readU8(), 42, 'skipDiscriminator');
}

{
  // remaining
  const buf = Buffer.alloc(10);
  const r = new BorshReader(buf, 3);
  assertEqual(r.remaining(), 7, 'remaining');
}

// ═══════════════════════════════════════════════════
//  Tests: GenesisRecord
// ═══════════════════════════════════════════════════

console.log('\n=== GenesisRecord ===');

{
  const disc = anchorAccountDisc('GenesisRecord');
  const data = Buffer.concat([
    disc,
    writeBytes32(TEST_HASH),                     // agent_id_hash
    writeString('TestAgent'),                     // agent_name
    writeString('A test agent'),                  // description
    writeString('utility'),                       // category
    writeVecString(['coding', 'testing']),        // capabilities
    writeString('https://example.com/meta.json'), // metadata_uri
    writeString('https://arweave.net/face.png'),  // face_image
    writePubkey(TEST_PUBKEY_1),                   // face_mint
    writeString('5xBcD...sig'),                   // face_burn_tx
    writeI64(NOW - 86400),                        // genesis_record (born yesterday)
    writeBool(true),                              // is_active
    writePubkey(TEST_PUBKEY_2),                   // authority
    writeOptionPubkey(null),                      // pending_authority
    writeU64(8500),                               // reputation_score
    writeU8(3),                                   // verification_level
    writeI64(NOW - 3600),                         // reputation_updated_at
    writeI64(NOW - 7200),                         // verification_updated_at
    writeI64(NOW - 86400),                        // created_at
    writeI64(NOW - 100),                          // updated_at
    writeU8(255),                                 // bump
  ]);

  const parsed = deserializeGenesisRecord(data);
  assertEqual(parsed.agentIdHash, TEST_HASH, 'genesis: agentIdHash');
  assertEqual(parsed.agentName, 'TestAgent', 'genesis: agentName');
  assertEqual(parsed.description, 'A test agent', 'genesis: description');
  assertEqual(parsed.category, 'utility', 'genesis: category');
  assertDeepEqual(parsed.capabilities, ['coding', 'testing'], 'genesis: capabilities');
  assertEqual(parsed.metadataUri, 'https://example.com/meta.json', 'genesis: metadataUri');
  assertEqual(parsed.faceImage, 'https://arweave.net/face.png', 'genesis: faceImage');
  assertEqual(parsed.faceMint, TEST_PUBKEY_1, 'genesis: faceMint');
  assertEqual(parsed.faceBurnTx, '5xBcD...sig', 'genesis: faceBurnTx');
  assertEqual(parsed.isBorn, true, 'genesis: isBorn');
  assertEqual(parsed.isActive, true, 'genesis: isActive');
  assertEqual(parsed.authority, TEST_PUBKEY_2, 'genesis: authority');
  assertEqual(parsed.pendingAuthority, null, 'genesis: pendingAuthority null');
  assertEqual(parsed.reputationScore, 8500, 'genesis: reputationScore');
  assertEqual(parsed.verificationLevel, 3, 'genesis: verificationLevel');
  assertEqual(parsed.bump, 255, 'genesis: bump');
}

{
  // GenesisRecord with pendingAuthority set
  const disc = anchorAccountDisc('GenesisRecord');
  const data = Buffer.concat([
    disc,
    writeBytes32(TEST_HASH),
    writeString('Agent2'),
    writeString('desc'),
    writeString('cat'),
    writeVecString([]),
    writeString(''),
    writeString(''),                              // face_image (empty = not born via face)
    writePubkey(PublicKey.default.toBase58()),     // face_mint (default = no mint)
    writeString(''),                              // face_burn_tx
    writeI64(0),                                  // genesis_record = 0 (unborn)
    writeBool(true),
    writePubkey(TEST_PUBKEY_1),
    writeOptionPubkey(TEST_PUBKEY_3),             // pending_authority = Some
    writeU64(0),
    writeU8(0),
    writeI64(0),
    writeI64(0),
    writeI64(NOW),
    writeI64(NOW),
    writeU8(254),
  ]);

  const parsed = deserializeGenesisRecord(data);
  assertEqual(parsed.isBorn, false, 'genesis: unborn (genesis_record=0)');
  assertEqual(parsed.faceImage, null, 'genesis: faceImage null when empty');
  assertEqual(parsed.faceMint, null, 'genesis: faceMint null when default');
  assertEqual(parsed.faceBurnTx, null, 'genesis: faceBurnTx null when empty');
  assertEqual(parsed.pendingAuthority, TEST_PUBKEY_3, 'genesis: pendingAuthority Some');
}

// ═══════════════════════════════════════════════════
//  Tests: LinkedWallet
// ═══════════════════════════════════════════════════

console.log('\n=== LinkedWallet ===');

{
  const disc = anchorAccountDisc('LinkedWallet');
  const data = Buffer.concat([
    disc,
    writePubkey(TEST_PUBKEY_1),   // identity
    writePubkey(TEST_PUBKEY_2),   // wallet
    writeString('solana'),        // chain
    writeString('deploy'),        // label
    writeI64(NOW),                // verified_at
    writeBool(true),              // is_active
    writeU8(253),                 // bump
  ]);

  const parsed = deserializeLinkedWallet(data);
  assertEqual(parsed.identity, TEST_PUBKEY_1, 'linkedWallet: identity');
  assertEqual(parsed.wallet, TEST_PUBKEY_2, 'linkedWallet: wallet');
  assertEqual(parsed.chain, 'solana', 'linkedWallet: chain');
  assertEqual(parsed.label, 'deploy', 'linkedWallet: label');
  assertEqual(parsed.verifiedAt, NOW, 'linkedWallet: verifiedAt');
  assertEqual(parsed.isActive, true, 'linkedWallet: isActive');
  assertEqual(parsed.bump, 253, 'linkedWallet: bump');
}

// ═══════════════════════════════════════════════════
//  Tests: MintTracker
// ═══════════════════════════════════════════════════

console.log('\n=== MintTracker ===');

{
  const disc = anchorAccountDisc('MintTracker');
  const data = Buffer.concat([
    disc,
    writePubkey(TEST_PUBKEY_1),  // identity
    writeU8(2),                  // mint_count
    writeI64(NOW - 600),         // last_mint_timestamp
    writeU8(252),                // bump
  ]);

  const parsed = deserializeMintTracker(data);
  assertEqual(parsed.identity, TEST_PUBKEY_1, 'mintTracker: identity');
  assertEqual(parsed.mintCount, 2, 'mintTracker: mintCount');
  assertEqual(parsed.lastMintTimestamp, NOW - 600, 'mintTracker: lastMintTimestamp');
  assertEqual(parsed.bump, 252, 'mintTracker: bump');
}

// ═══════════════════════════════════════════════════
//  Tests: NameRegistry
// ═══════════════════════════════════════════════════

console.log('\n=== NameRegistry ===');

{
  const nameHash = crypto.createHash('sha256').update('brainchain').digest().toString('hex');
  const disc = anchorAccountDisc('NameRegistry');
  const data = Buffer.concat([
    disc,
    writeString('brainChain'),    // name
    writeBytes32(nameHash),       // name_hash
    writePubkey(TEST_PUBKEY_1),   // identity
    writePubkey(TEST_PUBKEY_2),   // authority
    writeI64(NOW - 1000),         // registered_at
    writeBool(true),              // is_active
    writeU8(251),                 // bump
  ]);

  const parsed = deserializeNameRegistry(data);
  assertEqual(parsed.name, 'brainChain', 'nameRegistry: name');
  assertEqual(parsed.nameHash, nameHash, 'nameRegistry: nameHash');
  assertEqual(parsed.identity, TEST_PUBKEY_1, 'nameRegistry: identity');
  assertEqual(parsed.authority, TEST_PUBKEY_2, 'nameRegistry: authority');
  assertEqual(parsed.registeredAt, NOW - 1000, 'nameRegistry: registeredAt');
  assertEqual(parsed.isActive, true, 'nameRegistry: isActive');
  assertEqual(parsed.bump, 251, 'nameRegistry: bump');
}

// ═══════════════════════════════════════════════════
//  Tests: Review
// ═══════════════════════════════════════════════════

console.log('\n=== Review ===');

{
  const disc = anchorAccountDisc('Review');
  const data = Buffer.concat([
    disc,
    writeString('agent-42'),                      // agent_id
    writeBytes32(TEST_HASH),                      // agent_id_hash
    writePubkey(TEST_PUBKEY_1),                   // reviewer
    writeU8(5),                                   // rating
    writeString('Excellent work, shipped on time'), // review_text
    writeString('{"job":"escrow-deploy"}'),       // metadata
    writeI64(NOW - 3600),                         // created_at
    writeI64(NOW - 100),                          // updated_at
    writeBool(true),                              // is_active
    writeU8(250),                                 // bump
  ]);

  const parsed = deserializeReview(data);
  assertEqual(parsed.agentId, 'agent-42', 'review: agentId');
  assertEqual(parsed.agentIdHash, TEST_HASH, 'review: agentIdHash');
  assertEqual(parsed.reviewer, TEST_PUBKEY_1, 'review: reviewer');
  assertEqual(parsed.rating, 5, 'review: rating');
  assertEqual(parsed.reviewText, 'Excellent work, shipped on time', 'review: reviewText');
  assertEqual(parsed.metadata, '{"job":"escrow-deploy"}', 'review: metadata');
  assertEqual(parsed.isActive, true, 'review: isActive');
  assertEqual(parsed.bump, 250, 'review: bump');
}

// ═══════════════════════════════════════════════════
//  Tests: ReviewCounter
// ═══════════════════════════════════════════════════

console.log('\n=== ReviewCounter ===');

{
  const disc = anchorAccountDisc('ReviewCounter');
  const data = Buffer.concat([
    disc,
    writeString('agent-42'),     // agent_id
    writeBytes32(TEST_HASH),     // agent_id_hash
    writeU64(17),                // count
    writeU8(249),                // bump
  ]);

  const parsed = deserializeReviewCounter(data);
  assertEqual(parsed.agentId, 'agent-42', 'reviewCounter: agentId');
  assertEqual(parsed.agentIdHash, TEST_HASH, 'reviewCounter: agentIdHash');
  assertEqual(parsed.count, 17, 'reviewCounter: count');
  assertEqual(parsed.bump, 249, 'reviewCounter: bump');
}

// ═══════════════════════════════════════════════════
//  Tests: Attestation
// ═══════════════════════════════════════════════════

console.log('\n=== Attestation ===');

{
  const disc = anchorAccountDisc('Attestation');
  const data = Buffer.concat([
    disc,
    writeString('agent-42'),                      // agent_id
    writeBytes32(TEST_HASH),                      // agent_id_hash
    writeString('kyc'),                           // attestation_type
    writePubkey(TEST_PUBKEY_1),                   // issuer
    writeString('{"method":"passbase","id":"x"}'), // proof_data
    writeBool(true),                              // verified
    writeI64(NOW - 7200),                         // created_at
    writeOptionI64(NOW + 86400 * 365),            // expires_at = 1 year from now
    writeBool(false),                             // is_revoked
    writeU8(248),                                 // bump
  ]);

  const parsed = deserializeAttestation(data);
  assertEqual(parsed.agentId, 'agent-42', 'attestation: agentId');
  assertEqual(parsed.attestationType, 'kyc', 'attestation: attestationType');
  assertEqual(parsed.issuer, TEST_PUBKEY_1, 'attestation: issuer');
  assertEqual(parsed.verified, true, 'attestation: verified');
  assertEqual(parsed.isRevoked, false, 'attestation: isRevoked');
  assertEqual(parsed.isExpired, false, 'attestation: isExpired (future)');
  assertEqual(parsed.isValid, true, 'attestation: isValid (verified + not revoked + not expired)');
  assert(parsed.expiresAt > NOW, 'attestation: expiresAt in future');
  assertEqual(parsed.bump, 248, 'attestation: bump');
}

{
  // Expired attestation
  const disc = anchorAccountDisc('Attestation');
  const data = Buffer.concat([
    disc,
    writeString('agent-99'),
    writeBytes32(TEST_HASH),
    writeString('audit'),
    writePubkey(TEST_PUBKEY_2),
    writeString('{}'),
    writeBool(true),               // verified
    writeI64(NOW - 86400),
    writeOptionI64(NOW - 3600),    // expired 1 hour ago
    writeBool(false),              // not revoked
    writeU8(247),
  ]);

  const parsed = deserializeAttestation(data);
  assertEqual(parsed.isExpired, true, 'attestation: isExpired (past)');
  assertEqual(parsed.isValid, false, 'attestation: isValid false when expired');
}

{
  // Revoked attestation
  const disc = anchorAccountDisc('Attestation');
  const data = Buffer.concat([
    disc,
    writeString('agent-99'),
    writeBytes32(TEST_HASH),
    writeString('audit'),
    writePubkey(TEST_PUBKEY_2),
    writeString('{}'),
    writeBool(true),
    writeI64(NOW - 86400),
    writeOptionI64(null),          // no expiry
    writeBool(true),               // revoked!
    writeU8(246),
  ]);

  const parsed = deserializeAttestation(data);
  assertEqual(parsed.isRevoked, true, 'attestation: revoked');
  assertEqual(parsed.isValid, false, 'attestation: isValid false when revoked');
  assertEqual(parsed.expiresAt, null, 'attestation: no expiry');
}

// ═══════════════════════════════════════════════════
//  Tests: EscrowV3
// ═══════════════════════════════════════════════════

console.log('\n=== EscrowV3 ===');

{
  const descHash = crypto.createHash('sha256').update('Build SATP escrow').digest().toString('hex');
  const workHash = crypto.createHash('sha256').update('https://github.com/commit/abc').digest().toString('hex');
  const disc = anchorAccountDisc('EscrowV3');
  const data = Buffer.concat([
    disc,
    writePubkey(TEST_PUBKEY_1),        // client
    writePubkey(TEST_PUBKEY_2),        // agent
    writeBytes32(TEST_HASH),           // agent_id_hash
    writeU64(5000000000),              // amount (5 SOL)
    writeU64(1000000000),              // released_amount (1 SOL)
    writeBytes32(descHash),            // description_hash
    writeI64(NOW + 86400),             // deadline
    writeU64(0),                       // nonce
    writeU8(1),                        // status = WorkSubmitted
    writeU8(2),                        // min_verification_level
    writeBool(true),                   // require_born
    writeI64(NOW - 3600),              // created_at
    writePubkey(TEST_PUBKEY_3),        // arbiter
    writeOptionBytes32(workHash),      // work_hash = Some
    writeOptionI64(NOW - 600),         // work_submitted_at = Some
    writeOptionBytes32(null),          // dispute_reason_hash = None
    writeOptionI64(null),              // disputed_at = None
    writeOptionPubkey(null),           // disputed_by = None
    writeU8(245),                      // bump
  ]);

  const parsed = deserializeEscrowV3(data);
  assertEqual(parsed.client, TEST_PUBKEY_1, 'escrow: client');
  assertEqual(parsed.agent, TEST_PUBKEY_2, 'escrow: agent');
  assertEqual(parsed.agentIdHash, TEST_HASH, 'escrow: agentIdHash');
  assertEqual(parsed.amount, 5000000000, 'escrow: amount');
  assertEqual(parsed.releasedAmount, 1000000000, 'escrow: releasedAmount');
  assertEqual(parsed.remaining, 4000000000, 'escrow: remaining');
  assertEqual(parsed.descriptionHash, descHash, 'escrow: descriptionHash');
  assertEqual(parsed.status, 'WorkSubmitted', 'escrow: status');
  assertEqual(parsed.statusCode, 1, 'escrow: statusCode');
  assertEqual(parsed.minVerificationLevel, 2, 'escrow: minVerificationLevel');
  assertEqual(parsed.requireBorn, true, 'escrow: requireBorn');
  assertEqual(parsed.arbiter, TEST_PUBKEY_3, 'escrow: arbiter');
  assertEqual(parsed.workHash, workHash, 'escrow: workHash');
  assert(parsed.workSubmittedAt !== null, 'escrow: workSubmittedAt present');
  assertEqual(parsed.disputeReasonHash, null, 'escrow: no dispute hash');
  assertEqual(parsed.disputedAt, null, 'escrow: no disputed_at');
  assertEqual(parsed.disputedBy, null, 'escrow: no disputed_by');
  assertEqual(parsed.bump, 245, 'escrow: bump');
}

{
  // Disputed escrow
  const disputeHash = crypto.createHash('sha256').update('Work not delivered').digest().toString('hex');
  const disc = anchorAccountDisc('EscrowV3');
  const data = Buffer.concat([
    disc,
    writePubkey(TEST_PUBKEY_1),
    writePubkey(TEST_PUBKEY_2),
    writeBytes32(TEST_HASH),
    writeU64(2000000000),
    writeU64(0),
    writeBytes32(TEST_HASH),
    writeI64(NOW - 86400),            // deadline passed
    writeU64(1),                      // nonce=1
    writeU8(4),                       // status = Disputed
    writeU8(0),
    writeBool(false),
    writeI64(NOW - 86400 * 2),
    writePubkey(TEST_PUBKEY_3),
    writeOptionBytes32(null),         // no work
    writeOptionI64(null),
    writeOptionBytes32(disputeHash),  // dispute_reason_hash = Some
    writeOptionI64(NOW - 1800),       // disputed_at = Some
    writeOptionPubkey(TEST_PUBKEY_1), // disputed_by = client
    writeU8(244),
  ]);

  const parsed = deserializeEscrowV3(data);
  assertEqual(parsed.status, 'Disputed', 'escrow disputed: status');
  assertEqual(parsed.nonce, 1, 'escrow disputed: nonce');
  assertEqual(parsed.disputeReasonHash, disputeHash, 'escrow disputed: reason hash');
  assertEqual(parsed.disputedBy, TEST_PUBKEY_1, 'escrow disputed: disputed_by');
  assert(parsed.disputedAt !== null, 'escrow disputed: disputed_at present');
}

// ═══════════════════════════════════════════════════
//  Tests: Auto-detect (deserializeAccount)
// ═══════════════════════════════════════════════════

console.log('\n=== Auto-detect (deserializeAccount) ===');

{
  const disc = anchorAccountDisc('MintTracker');
  const data = Buffer.concat([
    disc,
    writePubkey(TEST_PUBKEY_1),
    writeU8(1),
    writeI64(NOW),
    writeU8(200),
  ]);

  const result = deserializeAccount(data);
  assertEqual(result.type, 'MintTracker', 'autodetect: MintTracker type');
  assertEqual(result.data.mintCount, 1, 'autodetect: MintTracker data');
}

{
  const disc = anchorAccountDisc('ReviewCounter');
  const data = Buffer.concat([
    disc,
    writeString('test-agent'),
    writeBytes32(TEST_HASH),
    writeU64(42),
    writeU8(199),
  ]);

  const result = deserializeAccount(data);
  assertEqual(result.type, 'ReviewCounter', 'autodetect: ReviewCounter type');
  assertEqual(result.data.count, 42, 'autodetect: ReviewCounter data');
}

{
  // Unknown discriminator
  const data = Buffer.alloc(32);
  data.fill(0xff, 0, 8);
  let threw = false;
  try {
    deserializeAccount(data);
  } catch (e) {
    threw = e.message.includes('Unknown account discriminator');
  }
  assert(threw, 'autodetect: throws on unknown discriminator');
}

{
  // Too short
  let threw = false;
  try {
    deserializeAccount(Buffer.alloc(4));
  } catch (e) {
    threw = e.message.includes('at least 8 bytes');
  }
  assert(threw, 'autodetect: throws on short buffer');
}

// ═══════════════════════════════════════════════════
//  Tests: isAccountType
// ═══════════════════════════════════════════════════

console.log('\n=== isAccountType ===');

{
  const disc = anchorAccountDisc('Attestation');
  const data = Buffer.concat([disc, Buffer.alloc(200)]);
  assertEqual(isAccountType(data, 'Attestation'), true, 'isAccountType: Attestation match');
  assertEqual(isAccountType(data, 'Review'), false, 'isAccountType: Attestation != Review');
  assertEqual(isAccountType(Buffer.alloc(4), 'Attestation'), false, 'isAccountType: short buffer');
}

// ═══════════════════════════════════════════════════
//  Tests: getAccountDiscriminator
// ═══════════════════════════════════════════════════

console.log('\n=== getAccountDiscriminator ===');

{
  const disc = getAccountDiscriminator('GenesisRecord');
  const expected = anchorAccountDisc('GenesisRecord');
  assert(disc.equals(expected), 'getAccountDiscriminator: GenesisRecord');
}

{
  // Unknown account name — should still compute
  const disc2 = getAccountDiscriminator('FooBar');
  assert(disc2.length === 8, 'getAccountDiscriminator: unknown name returns 8 bytes');
}

// ═══════════════════════════════════════════════════
//  Tests: DISCRIMINATORS constant
// ═══════════════════════════════════════════════════

console.log('\n=== DISCRIMINATORS ===');

{
  const expected = [
    'GenesisRecord', 'LinkedWallet', 'MintTracker', 'NameRegistry',
    'Review', 'ReviewCounter', 'Attestation', 'EscrowV3',
  ];
  const actual = Object.keys(DISCRIMINATORS);
  assertDeepEqual(actual.sort(), expected.sort(), 'DISCRIMINATORS: has all 8 types');

  for (const name of expected) {
    assert(DISCRIMINATORS[name].length === 8, `DISCRIMINATORS: ${name} is 8 bytes`);
  }
}

// ═══════════════════════════════════════════════════
//  Tests: deserializeBatch
// ═══════════════════════════════════════════════════

console.log('\n=== deserializeBatch ===');

{
  // Build 3 accounts: 2 MintTrackers + 1 bad
  const batchDisc = anchorAccountDisc('MintTracker');
  const mkMintTracker = (count) => Buffer.concat([
    batchDisc,
    writePubkey(TEST_PUBKEY_1),
    writeU8(count),
    writeI64(NOW),
    writeU8(200),
  ]);

  const accounts = [
    { pubkey: Keypair.generate().publicKey, account: { data: mkMintTracker(1) } },
    { pubkey: Keypair.generate().publicKey, account: { data: mkMintTracker(3) } },
    { pubkey: Keypair.generate().publicKey, account: { data: Buffer.alloc(4) } }, // too short
  ];

  const results = deserializeBatch(accounts, 'MintTracker');
  assertEqual(results.length, 2, 'batch: 2 of 3 parsed');
  assertEqual(results[0].data.mintCount, 1, 'batch: first mintCount');
  assertEqual(results[1].data.mintCount, 3, 'batch: second mintCount');
  assertEqual(results[0].type, 'MintTracker', 'batch: type set');
  assert(typeof results[0].pubkey === 'string', 'batch: pubkey is base58');
}

{
  // Batch with auto-detect (no expectedType)
  const mkReview = () => {
    const revDisc = anchorAccountDisc('Review');
    return Buffer.concat([
      revDisc,
      writeString('agent-1'),
      writeBytes32(TEST_HASH),
      writePubkey(TEST_PUBKEY_1),
      writeU8(4),
      writeString('Good'),
      writeString('{}'),
      writeI64(NOW),
      writeI64(NOW),
      writeBool(true),
      writeU8(200),
    ]);
  };

  const accounts = [
    { pubkey: Keypair.generate().publicKey, account: { data: mkReview() } },
  ];

  const results = deserializeBatch(accounts);
  assertEqual(results.length, 1, 'batch autodetect: 1 parsed');
  assertEqual(results[0].type, 'Review', 'batch autodetect: Review type');
  assertEqual(results[0].data.rating, 4, 'batch autodetect: rating');
}

// ═══════════════════════════════════════════════════
//  Tests: Edge Cases
// ═══════════════════════════════════════════════════

console.log('\n=== Edge Cases ===');

{
  // Empty strings
  const lwDisc = anchorAccountDisc('LinkedWallet');
  const data = Buffer.concat([
    lwDisc,
    writePubkey(TEST_PUBKEY_1),
    writePubkey(TEST_PUBKEY_2),
    writeString(''),              // empty chain
    writeString(''),              // empty label
    writeI64(0),
    writeBool(false),
    writeU8(1),
  ]);

  const parsed = deserializeLinkedWallet(data);
  assertEqual(parsed.chain, '', 'edge: empty string chain');
  assertEqual(parsed.label, '', 'edge: empty string label');
  assertEqual(parsed.isActive, false, 'edge: inactive');
}

{
  // All escrow status values
  const STATUSES = ['Active', 'WorkSubmitted', 'Released', 'Cancelled', 'Disputed', 'Resolved'];
  for (let i = 0; i < STATUSES.length; i++) {
    const esDisc = anchorAccountDisc('EscrowV3');
    const data = Buffer.concat([
      esDisc,
      writePubkey(TEST_PUBKEY_1),
      writePubkey(TEST_PUBKEY_2),
      writeBytes32(TEST_HASH),
      writeU64(1000),
      writeU64(0),
      writeBytes32(TEST_HASH),
      writeI64(NOW),
      writeU64(0),
      writeU8(i),                    // status code
      writeU8(0),
      writeBool(false),
      writeI64(NOW),
      writePubkey(TEST_PUBKEY_3),
      writeOptionBytes32(null),
      writeOptionI64(null),
      writeOptionBytes32(null),
      writeOptionI64(null),
      writeOptionPubkey(null),
      writeU8(200),
    ]);
    const parsed = deserializeEscrowV3(data);
    assertEqual(parsed.status, STATUSES[i], `edge: escrow status ${i} = ${STATUSES[i]}`);
  }
}

{
  // Unicode strings
  const uniDisc = anchorAccountDisc('Review');
  const data = Buffer.concat([
    uniDisc,
    writeString('エージェント-1'),     // Japanese agent ID
    writeBytes32(TEST_HASH),
    writePubkey(TEST_PUBKEY_1),
    writeU8(5),
    writeString('Excellent 🚀 très bon! ñ'),  // Mixed unicode
    writeString('{"emoji":"🔥"}'),
    writeI64(NOW),
    writeI64(NOW),
    writeBool(true),
    writeU8(200),
  ]);

  const parsed = deserializeReview(data);
  assertEqual(parsed.agentId, 'エージェント-1', 'edge: unicode agentId');
  assertEqual(parsed.reviewText, 'Excellent 🚀 très bon! ñ', 'edge: unicode reviewText');
  assertEqual(parsed.metadata, '{"emoji":"🔥"}', 'edge: unicode metadata');
}

{
  // Large Vec<String> in capabilities
  const capabilities = [];
  for (let i = 0; i < 10; i++) capabilities.push(`capability-${i}`);

  const bigDisc = anchorAccountDisc('GenesisRecord');
  const data = Buffer.concat([
    bigDisc,
    writeBytes32(TEST_HASH),
    writeString('BigAgent'),
    writeString('Many capabilities'),
    writeString('utility'),
    writeVecString(capabilities),
    writeString(''),
    writeString(''),
    writePubkey(PublicKey.default.toBase58()),
    writeString(''),
    writeI64(0),
    writeBool(true),
    writePubkey(TEST_PUBKEY_1),
    writeOptionPubkey(null),
    writeU64(0),
    writeU8(0),
    writeI64(0),
    writeI64(0),
    writeI64(NOW),
    writeI64(NOW),
    writeU8(200),
  ]);

  const parsed = deserializeGenesisRecord(data);
  assertEqual(parsed.capabilities.length, 10, 'edge: 10 capabilities');
  assertEqual(parsed.capabilities[9], 'capability-9', 'edge: last capability');
}

// ═══════════════════════════════════════════════════
//  Summary
// ═══════════════════════════════════════════════════

console.log('\n' + '='.repeat(50));
console.log(`BorshReader Tests: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
} else {
  console.log('✅ All BorshReader tests passed!\n');
}