const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const {
  registerBoaMintRoutes,
  registerBoaMintCompleteRoute,
  registerBoaAgentMintRoute,
} = require('../src/api/boa-mint');

function createApp() {
  const routes = [];
  return {
    routes,
    post(route, handler) {
      routes.push({ method: 'POST', route, handler });
    },
    get(route, handler) {
      routes.push({ method: 'GET', route, handler });
    },
  };
}

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createReq(body = {}) {
  return {
    body,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    query: {},
    params: {},
  };
}

test('production server mounts gated BOA mint routes', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
  assert.match(source, /registerBoaMintRoutes/);
  assert.match(source, /require\(['"]\.\/api\/boa-mint['"]\)/);
  assert.match(source, /\/api\/boa\/mint is mounted gated/);
});

test('POST /api/boa/mint is registered and returns 423 BOA_WRITES_READ_ONLY with no transaction', async () => {
  const app = createApp();
  registerBoaMintRoutes(app);
  registerBoaMintCompleteRoute(app);
  registerBoaAgentMintRoute(app);

  const mint = app.routes.find((route) => route.method === 'POST' && route.route === '/api/boa/mint');
  const complete = app.routes.find((route) => route.method === 'POST' && route.route === '/api/boa/mint/complete');
  const agent = app.routes.find((route) => route.method === 'POST' && route.route === '/api/boa/mint/agent');
  assert.ok(mint, 'expected POST /api/boa/mint');
  assert.ok(complete, 'expected POST /api/boa/mint/complete');
  assert.ok(agent, 'expected POST /api/boa/mint/agent');

  const res = createRes();
  await mint.handler(createReq({ wallet: '4saocPMWcL8K1b6Z7J1HAdVAxfbZjuUvzKnBbS6gVXZD' }), res);

  assert.equal(res.statusCode, 423);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'BOA_WRITES_READ_ONLY');
  assert.equal(Object.prototype.hasOwnProperty.call(res.body, 'transaction'), false);
});

test('BOA mint gate still holds when AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES=true', async () => {
  const previous = process.env.AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES;
  process.env.AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES = 'true';
  try {
    const app = createApp();
    registerBoaMintRoutes(app);
    const mint = app.routes.find((route) => route.route === '/api/boa/mint');
    const res = createRes();
    await mint.handler(createReq({ wallet: '4saocPMWcL8K1b6Z7J1HAdVAxfbZjuUvzKnBbS6gVXZD' }), res);
    assert.equal(res.statusCode, 423);
    assert.equal(res.body.code, 'BOA_WRITES_READ_ONLY');
    assert.equal(Object.prototype.hasOwnProperty.call(res.body, 'transaction'), false);
  } finally {
    if (previous === undefined) delete process.env.AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES;
    else process.env.AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES = previous;
  }
});
