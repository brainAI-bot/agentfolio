import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createTwoExchangePair, readTwoExchangeState } from '../src/two-exchange-slice.mjs';

import {
  PAIR_8_PRODUCT_AUTHORIZATION_DISPOSITION,
  assertEip3009EnvelopeBinding,
  assertRecipientBindings,
  createP13LiveAdapter,
  createP13Pair,
  runP13PairsSequentially,
  valueReduceFacilitatorSettlementResponse,
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
        safeAt: '2026-09-26T15:10:04.000Z',
        finalizedAt: '2026-09-26T15:10:05.000Z',
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

function eip3009Envelope({ from = payer, to = feeRecipient, value = '10000', network = 'eip155:84532', nonce = '0xpublic-test-nonce' } = {}) {
  return {
    network,
    payer: from,
    signature: `0xpublic-test-signature-${nonce}`,
    authorization: {
      from,
      to,
      value,
      validAfter: '0',
      validBefore: '1790435700',
      nonce,
    },
  };
}

function errorCode(code) {
  return (error) => error?.code === code;
}

async function runLiveProductOutcome(orderId, productSettlement) {
  const pair = createPair(orderId);
  const liveAdapter = createP13LiveAdapter({
    payer,
    feeRecipient,
    productRecipient,
    request: async ({ operation, leg }) => {
      if (operation === 'verify') {
        return {
          status: 'verified',
          authorizationId: `${orderId}-${leg}`,
          validBefore: '2026-09-26T15:15:00.000Z',
        };
      }
      if (leg === 'fee') {
        return {
          status: 'settled',
          settlementId: `${orderId}-fee`,
          transactionHash: `0x${orderId}-fee`,
          receiptAt: '2026-09-26T15:10:03.000Z',
          safeAt: '2026-09-26T15:10:04.000Z',
          finalizedAt: '2026-09-26T15:10:05.000Z',
        };
      }
      return typeof productSettlement === 'function'
        ? productSettlement()
        : productSettlement;
    },
  });
  return runP13PairsSequentially({
    jobs: [{
      pair,
      feeEnvelope: eip3009Envelope({ to: feeRecipient, nonce: `${orderId}-fee-nonce` }),
      productEnvelope: eip3009Envelope({ to: productRecipient, nonce: `${orderId}-product-nonce` }),
      adapter: liveAdapter,
      verifiedAt: '2026-09-26T15:10:01.000Z',
      now: () => '2026-09-26T15:10:02.000Z',
    }],
    payer,
  });
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
      ? { status: 'settled', settlementId: 'settlement-1-fee', transactionHash: '0x1fee', receiptAt: '2026-09-26T15:10:03.000Z', safeAt: '2026-09-26T15:10:04.000Z', finalizedAt: '2026-09-26T15:10:05.000Z' }
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
    feeRecipient,
    productRecipient,
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
        safeAt: '2026-09-26T15:10:04.000Z',
        finalizedAt: '2026-09-26T15:10:05.000Z',
      };
    },
  });
  const feeEnvelope = eip3009Envelope({ to: feeRecipient, nonce: '0xadapter-fee-nonce' });
  const productEnvelope = eip3009Envelope({ to: productRecipient, nonce: '0xadapter-product-nonce' });
  assert.deepEqual(assertEip3009EnvelopeBinding({ payer, quote: pair.legs.fee.quote, paymentEnvelope: feeEnvelope }), {
    from: payer,
    to: feeRecipient,
    value: '10000',
    nonce: '0xadapter-fee-nonce',
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
    pairHash: pair.pairHash,
    leg: 'fee',
    quote: pair.legs.fee.quote,
    paymentEnvelope: eip3009Envelope({ to: productRecipient }),
  }), errorCode('EIP3009_RECIPIENT_MISMATCH'));
});

test('reviewed live adapter rejects direct payer-to-self quotes before facilitator dispatch', async () => {
  const requests = [];
  const liveAdapter = createP13LiveAdapter({
    payer,
    feeRecipient,
    productRecipient,
    request: async (request) => {
      requests.push(request);
      return { status: 'verified' };
    },
  });
  const selfPair = createTwoExchangePair({
    orderId: 'direct-adapter-payer-to-self',
    fee: {
      productId: 'shops-p13-fee',
      productVersion: 'r1',
      artifact,
      payment: {
        network: 'eip155:84532',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        amountMinor: '10000',
        payTo: payer,
      },
      facilitator: { id: 'https://x402.org/facilitator' },
    },
    product: {
      productId: 'shops-p13-product',
      productVersion: 'r1',
      artifact,
      payment: {
        network: 'eip155:84532',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        amountMinor: '10000',
        payTo: productRecipient,
      },
      facilitator: { id: 'https://x402.org/facilitator' },
    },
  }, issuedAt);

  await assert.rejects(() => liveAdapter.verify({
    pairHash: selfPair.pairHash,
    leg: 'fee',
    quote: selfPair.legs.fee.quote,
    paymentEnvelope: eip3009Envelope({ to: payer }),
  }), errorCode('P13_RECIPIENT_BINDING_MISMATCH'));
  assert.deepEqual(requests, []);
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

test('rejects deserialized quote tampering to Base mainnet USDC and attacker facilitator before dispatch', async () => {
  const tampered = structuredClone(createPair('tampered-mainnet'));
  tampered.legs.fee.quote.payment.network = 'eip155:8453';
  tampered.legs.fee.quote.payment.asset = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  tampered.legs.fee.quote.facilitator.id = 'https://attacker.invalid';
  const trace = [];
  await assert.rejects(() => runP13PairsSequentially({ jobs: [{ ...job(1, trace), pair: tampered }], payer }), errorCode('QUOTE_BINDING_MISMATCH'));
  assert.deepEqual(trace, []);
});

test('fresh-nonce rerun cannot overwrite a consumed pair leg or dispatch it again', async () => {
  const pair = createPair('idempotent-double-run');
  const requests = [];
  const liveAdapter = createP13LiveAdapter({
    payer, feeRecipient, productRecipient,
    request: async (entry) => {
      requests.push(`${entry.operation}:${entry.leg}`);
      if (entry.operation === 'verify') {
        const nonce = entry.body.paymentPayload.authorization.nonce;
        return { status: 'verified', authorizationId: `authorization-${entry.leg}-${nonce}`, paymentFingerprint: `fingerprint-${entry.leg}-${nonce}`, validBefore: '2026-09-26T15:15:00.000Z' };
      }
      return { status: 'settled', settlementId: `settlement-${entry.leg}`, transactionHash: `0x${entry.leg}`, receiptAt: '2026-09-26T15:10:03.000Z', safeAt: '2026-09-26T15:10:04.000Z', finalizedAt: '2026-09-26T15:10:05.000Z' };
    },
  });
  const run = (nonce) => runP13PairsSequentially({ jobs: [{ pair, feeEnvelope: eip3009Envelope({ to: feeRecipient, nonce: `${nonce}-fee` }), productEnvelope: eip3009Envelope({ to: productRecipient, nonce: `${nonce}-product` }), adapter: liveAdapter, verifiedAt: '2026-09-26T15:10:01.000Z', now: () => '2026-09-26T15:10:02.000Z' }], payer });
  const first = (await run('first')).results[0];
  const second = (await run('fresh')).results[0];
  assert.equal(first.state, 'PAID');
  assert.equal(second.state, 'PAID');
  assert.equal(second.legs.fee.authorizationId, first.legs.fee.authorizationId);
  assert.equal(second.legs.product.paymentFingerprint, first.legs.product.paymentFingerprint);
  assert.equal(requests.filter((entry) => entry.startsWith('settle:')).length, 2);
});

test('pair-10 unknown preserves joinable authorization and value-reduced settlement evidence', async () => {
  const jobs = Array.from({ length: 10 }, (_, offset) => {
    const index = offset + 1;
    const pair = createPair(`pair-${index}`);
    const liveAdapter = createP13LiveAdapter({
      payer,
      feeRecipient,
      productRecipient,
      request: async ({ operation, leg }) => {
        if (operation === 'verify') {
          return {
            status: 'verified',
            authorizationId: `authorization-${index}-${leg}`,
            paymentFingerprint: 'facilitator-value-must-not-win',
            validBefore: '2026-09-26T15:15:00.000Z',
          };
        }
        if (index === 10 && leg === 'product') {
          return {
            status: 'unknown',
            transaction: null,
            errorReason: 'upstream settlement status unavailable',
            diagnostic: { code: 'TEMPORARY_UNKNOWN', signature: 'must-not-persist' },
            paymentPayload: { authorization: { nonce: 'must-not-persist' } },
            privateKey: 'must-not-persist',
          };
        }
        return {
          status: 'settled',
          success: true,
          settlementId: `settlement-${index}-${leg}`,
          transactionHash: `0x${index}${leg}`,
          receiptAt: '2026-09-26T15:10:03.000Z',
          safeAt: '2026-09-26T15:10:04.000Z',
          finalizedAt: '2026-09-26T15:10:05.000Z',
        };
      },
    });
    return {
      pair,
      feeEnvelope: eip3009Envelope({ to: feeRecipient, nonce: `0xnonce-${index}-fee` }),
      productEnvelope: eip3009Envelope({ to: productRecipient, nonce: `0xnonce-${index}-product` }),
      adapter: liveAdapter,
      verifiedAt: '2026-09-26T15:10:01.000Z',
      now: () => '2026-09-26T15:10:02.000Z',
    };
  });

  const output = await runP13PairsSequentially({ jobs, payer });
  assert.equal(output.completed, false);
  assert.deepEqual(output.stoppedAt, { index: 9, orderId: 'pair-10', state: 'PRODUCT_SETTLEMENT_UNKNOWN' });
  const product = output.results[9].legs.product;
  assert.equal(product.authorizationEvidence.authorizer, payer);
  assert.equal(product.authorizationEvidence.payer, payer);
  assert.equal(product.authorizationNonce, '0xnonce-10-product');
  assert.equal(product.quoteHash, product.quote.quoteHash);
  assert.equal(product.authorizationEvidence.quoteHash, product.quote.quoteHash);
  assert.equal(product.authorizationEvidence.paymentFingerprint, product.paymentFingerprint);
  assert.equal(product.authorizationEvidence.network, 'eip155:84532');
  assert.equal(product.authorizationEvidence.asset, '0x036cbd53842c5426634e7929541ec2318f3dcf7e');
  assert.equal(product.authorizationEvidence.payTo, productRecipient);
  assert.equal(product.authorizationEvidence.amountMinor, '10000');
  assert.equal(product.settlementEvidence.authorizer, payer);
  assert.equal(product.settlementEvidence.payer, payer);
  assert.equal(product.settlementEvidence.authorizationNonce, '0xnonce-10-product');
  assert.equal(product.settlementEvidence.paymentFingerprint, product.paymentFingerprint);
  assert.equal(product.settlementEvidence.quoteHash, product.quote.quoteHash);
  assert.equal(product.settlementEvidence.network, 'eip155:84532');
  assert.equal(product.settlementEvidence.asset, '0x036cbd53842c5426634e7929541ec2318f3dcf7e');
  assert.equal(product.settlementEvidence.payTo, productRecipient);
  assert.equal(product.settlementEvidence.amountMinor, '10000');
  assert.equal(product.settlementEvidence.errorReason, 'upstream settlement status unavailable');
  assert.deepEqual(product.settlementEvidence.facilitatorResponse, {
    status: 'unknown',
    transaction: null,
    errorReason: 'upstream settlement status unavailable',
    diagnostic: { code: 'TEMPORARY_UNKNOWN' },
  });
  const readback = readTwoExchangeState(output.results[9]);
  assert.equal(readback.asset, '0x036CbD53842c5426634e7929541eC2318f3dCF7e');
  assert.deepEqual({
    authorizer: readback.product.authorizer,
    payer: readback.product.payer,
    nonce: readback.product.authorizationNonce,
    network: readback.product.network,
    asset: readback.product.asset,
    payTo: readback.product.payTo,
    amountMinor: readback.product.amountMinor,
    quoteHash: readback.product.quoteHash,
    paymentFingerprint: readback.product.paymentFingerprint,
  }, {
    authorizer: payer,
    payer,
    nonce: '0xnonce-10-product',
    network: 'eip155:84532',
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    payTo: productRecipient,
    amountMinor: '10000',
    quoteHash: product.quote.quoteHash,
    paymentFingerprint: product.paymentFingerprint,
  });
  const serialized = JSON.stringify(output.results[9]);
  for (const forbidden of ['must-not-persist', 'paymentPayload', 'privateKey', 'signature']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('x402 rejected product settlement preserves the frozen pair and bound evidence', async () => {
  const output = await runLiveProductOutcome('x402-rejected', {
    success: false,
    errorReason: 'invalid_exact_evm_payload_signature',
    transaction: '',
    network: 'eip155:84532',
    payer,
  });
  assert.equal(output.completed, false);
  assert.equal(output.results.length, 1);
  const pair = output.results[0];
  assert.equal(pair.state, 'PRODUCT_SETTLEMENT_REJECTED');
  assert.equal(pair.legs.fee.state, 'SETTLED');
  assert.equal(pair.legs.product.state, 'SETTLEMENT_REJECTED');
  assert.equal(pair.legs.product.authorizationNonce, 'x402-rejected-product-nonce');
  assert.equal(pair.legs.product.settlementEvidence.errorReason, 'invalid_exact_evm_payload_signature');
  assert.equal(pair.legs.product.settlementEvidence.payer, payer);
  assert.equal(pair.legs.product.automaticResubmitAllowed, false);
});

test('x402 success without canonical settlement identifiers freezes as unknown', async () => {
  const output = await runLiveProductOutcome('x402-success-unknown', {
    success: true,
    transaction: '0xabc',
    network: 'eip155:84532',
    payer,
  });
  const pair = output.results[0];
  assert.equal(output.completed, false);
  assert.equal(pair.state, 'PRODUCT_SETTLEMENT_UNKNOWN');
  assert.equal(pair.legs.fee.state, 'SETTLED');
  assert.equal(pair.legs.product.state, 'SETTLEMENT_UNKNOWN');
  assert.equal(pair.legs.product.authorizationNonce, 'x402-success-unknown-product-nonce');
  assert.equal(pair.legs.product.settlementEvidence.facilitatorResponse.success, true);
  assert.equal(pair.legs.product.settlementEvidence.facilitatorResponse.transaction, '0xabc');
  assert.equal(pair.legs.product.automaticResubmitAllowed, false);
});

test('unrecognised product settlement response freezes as unknown', async () => {
  const output = await runLiveProductOutcome('unrecognised-unknown', {});
  const pair = output.results[0];
  assert.equal(output.completed, false);
  assert.equal(pair.state, 'PRODUCT_SETTLEMENT_UNKNOWN');
  assert.equal(pair.legs.product.state, 'SETTLEMENT_UNKNOWN');
  assert.deepEqual(pair.legs.product.settlementEvidence.facilitatorResponse, {});
  assert.equal(pair.legs.product.automaticResubmitAllowed, false);
});

test('explicit failed product settlement preserves the frozen pair and error reason', async () => {
  const output = await runLiveProductOutcome('status-failed', {
    status: 'failed',
    success: false,
    errorReason: 'insufficient_funds',
  });
  const pair = output.results[0];
  assert.equal(output.completed, false);
  assert.equal(pair.state, 'PRODUCT_SETTLEMENT_REJECTED');
  assert.equal(pair.legs.fee.state, 'SETTLED');
  assert.equal(pair.legs.product.authorizationNonce, 'status-failed-product-nonce');
  assert.equal(pair.legs.product.settlementEvidence.errorReason, 'insufficient_funds');
  assert.equal(pair.legs.product.automaticResubmitAllowed, false);
});

test('thrown product settle request freezes as unknown with only reduced public error evidence', async () => {
  const output = await runLiveProductOutcome('request-timeout', () => {
    const error = new Error('facilitator request timed out');
    error.code = 'ETIMEDOUT';
    error.request = { paymentPayload: { signature: 'must-not-persist' } };
    throw error;
  });
  const pair = output.results[0];
  assert.equal(output.completed, false);
  assert.equal(pair.state, 'PRODUCT_SETTLEMENT_UNKNOWN');
  assert.equal(pair.legs.fee.state, 'SETTLED');
  assert.equal(pair.legs.product.state, 'SETTLEMENT_UNKNOWN');
  assert.equal(pair.legs.product.authorizationNonce, 'request-timeout-product-nonce');
  assert.deepEqual(pair.legs.product.settlementEvidence.facilitatorResponse, {
    error: { code: 'ETIMEDOUT', message: 'facilitator request timed out' },
  });
  assert.equal(pair.legs.product.automaticResubmitAllowed, false);
  const serialized = JSON.stringify(pair.legs.product.settlementEvidence);
  assert.equal(serialized.includes('must-not-persist'), false);
  assert.equal(serialized.includes('paymentPayload'), false);
  assert.equal(serialized.includes('signature'), false);
});

test('settlement evidence reducer excludes private request material', () => {
  assert.deepEqual(valueReduceFacilitatorSettlementResponse({
    success: false,
    errorReason: 'unknown',
    headers: { authorization: 'secret' },
    request: { token: 'secret' },
    result: { code: 'UNKNOWN', signature: 'secret' },
  }), {
    success: false,
    errorReason: 'unknown',
    result: { code: 'UNKNOWN' },
  });
});
