const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getEscrowV3AuthorityReadback,
  getEscrowV3ReleaseFeeRoutingReadback,
} = require('../src/lib/escrow-v3-authority');

test('certified deployed release interface is reported unsupported without treasury accounts', () => {
  const readback = getEscrowV3AuthorityReadback();

  assert.equal(readback.releaseFeeRouting.status, 'unsupported');
  assert.equal(readback.releaseFeeRouting.supported, false);
  assert.equal(readback.releaseFeeRouting.failClosed, true);
  assert.equal(readback.releaseFeeRouting.requiredAccount, 'treasury');
  assert.deepEqual(readback.releaseFeeRouting.routes.release.accounts, ['escrow', 'client', 'agent']);
  assert.equal(readback.releaseFeeRouting.routes.release.treasuryAccountPresent, false);
  assert.deepEqual(
    readback.releaseFeeRouting.routes.partial_release.accounts,
    ['escrow', 'client', 'agent'],
  );
  assert.equal(readback.releaseFeeRouting.routes.partial_release.treasuryAccountPresent, false);
});

test('release capability opens only when both routes bind a writable treasury', () => {
  const readback = getEscrowV3ReleaseFeeRoutingReadback({
    idl: {
      instructions: ['release', 'partial_release'].map((name) => ({
        name,
        accounts: [
          { name: 'escrow', writable: true },
          { name: 'client', signer: true },
          { name: 'agent', writable: true },
          { name: 'treasury', writable: true },
        ],
      })),
    },
  });

  assert.equal(readback.status, 'supported');
  assert.equal(readback.supported, true);
  assert.equal(readback.failClosed, false);
  assert.equal(readback.routes.release.treasuryAccountWritable, true);
  assert.equal(readback.routes.partial_release.treasuryAccountWritable, true);
});

test('one release route without treasury keeps both builders fail closed', () => {
  const readback = getEscrowV3ReleaseFeeRoutingReadback({
    idl: {
      instructions: [
        { name: 'release', accounts: [{ name: 'treasury', writable: true }] },
        { name: 'partial_release', accounts: [{ name: 'agent', writable: true }] },
      ],
    },
  });

  assert.equal(readback.status, 'unsupported');
  assert.equal(readback.failClosed, true);
});
