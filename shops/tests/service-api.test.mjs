import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CATALOGUE_STATES,
  INERT_CATALOGUE_FIXTURES,
  ORDER_STATES,
  createShopsApi,
} from '../src/service-api.mjs';

const issuedAt = '2026-09-27T12:00:00.000Z';

function clock(...values) {
  const queue = [...values];
  return () => queue.length > 1 ? queue.shift() : queue[0];
}

async function createQuote(api, body = { productId: 'fixture-observer-product', productVersion: '2026.09.1' }) {
  return api.handle({ method: 'POST', path: '/api/shops/v1/quotes', body });
}

async function createOrder(api, quoteId, key = 'order-request-001') {
  const quote = await api.handle({ method: 'GET', path: `/api/shops/v1/quotes/${quoteId}` });
  return api.handle({
    method: 'POST',
    path: '/api/shops/v1/orders',
    headers: { 'Idempotency-Key': key },
    body: { quoteId, quoteHash: quote.body.quote.quoteHash },
  });
}

test('catalogue list and pinned detail are deterministic and observer-safe', async () => {
  const api = createShopsApi({ clock: () => issuedAt });
  const list = await api.handle({ method: 'GET', path: '/api/shops/v1/catalogue' });
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
  assert.deepEqual(list.body.items[0], INERT_CATALOGUE_FIXTURES[0]);
  assert.equal(list.body.items[0].availability, CATALOGUE_STATES.AVAILABLE_FOR_QUOTE);
  assert.equal('payTo' in list.body.items[0].price, false);

  const detail = await api.handle({ method: 'GET', path: '/api/shops/v1/catalogue/fixture-observer-product/versions/2026.09.1' });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.productVersion, '2026.09.1');
  assert.equal(detail.body.artifact.sha256, 'b7edccfe7c5a4c05fa7a6dc21eaa8915a45805603aa42181878c2d51d154e744');
  assert.equal(detail.body.artifact.bytes, 29);
  assert.equal(detail.body.licence.version, '1.0.0');
});

test('quote creation and read pin product, artifact, payment, and licence terms', async () => {
  const api = createShopsApi({ clock: () => issuedAt });
  const created = await createQuote(api);
  assert.equal(created.status, 201);
  assert.equal(created.body.state, 'QUOTED');
  assert.equal(created.body.quote.productVersion, '2026.09.1');
  assert.equal(created.body.quote.artifact.version, '2026.09.1');
  assert.equal(created.body.quote.payment.network, 'eip155:84532');
  assert.equal(created.body.quote.payment.scheme, 'exact');
  assert.equal(created.body.quote.payment.payTo, '<INERT_FIXTURE_RECIPIENT>');
  assert.equal(created.body.licence.reference, 'urn:makings:shops:licence:fixture-evaluation:1.0.0');
  assert.equal(created.body.quote.expiresAt, '2026-09-27T12:10:00.000Z');

  const read = await api.handle({ method: 'GET', path: created.headers.Location });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, created.body);
});

test('same-millisecond quote creates across instances retain unique identities and bindings', async () => {
  const firstApi = createShopsApi({ clock: () => issuedAt });
  const secondApi = createShopsApi({ clock: () => issuedAt });
  const [firstQuote, secondQuote] = await Promise.all([createQuote(firstApi), createQuote(secondApi)]);

  assert.equal(firstQuote.status, 201);
  assert.equal(secondQuote.status, 201);
  assert.notEqual(firstQuote.body.quote.quoteId, secondQuote.body.quote.quoteId);
  assert.notEqual(firstQuote.body.quote.quoteHash, secondQuote.body.quote.quoteHash);
  assert.notEqual(firstQuote.headers.Location, secondQuote.headers.Location);

  const [firstRead, secondRead] = await Promise.all([
    firstApi.handle({ method: 'GET', path: firstQuote.headers.Location }),
    secondApi.handle({ method: 'GET', path: secondQuote.headers.Location }),
  ]);
  assert.deepEqual(firstRead.body, firstQuote.body);
  assert.deepEqual(secondRead.body, secondQuote.body);

  const [firstOrder, secondOrder] = await Promise.all([
    createOrder(firstApi, firstQuote.body.quote.quoteId, 'same-millisecond-order-1'),
    createOrder(secondApi, secondQuote.body.quote.quoteId, 'same-millisecond-order-2'),
  ]);
  assert.equal(firstOrder.status, 201);
  assert.equal(secondOrder.status, 201);
  assert.notEqual(firstOrder.body.orderId, secondOrder.body.orderId);
});

test('injected id source controls deterministic quote and order identities', async () => {
  const ids = ['quote-fixture-id', 'order-fixture-id'];
  const api = createShopsApi({
    clock: clock(issuedAt, '2026-09-27T12:01:00.000Z'),
    idSource: () => ids.shift(),
  });

  const quoted = await createQuote(api);
  assert.equal(quoted.status, 201);
  assert.equal(quoted.body.quote.quoteId, 'quote_quote-fixture-id');

  const ordered = await createOrder(api, quoted.body.quote.quoteId);
  assert.equal(ordered.status, 201);
  assert.equal(ordered.body.orderId, 'order_order-fixture-id');
});

test('order creation is idempotent and starts with payment, finality, and delivery closed', async () => {
  const api = createShopsApi({ clock: clock(issuedAt, '2026-09-27T12:01:00.000Z') });
  const quoted = await createQuote(api);
  const created = await createOrder(api, quoted.body.quote.quoteId);
  assert.equal(created.status, 201);
  assert.equal(created.body.state, ORDER_STATES.PAYMENT_REQUIRED);
  assert.equal(created.body.quote.quoteHash, quoted.body.quote.quoteHash);
  assert.deepEqual(created.body.payment, { state: 'NOT_SUBMITTED', automaticResubmitAllowed: false, failure: null });
  assert.deepEqual(created.body.finality, { state: 'NOT_OBSERVED', safeAt: null, finalizedAt: null, failure: null });
  assert.deepEqual(created.body.delivery, { state: 'BLOCKED', entitlementId: null, receiptId: null, failure: null });

  const replay = await createOrder(api, quoted.body.quote.quoteId);
  assert.equal(replay.status, 200);
  assert.equal(replay.headers['Idempotency-Replayed'], 'true');
  assert.deepEqual(replay.body, created.body);

  const read = await api.handle({ method: 'GET', path: created.headers.Location });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, created.body);
});

test('order creation fails closed on missing key, key conflict, duplicate quote, and expiry', async () => {
  const api = createShopsApi({ clock: clock(
    issuedAt,
    '2026-09-27T12:01:00.000Z',
    '2026-09-27T12:02:00.000Z',
  ) });
  const firstQuote = await createQuote(api);
  const missingKey = await api.handle({
    method: 'POST',
    path: '/api/shops/v1/orders',
    body: { quoteId: firstQuote.body.quote.quoteId, quoteHash: firstQuote.body.quote.quoteHash },
  });
  assert.equal(missingKey.status, 400);
  assert.equal(missingKey.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');

  const firstOrder = await createOrder(api, firstQuote.body.quote.quoteId, 'same-key');
  assert.equal(firstOrder.status, 201);
  const secondQuote = await createQuote(api);
  const conflict = await createOrder(api, secondQuote.body.quote.quoteId, 'same-key');
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'IDEMPOTENCY_CONFLICT');
  const duplicateQuote = await createOrder(api, firstQuote.body.quote.quoteId, 'different-key');
  assert.equal(duplicateQuote.status, 409);
  assert.equal(duplicateQuote.body.error.code, 'QUOTE_ALREADY_ORDERED');
  const mismatch = await api.handle({
    method: 'POST',
    path: '/api/shops/v1/orders',
    headers: { 'Idempotency-Key': 'mismatched-quote' },
    body: { quoteId: secondQuote.body.quote.quoteId, quoteHash: '0'.repeat(64) },
  });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.error.code, 'QUOTE_BINDING_MISMATCH');

  const expiryApi = createShopsApi({ clock: clock(issuedAt, '2026-09-27T12:10:00.001Z') });
  const expiringQuote = await createQuote(expiryApi);
  const expired = await createOrder(expiryApi, expiringQuote.body.quote.quoteId);
  assert.equal(expired.status, 409);
  assert.equal(expired.body.error.code, 'QUOTE_EXPIRED');
});

test('unavailable and unknown catalogue states do not silently create quotes', async () => {
  for (const availability of [CATALOGUE_STATES.UNAVAILABLE, CATALOGUE_STATES.UNKNOWN]) {
    const api = createShopsApi({
      clock: () => issuedAt,
      catalogue: [{ ...INERT_CATALOGUE_FIXTURES[0], availability }],
    });
    const result = await createQuote(api);
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'PRODUCT_UNAVAILABLE');
    assert.equal(result.body.error.details.availability, availability);
  }
});

test('negative route, method, not-found, and validation cases are explicit', async () => {
  const api = createShopsApi({ clock: () => issuedAt });
  const cases = [
    [{ method: 'GET', path: '/api/shops/v1/not-a-route' }, 404, 'ROUTE_NOT_FOUND'],
    [{ method: 'POST', path: '/api/shops/v1/catalogue' }, 405, 'METHOD_NOT_ALLOWED'],
    [{ method: 'GET', path: '/api/shops/v1/quotes' }, 405, 'METHOD_NOT_ALLOWED'],
    [{ method: 'GET', path: '/api/shops/v1/catalogue/missing/versions/1' }, 404, 'CATALOGUE_VERSION_NOT_FOUND'],
    [{ method: 'GET', path: '/api/shops/v1/quotes/missing' }, 404, 'QUOTE_NOT_FOUND'],
    [{ method: 'GET', path: '/api/shops/v1/orders/missing' }, 404, 'ORDER_NOT_FOUND'],
    [{ method: 'GET', path: '/api/shops/v1/quotes/%E0%A4%A' }, 400, 'INVALID_PATH'],
    [{ method: 'POST', path: '/api/shops/v1/quotes', body: null }, 400, 'INVALID_REQUEST'],
    [{ method: 'POST', path: '/api/shops/v1/quotes', body: { productId: 'fixture-observer-product' } }, 400, 'INVALID_REQUEST'],
    [{ method: 'POST', path: '/api/shops/v1/quotes', body: { productId: 'fixture-observer-product', productVersion: '2026.09.1', latest: true } }, 400, 'INVALID_REQUEST'],
  ];
  for (const [request, status, code] of cases) {
    const result = await api.handle(request);
    assert.equal(result.status, status, `${request.method} ${request.path}`);
    assert.equal(result.body.error.code, code, `${request.method} ${request.path}`);
  }
  const wrongMethod = await api.handle({ method: 'DELETE', path: '/api/shops/v1/orders/missing' });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.Allow, 'GET');
});
