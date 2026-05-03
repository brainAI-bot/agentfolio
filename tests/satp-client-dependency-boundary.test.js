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
