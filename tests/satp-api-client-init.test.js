const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('SATP API client init', () => {
  it('defaults the V3 client to the devnet SATP runtime env knobs', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/routes/satp-api.js'), 'utf8');

    assert.match(source, /network:\s*process\.env\.SATP_NETWORK_EFFECTIVE\s*\|\|\s*'devnet'/);
    assert.match(source, /rpcUrl:\s*process\.env\.SATP_RPC_URL\s*\|\|\s*'https:\/\/api\.devnet\.solana\.com'/);
    assert.doesNotMatch(source, /mainnet\.helius-rpc\.com/);
  });
});
