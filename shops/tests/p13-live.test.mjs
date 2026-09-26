import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  PAIR_8_PRODUCT_AUTHORIZATION_DISPOSITION,
  assertRecipientBindings,
  createP13Pair,
  runP13PairsSequentially,
} from '../scripts/p13-live.mjs';

const payer = '0x1111111111111111111111111111111111111111';
const feeRecipient = '0x2222222222222222222222222222222222222222';
const productRecipient = '0x3333333333333333333333333333333333333333';
const issuedAt = '2026-09-26T15:10:00.000Z';
const artifactBytes = Buffer.from('P13 reviewed runner artifact\n');
const artifact = {
  artifactId: 'p13-reviewed-runner',
  version: '1',
  sha256: createHash('sha256').update(artifactBytes).digest('hex'),
  bytes: artifactBytes.length,
  mediaType: 'application/octet-stream',
};

function createPair(orderId) {
  return createP13Pair({ orderId, payer, feeRecipient, productRecipient, artifact, issuedAt });
}

function adapter(trace, index, settlementGate = async () => {}) {
  return {
    verify: async ({ leg }) => {
      trace.push(`verify:${index}:${leg}`);
      return {
        status: 'verified',
        authorizationId: `authorization-${index}-${leg}`,
        paymentFingerprint: `fingerprint-${index}-${leg}`,
        validBefore: '2026-09-26T15:15:00.000Z',
      };
    },
    settle: async ({ leg }) => {
      trace.push(`settle:start:${index}:${leg}`);
      await settlementGate(index, leg);
      trace.push(`settle:end:${index}:${leg}`);
      return {
        status: 'settled',
        settlementId: `settlement-${index}-${leg}`,
        transactionHash: `0x${String(index).padStart(2, '0')}${leg === 'fee' ? 'f' : 'e'}`,
        receiptAt: '2026-09-26T15:10:03.000Z',
      };
    },
  };
}

function job(index, trace, settlementGate) {
  return {
    pair: createPair(`p13-${index}`),
    feeEnvelope: { signature: `fee-${index}` },
    productEnvelope: { signature: `product-${index}` },
    adapter: adapter(trace, index, settlementGate),
    verifiedAt: '2026-09-26T15:10:01.000Z',
    now: () => '2026-09-26T15:10:02.000Z',
  };
}

function errorCode(code) {
  return (error) => error?.code === code;
}

test('imports and invokes the reviewed two-exchange module', async () => {
  const source = await readFile(new URL('../scripts/p13-live.mjs', import.meta.url), 'utf8');
  assert.match(source, /from '\.\.\/src\/two-exchange-slice\.mjs'/);
  assert.match(source, /verifyTwoExchangePair\(pair/);
  assert.match(source, /settleTwoExchangePair\(verified/);

  const trace = [];
  const { results } = await runP13PairsSequentially({ jobs: [job(1, trace)] });
  assert.equal(results[0].state, 'PAID');
  assert.deepEqual(trace, [
    'verify:1:fee',
    'verify:1:product',
    'settle:start:1:fee',
    'settle:end:1:fee',
    'settle:start:1:product',
    'settle:end:1:product',
  ]);
});

test('binds distinct public fee and product recipients and rejects payer self-payment', () => {
  assert.deepEqual(assertRecipientBindings({ payer, feeRecipient, productRecipient }), {
    payer,
    feeRecipient,
    productRecipient,
  });
  assert.throws(() => assertRecipientBindings({ payer, feeRecipient, productRecipient: feeRecipient }), errorCode('RECIPIENTS_MUST_DIFFER'));
  assert.throws(() => assertRecipientBindings({ payer, feeRecipient: payer, productRecipient }), errorCode('PAYER_RECIPIENT_FORBIDDEN'));
  assert.throws(() => assertRecipientBindings({ payer, feeRecipient, productRecipient: payer.toUpperCase().replace('0X', '0x') }), errorCode('PAYER_RECIPIENT_FORBIDDEN'));
  assert.throws(() => assertRecipientBindings({ payer: 'not-an-address', feeRecipient, productRecipient }), errorCode('INVALID_PUBLIC_TEST_ADDRESS'));

  const pair = createPair('recipient-binding');
  assert.equal(pair.legs.fee.quote.payment.payTo, feeRecipient);
  assert.equal(pair.legs.product.quote.payment.payTo, productRecipient);
  assert.notEqual(pair.legs.fee.quote.payment.payTo, pair.legs.product.quote.payment.payTo);
  assert.notEqual(pair.legs.fee.quote.payment.payTo, payer);
  assert.notEqual(pair.legs.product.quote.payment.payTo, payer);
});

test('awaits each pair settlement before dispatching the next pair', async () => {
  const trace = [];
  let activeSettlements = 0;
  let maximumActiveSettlements = 0;
  const gate = async () => {
    activeSettlements += 1;
    maximumActiveSettlements = Math.max(maximumActiveSettlements, activeSettlements);
    await new Promise((resolve) => setImmediate(resolve));
    activeSettlements -= 1;
  };
  const { results } = await runP13PairsSequentially({ jobs: [job(1, trace, gate), job(2, trace, gate)] });
  assert.equal(results.every((result) => result.state === 'PAID'), true);
  assert.equal(maximumActiveSettlements, 1);
  assert.equal(trace.indexOf('settle:end:1:product') < trace.indexOf('settle:start:2:fee'), true);
});

test('records pair-8 product authorization as unused with no replacement', async () => {
  const trace = [];
  const output = await runP13PairsSequentially({ jobs: [job(9, trace)] });
  assert.deepEqual(PAIR_8_PRODUCT_AUTHORIZATION_DISPOSITION, {
    pair: 8,
    productAuthorization: 'unused',
    replacementAuthorization: 'not_created',
  });
  assert.deepEqual(output.priorPair8, PAIR_8_PRODUCT_AUTHORIZATION_DISPOSITION);
});
