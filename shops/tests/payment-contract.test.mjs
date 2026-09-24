import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BASE_MAINNET,
  BASE_SEPOLIA,
  PAYMENT_STATES,
  applyPaymentEvent,
  assertFacilitatorTerms,
  assertPaymentNotReplayed,
  buildDownloadHeaders,
  canonicalJson,
  createQuote,
  createReceipt,
  initialPaymentState,
  paymentFingerprint,
  requestFingerprint,
  resolveIdempotency,
  sha256Hex,
  verifyDownload,
  verifyReceipt,
} from '../src/payment-contract.mjs';

const artifactBytes = Buffer.from('qualified shops artifact\n');
const now = '2026-09-24T01:00:00.000Z';

function quoteInput(overrides = {}) {
  return {
    quoteId: 'quote-001',
    productId: 'shops-test-product',
    productVersion: '1.0.0',
    artifact: {
      artifactId: 'artifact-001',
      version: '1',
      sha256: sha256Hex(artifactBytes),
      bytes: artifactBytes.length,
      mediaType: 'application/octet-stream',
    },
    payment: {
      network: BASE_SEPOLIA,
      asset: 'base-sepolia-test-asset',
      amountMinor: '1000',
      payTo: '<OWNER_PROVISIONED_BASE_SEPOLIA_RECEIVER>',
    },
    facilitator: {
      id: 'qualified-facilitator-config-v1',
    },
    expiresAt: '2026-09-24T01:15:00.000Z',
    ...overrides,
  };
}

function terms(quote, overrides = {}) {
  return {
    quoteId: quote.quoteId,
    quoteHash: quote.quoteHash,
    network: quote.payment.network,
    asset: quote.payment.asset,
    amountMinor: quote.payment.amountMinor,
    payTo: quote.payment.payTo,
    scheme: quote.payment.scheme,
    facilitatorId: quote.facilitator.id,
    ...overrides,
  };
}

function errorCode(code) {
  return (error) => error?.code === code;
}

function paidSnapshot() {
  const quote = createQuote(quoteInput(), now);
  let snapshot = initialPaymentState(quote);
  snapshot = applyPaymentEvent(snapshot, {
    type: 'begin_verification',
    at: '2026-09-24T01:01:00.000Z',
    terms: terms(quote),
    facilitatorId: 'qualified-facilitator-config-v1',
    paymentFingerprint: paymentFingerprint({ network: BASE_SEPOLIA, payer: 'test-payer', signature: 'test-signature' }),
  });
  snapshot = applyPaymentEvent(snapshot, {
    type: 'verification_accepted',
    at: '2026-09-24T01:02:00.000Z',
    terms: terms(quote),
  });
  return applyPaymentEvent(snapshot, {
    type: 'settled',
    at: '2026-09-24T01:03:00.000Z',
    terms: terms(quote),
    settlementId: 'settlement-001',
    transactionHash: '0xtest-transaction-hash',
  });
}

test('accepts an explicit Base Sepolia quote and binds its hash', () => {
  const quote = createQuote(quoteInput(), now);
  assert.equal(quote.payment.network, BASE_SEPOLIA);
  assert.match(quote.quoteHash, /^[a-f0-9]{64}$/);
  assert.equal(createQuote(quoteInput(), now).quoteHash, quote.quoteHash);
});

test('rejects Base mainnet and missing payment bindings', () => {
  assert.throws(() => createQuote(quoteInput({ payment: { ...quoteInput().payment, network: BASE_MAINNET } }), now), errorCode('LIVE_NETWORK_FORBIDDEN'));
  for (const field of ['network', 'asset', 'amountMinor', 'payTo']) {
    const payment = { ...quoteInput().payment };
    delete payment[field];
    assert.throws(() => createQuote(quoteInput({ payment }), now), errorCode('QUOTE_BINDING_MISMATCH'));
  }
});

test('moves through the happy payment and artifact-ready transition', () => {
  const paid = paidSnapshot();
  assert.equal(paid.state, PAYMENT_STATES.PAID);
  const receipt = createReceipt(paid, artifactBytes, '2026-09-24T01:04:00.000Z');
  const ready = applyPaymentEvent(paid, { type: 'artifact_ready', at: '2026-09-24T01:05:00.000Z', receipt, artifactBytes });
  assert.equal(ready.state, PAYMENT_STATES.READY);
  assert.equal(verifyReceipt(ready.receipt), true);
});

test('expired quote cannot begin verification', () => {
  const quote = createQuote(quoteInput(), now);
  assert.throws(() => applyPaymentEvent(initialPaymentState(quote), {
    type: 'begin_verification',
    at: '2026-09-24T01:16:00.000Z',
    terms: terms(quote),
    facilitatorId: 'qualified-facilitator-config-v1',
    paymentFingerprint: 'fingerprint',
  }), errorCode('QUOTE_EXPIRED'));
});

test('facilitator cannot override commerce terms', () => {
  const quote = createQuote(quoteInput(), now);
  for (const [field, value] of [
    ['quoteHash', 'wrong'],
    ['network', BASE_MAINNET],
    ['asset', 'wrong-asset'],
    ['amountMinor', '999'],
    ['payTo', 'wrong-recipient'],
  ]) {
    assert.throws(() => assertFacilitatorTerms(quote, terms(quote, { [field]: value })), errorCode('FACILITATOR_TERM_MISMATCH'));
  }
});

test('same idempotency key and request replays stored result without another effect', () => {
  const requestHash = requestFingerprint({ method: 'POST', path: '/api/shops/v1/purchases', body: { quoteId: 'quote-001' } });
  assert.deepEqual(resolveIdempotency(null, { key: 'idem-001', requestHash }), { action: 'claim', key: 'idem-001', requestHash });
  const replay = resolveIdempotency({ key: 'idem-001', requestHash, result: { purchaseId: 'purchase-001' } }, { key: 'idem-001', requestHash });
  assert.equal(replay.action, 'replay');
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.purchaseId, 'purchase-001');
});

test('idempotency key conflict and cross-quote payment replay fail closed', () => {
  assert.throws(() => resolveIdempotency(
    { key: 'idem-001', requestHash: 'first', result: {} },
    { key: 'idem-001', requestHash: 'second' },
  ), errorCode('IDEMPOTENCY_CONFLICT'));
  assert.throws(() => assertPaymentNotReplayed(
    { quoteId: 'quote-001' },
    { quoteId: 'quote-002' },
  ), errorCode('PAYMENT_REPLAY'));
});

test('timeout or facilitator failure becomes settlement unknown without automatic resubmit', () => {
  const quote = createQuote(quoteInput(), now);
  let snapshot = initialPaymentState(quote);
  snapshot = applyPaymentEvent(snapshot, {
    type: 'begin_verification',
    at: '2026-09-24T01:01:00.000Z',
    terms: terms(quote),
    facilitatorId: 'qualified-facilitator-config-v1',
    paymentFingerprint: 'fingerprint',
  });
  snapshot = applyPaymentEvent(snapshot, { type: 'settlement_unknown', at: '2026-09-24T01:02:00.000Z' });
  assert.equal(snapshot.state, PAYMENT_STATES.SETTLEMENT_UNKNOWN);
  assert.equal(snapshot.automaticResubmitAllowed, false);
  assert.throws(() => createReceipt(snapshot, artifactBytes), errorCode('INVALID_PAYMENT_TRANSITION'));
});

test('reconciliation resolves unknown settlement exactly once', () => {
  const quote = createQuote(quoteInput(), now);
  let snapshot = initialPaymentState(quote);
  snapshot = applyPaymentEvent(snapshot, {
    type: 'begin_verification', at: '2026-09-24T01:01:00.000Z', terms: terms(quote), facilitatorId: 'qualified-facilitator-config-v1', paymentFingerprint: 'fingerprint',
  });
  snapshot = applyPaymentEvent(snapshot, { type: 'settlement_unknown', at: '2026-09-24T01:02:00.000Z' });
  snapshot = applyPaymentEvent(snapshot, {
    type: 'settled', at: '2026-09-24T01:03:00.000Z', terms: terms(quote), settlementId: 'settlement-001', transactionHash: '0xtest',
  });
  assert.equal(snapshot.state, PAYMENT_STATES.PAID);
  assert.throws(() => applyPaymentEvent(snapshot, {
    type: 'settled', at: '2026-09-24T01:04:00.000Z', terms: terms(quote), settlementId: 'settlement-001', transactionHash: '0xtest',
  }), errorCode('INVALID_PAYMENT_TRANSITION'));
});

test('rejected payment creates no receipt or entitlement', () => {
  const quote = createQuote(quoteInput(), now);
  let snapshot = initialPaymentState(quote);
  snapshot = applyPaymentEvent(snapshot, {
    type: 'begin_verification', at: '2026-09-24T01:01:00.000Z', terms: terms(quote), facilitatorId: 'qualified-facilitator-config-v1', paymentFingerprint: 'fingerprint',
  });
  snapshot = applyPaymentEvent(snapshot, { type: 'verification_rejected', at: '2026-09-24T01:02:00.000Z' });
  assert.equal(snapshot.state, PAYMENT_STATES.REJECTED);
  assert.throws(() => createReceipt(snapshot, artifactBytes), errorCode('INVALID_PAYMENT_TRANSITION'));
});

test('receipt hash and artifact download contract detect mutation', () => {
  const receipt = createReceipt(paidSnapshot(), artifactBytes, '2026-09-24T01:04:00.000Z');
  assert.equal(verifyReceipt(receipt), true);
  assert.equal(verifyDownload(receipt, artifactBytes), true);
  const headers = buildDownloadHeaders(receipt);
  assert.equal(headers['Content-Length'], String(artifactBytes.length));
  assert.equal(headers['Content-Type'], 'application/octet-stream');
  assert.match(headers['Content-Digest'], /^sha-256=:/);
  assert.throws(() => verifyReceipt({ ...receipt, amountMinor: '999' }), errorCode('RECEIPT_HASH_MISMATCH'));
  assert.throws(() => verifyDownload(receipt, Buffer.from('wrong bytes')), errorCode('ARTIFACT_INTEGRITY_FAILED'));
});

test('quote terms are deeply immutable after hashing', () => {
  const quote = createQuote(quoteInput(), now);
  assert.equal(Object.isFrozen(quote), true);
  assert.equal(Object.isFrozen(quote.payment), true);
  assert.throws(() => { quote.payment.amountMinor = '999'; }, TypeError);
  assert.equal(quote.payment.amountMinor, '1000');
});

test('scheme and expected facilitator are immutable trust-boundary terms', () => {
  const quote = createQuote(quoteInput(), now);
  assert.throws(() => assertFacilitatorTerms(quote, terms(quote, { scheme: 'upto' })), errorCode('FACILITATOR_TERM_MISMATCH'));
  assert.throws(() => assertFacilitatorTerms(quote, terms(quote, { facilitatorId: 'unexpected-facilitator' })), errorCode('FACILITATOR_TERM_MISMATCH'));
  assert.throws(() => createQuote(quoteInput({ payment: { ...quoteInput().payment, scheme: 'upto' } }), now), errorCode('QUOTE_BINDING_MISMATCH'));
});

test('any previously claimed payment fingerprint must replay through its original idempotency result', () => {
  assert.throws(() => assertPaymentNotReplayed({ quoteId: 'quote-001' }, { quoteId: 'quote-001' }), errorCode('PAYMENT_REPLAY'));
});

test('ready state requires a bound receipt and verified artifact bytes', () => {
  const paid = paidSnapshot();
  const receipt = createReceipt(paid, artifactBytes, '2026-09-24T01:04:00.000Z');
  assert.throws(() => applyPaymentEvent(paid, { type: 'artifact_ready', at: '2026-09-24T01:05:00.000Z' }), errorCode('RECEIPT_HASH_MISMATCH'));
  assert.throws(() => applyPaymentEvent(paid, { type: 'artifact_ready', at: '2026-09-24T01:05:00.000Z', receipt, artifactBytes: Buffer.from('wrong') }), errorCode('ARTIFACT_INTEGRITY_FAILED'));
});

test('event timestamps cannot move backwards', () => {
  const paid = paidSnapshot();
  assert.throws(() => applyPaymentEvent(paid, { type: 'artifact_ready', at: '2026-09-24T01:02:00.000Z' }), errorCode('INVALID_PAYMENT_TRANSITION'));
});

test('an attacker-rehashed malformed receipt is still rejected', () => {
  const receipt = createReceipt(paidSnapshot(), artifactBytes, '2026-09-24T01:04:00.000Z');
  const { receiptHash: ignored, ...unsigned } = { ...receipt, network: BASE_MAINNET };
  const malformed = { ...unsigned, receiptHash: sha256Hex(canonicalJson(unsigned)) };
  assert.throws(() => verifyReceipt(malformed), errorCode('RECEIPT_HASH_MISMATCH'));
});

test('runbook remains inert and names the chain gates', async () => {
  const runbook = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../docs/BASE-SEPOLIA-TEST-PAYMENT-RUNBOOK.md', import.meta.url), 'utf8'));
  assert.match(runbook, /eip155:84532/);
  assert.match(runbook, /eip155:8453/);
  assert.match(runbook, /executes no payment/);
  assert.match(runbook, /OWNER_PROVISIONED_BASE_SEPOLIA_RECEIVER/);
  assert.doesNotMatch(runbook, /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|0x[a-fA-F0-9]{40}/);
});
