import { pathToFileURL } from 'node:url';

import {
  BASE_SEPOLIA_USDC,
  X402_TEST_FACILITATOR,
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

export async function runP13PairsSequentially({ jobs }) {
  if (!Array.isArray(jobs) || jobs.length === 0) fail('P13_JOBS_REQUIRED', 'at least one P13 job is required');
  const results = [];
  for (const job of jobs) {
    // Intentionally await the complete fee-then-product settlement before the
    // next pair can dispatch any settlement.
    results.push(await runP13Pair(job));
  }
  return {
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
