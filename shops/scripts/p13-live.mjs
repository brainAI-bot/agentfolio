import { pathToFileURL } from 'node:url';

import {
  BASE_SEPOLIA_USDC,
  X402_TEST_FACILITATOR,
  assertBoundedProbe,
  createTwoExchangePair,
  settleTwoExchangePair,
  verifyTwoExchangePair,
} from '../src/two-exchange-slice.mjs';

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
  return { from, to, value: String(authorization.value) };
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

export function createP13LiveAdapter({ payer, request }) {
  normalizedAddress(payer, 'payer');
  if (typeof request !== 'function') fail('FACILITATOR_REQUEST_REQUIRED', 'request callback is required');
  const boundPayments = new Map();
  return {
    verify: async ({ leg, quote, paymentEnvelope }) => {
      assertEip3009EnvelopeBinding({ payer, quote, paymentEnvelope });
      const body = facilitatorRequestBody(quote, paymentEnvelope);
      if (normalizedAddress(body.paymentRequirements.payTo, 'paymentRequirements.payTo')
        !== normalizedAddress(paymentEnvelope.authorization.to, 'paymentEnvelope.authorization.to')) {
        fail('FACILITATOR_RECIPIENT_MISMATCH', `${leg} facilitator request recipient differs from the signed target`);
      }
      boundPayments.set(quote.quoteHash, { paymentEnvelope, body });
      return request({ operation: 'verify', facilitator: quote.facilitator.id, leg, body });
    },
    settle: async ({ leg, quote, authorization }) => {
      const bound = boundPayments.get(quote.quoteHash);
      if (!bound) fail('UNVERIFIED_SETTLEMENT_FORBIDDEN', `${leg} settlement has no verified bound payment`);
      assertEip3009EnvelopeBinding({ payer, quote, paymentEnvelope: bound.paymentEnvelope });
      return request({
        operation: 'settle',
        facilitator: quote.facilitator.id,
        leg,
        body: { ...bound.body, authorization },
      });
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
