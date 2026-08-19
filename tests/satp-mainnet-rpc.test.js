const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const HELPER = path.join(__dirname, '..', 'src', 'lib', 'satp-mainnet-rpc.js');
const SCORE = path.join(__dirname, '..', 'src', 'v3-score-service.js');

test('satp-mainnet-rpc helper exists on disk', () => {
  assert.ok(fs.existsSync(HELPER), 'src/lib/satp-mainnet-rpc.js must exist');
});

test('v3-score-service require of satp-mainnet-rpc resolves', () => {
  const source = fs.readFileSync(SCORE, 'utf8');
  assert.match(source, /require\(['"]\.\/lib\/satp-mainnet-rpc['"]\)/);
  assert.doesNotThrow(() => require(HELPER));
});

test('resolveSatpMainnetRpcUrl ignores leftover devnet RPC', () => {
  const { resolveSatpMainnetRpcUrl } = require(HELPER);
  assert.strictEqual(
    resolveSatpMainnetRpcUrl({ SOLANA_RPC_URL: 'https://api.devnet.solana.com' }),
    'https://api.mainnet-beta.solana.com'
  );
  assert.strictEqual(
    resolveSatpMainnetRpcUrl({ SOLANA_RPC_URL: 'https://devnet.helius-rpc.com/?api-key=x' }),
    'https://api.mainnet-beta.solana.com'
  );
  assert.strictEqual(
    resolveSatpMainnetRpcUrl({ SOLANA_RPC_URL: 'https://mainnet.helius-rpc.com' }),
    'https://mainnet.helius-rpc.com'
  );
  assert.strictEqual(
    resolveSatpMainnetRpcUrl({}),
    'https://api.mainnet-beta.solana.com'
  );
});
