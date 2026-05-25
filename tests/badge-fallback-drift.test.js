const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const serverPath = path.resolve(__dirname, '../src/server.js');

function readServerSource() {
  return fs.readFileSync(serverPath, 'utf8');
}

function extractFunctionSource(source, signature) {
  const start = source.indexOf(signature);
  assert.notStrictEqual(start, -1, `expected ${signature} to exist`);

  const openBrace = source.indexOf('{', start);
  assert.notStrictEqual(openBrace, -1, `expected ${signature} to have a body`);

  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  assert.fail(`expected ${signature} body to terminate`);
}

function createBadgeHandler({ row = null, unified = { level: 3, score: 456 } } = {}) {
  const source = readServerSource();
  const renderBadgeSource = extractFunctionSource(source, 'async function renderBadge(req, res)');
  const getCalls = [];
  const v3Calls = [];
  const computeCalls = [];
  const db = {
    prepare(sql) {
      assert.match(sql, /SELECT id, name, claimed, wallet, created_at FROM profiles WHERE id = \?/);
      return {
        get(id) {
          getCalls.push(id);
          return row && row.id === id ? row : null;
        },
      };
    },
  };
  const profileStore = { getDb: () => db };
  const computeUnifiedTrustScore = (passedDb, passedRow, options) => {
    computeCalls.push({ db: passedDb, row: passedRow, options });
    return unified;
  };
  const getV3Score = async (id) => {
    v3Calls.push(id);
    return { reputationScore: 123000, verificationLevel: 2 };
  };
  const { generateBadgeSVG } = require('../src/lib/badge-svg');
  const renderBadge = new Function(
    'profileStore',
    'computeUnifiedTrustScore',
    'getV3Score',
    'generateBadgeSVG',
    'console',
    `${renderBadgeSource}; return renderBadge;`
  )(profileStore, computeUnifiedTrustScore, getV3Score, generateBadgeSVG, console);

  return { renderBadge, getCalls, v3Calls, computeCalls };
}

function sendExpressStyleResponse(nodeRes) {
  const headers = {};
  let statusCode = 200;

  return {
    set(name, value) {
      headers[name] = value;
      return this;
    },
    type(value) {
      headers['Content-Type'] = value;
      return this;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    send(payload) {
      nodeRes.writeHead(statusCode, headers);
      nodeRes.end(payload);
      return this;
    },
  };
}

async function withBadgeServer(handler, callback) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const match = url.pathname.match(/^\/api\/badge\/([^/]+)$/);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }

    await handler(
      { params: { id: decodeURIComponent(match[1]) } },
      sendExpressStyleResponse(res)
    );
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

describe('badge fallback production drift guard', () => {
  it('keeps badge routes on the unified trust-score generator', () => {
    const source = readServerSource();

    assert.ok(source.includes("const { generateBadgeSVG } = require('./lib/badge-svg');"));
    assert.ok(source.includes('async function renderBadge(req, res)'));
    assert.ok(source.includes('const v3Score = await getV3Score(id).catch(() => null);'));
    assert.ok(source.includes('const unified = computeUnifiedTrustScore(db, row, { v3Score });'));
    assert.ok(source.includes('const svg = generateBadgeSVG(row.name, unified.level, unified.score);'));
    assert.ok(source.includes('const fallbackSvg = generateBadgeSVG(id, 0, 0);'));
    assert.ok(source.includes('const publicBadgeLimiter = rateLimit({'));
    assert.ok(source.includes("app.get('/api/badge/:id.svg', publicBadgeLimiter, renderBadge);"));
    assert.ok(source.includes("app.get('/api/badge/:id', publicBadgeLimiter, renderBadge);"));
    assert.ok(!source.includes('chainCache.getVerifications(id)'));
    assert.ok(!source.includes('<text x="155" y="19"'));
    assert.ok(!source.includes("return res.status(404).type('text/plain').send('Profile not found')"));
  });

  it('escapes badge SVG text fields', () => {
    const { generateBadgeSVG } = require('../src/lib/badge-svg');
    const svg = generateBadgeSVG('A&B <Agent>', 1, 100);

    assert.match(svg, /A&amp;B &lt;Agent&gt;/);
    assert.doesNotMatch(svg, /A&B <Agent>/);
  });

  it('serves the SVG badge route through the unified score handler', async () => {
    const row = {
      id: 'agent_alice',
      name: 'Alice',
      claimed: 1,
      wallet: 'Wallet1111111111111111111111111111111111111',
      created_at: '2026-01-01T00:00:00.000Z',
    };
    const loaded = createBadgeHandler({ row, unified: { level: 3, score: 456 } });

    await withBadgeServer(loaded.renderBadge, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/badge/agent_alice.svg`);
      const body = await response.text();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('content-type'), 'image/svg+xml');
      assert.strictEqual(response.headers.get('cache-control'), 'public, max-age=300');
      assert.match(body, /Alice/);
      assert.match(body, /L3/);
      assert.match(body, /456/);
    });

    assert.deepStrictEqual(loaded.getCalls, ['agent_alice']);
    assert.deepStrictEqual(loaded.v3Calls, ['agent_alice']);
    assert.strictEqual(loaded.computeCalls.length, 1);
    assert.strictEqual(loaded.computeCalls[0].row, row);
    assert.deepStrictEqual(loaded.computeCalls[0].options, {
      v3Score: { reputationScore: 123000, verificationLevel: 2 },
    });
  });

  it('keeps the extensionless badge route fetchable for missing profiles', async () => {
    const loaded = createBadgeHandler();

    await withBadgeServer(loaded.renderBadge, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/badge/missing_agent`);
      const body = await response.text();

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('content-type'), 'image/svg+xml');
      assert.strictEqual(response.headers.get('cache-control'), 'public, max-age=300');
      assert.match(body, /missing_agent/);
      assert.match(body, /L0/);
    });

    assert.deepStrictEqual(loaded.getCalls, ['missing_agent']);
    assert.deepStrictEqual(loaded.v3Calls, []);
    assert.deepStrictEqual(loaded.computeCalls, []);
  });
});
