const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const satpApiSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'satp-api.js'),
  'utf8'
);

test('SATP API V3 client defaults to the prod devnet runtime configuration', () => {
  assert.match(satpApiSource, /network:\s*process\.env\.SATP_NETWORK_EFFECTIVE\s*\|\|\s*'devnet'/);
  assert.match(satpApiSource, /rpcUrl:\s*process\.env\.SATP_RPC_URL\s*\|\|\s*'https:\/\/api\.devnet\.solana\.com'/);
  assert.doesNotMatch(satpApiSource, /mainnet\.helius-rpc\.com/);
});
