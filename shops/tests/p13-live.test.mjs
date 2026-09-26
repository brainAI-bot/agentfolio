import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createTwoExchangePair } from '../src/two-exchange-slice.mjs';

import {
  PAIR_8_PRODUCT_AUTHORIZATION_DISPOSITION,
  assertEip3009EnvelopeBinding,
  assertRecipientBindings,
  createP13LiveAdapter,
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

function eip3009Envelope({ from = payer, to = feeRecipient, value = '10000', network = 'eip155:84532' } = {}) {
  return {
    network,
    payer: from,
    signature: '0xpublic-test-signature',
    authorization: {
      from,
      to,
      value,
      validAfter: '0',
      validBefore: '1790435700',
      nonce: '0xpublic-test-nonce',
    },
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
  const { results } = await runP13PairsSequentially({ jobs: [job(1, trace)], payer });
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
  const { results } = await runP13PairsSequentially({ jobs: [job(1, trace, gate), job(2, trace, gate)], payer });
  assert.equal(results.every((result) => result.state === 'PAID'), true);
  assert.equal(maximumActiveSettlements, 1);
  assert.equal(trace.indexOf('settle:end:1:product') < trace.indexOf('settle:start:2:fee'), true);
});

test('applies the authoritative bounded-probe gate before any adapter call', async () => {
  const trace = [];
  const jobs = Array.from({ length: 11 }, (_, index) => job(index + 1, trace));
  await assert.rejects(() => runP13PairsSequentially({ jobs, payer }), errorCode('PAIR_LIMIT_EXCEEDED'));
  assert.deepEqual(trace, []);
});

test('stops before the next pair after the first unexpected settlement outcome', async () => {
  const trace = [];
  const first = job(1, trace);
  first.adapter.settle = async ({ leg }) => {
    trace.push(`settle:1:${leg}`);
    return leg === 'fee'
      ? { status: 'settled', settlementId: 'settlement-1-fee', transactionHash: '0x1fee', receiptAt: '2026-09-26T15:10:03.000Z' }
      : { status: 'unknown', settlementId: 'pending-1-product', transactionHash: '0x1pending' };
  };
  const output = await runP13PairsSequentially({ jobs: [first, job(2, trace)], payer });
  assert.equal(output.completed, false);
  assert.deepEqual(output.stoppedAt, { index: 0, orderId: 'p13-1', state: 'PRODUCT_SETTLEMENT_UNKNOWN' });
  assert.equal(output.results.length, 1);
  assert.equal(trace.some((entry) => entry.includes(':2:')), false);
});

test('reviewed live adapter binds quote payTo through EIP-3009 and facilitator requests', async () => {
  const pair = createPair('adapter-binding');
  const requests = [];
  const liveAdapter = createP13LiveAdapter({
    payer,
    request: async (request) => {
      requests.push(request);
      if (request.operation === 'verify') {
        return {
          status: 'verified',
          authorizationId: `authorization-${request.leg}`,
          paymentFingerprint: `fingerprint-${request.leg}`,
          validBefore: '2026-09-26T15:15:00.000Z',
        };
      }
      return {
        status: 'settled',
        settlementId: `settlement-${request.leg}`,
        transactionHash: `0x${request.leg}`,
        receiptAt: '2026-09-26T15:10:03.000Z',
      };
    },
  });
  const feeEnvelope = eip3009Envelope({ to: feeRecipient });
  const productEnvelope = eip3009Envelope({ to: productRecipient });
  assert.deepEqual(assertEip3009EnvelopeBinding({ payer, quote: pair.legs.fee.quote, paymentEnvelope: feeEnvelope }), {
    from: payer,
    to: feeRecipient,
    value: '10000',
  });
  const output = await runP13PairsSequentially({ jobs: [{
    pair,
    feeEnvelope,
    productEnvelope,
    adapter: liveAdapter,
    verifiedAt: '2026-09-26T15:10:01.000Z',
    now: () => '2026-09-26T15:10:02.000Z',
  }], payer });
  assert.equal(output.completed, true);
  assert.deepEqual(requests.map(({ operation, leg }) => `${operation}:${leg}`), [
    'verify:fee', 'verify:product', 'settle:fee', 'settle:product',
  ]);
  for (const request of requests) {
    assert.equal(request.facilitator, 'https://x402.org/facilitator');
    assert.equal(request.body.paymentRequirements.payTo.toLowerCase(), request.body.paymentPayload.authorization.to.toLowerCase());
  }
  await assert.rejects(() => liveAdapter.verify({
    leg: 'fee',
    quote: pair.legs.fee.quote,
    paymentEnvelope: eip3009Envelope({ to: productRecipient }),
  }), errorCode('EIP3009_RECIPIENT_MISMATCH'));
});

test('records pair-8 product authorization as unused with no replacement', async () => {
  const trace = [];
  const output = await runP13PairsSequentially({ jobs: [job(9, trace)], payer });
  assert.deepEqual(PAIR_8_PRODUCT_AUTHORIZATION_DISPOSITION, {
    pair: 8,
    productAuthorization: 'unused',
    replacementAuthorization: 'not_created',
  });
  assert.deepEqual(output.priorPair8, PAIR_8_PRODUCT_AUTHORIZATION_DISPOSITION);
});

test('rejects an externally constructed payer-to-self pair before adapter dispatch', async () => {
  const quote = (leg, payTo) => ({
    productId: `shops-p13-${leg}`,
    productVersion: 'r1',
    artifact,
    payment: {
      network: 'eip155:84532',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      amountMinor: '10000',
      payTo,
    },
    facilitator: { id: 'https://x402.org/facilitator' },
  });
  const pair = createTwoExchangePair({
    orderId: 'external-payer-to-self',
    fee: quote('fee', payer),
    product: quote('product', productRecipient),
  }, issuedAt);
  const trace = [];
  await assert.rejects(() => runP13PairsSequentially({
    jobs: [{
      pair,
      feeEnvelope: { signature: 'fee-external' },
      productEnvelope: { signature: 'product-external' },
      adapter: adapter(trace, 'external'),
      verifiedAt: '2026-09-26T15:10:01.000Z',
      now: () => '2026-09-26T15:10:02.000Z',
    }],
    payer,
  }), errorCode('PAYER_RECIPIENT_FORBIDDEN'));
  assert.deepEqual(trace, []);
});
