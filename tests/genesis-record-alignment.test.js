const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { PublicKey } = require('@solana/web3.js');

const explorer = require('../src/v3-explorer');
const scoreService = require('../src/v3-score-service');
const integrity = require('../tools/integrity-check');

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

function buildGenesisRecord({ includeIsActive, isActive = true, rawReputationScore = 130000, verificationLevel = 3 }) {
  const zero = new PublicKey('11111111111111111111111111111111').toBuffer();
  const authority = new PublicKey(Buffer.alloc(32, 7)).toBuffer();
  const tail = [
    ...(includeIsActive ? [Buffer.from([isActive ? 1 : 0])] : []),
    authority,
    Buffer.from([0]),
    u64(rawReputationScore),
    Buffer.from([verificationLevel]),
    i64(1713667201),
    i64(1713667202),
    i64(1713667203),
    i64(1713667204),
    Buffer.from([255]),
  ];

  return Buffer.concat([
    GENESIS_DISC,
    Buffer.alloc(32, 1),
    str('brainTEST'),
    str('testing'),
    str('general'),
    vecStr([]),
    str(''),
    str(''),
    zero,
    str(''),
    i64(0),
    ...tail,
  ]);
}

describe('Genesis Record truth alignment', () => {
  it('normalizes raw scores consistently across explorer, score service, identity, and checker parsers', () => {
    assert.strictEqual(explorer.normalizeReputationScore(130000), 13);
    assert.strictEqual(scoreService.normalizeReputationScore(130000), 13);
    assert.strictEqual(integrity.normalizeReputationScore(130000), 13);
  });

  it('parses current isActive Genesis layout consistently', () => {
    const record = buildGenesisRecord({ includeIsActive: true });

    const parsedExplorer = explorer.parseGenesisRecord('PDA11111111111111111111111111111111111111111', record);
    const parsedScore = scoreService.parseGenesisRecord(record);
    const parsedIntegrity = integrity.parseGenesisRecord(record);

    for (const parsed of [parsedExplorer, parsedScore, parsedIntegrity]) {
      assert.ok(parsed);
      assert.strictEqual(parsed.rawReputationScore, 130000);
      assert.strictEqual(parsed.reputationScore, 13);
      assert.strictEqual(parsed.verificationLevel, 3);
      assert.strictEqual(parsed.verificationLabel, 'Established');
      assert.strictEqual(parsed.isActive, true);
    }
  });

  it('still parses legacy no-isActive Genesis layout', () => {
    const record = buildGenesisRecord({ includeIsActive: false, rawReputationScore: 600000, verificationLevel: 4 });

    const parsedScore = scoreService.parseGenesisRecord(record);
    const parsedIntegrity = integrity.parseGenesisRecord(record);

    for (const parsed of [parsedScore, parsedIntegrity]) {
      assert.ok(parsed);
      assert.strictEqual(parsed.rawReputationScore, 600000);
      assert.strictEqual(parsed.reputationScore, 60);
      assert.strictEqual(parsed.verificationLevel, 4);
      assert.strictEqual(parsed.verificationLabel, 'Trusted');
      assert.strictEqual(parsed.isActive, true);
    }
  });

  it('documents the expected-unminted team IDs used by the checker', () => {
    assert.deepStrictEqual([...integrity.EXPECTED_UNMINTED_GENESIS_IDS].sort(), [
      'agent_aremes',
      'agent_brainchain',
      'agent_brainforge',
      'agent_braingrowth',
      'agent_brainkid',
      'agent_braintrade',
      'agent_suppi',
    ]);
  });
});
