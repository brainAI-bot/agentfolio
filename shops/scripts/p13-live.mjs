import { pathToFileURL } from 'node:url';

import {
  BASE_SEPOLIA_USDC,
  X402_TEST_FACILITATOR,
  assertBoundedProbe,
  createTwoExchangePair,
  settleTwoExchangePair,
  verifyTwoExchangePair,
} from '../src/two-exchange-slice.mjs';
import { paymentFingerprint, verifyQuote } from '../src/payment-contract.mjs';

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const PAIR_8_PRODUCT_AUTHORIZATION_DISPOSITION = Object.freeze({
  pair: 8,
  productAuthorization: 'unused',
  replacementAuthorization: 'not_created',
});

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function normalizedAddress(value, field) {
  if (typeof value !== 'string' || !EVM_ADDRESS.test(value)) {
    fail('INVALID_PUBLIC_TEST_ADDRESS', `${field} must be a public EVM test address`);
  }
  return value.toLowerCase();
}

function requireObject(value, code, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code, message);
  return value;
}

export function assertRecipientBindings({ payer, feeRecipient, productRecipient }) {
  const normalized = {
    payer: normalizedAddress(payer, 'payer'),
    feeRecipient: normalizedAddress(feeRecipient, 'feeRecipient'),
    productRecipient: normalizedAddress(productRecipient, 'productRecipient'),
  };
  if (normalized.feeRecipient === normalized.productRecipient) {
    fail('RECIPIENTS_MUST_DIFFER', 'fee and product recipients must be distinct');
  }
  if (normalized.feeRecipient === normalized.payer || normalized.productRecipient === normalized.payer) {
    fail('PAYER_RECIPIENT_FORBIDDEN', 'neither recipient may equal the payer');
  }
  return normalized;
}

export function assertEip3009EnvelopeBinding({ payer, quote, paymentEnvelope }) {
  const normalizedPayer = normalizedAddress(payer, 'payer');
  const authorization = requireObject(
    paymentEnvelope?.authorization,
    'EIP3009_AUTHORIZATION_REQUIRED',
    'paymentEnvelope.authorization is required',
  );
  const from = normalizedAddress(authorization.from, 'paymentEnvelope.authorization.from');
  const to = normalizedAddress(authorization.to, 'paymentEnvelope.authorization.to');
  const payTo = normalizedAddress(quote?.payment?.payTo, 'quote.payment.payTo');
  if (paymentEnvelope?.network !== quote?.payment?.network) {
    fail('EIP3009_NETWORK_MISMATCH', 'EIP-3009 envelope network must equal the quote network');
  }
  if (from !== normalizedPayer) fail('EIP3009_PAYER_MISMATCH', 'EIP-3009 from must equal the payer');
  if (to !== payTo) fail('EIP3009_RECIPIENT_MISMATCH', 'EIP-3009 to must equal quote.payment.payTo');
  if (String(authorization.value) !== quote?.payment?.amountMinor) {
    fail('EIP3009_AMOUNT_MISMATCH', 'EIP-3009 value must equal the quote amount');
  }
  if (typeof paymentEnvelope?.signature !== 'string' || paymentEnvelope.signature.length === 0) {
    fail('EIP3009_SIGNATURE_REQUIRED', 'signed EIP-3009 envelope is required');
  }
  if (typeof authorization.nonce !== 'string' || authorization.nonce.length === 0) {
    fail('EIP3009_NONCE_REQUIRED', 'EIP-3009 authorization nonce is required');
  }
  return { from, to, value: String(authorization.value), nonce: authorization.nonce };
}

const PRIVATE_EVIDENCE_KEYS = new Set([
  'authorization', 'cookie', 'headers', 'keypair', 'mnemonic', 'password',
  'paymentenvelope', 'paymentpayload', 'privatekey', 'request', 'seed',
  'secret', 'signature', 'token',
]);

function isPrivateEvidenceKey(key) {
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return PRIVATE_EVIDENCE_KEYS.has(normalizedKey)
    || /(credential|mnemonic|password|privatekey|refreshtoken|accesstoken|apikey|secret|seed|signature)$/.test(normalizedKey);
}

function reducePublicEvidence(value, depth = 0) {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 6) return '[depth-limited]';
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => reducePublicEvidence(entry, depth + 1));
  if (typeof value !== 'object') return undefined;
  const reduced = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isPrivateEvidenceKey(key)) continue;
    const publicEntry = reducePublicEvidence(entry, depth + 1);
    if (publicEntry !== undefined) reduced[key] = publicEntry;
  }
  return reduced;
}

export function valueReduceFacilitatorSettlementResponse(response) {
  return reducePublicEvidence(response);
}

function valueReduceSettlementError(error) {
  return {
    ...(typeof error?.code === 'string' || typeof error?.code === 'number'
      ? { code: String(error.code) }
      : {}),
    message: typeof error?.message === 'string'
      ? error.message
      : 'facilitator settlement request failed',
  };
}

function authorizationEvidence(quote, paymentEnvelope) {
  const authorizer = normalizedAddress(
    paymentEnvelope.authorization.from,
    'paymentEnvelope.authorization.from',
  );
  return {
    authorizer,
    payer: authorizer,
    authorizationNonce: paymentEnvelope.authorization.nonce,
    paymentFingerprint: paymentFingerprint(paymentEnvelope),
    quoteHash: quote.quoteHash,
    network: quote.payment.network,
    asset: normalizedAddress(quote.payment.asset, 'quote.payment.asset'),
    payTo: normalizedAddress(quote.payment.payTo, 'quote.payment.payTo'),
    amountMinor: quote.payment.amountMinor,
  };
}

function facilitatorRequestBody(quote, paymentEnvelope) {
  return {
    x402Version: 1,
    paymentPayload: paymentEnvelope,
    paymentRequirements: {
      scheme: quote.payment.scheme,
      network: quote.payment.network,
      asset: quote.payment.asset,
      amountMinor: quote.payment.amountMinor,
      payTo: quote.payment.payTo,
      quoteHash: quote.quoteHash,
    },
  };
}

export function assertP13RequestPolicy({ pairHash, quote }) {
  if (typeof pairHash !== 'string' || pairHash.length === 0) fail('PAIR_BINDING_MISMATCH', 'pairHash is required');
  verifyQuote(quote);
  if (quote.payment.network !== 'eip155:84532') fail('LIVE_NETWORK_FORBIDDEN', 'Base Sepolia only');
  if (quote.payment.asset.toLowerCase() !== BASE_SEPOLIA_USDC.toLowerCase()) fail('ASSET_MISMATCH', 'Circle Base Sepolia test USDC required');
  if (quote.facilitator.id !== X402_TEST_FACILITATOR) fail('FACILITATOR_MISMATCH', 'selected test facilitator required');
}

export function createP13LiveAdapter({ payer, feeRecipient, productRecipient, request }) {
  const recipients = assertRecipientBindings({ payer, feeRecipient, productRecipient });
  if (typeof request !== 'function') fail('FACILITATOR_REQUEST_REQUIRED', 'request callback is required');
  const expectedRecipients = Object.freeze({ fee: recipients.feeRecipient, product: recipients.productRecipient });
  const boundPayments = new Map();
  const consumedSettlements = new Map();
  return {
    verify: async ({ pairHash, leg, quote, paymentEnvelope }) => {
      if (!(leg in expectedRecipients)) fail('INVALID_P13_LEG', 'P13 leg must be fee or product');
      const legKey = `${pairHash}:${leg}`;
      assertP13RequestPolicy({ pairHash, quote });
      const quotedRecipient = normalizedAddress(quote?.payment?.payTo, 'quote.payment.payTo');
      if (quotedRecipient !== expectedRecipients[leg]) fail('P13_RECIPIENT_BINDING_MISMATCH', `${leg} quote recipient differs from the configured public test recipient`);
      assertEip3009EnvelopeBinding({ payer: recipients.payer, quote, paymentEnvelope });
      const evidence = authorizationEvidence(quote, paymentEnvelope);
      const body = facilitatorRequestBody(quote, paymentEnvelope);
      if (consumedSettlements.has(legKey)) {
        const consumedBinding = boundPayments.get(legKey);
        if (!consumedBinding || consumedBinding.quoteHash !== quote.quoteHash) fail('PAIR_BINDING_MISMATCH', `${leg} consumed settlement differs from the verified quote`);
        return consumedBinding.verification;
      }
      const facilitatorVerification = await request({ operation: 'verify', facilitator: quote.facilitator.id, leg, body });
      const verification = {
        ...facilitatorVerification,
        paymentFingerprint: evidence.paymentFingerprint,
        authorizationEvidence: evidence,
      };
      boundPayments.set(legKey, { pairHash, leg, quoteHash: quote.quoteHash, paymentEnvelope, body, verification, evidence });
      return verification;
    },
    settle: async ({ pairHash, leg, quote, authorization }) => {
      if (!(leg in expectedRecipients)) fail('INVALID_P13_LEG', 'P13 leg must be fee or product');
      const legKey = `${pairHash}:${leg}`;
      assertP13RequestPolicy({ pairHash, quote });
      const bound = boundPayments.get(legKey);
      if (!bound) fail('UNVERIFIED_SETTLEMENT_FORBIDDEN', `${leg} settlement has no verified bound payment`);
      if (bound.pairHash !== pairHash || bound.leg !== leg || bound.quoteHash !== quote.quoteHash) fail('PAIR_BINDING_MISMATCH', `${leg} settlement differs from the verified pair leg`);
      if (authorization?.authorizationId !== bound.verification?.authorizationId || authorization?.paymentFingerprint !== bound.verification?.paymentFingerprint) {
        fail('VERIFICATION_BINDING_MISMATCH', `${leg} settlement differs from the verified authorization`);
      }
      assertEip3009EnvelopeBinding({ payer: recipients.payer, quote, paymentEnvelope: bound.paymentEnvelope });
      if (consumedSettlements.has(legKey)) return consumedSettlements.get(legKey);
      const settlement = Promise.resolve()
        .then(() => request({ operation: 'settle', facilitator: quote.facilitator.id, leg, body: { ...bound.body, authorization } }))
        .then((facilitatorResponse) => ({
          ...facilitatorResponse,
          settlementEvidence: {
            ...bound.evidence,
            facilitatorResponse: valueReduceFacilitatorSettlementResponse(facilitatorResponse),
            errorReason: typeof facilitatorResponse?.errorReason === 'string' ? facilitatorResponse.errorReason : null,
          },
        }))
        .catch((error) => {
          const reducedError = valueReduceSettlementError(error);
          return {
            status: 'unknown',
            errorReason: reducedError.message,
            settlementEvidence: {
              ...bound.evidence,
              facilitatorResponse: { error: reducedError },
              errorReason: reducedError.message,
            },
          };
        });
      consumedSettlements.set(legKey, settlement);
      return settlement;
    },
  };
}

export function createP13Pair({
  orderId,
  payer,
  feeRecipient,
  productRecipient,
  artifact,
  issuedAt = new Date().toISOString(),
}) {
  assertRecipientBindings({ payer, feeRecipient, productRecipient });
  const quote = (leg, payTo) => ({
    productId: `shops-p13-${leg}`,
    productVersion: 'r1',
    artifact,
    payment: {
      network: 'eip155:84532',
      asset: BASE_SEPOLIA_USDC,
      amountMinor: '10000',
      payTo,
    },
    facilitator: { id: X402_TEST_FACILITATOR },
  });
  return createTwoExchangePair({
    orderId,
    fee: quote('fee', feeRecipient),
    product: quote('product', productRecipient),
  }, issuedAt);
}

export async function runP13Pair({
  pair,
  feeEnvelope,
  productEnvelope,
  adapter,
  verifiedAt = new Date().toISOString(),
  now = () => new Date().toISOString(),
}) {
  const verified = await verifyTwoExchangePair(pair, {
    feeEnvelope,
    productEnvelope,
    adapter,
    at: verifiedAt,
  });
  return settleTwoExchangePair(verified, { adapter, now });
}

export async function runP13PairsSequentially({ jobs, payer }) {
  if (!Array.isArray(jobs) || jobs.length === 0) fail('P13_JOBS_REQUIRED', 'at least one P13 job is required');
  assertBoundedProbe(jobs.map((job) => job?.pair));
  for (const job of jobs) {
    assertRecipientBindings({
      payer,
      feeRecipient: job?.pair?.legs?.fee?.quote?.payment?.payTo,
      productRecipient: job?.pair?.legs?.product?.quote?.payment?.payTo,
    });
  }
  const results = [];
  for (const [index, job] of jobs.entries()) {
    // Await the complete fee-then-product settlement before the next pair can
    // verify or dispatch. Any non-PAID result freezes the remaining probe.
    const result = await runP13Pair(job);
    results.push(result);
    if (result.state !== 'PAID') {
      return {
        completed: false,
        results,
        stoppedAt: { index, orderId: result.orderId, state: result.state },
        priorPair8: PAIR_8_PRODUCT_AUTHORIZATION_DISPOSITION,
      };
    }
  }
  return {
    completed: true,
    results,
    priorPair8: PAIR_8_PRODUCT_AUTHORIZATION_DISPOSITION,
  };
}

function parsePublicInputs(argv) {
  const values = Object.fromEntries(argv.map((entry) => {
    const [key, ...rest] = entry.replace(/^--/, '').split('=');
    return [key, rest.join('=')];
  }));
  return assertRecipientBindings({
    payer: values.payer,
    feeRecipient: values['fee-recipient'],
    productRecipient: values['product-recipient'],
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const recipients = parsePublicInputs(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify({
    ready: true,
    recipients,
    pair8: PAIR_8_PRODUCT_AUTHORIZATION_DISPOSITION,
    fundedRun: false,
    note: 'Public recipient validation only; import runP13PairsSequentially into an explicitly authorized adapter harness.',
  })}\n`);
}
