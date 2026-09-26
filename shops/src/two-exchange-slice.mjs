import { canonicalJson, createQuote, sha256Hex } from './payment-contract.mjs';

export const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
export const X402_TEST_FACILITATOR = 'https://x402.org/facilitator';

export const TWO_EXCHANGE_LIMITS = Object.freeze({
  quoteTtlSeconds: 600,
  authorizationMaxSeconds: 300,
  admissionMarginSeconds: 60,
  settlementDispatchFloorSeconds: 30,
  maxOrderAmountMinor: 20_000n,
  maxAggregateAmountMinor: 200_000n,
  maxPairs: 10,
});

export class TwoExchangeError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'TwoExchangeError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new TwoExchangeError(code, message);
}

function iso(value, code = 'INVALID_TIMESTAMP') {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) fail(code, `${value} is not a valid timestamp`);
  return date.toISOString();
}

function secondsBetween(later, earlier) {
  return (new Date(later).valueOf() - new Date(earlier).valueOf()) / 1000;
}

function clone(value) {
  return structuredClone(value);
}

function assertPairShape(pair) {
  if (!pair || pair.schemaVersion !== 1 || pair.network !== 'eip155:84532') {
    fail('PAIR_BINDING_MISMATCH', 'pair must be the Base Sepolia two-exchange schema');
  }
  const expected = sha256Hex(canonicalJson({
    schemaVersion: pair.schemaVersion,
    orderId: pair.orderId,
    network: pair.network,
    asset: pair.asset,
    facilitator: pair.facilitator,
    issuedAt: pair.issuedAt,
    expiresAt: pair.expiresAt,
    feeQuoteHash: pair.legs?.fee?.quote?.quoteHash,
    productQuoteHash: pair.legs?.product?.quote?.quoteHash,
  }));
  if (pair.pairHash !== expected) fail('PAIR_BINDING_MISMATCH', 'pair hash mismatch');
}

function assertLegQuotes(feeQuote, productQuote) {
  for (const [leg, quote] of [['fee', feeQuote], ['product', productQuote]]) {
    if (quote.payment.network !== 'eip155:84532') fail('LIVE_NETWORK_FORBIDDEN', `${leg} must use Base Sepolia`);
    if (quote.payment.asset.toLowerCase() !== BASE_SEPOLIA_USDC.toLowerCase()) {
      fail('ASSET_MISMATCH', `${leg} must use Circle Base Sepolia USDC`);
    }
    if (quote.facilitator.id !== X402_TEST_FACILITATOR) {
      fail('FACILITATOR_MISMATCH', `${leg} must use the bounded test facilitator`);
    }
  }
  if (feeQuote.issuedAt !== productQuote.issuedAt || feeQuote.expiresAt !== productQuote.expiresAt) {
    fail('PAIR_BINDING_MISMATCH', 'both legs must share one quote snapshot');
  }
  if (secondsBetween(feeQuote.expiresAt, feeQuote.issuedAt) !== TWO_EXCHANGE_LIMITS.quoteTtlSeconds) {
    fail('QUOTE_TTL_MISMATCH', 'quote TTL must be exactly 600 seconds');
  }
  const total = BigInt(feeQuote.payment.amountMinor) + BigInt(productQuote.payment.amountMinor);
  if (total > TWO_EXCHANGE_LIMITS.maxOrderAmountMinor) fail('ORDER_LIMIT_EXCEEDED', 'order exceeds 0.02 test USDC');
}

export function createTwoExchangePair({ orderId, fee, product }, issuedAt = new Date().toISOString()) {
  if (typeof orderId !== 'string' || orderId.trim() === '') fail('PAIR_BINDING_MISMATCH', 'orderId is required');
  const issued = iso(issuedAt);
  const expiresAt = new Date(new Date(issued).valueOf() + TWO_EXCHANGE_LIMITS.quoteTtlSeconds * 1000).toISOString();
  const feeQuote = createQuote({ ...fee, quoteId: `${orderId}:fee`, expiresAt }, issued);
  const productQuote = createQuote({ ...product, quoteId: `${orderId}:product`, expiresAt }, issued);
  assertLegQuotes(feeQuote, productQuote);
  const unsigned = {
    schemaVersion: 1,
    orderId,
    network: 'eip155:84532',
    asset: BASE_SEPOLIA_USDC,
    facilitator: X402_TEST_FACILITATOR,
    issuedAt: issued,
    expiresAt,
    feeQuoteHash: feeQuote.quoteHash,
    productQuoteHash: productQuote.quoteHash,
  };
  return {
    schemaVersion: 1,
    orderId,
    network: unsigned.network,
    asset: unsigned.asset,
    facilitator: unsigned.facilitator,
    issuedAt: issued,
    expiresAt,
    state: 'PAYMENT_REQUIRED',
    pairHash: sha256Hex(canonicalJson(unsigned)),
    legs: {
      fee: { state: 'QUOTED', quote: feeQuote },
      product: { state: 'QUOTED', quote: productQuote },
    },
    automaticResubmitAllowed: false,
    history: [],
  };
}

export function unpaidChallenge(pair) {
  assertPairShape(pair);
  return {
    status: 402,
    body: {
      code: 'PAYMENT_REQUIRED',
      orderId: pair.orderId,
      pairHash: pair.pairHash,
      expiresAt: pair.expiresAt,
      accepts: [pair.legs.fee.quote, pair.legs.product.quote],
    },
  };
}

export function assertBoundedProbe(pairs) {
  if (!Array.isArray(pairs) || pairs.length < 1 || pairs.length > TWO_EXCHANGE_LIMITS.maxPairs) {
    fail('PAIR_LIMIT_EXCEEDED', 'probe must contain between 1 and 10 pairs');
  }
  let aggregate = 0n;
  for (const pair of pairs) {
    assertPairShape(pair);
    aggregate += BigInt(pair.legs.fee.quote.payment.amountMinor);
    aggregate += BigInt(pair.legs.product.quote.payment.amountMinor);
  }
  if (aggregate > TWO_EXCHANGE_LIMITS.maxAggregateAmountMinor) {
    fail('AGGREGATE_LIMIT_EXCEEDED', 'probe exceeds 0.20 test USDC');
  }
  return { pairs: pairs.length, aggregateAmountMinor: aggregate.toString() };
}

function assertAuthorization(leg, result, pair, at) {
  if (result?.status !== 'verified') fail(result?.failureCode ?? 'VERIFICATION_REJECTED', `${leg} authorization was not verified`);
  if (!result.authorizationId || !result.paymentFingerprint) fail('VERIFICATION_BINDING_MISMATCH', `${leg} verification identifiers are required`);
  const validBefore = iso(result.validBefore, 'VERIFICATION_BINDING_MISMATCH');
  const remaining = secondsBetween(validBefore, at);
  if (remaining < TWO_EXCHANGE_LIMITS.admissionMarginSeconds) fail('PAIR_ADMISSION_CUTOFF', `${leg} has less than 60 seconds remaining`);
  if (remaining > TWO_EXCHANGE_LIMITS.authorizationMaxSeconds) fail('AUTHORIZATION_WINDOW_EXCEEDED', `${leg} authorization exceeds 300 seconds`);
  if (new Date(validBefore) > new Date(pair.expiresAt)) fail('AUTHORIZATION_WINDOW_EXCEEDED', `${leg} authorization outlives the quote`);
  return {
    state: 'VERIFIED',
    quote: pair.legs[leg].quote,
    authorizationId: result.authorizationId,
    paymentFingerprint: result.paymentFingerprint,
    validBefore,
    verifiedAt: iso(at),
  };
}

export async function verifyTwoExchangePair(pair, { feeEnvelope, productEnvelope, adapter, at = new Date().toISOString() }) {
  assertPairShape(pair);
  if (pair.state !== 'PAYMENT_REQUIRED') fail('INVALID_PAIR_TRANSITION', `cannot verify from ${pair.state}`);
  const verifiedAt = iso(at);
  if (new Date(verifiedAt) > new Date(pair.expiresAt)) fail('QUOTE_EXPIRED');
  const [feeResult, productResult] = await Promise.all([
    adapter.verify({ leg: 'fee', quote: pair.legs.fee.quote, paymentEnvelope: feeEnvelope }),
    adapter.verify({ leg: 'product', quote: pair.legs.product.quote, paymentEnvelope: productEnvelope }),
  ]);
  const next = clone(pair);
  next.state = 'VERIFIED';
  next.legs.fee = assertAuthorization('fee', feeResult, pair, verifiedAt);
  next.legs.product = assertAuthorization('product', productResult, pair, verifiedAt);
  next.history.push({ type: 'verified_both', at: verifiedAt, state: next.state });
  return next;
}

function assertDispatchable(leg, at) {
  const remaining = secondsBetween(leg.validBefore, at);
  if (remaining < TWO_EXCHANGE_LIMITS.settlementDispatchFloorSeconds) {
    fail('SETTLEMENT_DISPATCH_CUTOFF', 'authorization has less than 30 seconds remaining');
  }
}

function applySettlement(next, legName, result, at) {
  const leg = next.legs[legName];
  if (result?.status === 'settled') {
    if (!result.transactionHash || !result.settlementId) fail('SETTLEMENT_BINDING_MISMATCH', `${legName} settlement identifiers are required`);
    next.legs[legName] = {
      ...leg,
      state: 'SETTLED',
      transactionHash: result.transactionHash,
      settlementId: result.settlementId,
      receiptAt: iso(result.receiptAt ?? at),
      safeAt: result.safeAt ? iso(result.safeAt) : undefined,
      finalizedAt: result.finalizedAt ? iso(result.finalizedAt) : undefined,
    };
    return 'settled';
  }
  if (result?.status === 'settlement_pending' || result?.status === 'unknown') {
    next.legs[legName] = {
      ...leg,
      state: 'SETTLEMENT_UNKNOWN',
      transactionHash: result.transactionHash,
      settlementId: result.settlementId,
      unknownAt: iso(at),
      automaticResubmitAllowed: false,
    };
    next.state = legName === 'fee' ? 'FEE_SETTLEMENT_UNKNOWN' : 'PRODUCT_SETTLEMENT_UNKNOWN';
    next.history.push({ type: `${legName}_settlement_unknown`, at: iso(at), state: next.state });
    return 'unknown';
  }
  fail(result?.failureCode ?? 'SETTLEMENT_REJECTED', `${legName} settlement was rejected`);
}

export async function settleTwoExchangePair(pair, { adapter, at = new Date().toISOString() }) {
  assertPairShape(pair);
  if (pair.state !== 'VERIFIED') fail('PAIR_FROZEN', `cannot dispatch settlement from ${pair.state}`);
  const dispatchedAt = iso(at);
  const next = clone(pair);
  assertDispatchable(next.legs.fee, dispatchedAt);
  const feeResult = await adapter.settle({ leg: 'fee', quote: next.legs.fee.quote, authorization: next.legs.fee });
  if (applySettlement(next, 'fee', feeResult, dispatchedAt) !== 'settled') return next;
  next.state = 'FEE_SETTLED';
  next.history.push({ type: 'fee_settled', at: dispatchedAt, state: next.state });

  assertDispatchable(next.legs.product, dispatchedAt);
  const productResult = await adapter.settle({ leg: 'product', quote: next.legs.product.quote, authorization: next.legs.product });
  if (applySettlement(next, 'product', productResult, dispatchedAt) !== 'settled') return next;
  next.state = 'PAID';
  next.paidAt = dispatchedAt;
  next.history.push({ type: 'product_settled', at: dispatchedAt, state: next.state });
  return next;
}

export function reconcileOriginalSettlement(pair, { leg, authorizationId, paymentFingerprint, result, at = new Date().toISOString() }) {
  assertPairShape(pair);
  const expectedState = leg === 'fee' ? 'FEE_SETTLEMENT_UNKNOWN' : leg === 'product' ? 'PRODUCT_SETTLEMENT_UNKNOWN' : null;
  if (!expectedState || pair.state !== expectedState) fail('RECONCILIATION_TARGET_MISMATCH');
  const original = pair.legs[leg];
  if (authorizationId !== original.authorizationId || paymentFingerprint !== original.paymentFingerprint) {
    fail('RECONCILIATION_TARGET_MISMATCH', 'reconciliation must target the original authorization');
  }
  const next = clone(pair);
  if (applySettlement(next, leg, result, at) !== 'settled') return next;
  next.state = leg === 'fee' ? 'FEE_SETTLED_RECONCILED' : 'PAID';
  if (leg === 'product') next.paidAt = iso(at);
  next.history.push({ type: `${leg}_reconciled`, at: iso(at), state: next.state });
  return next;
}

export async function dispatchProductAfterFeeReconciliation(pair, { adapter, at = new Date().toISOString() }) {
  assertPairShape(pair);
  if (pair.state !== 'FEE_SETTLED_RECONCILED') fail('INVALID_PAIR_TRANSITION');
  const dispatchedAt = iso(at);
  const next = clone(pair);
  assertDispatchable(next.legs.product, dispatchedAt);
  const result = await adapter.settle({ leg: 'product', quote: next.legs.product.quote, authorization: next.legs.product });
  if (applySettlement(next, 'product', result, dispatchedAt) !== 'settled') return next;
  next.state = 'PAID';
  next.paidAt = dispatchedAt;
  next.history.push({ type: 'product_settled_after_fee_reconciliation', at: dispatchedAt, state: next.state });
  return next;
}

export function readTwoExchangeState(pair) {
  assertPairShape(pair);
  const leg = (value) => ({
    state: value.state,
    quoteHash: value.quote.quoteHash,
    authorizationId: value.authorizationId,
    paymentFingerprint: value.paymentFingerprint,
    settlementId: value.settlementId,
    transactionHash: value.transactionHash,
    receiptAt: value.receiptAt,
    safeAt: value.safeAt,
    finalizedAt: value.finalizedAt,
  });
  return {
    orderId: pair.orderId,
    pairHash: pair.pairHash,
    state: pair.state,
    network: pair.network,
    expiresAt: pair.expiresAt,
    fee: leg(pair.legs.fee),
    product: leg(pair.legs.product),
    automaticResubmitAllowed: false,
    receiptReady: pair.state === 'PAID',
  };
}

export function createTwoExchangeReceipt(pair, artifactBytes, issuedAt = new Date().toISOString()) {
  assertPairShape(pair);
  if (pair.state !== 'PAID') fail('INVALID_PAIR_TRANSITION', 'both exchanges must settle before receipt creation');
  const bytes = Buffer.from(artifactBytes);
  const artifact = pair.legs.product.quote.artifact;
  if (bytes.length !== artifact.bytes || sha256Hex(bytes) !== artifact.sha256) fail('ARTIFACT_INTEGRITY_FAILED');
  const receipt = {
    schemaVersion: 1,
    orderId: pair.orderId,
    pairHash: pair.pairHash,
    network: pair.network,
    asset: pair.asset,
    fee: {
      quoteHash: pair.legs.fee.quote.quoteHash,
      paymentFingerprint: pair.legs.fee.paymentFingerprint,
      settlementId: pair.legs.fee.settlementId,
      transactionHash: pair.legs.fee.transactionHash,
    },
    product: {
      quoteHash: pair.legs.product.quote.quoteHash,
      paymentFingerprint: pair.legs.product.paymentFingerprint,
      settlementId: pair.legs.product.settlementId,
      transactionHash: pair.legs.product.transactionHash,
    },
    artifact,
    paidAt: pair.paidAt,
    issuedAt: iso(issuedAt),
  };
  return { ...receipt, receiptHash: sha256Hex(canonicalJson(receipt)) };
}

export function verifyTwoExchangeDownload(pair, receipt, artifactBytes) {
  assertPairShape(pair);
  const { receiptHash, ...unsigned } = receipt ?? {};
  if (!receiptHash || sha256Hex(canonicalJson(unsigned)) !== receiptHash) fail('RECEIPT_HASH_MISMATCH');
  if (pair.state !== 'PAID' || receipt.pairHash !== pair.pairHash) fail('RECEIPT_HASH_MISMATCH');
  for (const leg of ['fee', 'product']) {
    if (receipt[leg]?.transactionHash !== pair.legs[leg].transactionHash || receipt[leg]?.paymentFingerprint !== pair.legs[leg].paymentFingerprint) {
      fail('RECEIPT_HASH_MISMATCH');
    }
  }
  const bytes = Buffer.from(artifactBytes);
  if (bytes.length !== receipt.artifact.bytes || sha256Hex(bytes) !== receipt.artifact.sha256) fail('ARTIFACT_INTEGRITY_FAILED');
  return {
    sha256: sha256Hex(bytes),
    bytes: bytes.length,
    headers: {
      'Content-Length': String(bytes.length),
      'Content-Type': receipt.artifact.mediaType,
      ETag: `"sha256-${receipt.artifact.sha256}"`,
      'Content-Digest': `sha-256=:${Buffer.from(receipt.artifact.sha256, 'hex').toString('base64')}:`,
    },
  };
}
