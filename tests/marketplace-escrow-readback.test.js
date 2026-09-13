const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bs58Module = require('bs58');
const { Keypair } = require('@solana/web3.js');
const {
  ESCROW_V3_ACCOUNT_DISCRIMINATOR,
  READBACK_ERROR_CODE,
  verifyEscrowFundingOnChain,
} = require('../src/lib/marketplace-escrow-readback');

const bs58 = bs58Module.default || bs58Module;

function validSignature() {
  return bs58.encode(crypto.randomBytes(64));
}

function u64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function i64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64LE(BigInt(value));
  return buffer;
}

function createEscrowInstructionData() {
  return crypto.createHash('sha256').update('global:create_escrow').digest().subarray(0, 8);
}

function escrowAccountData({ client = Keypair.generate().publicKey, agent = Keypair.generate().publicKey } = {}) {
  return Buffer.concat([
    ESCROW_V3_ACCOUNT_DISCRIMINATOR,
    client.toBuffer(),
    agent.toBuffer(),
    Buffer.alloc(32),
    u64(100),
    u64(0),
    Buffer.alloc(32),
    i64(2_000_000_000),
    u64(0),
    Buffer.from([0]), // SOL
    Buffer.from([0]), // tokenMint None
    Buffer.from([0]), // tokenVault None
    Buffer.from([0]), // tokenDecimals None
    Buffer.from([0]), // Active
    Buffer.from([0]), // minVerificationLevel
    Buffer.from([0]), // requireBorn
    i64(1_700_000_000),
    Keypair.generate().publicKey.toBuffer(),
    Buffer.from([0]), // workHash None
    Buffer.from([0]), // workSubmittedAt None
    Buffer.from([0]), // disputeReasonHash None
    Buffer.from([0]), // disputedAt None
    Buffer.from([0]), // disputedBy None
    Buffer.from([255]),
  ]);
}

function accountInfo(owner, options) {
  return { owner, data: escrowAccountData(options) };
}

test('verifies the create instruction and funded SATP V3 escrow state for the authenticated client', async () => {
  const escrow = Keypair.generate().publicKey;
  const programId = Keypair.generate().publicKey;
  const client = Keypair.generate().publicKey;
  const agent = Keypair.generate().publicKey;
  const signature = validSignature();
  const connection = {
    async getTransaction(received, options) {
      assert.equal(received, signature);
      assert.deepEqual(options, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      return {
        slot: 42,
        transaction: {
          message: {
            staticAccountKeys: [client, escrow, programId],
            compiledInstructions: [{
              programIdIndex: 2,
              accountKeyIndexes: [0, 1],
              data: createEscrowInstructionData(),
            }],
          },
        },
        meta: { err: null, loadedAddresses: { writable: [], readonly: [] } },
      };
    },
    async getAccountInfo(received, config) {
      assert.equal(received.toBase58(), escrow.toBase58());
      assert.deepEqual(config, { commitment: 'confirmed', minContextSlot: 42 });
      return accountInfo(programId, { client, agent });
    },
  };

  const result = await verifyEscrowFundingOnChain(
    { escrowPDA: escrow.toBase58(), txSignature: signature, expectedClient: client, expectedAgent: agent },
    { connection, network: 'devnet', programId },
  );

  assert.equal(result.verified, true);
  assert.equal(result.slot, 42);
  assert.equal(result.escrowPDA, escrow.toBase58());
  assert.equal(result.txSignature, signature);
  assert.equal(result.escrowProgramId, programId.toBase58());
  assert.equal(result.client, client.toBase58());
  assert.equal(result.agent, agent.toBase58());
  assert.equal(result.amount, '100');
  assert.equal(result.remaining, '100');
  assert.equal(result.currency, 'SOL');
  assert.equal(result.status, 'Active');
});

test('rejects a transaction that does not create the supplied escrow PDA', async () => {
  const escrow = Keypair.generate().publicKey;
  const programId = Keypair.generate().publicKey;
  const connection = {
    async getTransaction() {
      return {
        slot: 43,
        transaction: { message: { staticAccountKeys: [Keypair.generate().publicKey] } },
        meta: { err: null, loadedAddresses: { writable: [], readonly: [] } },
      };
    },
    async getAccountInfo() { return accountInfo(programId); },
  };

  await assert.rejects(
    verifyEscrowFundingOnChain(
      { escrowPDA: escrow.toBase58(), txSignature: validSignature() },
      { connection, network: 'devnet', programId },
    ),
    (error) => error.code === READBACK_ERROR_CODE
      && error.statusCode === 422
      && error.reason === 'transaction_escrow_mismatch',
  );
});

test('rejects failed transactions and non-SATP escrow account owners', async () => {
  const escrow = Keypair.generate().publicKey;
  const programId = Keypair.generate().publicKey;
  const wrongProgram = Keypair.generate().publicKey;
  const signature = validSignature();

  await assert.rejects(
    verifyEscrowFundingOnChain(
      { escrowPDA: escrow.toBase58(), txSignature: signature },
      {
        network: 'devnet',
        programId,
        connection: {
          async getTransaction() {
            return {
              transaction: { message: { staticAccountKeys: [escrow] } },
              meta: { err: { InstructionError: [0, 'Custom'] } },
            };
          },
        },
      },
    ),
    (error) => error.reason === 'transaction_failed',
  );

  await assert.rejects(
    verifyEscrowFundingOnChain(
      { escrowPDA: escrow.toBase58(), txSignature: signature },
      {
        network: 'devnet',
        programId,
        connection: {
          async getTransaction() {
            return {
              transaction: {
                message: {
                  staticAccountKeys: [escrow, programId],
                  compiledInstructions: [{
                    programIdIndex: 1,
                    accountKeyIndexes: [0],
                    data: createEscrowInstructionData(),
                  }],
                },
              },
              meta: { err: null, loadedAddresses: { writable: [], readonly: [] } },
            };
          },
          async getAccountInfo() { return accountInfo(wrongProgram); },
        },
      },
    ),
    (error) => error.reason === 'escrow_owner_mismatch',
  );
});

test('rejects an escrow owned by a different client', async () => {
  const escrow = Keypair.generate().publicKey;
  const programId = Keypair.generate().publicKey;
  const expectedClient = Keypair.generate().publicKey;
  const actualClient = Keypair.generate().publicKey;
  const transaction = {
    slot: 44,
    transaction: {
      message: {
        staticAccountKeys: [escrow, programId],
        compiledInstructions: [{ programIdIndex: 1, accountKeyIndexes: [0], data: createEscrowInstructionData() }],
      },
    },
    meta: { err: null, loadedAddresses: { writable: [], readonly: [] } },
  };

  await assert.rejects(
    verifyEscrowFundingOnChain(
      { escrowPDA: escrow.toBase58(), txSignature: validSignature(), expectedClient },
      {
        network: 'devnet',
        programId,
        connection: {
          async getTransaction() { return transaction; },
          async getAccountInfo() { return accountInfo(programId, { client: actualClient }); },
        },
      },
    ),
    (error) => error.reason === 'escrow_client_mismatch',
  );
});

test('fails closed on malformed proofs and RPC readback errors', async () => {
  const escrow = Keypair.generate().publicKey;
  const programId = Keypair.generate().publicKey;

  await assert.rejects(
    verifyEscrowFundingOnChain(
      { escrowPDA: escrow.toBase58(), txSignature: 'not-a-signature' },
      { connection: {}, network: 'devnet', programId },
    ),
    (error) => error.statusCode === 400 && error.reason === 'invalid_tx_signature',
  );

  await assert.rejects(
    verifyEscrowFundingOnChain(
      { escrowPDA: escrow.toBase58(), txSignature: validSignature() },
      {
        network: 'devnet',
        programId,
        connection: { async getTransaction() { throw new Error('provider unavailable'); } },
      },
    ),
    (error) => error.statusCode === 503 && error.reason === 'rpc_readback_failed',
  );
});
