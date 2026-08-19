const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

describe('SATP explorer mainnet pin', () => {
  it('resolveSatpMainnetRpcUrl ignores SATP_NETWORK=devnet and leftover public devnet RPC', () => {
    const previousNet = process.env.SATP_NETWORK;
    const previousRpc = process.env.SOLANA_RPC_URL;
    process.env.SATP_NETWORK = 'devnet';
    process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';
    try {
      const resolved = require.resolve('../src/lib/satp-mainnet-rpc');
      delete require.cache[resolved];
      const { NETWORK, LABEL, resolveSatpMainnetRpcUrl } = require('../src/lib/satp-mainnet-rpc');
      const url = resolveSatpMainnetRpcUrl();
      assert.equal(NETWORK, 'mainnet-beta');
      assert.equal(LABEL, 'mainnet-beta');
      assert.notEqual(url, 'https://api.devnet.solana.com');
      assert.match(url, /mainnet/);
    } finally {
      if (previousNet === undefined) delete process.env.SATP_NETWORK;
      else process.env.SATP_NETWORK = previousNet;
      if (previousRpc === undefined) delete process.env.SOLANA_RPC_URL;
      else process.env.SOLANA_RPC_URL = previousRpc;
      delete require.cache[require.resolve('../src/lib/satp-mainnet-rpc')];
    }
  });

  it('v3-explorer and satp-explorer-api pin GPA via helper, not SATP_NETWORK or public devnet', () => {
    const explorer = fs.readFileSync(path.join(ROOT, 'src', 'v3-explorer.js'), 'utf8');
    const api = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'satp-explorer-api.js'), 'utf8');
    for (const source of [explorer, api]) {
      assert.match(source, /satp-mainnet-rpc/);
      assert.match(source, /resolveSatpMainnetRpcUrl/);
      assert.doesNotMatch(source, /SATP_NETWORK\s*===\s*['"]devnet['"]/);
      assert.doesNotMatch(source, /api\.devnet\.solana\.com/);
    }
  });

  it('getV3IdentityStatus / check path uses parseGenesisRecord, not getGenesisRecord', () => {
    const v3 = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'satp-auto-identity-v3.js'), 'utf8');
    const start = v3.indexOf('async function getV3IdentityStatus');
    const end = v3.indexOf('async function hasV3Identity');
    assert.notEqual(start, -1);
    const fn = v3.slice(start, end);
    assert.match(fn, /parseGenesisRecord/);
    assert.match(fn, /v3-score-service/);
    assert.doesNotMatch(fn, /getGenesisRecord/);
    assert.doesNotMatch(fn, /SATPV3SDK/);
    const checkStart = v3.indexOf("app.get('/api/satp-auto/v3/identity/check/:agentId'");
    assert.notEqual(checkStart, -1);
    const check = v3.slice(checkStart, checkStart + 1200);
    assert.match(check, /getV3IdentityStatus/);
  });

  it('parseGenesisRecord decodes live HmuetLjw account bytes', () => {
    const { parseGenesisRecord } = require('../src/v3-score-service');
    const { parseGenesisRecord: explorerParse } = require('../src/v3-explorer');
    const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'hmuetljw-genesis.bin'));
    assert.equal(raw.length, 1384);
    const score = parseGenesisRecord(raw);
    assert.ok(score);
    assert.equal(score.agentName, 'p1reg_35028542');
    assert.equal(score.isActive, true);
    const explorer = explorerParse('HmuetLjwGoZ3kHt2TKj83pqPYVX9j62mSJWhRw8xAdWg', raw);
    assert.ok(explorer);
    assert.equal(explorer.agentName, 'p1reg_35028542');
    assert.equal(explorer.isActive, true);
  });
});
