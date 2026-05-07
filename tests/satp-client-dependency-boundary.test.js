const test = require('node:test');
const assert = require('node:assert/strict');

const { client } = require('../src/adapters/satp');

test('SATP adapter resolves extracted @brainai/satp-client dependency without embedded fallback', () => {
  const resolved = require.resolve('@brainai/satp-client');
  assert.match(resolved, /node_modules[\/]@brainai[\/]satp-client/);

  const satpClient = client.loadSatpClient();
  assert.equal(client.assertRequiredSatpClientExports(satpClient), true);
  assert.equal(typeof satpClient.SATPSDK, 'function');
  assert.equal(typeof satpClient.SATPV3SDK, 'function');
  assert.equal(typeof satpClient.createSATPClient, 'function');
});

test('legacy SATP deep-require shims resolve against extracted package source paths', () => {
  const shimCases = [
    ['../src/satp-client/src/v3-sdk', 'SATPV3SDK'],
    ['../src/satp-client/src/v3-pda', 'getV3ReviewPDA'],
    ['../src/satp-client/src/borsh-reader', 'BorshReader'],
  ];

  for (const [shimPath, expectedExport] of shimCases) {
    const resolved = require.resolve(shimPath);
    assert.match(resolved, /src[\\/]satp-client[\\/]src[\\/]/);
    const shim = require(shimPath);
    assert.equal(typeof shim[expectedExport], 'function');
  }
});
