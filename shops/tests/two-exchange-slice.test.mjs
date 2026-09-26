import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256Hex } from '../src/payment-contract.mjs';
import {
  BASE_SEPOLIA_USDC,
  TWO_EXCHANGE_LIMITS,
  X402_TEST_FACILITATOR,
  assertBoundedProbe,
  createTwoExchangePair,
  createTwoExchangeReceipt,
  dispatchProductAfterFeeReconciliation,
  readTwoExchangeState,
  reconcileOriginalSettlement,
  settleTwoExchangePair,
  unpaidChallenge,
  verifyTwoExchangeDownload,
  verifyTwoExchangePair,
} from '../src/two-exchange-slice.mjs';

const issuedAt = '2026-09-26T10:00:00.000Z';
const artifactBytes = Buffer.from('bounded two-exchange artifact\n');

function quoteInput(leg, overrides = {}) {
  return {
    productId: `shops-${leg}`,
    productVersion: 'r1',
    artifact: {
      artifactId: `artifact-${leg}`,
      version: '1',
      sha256: sha256Hex(artifactBytes),
      bytes: artifactBytes.length,
      mediaType: 'application/octet-stream',
    },
    payment: {
      network: 'eip155:84532',
      asset: BASE_SEPOLIA_USDC,
      amountMinor: '10000',
      payTo: leg === 'fee' ? '0xfee-test-receiver' : '0xproduct-test-receiver',
    },
    facilitator: { id: X402_TEST_FACILITATOR },
    ...overrides,
  };
}

function pair(orderId = 'order-001') {
  return createTwoExchangePair({ orderId, fee: quoteInput('fee'), product: quoteInput('product') }, issuedAt);
}

function verifiedResult(leg, validBefore = '2026-09-26T10:05:00.000Z') {
  return {
    status: 'verified',
    authorizationId: `authorization-${leg}`,
    paymentFingerprint: `fingerprint-${leg}`,
    validBefore,
  };
}

function settledResult(leg) {
  return {
    status: 'settled',
    settlementId: `settlement-${leg}`,
    transactionHash: `0xtx-${leg}`,
    receiptAt: '2026-09-26T10:00:03.000Z',
    safeAt: '2026-09-26T10:02:03.000Z',
    finalizedAt: '2026-09-26T10:20:03.000Z',
  };
}

async function fullyVerified(input = pair(), adapterOverrides = {}) {
  const adapter = {
    verify: async ({ leg }) => verifiedResult(leg),
    ...adapterOverrides,
  };
  return verifyTwoExchangePair(input, {
    feeEnvelope: { signature: 'fee-signature' },
    productEnvelope: { signature: 'product-signature' },
    adapter,
    at: '2026-09-26T10:00:01.000Z',
  });
}

async function fullyPaid(input = pair()) {
  const verified = await fullyVerified(input);
  return settleTwoExchangePair(verified, {
    adapter: { settle: async ({ leg }) => settledResult(leg) },
    at: '2026-09-26T10:00:02.000Z',
  });
}

function errorCode(code) {
  return (error) => error?.code === code;
}

test('pins the P13 bounds and returns an unpaid 402 with two exchanges', () => {
  assert.deepEqual(TWO_EXCHANGE_LIMITS, {
    quoteTtlSeconds: 600,
    authorizationMaxSeconds: 300,
    admissionMarginSeconds: 60,
    settlementDispatchFloorSeconds: 30,
    maxOrderAmountMinor: 20000n,
    maxAggregateAmountMinor: 200000n,
    maxPairs: 10,
  });
  const snapshot = pair();
  assert.equal(snapshot.expiresAt, '2026-09-26T10:10:00.000Z');
  const challenge = unpaidChallenge(snapshot);
  assert.equal(challenge.status, 402);
  assert.equal(challenge.body.accepts.length, 2);
  assert.notEqual(challenge.body.accepts[0].quoteHash, challenge.body.accepts[1].quoteHash);
});

test('verifies both authorizations concurrently and settles fee before product', async () => {
  const calls = [];
  let started = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const adapter = {
    verify: async ({ leg }) => {
      calls.push(`verify:${leg}`);
      started += 1;
      if (started === 2) release();
      await barrier;
      return verifiedResult(leg);
    },
    settle: async ({ leg }) => {
      calls.push(`settle:${leg}`);
      return settledResult(leg);
    },
  };
  const verified = await verifyTwoExchangePair(pair(), {
    feeEnvelope: { signature: 'fee-signature' },
    productEnvelope: { signature: 'product-signature' },
    adapter,
    at: '2026-09-26T10:00:01.000Z',
  });
  const paid = await settleTwoExchangePair(verified, { adapter, at: '2026-09-26T10:00:02.000Z' });
  assert.equal(paid.state, 'PAID');
  assert.deepEqual(calls, ['verify:fee', 'verify:product', 'settle:fee', 'settle:product']);
});

test('enforces the 60-second admission margin and 30-second dispatch floor', async () => {
  await assert.rejects(() => fullyVerified(pair(), {
    verify: async ({ leg }) => verifiedResult(leg, '2026-09-26T10:01:00.999Z'),
  }), errorCode('PAIR_ADMISSION_CUTOFF'));

  const verified = await fullyVerified(pair(), {
    verify: async ({ leg }) => verifiedResult(leg, '2026-09-26T10:01:01.000Z'),
  });
  await assert.rejects(() => settleTwoExchangePair(verified, {
    adapter: { settle: async ({ leg }) => settledResult(leg) },
    at: '2026-09-26T10:00:31.001Z',
  }), errorCode('SETTLEMENT_DISPATCH_CUTOFF'));
  const paid = await settleTwoExchangePair(verified, {
    adapter: { settle: async ({ leg }) => settledResult(leg) },
    at: '2026-09-26T10:00:31.000Z',
  });
  assert.equal(paid.state, 'PAID');
});

test('fee settlement unknown freezes the original transfer and suppresses product dispatch', async () => {
  const calls = [];
  const verified = await fullyVerified();
  const frozen = await settleTwoExchangePair(verified, {
    adapter: {
      settle: async ({ leg }) => {
        calls.push(leg);
        return { status: 'settlement_pending', settlementId: 'pending-fee', transactionHash: '0xpending-fee' };
      },
    },
    at: '2026-09-26T10:00:02.000Z',
  });
  assert.equal(frozen.state, 'FEE_SETTLEMENT_UNKNOWN');
  assert.equal(frozen.automaticResubmitAllowed, false);
  assert.deepEqual(calls, ['fee']);
  await assert.rejects(() => settleTwoExchangePair(frozen, { adapter: {}, at: '2026-09-26T10:00:03.000Z' }), errorCode('PAIR_FROZEN'));

  const reconciled = reconcileOriginalSettlement(frozen, {
    leg: 'fee',
    authorizationId: frozen.legs.fee.authorizationId,
    paymentFingerprint: frozen.legs.fee.paymentFingerprint,
    result: settledResult('fee'),
    at: '2026-09-26T10:00:04.000Z',
  });
  const paid = await dispatchProductAfterFeeReconciliation(reconciled, {
    adapter: { settle: async ({ leg }) => { calls.push(leg); return settledResult(leg); } },
    at: '2026-09-26T10:00:05.000Z',
  });
  assert.equal(paid.state, 'PAID');
  assert.deepEqual(calls, ['fee', 'product']);
});

test('product settlement unknown reconciles the original product without replacement payment', async () => {
  const calls = [];
  const verified = await fullyVerified();
  const frozen = await settleTwoExchangePair(verified, {
    adapter: {
      settle: async ({ leg }) => {
        calls.push(leg);
        return leg === 'fee' ? settledResult(leg) : { status: 'unknown', settlementId: 'pending-product', transactionHash: '0xpending-product' };
      },
    },
    at: '2026-09-26T10:00:02.000Z',
  });
  assert.equal(frozen.state, 'PRODUCT_SETTLEMENT_UNKNOWN');
  assert.deepEqual(calls, ['fee', 'product']);
  assert.throws(() => reconcileOriginalSettlement(frozen, {
    leg: 'product', authorizationId: 'replacement', paymentFingerprint: frozen.legs.product.paymentFingerprint, result: settledResult('product'), at: '2026-09-26T10:00:03.000Z',
  }), errorCode('RECONCILIATION_TARGET_MISMATCH'));
  const paid = reconcileOriginalSettlement(frozen, {
    leg: 'product', authorizationId: frozen.legs.product.authorizationId, paymentFingerprint: frozen.legs.product.paymentFingerprint, result: settledResult('product'), at: '2026-09-26T10:00:03.000Z',
  });
  assert.equal(paid.state, 'PAID');
  assert.deepEqual(calls, ['fee', 'product']);
});

test('paid readback and receipt bind both transactions and downloaded-file SHA-256', async () => {
  const paid = await fullyPaid();
  const readback = readTwoExchangeState(paid);
  assert.equal(readback.receiptReady, true);
  assert.equal(readback.fee.transactionHash, '0xtx-fee');
  assert.equal(readback.product.transactionHash, '0xtx-product');
  assert.equal('paymentEnvelope' in readback.fee, false);
  const receipt = createTwoExchangeReceipt(paid, artifactBytes, '2026-09-26T10:00:04.000Z');
  const download = verifyTwoExchangeDownload(paid, receipt, artifactBytes);
  assert.equal(download.sha256, sha256Hex(artifactBytes));
  assert.equal(download.headers['Content-Length'], String(artifactBytes.length));
  assert.match(download.headers['Content-Digest'], /^sha-256=:/);
  assert.throws(() => verifyTwoExchangeDownload(paid, receipt, Buffer.from('changed')), errorCode('ARTIFACT_INTEGRITY_FAILED'));
  assert.throws(() => verifyTwoExchangeDownload(paid, { ...receipt, pairHash: 'changed' }, artifactBytes), errorCode('RECEIPT_HASH_MISMATCH'));
});

test('bounded 10-pair probe preserves per-pair fee-first ordering', async () => {
  const traces = new Map();
  const probePairs = Array.from({ length: TWO_EXCHANGE_LIMITS.maxPairs }, (_, index) => pair(`probe-${index}`));
  assert.deepEqual(assertBoundedProbe(probePairs), { pairs: 10, aggregateAmountMinor: '200000' });
  assert.throws(() => assertBoundedProbe([...probePairs, pair('probe-over')]), errorCode('PAIR_LIMIT_EXCEEDED'));
  const jobs = probePairs.map(async (probePair, index) => {
    const orderId = probePair.orderId;
    traces.set(orderId, []);
    const adapter = {
      verify: async ({ leg }) => {
        traces.get(orderId).push(`verify:${leg}`);
        return verifiedResult(`${leg}-${index}`);
      },
      settle: async ({ leg }) => {
        traces.get(orderId).push(`settle:${leg}`);
        return { ...settledResult(`${leg}-${index}`), settlementId: `settlement-${leg}-${index}`, transactionHash: `0xtx-${leg}-${index}` };
      },
    };
    const verified = await verifyTwoExchangePair(probePair, {
      feeEnvelope: { signature: `fee-${index}` }, productEnvelope: { signature: `product-${index}` }, adapter, at: '2026-09-26T10:00:01.000Z',
    });
    return settleTwoExchangePair(verified, { adapter, at: '2026-09-26T10:00:02.000Z' });
  });
  const results = await Promise.all(jobs);
  assert.equal(results.length, 10);
  assert.equal(results.every((result) => result.state === 'PAID'), true);
  for (const trace of traces.values()) {
    assert.equal(trace.indexOf('settle:fee') < trace.indexOf('settle:product'), true);
  }
});

test('rejects mainnet, wrong assets, wrong facilitator, over-limit order, and receipt-before-both-paid', async () => {
  assert.throws(() => createTwoExchangePair({
    orderId: 'mainnet', fee: quoteInput('fee', { payment: { ...quoteInput('fee').payment, network: 'eip155:8453' } }), product: quoteInput('product'),
  }, issuedAt), (error) => ['LIVE_NETWORK_FORBIDDEN', 'QUOTE_BINDING_MISMATCH'].includes(error?.code));
  assert.throws(() => createTwoExchangePair({
    orderId: 'asset', fee: quoteInput('fee', { payment: { ...quoteInput('fee').payment, asset: '0xwrong' } }), product: quoteInput('product'),
  }, issuedAt), errorCode('ASSET_MISMATCH'));
  assert.throws(() => createTwoExchangePair({
    orderId: 'facilitator', fee: quoteInput('fee', { facilitator: { id: 'https://example.invalid' } }), product: quoteInput('product'),
  }, issuedAt), errorCode('FACILITATOR_MISMATCH'));
  assert.throws(() => createTwoExchangePair({
    orderId: 'limit', fee: quoteInput('fee', { payment: { ...quoteInput('fee').payment, amountMinor: '10001' } }), product: quoteInput('product'),
  }, issuedAt), errorCode('ORDER_LIMIT_EXCEEDED'));
  assert.throws(() => createTwoExchangeReceipt(pair(), artifactBytes), errorCode('INVALID_PAIR_TRANSITION'));
});
