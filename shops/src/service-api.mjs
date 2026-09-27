import { BASE_SEPOLIA, createQuote, requestFingerprint, resolveIdempotency, sha256Hex } from './payment-contract.mjs';

const API_PREFIX = '/api/shops/v1';
const JSON_HEADERS = Object.freeze({ 'Content-Type': 'application/json; charset=utf-8' });
const QUOTE_TTL_MS = 10 * 60 * 1000;

export const CATALOGUE_STATES = Object.freeze({
  AVAILABLE_FOR_QUOTE: 'AVAILABLE_FOR_QUOTE',
  UNAVAILABLE: 'UNAVAILABLE',
  UNKNOWN: 'UNKNOWN',
});

export const ORDER_STATES = Object.freeze({
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  PAYMENT_UNKNOWN: 'PAYMENT_UNKNOWN',
  PAID_AWAITING_FINALITY: 'PAID_AWAITING_FINALITY',
  READY_FOR_DELIVERY: 'READY_FOR_DELIVERY',
  FAILED: 'FAILED',
});

export const INERT_CATALOGUE_FIXTURES = Object.freeze([
  Object.freeze({
    schemaVersion: 1,
    productId: 'fixture-observer-product',
    productVersion: '2026.09.1',
    title: 'Inert contract fixture',
    summary: 'Synthetic non-sale fixture for Shops API contract tests.',
    availability: CATALOGUE_STATES.AVAILABLE_FOR_QUOTE,
    artifact: Object.freeze({
      artifactId: 'fixture-artifact-2026-09-1',
      version: '2026.09.1',
      sha256: 'b7edccfe7c5a4c05fa7a6dc21eaa8915a45805603aa42181878c2d51d154e744',
      bytes: 29,
      mediaType: 'application/octet-stream',
    }),
    price: Object.freeze({
      scheme: 'exact',
      network: BASE_SEPOLIA,
      asset: 'fixture-base-sepolia-asset',
      amountMinor: '1000',
    }),
    licence: Object.freeze({
      licenceId: 'fixture-evaluation-licence',
      version: '1.0.0',
      reference: 'urn:makings:shops:licence:fixture-evaluation:1.0.0',
    }),
  }),
]);

export class ShopsApiError extends Error {
  constructor(status, code, message = code, details) {
    super(message);
    this.name = 'ShopsApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function fail(status, code, message, details) {
  throw new ShopsApiError(status, code, message, details);
}

function clone(value) {
  return structuredClone(value);
}

function normalizePath(path) {
  if (typeof path !== 'string' || path === '') return '/';
  const pathname = path.split('?')[0];
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function pathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    fail(400, 'INVALID_PATH', 'route path contains malformed percent encoding');
  }
}

function header(headers, name) {
  if (!headers || typeof headers !== 'object') return undefined;
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  return match ? headers[match] : undefined;
}

function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(400, 'INVALID_REQUEST', 'request body must be a JSON object');
  }
  return value;
}

function requireExactFields(value, required, optional = []) {
  const body = requireObject(value);
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length) fail(400, 'INVALID_REQUEST', 'request body contains unknown fields', { fields: unknown.sort() });
  const missing = required.filter((key) => typeof body[key] !== 'string' || body[key].trim() === '');
  if (missing.length) fail(400, 'INVALID_REQUEST', 'request body is missing required fields', { fields: missing });
  return body;
}

function asIso(value, code = 'CLOCK_INVALID') {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) fail(500, code, 'service clock returned an invalid timestamp');
  return date.toISOString();
}

function response(status, body, headers = {}) {
  return { status, headers: { ...JSON_HEADERS, ...headers }, body };
}

function errorResponse(error) {
  if (error instanceof ShopsApiError) {
    return response(error.status, {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
  }
  if (error?.code === 'IDEMPOTENCY_KEY_REQUIRED') {
    return response(400, { error: { code: error.code, message: error.message } });
  }
  if (error?.code === 'IDEMPOTENCY_CONFLICT') {
    return response(409, { error: { code: error.code, message: error.message } });
  }
  if (typeof error?.code === 'string') {
    return response(422, { error: { code: error.code, message: error.message } });
  }
  return response(500, { error: { code: 'INTERNAL_ERROR', message: 'unexpected Shops contract error' } });
}

function catalogueKey(productId, productVersion) {
  return `${productId}\u0000${productVersion}`;
}

function observerCatalogueItem(item) {
  return {
    schemaVersion: item.schemaVersion,
    productId: item.productId,
    productVersion: item.productVersion,
    title: item.title,
    summary: item.summary,
    availability: item.availability,
    artifact: clone(item.artifact),
    price: {
      scheme: item.price?.scheme,
      network: item.price?.network,
      asset: item.price?.asset,
      amountMinor: item.price?.amountMinor,
    },
    licence: clone(item.licence),
  };
}

export function createShopsApi({
  catalogue = INERT_CATALOGUE_FIXTURES,
  clock = () => new Date().toISOString(),
  paymentTerms = {},
} = {}) {
  const catalogueByVersion = new Map();
  for (const item of catalogue) {
    const key = catalogueKey(item.productId, item.productVersion);
    if (catalogueByVersion.has(key)) fail(500, 'DUPLICATE_CATALOGUE_VERSION', 'catalogue product versions must be unique');
    catalogueByVersion.set(key, clone(item));
  }

  const quotes = new Map();
  const orders = new Map();
  const orderClaims = new Map();
  const quoteClaims = new Map();
  let quoteSequence = 0;

  function getCatalogueVersion(productId, productVersion) {
    const item = catalogueByVersion.get(catalogueKey(productId, productVersion));
    if (!item) fail(404, 'CATALOGUE_VERSION_NOT_FOUND', 'catalogue product version was not found');
    return item;
  }

  function listCatalogue() {
    const items = [...catalogueByVersion.values()]
      .map(observerCatalogueItem)
      .sort((a, b) => `${a.productId}:${a.productVersion}`.localeCompare(`${b.productId}:${b.productVersion}`));
    return response(200, { schemaVersion: 1, items });
  }

  function readCatalogue(productId, productVersion) {
    return response(200, observerCatalogueItem(getCatalogueVersion(productId, productVersion)));
  }

  function createQuoteRecord(body) {
    const input = requireExactFields(body, ['productId', 'productVersion']);
    const item = getCatalogueVersion(input.productId, input.productVersion);
    if (item.availability !== CATALOGUE_STATES.AVAILABLE_FOR_QUOTE) {
      fail(409, 'PRODUCT_UNAVAILABLE', 'catalogue product version is not available for quote', { availability: item.availability ?? CATALOGUE_STATES.UNKNOWN });
    }
    const issuedAt = asIso(clock());
    const expiresAt = new Date(new Date(issuedAt).valueOf() + QUOTE_TTL_MS).toISOString();
    quoteSequence += 1;
    const quoteId = `quote_${sha256Hex(`${item.productId}:${item.productVersion}:${issuedAt}:${quoteSequence}`).slice(0, 24)}`;
    const quote = createQuote({
      quoteId,
      productId: item.productId,
      productVersion: item.productVersion,
      artifact: item.artifact,
      payment: {
        scheme: item.price?.scheme,
        network: item.price?.network,
        asset: item.price?.asset,
        amountMinor: item.price?.amountMinor,
        payTo: paymentTerms.payTo ?? '<INERT_FIXTURE_RECIPIENT>',
      },
      facilitator: {
        id: paymentTerms.facilitatorId ?? 'inert-fixture-facilitator-v1',
      },
      expiresAt,
    }, issuedAt);
    const record = {
      schemaVersion: 1,
      state: 'QUOTED',
      quote,
      licence: clone(item.licence),
      availabilityAtIssue: item.availability,
    };
    quotes.set(quote.quoteId, record);
    return response(201, clone(record), { Location: `${API_PREFIX}/quotes/${quote.quoteId}` });
  }

  function readQuote(quoteId) {
    const record = quotes.get(quoteId);
    if (!record) fail(404, 'QUOTE_NOT_FOUND', 'quote was not found');
    return response(200, clone(record));
  }

  function createOrderRecord(request, body) {
    const input = requireExactFields(body, ['quoteId', 'quoteHash']);
    const key = header(request.headers, 'Idempotency-Key');
    const requestHash = requestFingerprint({ method: 'POST', path: `${API_PREFIX}/orders`, body: input });
    const existingClaim = key ? orderClaims.get(key) : undefined;
    const resolution = resolveIdempotency(existingClaim, { key, requestHash });
    if (resolution.action === 'replay') {
      return response(200, clone(resolution.result), { 'Idempotency-Replayed': 'true', Location: `${API_PREFIX}/orders/${resolution.result.orderId}` });
    }

    const quoteRecord = quotes.get(input.quoteId);
    if (!quoteRecord) fail(404, 'QUOTE_NOT_FOUND', 'quote was not found');
    if (input.quoteHash !== quoteRecord.quote.quoteHash) {
      fail(409, 'QUOTE_BINDING_MISMATCH', 'order quoteHash differs from the stored immutable quote');
    }
    const now = asIso(clock());
    if (new Date(now) > new Date(quoteRecord.quote.expiresAt)) {
      fail(409, 'QUOTE_EXPIRED', 'expired quote cannot create an order');
    }
    const claimedOrderId = quoteClaims.get(input.quoteId);
    if (claimedOrderId) {
      fail(409, 'QUOTE_ALREADY_ORDERED', 'quote is already bound to an order', { orderId: claimedOrderId });
    }

    const orderId = `order_${sha256Hex(`${key}:${quoteRecord.quote.quoteHash}`).slice(0, 24)}`;
    const order = {
      schemaVersion: 1,
      orderId,
      state: ORDER_STATES.PAYMENT_REQUIRED,
      quote: clone(quoteRecord.quote),
      licence: clone(quoteRecord.licence),
      createdAt: now,
      updatedAt: now,
      payment: {
        state: 'NOT_SUBMITTED',
        automaticResubmitAllowed: false,
        failure: null,
      },
      finality: {
        state: 'NOT_OBSERVED',
        safeAt: null,
        finalizedAt: null,
        failure: null,
      },
      delivery: {
        state: 'BLOCKED',
        entitlementId: null,
        receiptId: null,
        failure: null,
      },
    };
    orders.set(orderId, order);
    quoteClaims.set(input.quoteId, orderId);
    orderClaims.set(key, { key, requestHash, result: clone(order) });
    return response(201, clone(order), { Location: `${API_PREFIX}/orders/${orderId}` });
  }

  function readOrder(orderId) {
    const order = orders.get(orderId);
    if (!order) fail(404, 'ORDER_NOT_FOUND', 'order was not found');
    return response(200, clone(order));
  }

  function methodNotAllowed(allowed) {
    return response(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'method is not allowed for this route' } }, { Allow: allowed.join(', ') });
  }

  async function handle(request = {}) {
    try {
      const method = typeof request.method === 'string' ? request.method.toUpperCase() : '';
      const path = normalizePath(request.path);
      if (path === `${API_PREFIX}/catalogue`) {
        return method === 'GET' ? listCatalogue() : methodNotAllowed(['GET']);
      }
      const catalogueMatch = path.match(/^\/api\/shops\/v1\/catalogue\/([^/]+)\/versions\/([^/]+)$/);
      if (catalogueMatch) {
        return method === 'GET'
          ? readCatalogue(pathSegment(catalogueMatch[1]), pathSegment(catalogueMatch[2]))
          : methodNotAllowed(['GET']);
      }
      if (path === `${API_PREFIX}/quotes`) {
        return method === 'POST' ? createQuoteRecord(request.body) : methodNotAllowed(['POST']);
      }
      const quoteMatch = path.match(/^\/api\/shops\/v1\/quotes\/([^/]+)$/);
      if (quoteMatch) {
        return method === 'GET' ? readQuote(pathSegment(quoteMatch[1])) : methodNotAllowed(['GET']);
      }
      if (path === `${API_PREFIX}/orders`) {
        return method === 'POST' ? createOrderRecord(request, request.body) : methodNotAllowed(['POST']);
      }
      const orderMatch = path.match(/^\/api\/shops\/v1\/orders\/([^/]+)$/);
      if (orderMatch) {
        return method === 'GET' ? readOrder(pathSegment(orderMatch[1])) : methodNotAllowed(['GET']);
      }
      return response(404, { error: { code: 'ROUTE_NOT_FOUND', message: 'Shops API route was not found' } });
    } catch (error) {
      return errorResponse(error);
    }
  }

  return Object.freeze({ handle });
}
