const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

describe('SATP explorer mainnet pin', () => {
  it('explorer GPA ignores SATP_NETWORK=devnet and a leftover devnet SOLANA_RPC_URL', () => {
    const explorer = fs.readFileSync(path.join(ROOT, 'src', 'v3-explorer.js'), 'utf8');
    const api = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'satp-explorer-api.js'), 'utf8');
    for (const source of [explorer, api]) {
      assert.match(source, /resolveSatpMainnetRpcUrl/);
      assert.doesNotMatch(source, /SATP_NETWORK/);
      assert.doesNotMatch(source, /api\.devnet\.solana\.com/);
      assert.match(source, /if \(rpc && !\/devnet\/i\.test\(rpc\)\) return rpc/);
    }
  });

  it('identity exists/active uses in-repo parseGenesisRecord, not satp-client getGenesisRecord', () => {
    const v3 = fs.readFileSync(path.join(ROOT, 'src', 'routes', 'satp-auto-identity-v3.js'), 'utf8');
    const start = v3.indexOf('async function getV3IdentityStatus');
    const end = v3.indexOf('async function hasV3Identity');
    assert.notEqual(start, -1);
    const fn = v3.slice(start, end);
    assert.match(fn, /parseGenesisRecord/);
    assert.doesNotMatch(fn, /getGenesisRecord/);
    assert.doesNotMatch(fn, /SATPV3SDK/);
  });

  it('in-repo parser decodes the live HmuetLjw genesis layout', () => {
    const { parseGenesisRecord } = require('../src/v3-score-service');
    const { parseGenesisRecord: explorerParse } = require('../src/v3-explorer');
    const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'hmuetljw-genesis.bin'));
    assert.equal(raw.length, 1384);
    const score = parseGenesisRecord(raw);
    assert.equal(score.agentName, 'p1reg_35028542');
    assert.equal(score.isActive, true);
    const explorer = explorerParse('HmuetLjwGoZ3kHt2TKj83pqPYVX9j62mSJWhRw8xAdWg', raw);
    assert.equal(explorer.agentName, 'p1reg_35028542');
    assert.equal(explorer.isActive, true);
    assert.equal(explorer.authority, '2op4BBEhNBEf3qSv9S4p8ph1QSkJFuC4wgrhNFxDJncZ');
  });
});
