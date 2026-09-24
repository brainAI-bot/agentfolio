import { createHash } from 'node:crypto';

export const BASE_SEPOLIA = 'eip155:84532';
export const BASE_MAINNET = 'eip155:8453';

export const PAYMENT_STATES = Object.freeze({
  QUOTED: 'QUOTED',
  EXPIRED: 'EXPIRED',
  VERIFYING: 'VERIFYING',
  REJECTED: 'REJECTED',
  SETTLING: 'SETTLING',
  SETTLEMENT_UNKNOWN: 'SETTLEMENT_UNKNOWN',
  PAID: 'PAID',
  READY: 'READY',
});

export class PaymentContractError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'PaymentContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new PaymentContractError(code, message);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256Hex(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return createHash('sha256').update(bytes).digest('hex');
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function requireString(value, code, field) {
  if (typeof value !== 'string' || value.trim() === '') fail(code, `${field} is required`);
  return value;
}

function requireMinorAmount(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
    fail('QUOTE_BINDING_MISMATCH', 'amountMinor must be a positive decimal string');
  }
  return value;
}

function requireArtifact(artifact) {
  if (!artifact || typeof artifact !== 'object') fail('QUOTE_BINDING_MISMATCH', 'artifact is required');
  const normalized = {
    artifactId: requireString(artifact.artifactId, 'QUOTE_BINDING_MISMATCH', 'artifact.artifactId'),
    version: requireString(artifact.version, 'QUOTE_BINDING_MISMATCH', 'artifact.version'),
    sha256: requireString(artifact.sha256, 'QUOTE_BINDING_MISMATCH', 'artifact.sha256').toLowerCase(),
    bytes: artifact.bytes,
    mediaType: requireString(artifact.mediaType, 'QUOTE_BINDING_MISMATCH', 'artifact.mediaType'),
  };
  if (!/^[a-f0-9]{64}$/.test(normalized.sha256)) fail('QUOTE_BINDING_MISMATCH', 'artifact.sha256 must be hex sha256');
  if (!Number.isSafeInteger(normalized.bytes) || normalized.bytes < 0) fail('QUOTE_BINDING_MISMATCH', 'artifact.bytes must be a non-negative safe integer');
  return normalized;
}

function requireBaseSepolia(payment) {
  if (!payment || typeof payment !== 'object') fail('QUOTE_BINDING_MISMATCH', 'payment is required');
  if (payment.network !== BASE_SEPOLIA) {
    fail(payment.network === BASE_MAINNET ? 'LIVE_NETWORK_FORBIDDEN' : 'QUOTE_BINDING_MISMATCH', 'Wave 1 qualification permits Base Sepolia only');
  }
  const scheme = payment.scheme ?? 'exact';
  if (scheme !== 'exact') fail('QUOTE_BINDING_MISMATCH', 'Wave 1 qualification permits the exact payment scheme only');
  return {
    scheme,
    network: payment.network,
    asset: requireString(payment.asset, 'QUOTE_BINDING_MISMATCH', 'payment.asset'),
    amountMinor: requireMinorAmount(payment.amountMinor),
    payTo: requireString(payment.payTo, 'QUOTE_BINDING_MISMATCH', 'payment.payTo'),
  };
}

export function createQuote(input, now = new Date().toISOString()) {
  const issuedAt = new Date(now);
  const expiresAt = new Date(input?.expiresAt);
  if (Number.isNaN(issuedAt.valueOf()) || Number.isNaN(expiresAt.valueOf()) || expiresAt <= issuedAt) {
    fail('QUOTE_BINDING_MISMATCH', 'expiresAt must be after issuedAt');
  }
  const quote = {
    schemaVersion: 1,
    quoteId: requireString(input?.quoteId, 'QUOTE_BINDING_MISMATCH', 'quoteId'),
    productId: requireString(input?.productId, 'QUOTE_BINDING_MISMATCH', 'productId'),
    productVersion: requireString(input?.productVersion, 'QUOTE_BINDING_MISMATCH', 'productVersion'),
    artifact: requireArtifact(input?.artifact),
    payment: requireBaseSepolia(input?.payment),
    facilitator: {
      id: requireString(input?.facilitator?.id, 'QUOTE_BINDING_MISMATCH', 'facilitator.id'),
    },
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  return deepFreeze({ ...quote, quoteHash: sha256Hex(canonicalJson(quote)) });
}

export function verifyQuote(quote) {
  const { quoteHash, ...unsigned } = quote ?? {};
  if (!quoteHash || sha256Hex(canonicalJson(unsigned)) !== quoteHash) {
    fail('QUOTE_BINDING_MISMATCH', 'quote hash mismatch');
  }
  return true;
}

export function paymentFingerprint(paymentEnvelope) {
  const signature = requireString(paymentEnvelope?.signature, 'QUOTE_BINDING_MISMATCH', 'payment signature');
  return sha256Hex(canonicalJson({
    network: requireString(paymentEnvelope?.network, 'QUOTE_BINDING_MISMATCH', 'payment network'),
    payer: requireString(paymentEnvelope?.payer, 'QUOTE_BINDING_MISMATCH', 'payment payer'),
    signature,
  }));
}

export function requestFingerprint({ method, path, body }) {
  return sha256Hex(canonicalJson({
    method: requireString(method, 'IDEMPOTENCY_KEY_REQUIRED', 'method').toUpperCase(),
    path: requireString(path, 'IDEMPOTENCY_KEY_REQUIRED', 'path'),
    body: body ?? null,
  }));
}

export function resolveIdempotency(existing, incoming) {
  const key = requireString(incoming?.key, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key');
  const requestHash = requireString(incoming?.requestHash, 'IDEMPOTENCY_KEY_REQUIRED', 'requestHash');
  if (!existing) return { action: 'claim', key, requestHash };
  if (existing.key !== key || existing.requestHash !== requestHash) {
    fail('IDEMPOTENCY_CONFLICT', 'idempotency key is already bound to another request');
  }
  return { action: 'replay', key, requestHash, result: existing.result, replayed: true };
}

export function assertPaymentNotReplayed(existingClaim, incoming) {
  if (!existingClaim) return true;
  fail('PAYMENT_REPLAY', `payment fingerprint is already claimed by ${existingClaim.quoteId ?? 'another purchase'}; retry through its original idempotency result`);
}

export function assertFacilitatorTerms(quote, terms) {
  verifyQuote(quote);
  const expected = {
    quoteId: quote.quoteId,
    quoteHash: quote.quoteHash,
    network: quote.payment.network,
    asset: quote.payment.asset,
    amountMinor: quote.payment.amountMinor,
    payTo: quote.payment.payTo,
    scheme: quote.payment.scheme,
    facilitatorId: quote.facilitator.id,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (terms?.[key] !== value) fail('FACILITATOR_TERM_MISMATCH', `${key} differs from the immutable quote`);
  }
  return true;
}

function withHistory(snapshot, event, state, extra = {}) {
  return {
    ...snapshot,
    ...extra,
    state,
    updatedAt: event.at,
    history: [...(snapshot.history ?? []), { type: event.type, at: event.at, state }],
  };
}

function requireState(snapshot, ...states) {
  if (!states.includes(snapshot?.state)) fail('INVALID_PAYMENT_TRANSITION', `${snapshot?.state ?? 'missing'} cannot perform this transition`);
}

function requireReconciliationRejectionEvidence(snapshot, evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    fail('RECONCILIATION_EVIDENCE_REQUIRED', 'reconciliation rejection requires structured evidence');
  }
  if (evidence.originalAuthorizationCannotSettle !== true || evidence.matchingSuccessfulTransferFound !== false) {
    fail('RECONCILIATION_EVIDENCE_REQUIRED', 'evidence must prove the original authorization cannot settle and no successful matching transfer exists');
  }
  const reasonCode = requireString(evidence.reasonCode, 'RECONCILIATION_EVIDENCE_REQUIRED', 'evidence.reasonCode');
  if (!['AUTHORIZATION_REJECTED', 'AUTHORIZATION_EXPIRED', 'AUTHORIZATION_CANCELLED', 'PAYMENT_INVALID'].includes(reasonCode)) {
    fail('RECONCILIATION_EVIDENCE_REQUIRED', 'evidence.reasonCode must be a non-transient terminal result');
  }
  const checkedAt = new Date(evidence.checkedAt);
  if (Number.isNaN(checkedAt.valueOf())) {
    fail('RECONCILIATION_EVIDENCE_REQUIRED', 'evidence.checkedAt must be an ISO timestamp');
  }
  if (checkedAt < new Date(snapshot.updatedAt)) {
    fail('RECONCILIATION_EVIDENCE_REQUIRED', 'evidence cannot predate settlement uncertainty');
  }
  if (evidence.paymentFingerprint !== snapshot.paymentFingerprint) {
    fail('PAYMENT_FINGERPRINT_MISMATCH', 'reconciliation evidence is not for the original payment');
  }
  return {
    originalAuthorizationCannotSettle: true,
    matchingSuccessfulTransferFound: false,
    reasonCode,
    checkedAt: checkedAt.toISOString(),
    paymentFingerprint: snapshot.paymentFingerprint,
  };
}

export function initialPaymentState(quote) {
  verifyQuote(quote);
  return {
    quote,
    state: PAYMENT_STATES.QUOTED,
    createdAt: quote.issuedAt,
    updatedAt: quote.issuedAt,
    history: [],
  };
}

export function applyPaymentEvent(snapshot, event) {
  requireString(event?.type, 'INVALID_PAYMENT_TRANSITION', 'event.type');
  const at = new Date(event?.at);
  if (Number.isNaN(at.valueOf())) fail('INVALID_PAYMENT_TRANSITION', 'event.at must be an ISO timestamp');
  const normalizedEvent = { ...event, at: at.toISOString() };
  verifyQuote(snapshot?.quote);
  if (snapshot?.updatedAt && at < new Date(snapshot.updatedAt)) {
    fail('INVALID_PAYMENT_TRANSITION', 'event timestamps must be monotonic');
  }

  switch (event.type) {
    case 'expire':
      requireState(snapshot, PAYMENT_STATES.QUOTED);
      if (at <= new Date(snapshot.quote.expiresAt)) fail('INVALID_PAYMENT_TRANSITION', 'quote has not expired');
      return withHistory(snapshot, normalizedEvent, PAYMENT_STATES.EXPIRED);
    case 'begin_verification':
      requireState(snapshot, PAYMENT_STATES.QUOTED);
      if (at > new Date(snapshot.quote.expiresAt)) fail('QUOTE_EXPIRED', 'expired quote cannot be verified');
      assertFacilitatorTerms(snapshot.quote, event.terms);
      if (event.paymentEnvelope?.network !== snapshot.quote.payment.network) {
        fail('QUOTE_BINDING_MISMATCH', 'payment envelope network differs from the immutable quote');
      }
      return withHistory(snapshot, normalizedEvent, PAYMENT_STATES.VERIFYING, {
        paymentFingerprint: paymentFingerprint(event.paymentEnvelope),
        facilitatorId: snapshot.quote.facilitator.id,
      });
    case 'verification_rejected':
      requireState(snapshot, PAYMENT_STATES.VERIFYING);
      return withHistory(snapshot, normalizedEvent, PAYMENT_STATES.REJECTED, { failureCode: event.failureCode ?? 'PAYMENT_REJECTED' });
    case 'verification_accepted':
      requireState(snapshot, PAYMENT_STATES.VERIFYING);
      assertFacilitatorTerms(snapshot.quote, event.terms);
      return withHistory(snapshot, normalizedEvent, PAYMENT_STATES.SETTLING);
    case 'settlement_unknown':
      requireState(snapshot, PAYMENT_STATES.VERIFYING, PAYMENT_STATES.SETTLING);
      return withHistory(snapshot, normalizedEvent, PAYMENT_STATES.SETTLEMENT_UNKNOWN, {
        failureCode: 'SETTLEMENT_UNKNOWN',
        automaticResubmitAllowed: false,
      });
    case 'settled':
      requireState(snapshot, PAYMENT_STATES.SETTLING, PAYMENT_STATES.SETTLEMENT_UNKNOWN);
      assertFacilitatorTerms(snapshot.quote, event.terms);
      if (requireString(event.paymentFingerprint, 'PAYMENT_FINGERPRINT_MISMATCH', 'paymentFingerprint') !== snapshot.paymentFingerprint) {
        fail('PAYMENT_FINGERPRINT_MISMATCH', 'settlement is not for the original payment');
      }
      return withHistory(snapshot, normalizedEvent, PAYMENT_STATES.PAID, {
        settlementId: requireString(event.settlementId, 'QUOTE_BINDING_MISMATCH', 'settlementId'),
        transactionHash: requireString(event.transactionHash, 'QUOTE_BINDING_MISMATCH', 'transactionHash'),
        paidAt: at.toISOString(),
        automaticResubmitAllowed: false,
        failureCode: undefined,
      });
    case 'reconciliation_rejected':
      requireState(snapshot, PAYMENT_STATES.SETTLEMENT_UNKNOWN);
      return withHistory(snapshot, normalizedEvent, PAYMENT_STATES.REJECTED, {
        failureCode: event.failureCode ?? 'PAYMENT_REJECTED',
        reconciliationEvidence: requireReconciliationRejectionEvidence(snapshot, event.evidence),
      });
    case 'artifact_ready':
      requireState(snapshot, PAYMENT_STATES.PAID);
      assertReceiptBoundToSnapshot(snapshot, event.receipt);
      verifyDownload(snapshot, event.receipt, event.artifactBytes);
      return withHistory(snapshot, normalizedEvent, PAYMENT_STATES.READY, { receipt: event.receipt });
    default:
      fail('INVALID_PAYMENT_TRANSITION', `unknown event ${event.type}`);
  }
}

export function createReceipt(paidSnapshot, artifactBytes, issuedAt = new Date().toISOString()) {
  requireState(paidSnapshot, PAYMENT_STATES.PAID);
  verifyQuote(paidSnapshot.quote);
  const issued = new Date(issuedAt);
  if (Number.isNaN(issued.valueOf()) || issued < new Date(paidSnapshot.paidAt)) {
    fail('INVALID_PAYMENT_TRANSITION', 'receipt issuance must follow payment');
  }
  const bytes = Buffer.from(artifactBytes);
  const artifact = paidSnapshot.quote.artifact;
  if (bytes.length !== artifact.bytes || sha256Hex(bytes) !== artifact.sha256) {
    fail('ARTIFACT_INTEGRITY_FAILED', 'artifact bytes do not match the immutable quote');
  }
  const receipt = {
    schemaVersion: 1,
    receiptId: sha256Hex(`${paidSnapshot.quote.quoteId}:${paidSnapshot.settlementId}`),
    quoteId: paidSnapshot.quote.quoteId,
    quoteHash: paidSnapshot.quote.quoteHash,
    paymentFingerprint: paidSnapshot.paymentFingerprint,
    settlementId: paidSnapshot.settlementId,
    transactionHash: paidSnapshot.transactionHash,
    network: paidSnapshot.quote.payment.network,
    scheme: paidSnapshot.quote.payment.scheme,
    asset: paidSnapshot.quote.payment.asset,
    amountMinor: paidSnapshot.quote.payment.amountMinor,
    payTo: paidSnapshot.quote.payment.payTo,
    facilitatorId: paidSnapshot.quote.facilitator.id,
    artifact,
    paidAt: paidSnapshot.paidAt,
    issuedAt: issued.toISOString(),
  };
  return { ...receipt, receiptHash: sha256Hex(canonicalJson(receipt)) };
}

export function verifyReceipt(receipt) {
  const { receiptHash, ...unsigned } = receipt ?? {};
  if (!receiptHash || sha256Hex(canonicalJson(unsigned)) !== receiptHash) fail('RECEIPT_HASH_MISMATCH', 'receipt hash mismatch');
  if (receipt.schemaVersion !== 1 || receipt.network !== BASE_SEPOLIA || receipt.scheme !== 'exact') {
    fail('RECEIPT_HASH_MISMATCH', 'receipt schema or payment network is invalid');
  }
  for (const field of ['receiptId', 'quoteId', 'quoteHash', 'paymentFingerprint', 'settlementId', 'transactionHash', 'asset', 'amountMinor', 'payTo', 'facilitatorId', 'paidAt', 'issuedAt']) {
    requireString(receipt[field], 'RECEIPT_HASH_MISMATCH', `receipt.${field}`);
  }
  requireMinorAmount(receipt.amountMinor);
  requireArtifact(receipt.artifact);
  return true;
}

export function assertReceiptBoundToSnapshot(paidSnapshot, receipt) {
  requireState(paidSnapshot, PAYMENT_STATES.PAID, PAYMENT_STATES.READY);
  verifyQuote(paidSnapshot.quote);
  verifyReceipt(receipt);
  const expected = {
    quoteId: paidSnapshot.quote.quoteId,
    quoteHash: paidSnapshot.quote.quoteHash,
    paymentFingerprint: paidSnapshot.paymentFingerprint,
    settlementId: paidSnapshot.settlementId,
    transactionHash: paidSnapshot.transactionHash,
    network: paidSnapshot.quote.payment.network,
    scheme: paidSnapshot.quote.payment.scheme,
    asset: paidSnapshot.quote.payment.asset,
    amountMinor: paidSnapshot.quote.payment.amountMinor,
    payTo: paidSnapshot.quote.payment.payTo,
    facilitatorId: paidSnapshot.quote.facilitator.id,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (receipt[key] !== value) fail('RECEIPT_HASH_MISMATCH', `receipt.${key} is not bound to the paid purchase`);
  }
  if (canonicalJson(receipt.artifact) !== canonicalJson(paidSnapshot.quote.artifact)) {
    fail('RECEIPT_HASH_MISMATCH', 'receipt artifact is not bound to the quote');
  }
  return true;
}

export function verifyDownload(paidOrReadySnapshot, receipt, artifactBytes) {
  assertReceiptBoundToSnapshot(paidOrReadySnapshot, receipt);
  const bytes = Buffer.from(artifactBytes);
  if (bytes.length !== receipt.artifact.bytes || sha256Hex(bytes) !== receipt.artifact.sha256) {
    fail('ARTIFACT_INTEGRITY_FAILED', 'download bytes do not match the receipt');
  }
  return true;
}

export function buildDownloadHeaders(paidOrReadySnapshot, receipt) {
  assertReceiptBoundToSnapshot(paidOrReadySnapshot, receipt);
  return {
    'Content-Type': receipt.artifact.mediaType,
    'Content-Length': String(receipt.artifact.bytes),
    ETag: `"sha256-${receipt.artifact.sha256}"`,
    'Content-Digest': `sha-256=:${Buffer.from(receipt.artifact.sha256, 'hex').toString('base64')}:`,
    'Cache-Control': 'private, no-store',
  };
}
