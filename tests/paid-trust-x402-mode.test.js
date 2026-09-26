const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  PAID_TRUST_X402_ROUTES,
  paidTrustPricingEntries,
  paidTrustX402ModeGate,
  resolvePaidTrustX402Mode,
} = require('../src/lib/paid-trust-x402-mode');

const ORIGINAL_MODE = process.env.PAID_TRUST_X402_MODE;

test.afterEach(() => {
  if (ORIGINAL_MODE === undefined) delete process.env.PAID_TRUST_X402_MODE;
  else process.env.PAID_TRUST_X402_MODE = ORIGINAL_MODE;
});

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function requestFor(pathname, headers = {}) {
  return { method: 'GET', path: pathname, originalUrl: pathname, headers };
}

function invokeGate(pathname, mode, headers = {}) {
  if (mode === undefined) delete process.env.PAID_TRUST_X402_MODE;
  else process.env.PAID_TRUST_X402_MODE = mode;
  const req = requestFor(pathname, headers);
  const res = responseRecorder();
  let nextCalls = 0;
  paidTrustX402ModeGate(req, res, () => { nextCalls += 1; });
  return { req, res, nextCalls };
}

const concretePaidPaths = [
  '/api/score',
  '/api/profile/agent-123/trust-score',
  '/api/leaderboard/scores',
];

const mixedCasePaidPaths = [
  '/API/Score',
  '/api/Profile/agent-123/Trust-Score',
  '/api/Leaderboard/Scores',
];

test('allowlist covers exactly the three paid trust-score contracts', () => {
  assert.deepEqual(PAID_TRUST_X402_ROUTES.map(({ method, path }) => `${method} ${path}`), [
    'GET /api/score',
    'GET /api/profile/:id/trust-score',
    'GET /api/leaderboard/scores',
  ]);
});

test('missing and enabled mode preserve payment middleware behavior on every paid route', () => {
  for (const mode of [undefined, '', 'enabled', ' ENABLED ']) {
    for (const pathname of concretePaidPaths) {
      const { res, nextCalls } = invokeGate(pathname, mode);
      assert.equal(nextCalls, 1, `${pathname} should continue in mode ${String(mode)}`);
      assert.equal(res.statusCode, null);
    }
  }
  assert.equal(resolvePaidTrustX402Mode(undefined), 'enabled');
});

test('drain suppresses new challenges on every paid route but passes receipt authorization to verification', () => {
  for (const pathname of concretePaidPaths) {
    const fresh = invokeGate(pathname, 'drain');
    assert.equal(fresh.nextCalls, 0);
    assert.equal(fresh.res.statusCode, 503);
    assert.equal(fresh.res.body.code, 'PAID_TRUST_DRAINING');

    const replay = invokeGate(pathname, 'drain', { 'payment-signature': 'authorized-receipt' });
    assert.equal(replay.nextCalls, 1, `${pathname} receipt must reach x402 verification`);
    assert.equal(replay.res.statusCode, null);
  }
});

test('drain suppresses new challenges for mixed-case paths routed by Express', () => {
  for (const pathname of mixedCasePaidPaths) {
    const result = invokeGate(pathname, 'drain');
    assert.equal(result.nextCalls, 0, `${pathname} must not bypass the drain gate`);
    assert.equal(result.res.statusCode, 503);
    assert.equal(result.res.body.code, 'PAID_TRUST_DRAINING');
  }
});

test('disabled retires every paid route before payment middleware or transfer initiation', () => {
  for (const pathname of concretePaidPaths) {
    let paymentMiddlewareCalls = 0;
    const req = requestFor(pathname, { 'payment-signature': 'must-not-be-processed' });
    const res = responseRecorder();
    process.env.PAID_TRUST_X402_MODE = 'disabled';

    paidTrustX402ModeGate(req, res, () => { paymentMiddlewareCalls += 1; });

    assert.equal(paymentMiddlewareCalls, 0);
    assert.equal(res.statusCode, 410);
    assert.equal(res.body.code, 'PAID_TRUST_RETIRED');
  }
});

test('disabled retires mixed-case paths before payment middleware or transfer initiation', () => {
  for (const pathname of mixedCasePaidPaths) {
    const result = invokeGate(pathname, 'disabled', { 'payment-signature': 'must-not-be-processed' });
    assert.equal(result.nextCalls, 0, `${pathname} must not bypass the disabled gate`);
    assert.equal(result.res.statusCode, 410);
    assert.equal(result.res.body.code, 'PAID_TRUST_RETIRED');
  }
});

test('invalid mode fails closed before payment middleware on every paid route', () => {
  for (const pathname of concretePaidPaths) {
    const result = invokeGate(pathname, 'unexpected');
    assert.equal(result.nextCalls, 0);
    assert.equal(result.res.statusCode, 503);
    assert.equal(result.res.body.code, 'PAID_TRUST_MODE_INVALID');
  }
  assert.equal(resolvePaidTrustX402Mode('unexpected'), 'invalid');
});

test('unrelated profile, leaderboard, SATP, and marketplace reads bypass every mode', () => {
  for (const mode of ['enabled', 'drain', 'disabled', 'invalid-value']) {
    for (const pathname of [
      '/api/profile/agent-123',
      '/api/leaderboard',
      '/api/satp/score/agent-123',
      '/api/marketplace/jobs',
    ]) {
      const result = invokeGate(pathname, mode);
      assert.equal(result.nextCalls, 1, `${pathname} must remain unchanged in ${mode}`);
      assert.equal(result.res.statusCode, null);
    }
  }
});

test('disabled pricing omits all paid trust routes while other modes preserve the catalog', () => {
  const entries = concretePaidPaths.map((entry) => ({ path: entry }));
  assert.deepEqual(paidTrustPricingEntries(entries, undefined), entries);
  assert.deepEqual(paidTrustPricingEntries(entries, 'enabled'), entries);
  assert.deepEqual(paidTrustPricingEntries(entries, 'drain'), entries);
  assert.deepEqual(paidTrustPricingEntries(entries, 'invalid'), entries);
  assert.deepEqual(paidTrustPricingEntries(entries, 'disabled'), []);
});

test('canonical server wires the central gate before direct and global x402 middleware', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
  assert.match(server, /app\.get\('\/api\/profile\/:id\/trust-score', trustScoreLimiter, paidTrustX402ModeGate, trustScorePaymentMiddleware/);
  assert.match(server, /app\.use\(\s*paidTrustX402ModeGate,\s*paymentMiddleware\(/);
  assert.match(server, /paid:\s*paidTrustPricingEntries\(\[/);
});

test('canonical server rate-limits both root paid routes before the gate and x402 verification', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
  const limiterDefinition = server.indexOf('const paidTrustScoreLimiter = rateLimit({');
  const limiterMount = server.indexOf("app.use(['/api/score', '/api/leaderboard/scores'], paidTrustScoreLimiter);");
  const gateMount = server.indexOf('app.use(\n  paidTrustX402ModeGate,');

  assert.ok(limiterDefinition >= 0, 'shared paid trust limiter must be defined');
  assert.ok(limiterMount > limiterDefinition, 'both paid routes must mount the shared limiter');
  assert.ok(gateMount > limiterMount, 'limiter must run before the gate and payment middleware');
  assert.match(
    server.slice(limiterDefinition, limiterMount),
    /windowMs:\s*60 \* 1000,[\s\S]*max:\s*100,/,
    'paid trust limiter must match the existing 100/min trust-score budget',
  );
});

test('legacy x402 installer shares the canonical cut-over gate and all three route prices', () => {
  const legacy = fs.readFileSync(path.join(__dirname, '../src/x402-payments.js'), 'utf8');
  assert.match(legacy, /app\.use\(paidTrustX402ModeGate\);\s*app\.use\(middleware\);/);
  for (const route of ['/api/score', '/api/profile/[id]/trust-score', '/api/leaderboard/scores']) {
    assert.ok(legacy.includes(route), `legacy adapter missing ${route}`);
  }
  assert.match(legacy, /paid:\s*paidTrustPricingEntries\(\[/);
});
