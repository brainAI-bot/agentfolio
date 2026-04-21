const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { PublicKey } = require('@solana/web3.js');
const { parseGenesisRecord } = require('../src/v3-explorer');

const GENESIS_DISC = crypto.createHash('sha256')
  .update('account:GenesisRecord')
  .digest()
  .slice(0, 8);

function u32(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value, 0);
  return buf;
}

function i64(value) {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(value), 0);
  return buf;
}

function u64(value) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value), 0);
  return buf;
}

function str(value) {
  const data = Buffer.from(value, 'utf8');
  return Buffer.concat([u32(data.length), data]);
}

function vecStr(values) {
  return Buffer.concat([u32(values.length), ...values.map(str)]);
}

function buildGenesisRecord({ rawReputationScore }) {
  const zero = new PublicKey('11111111111111111111111111111111').toBuffer();
  const authority = new PublicKey(Buffer.alloc(32, 7)).toBuffer();

  return Buffer.concat([
    GENESIS_DISC,
    Buffer.alloc(32, 1),
    str('agent_braintest'),
    str('demo agent'),
    str('ai'),
    vecStr(['search', 'analysis']),
    str('https://example.com/meta.json'),
    str('https://example.com/face.png'),
    zero,
    str(''),
    i64(1713667200),
    Buffer.from([1]),
    authority,
    Buffer.from([0]),
    u64(rawReputationScore),
    Buffer.from([3]),
  ]);
}

describe('v3 explorer score scale regression guard', () => {
  it('uses the same /10000 score normalization as the deep-link score service', () => {
    const record = buildGenesisRecord({ rawReputationScore: 600000 });
    const parsed = parseGenesisRecord('PDA11111111111111111111111111111111111111111', record);

    assert.ok(parsed);
    assert.strictEqual(parsed.rawReputationScore, 600000);
    assert.strictEqual(parsed.reputationScore, 60);
    assert.strictEqual(parsed.verificationLevel, 3);
  });
});
