const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const profileStorePath = path.resolve(__dirname, '../src/profile-store.js');

function readProfileStoreSource() {
  return fs.readFileSync(profileStorePath, 'utf8');
}

function extractProfileByWalletHandler() {
  const source = readProfileStoreSource();
  const routeStart = source.indexOf("app.get('/api/profile-by-wallet'");
  assert.notStrictEqual(routeStart, -1, 'expected /api/profile-by-wallet route');

  const callbackStart = source.indexOf('(req, res) => {', routeStart);
  assert.notStrictEqual(callbackStart, -1, 'expected route callback');

  const openBrace = source.indexOf('{', callbackStart);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) {
      const handlerSource = source.slice(callbackStart, index + 1);
      return new Function('getDb', `return ${handlerSource};`);
    }
  }

  assert.fail('expected /api/profile-by-wallet callback to terminate');
}

function createResponse(nodeRes) {
  let statusCode = 200;

  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      nodeRes.writeHead(statusCode, { 'Content-Type': 'application/json' });
      nodeRes.end(JSON.stringify(payload));
      return this;
    },
  };
}

async function withProfileByWalletServer(rows, callback) {
  const buildHandler = extractProfileByWalletHandler();
  const statements = [];
  const db = {
    prepare(sql) {
      statements.push(sql);
      return {
        get(preferredId) {
          if (sql.includes('WHERE id = ?')) {
            return rows.find((row) => row.id === preferredId) || null;
          }
          return rows[0] || null;
        },
        all() {
          return rows;
        },
      };
    },
  };
  const handler = buildHandler(() => db);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/api/profile-by-wallet') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    const query = Object.fromEntries(url.searchParams.entries());
    handler({ query }, createResponse(res));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`, statements);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

describe('/api/profile-by-wallet payload contract', () => {
  it('returns a fetchable wallet payload with top-level and nested wallet aliases', async () => {
    const row = {
      id: 'agent_wallet_payload',
      name: 'Wallet Payload',
      wallet: '',
      wallets: JSON.stringify({ solana: 'WalletPayload111' }),
    };

    await withProfileByWalletServer([row], async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/profile-by-wallet?wallet=WalletPayload111`);
      const payload = await response.json();

      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(payload, {
        found: true,
        id: 'agent_wallet_payload',
        profileId: 'agent_wallet_payload',
        name: 'Wallet Payload',
        profile: {
          id: 'agent_wallet_payload',
          name: 'Wallet Payload',
          wallet: 'WalletPayload111',
          walletAddress: 'WalletPayload111',
          wallets: { solana: 'WalletPayload111' },
        },
        wallet: 'WalletPayload111',
        walletAddress: 'WalletPayload111',
        wallets: { solana: 'WalletPayload111' },
        preferredMatched: false,
      });
    });
  });

  it('keeps ambiguous shared-wallet lookups fetchable as a 409 JSON contract', async () => {
    const rows = [
      { id: 'agent_newer', name: 'Newer', wallet: 'SharedWallet111', wallets: '{}' },
      { id: 'agent_older', name: 'Older', wallet: 'SharedWallet111', wallets: '{}' },
    ];

    await withProfileByWalletServer(rows, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/profile-by-wallet?wallet=SharedWallet111`);
      const payload = await response.json();

      assert.strictEqual(response.status, 409);
      assert.strictEqual(payload.found, false);
      assert.strictEqual(payload.ambiguous, true);
      assert.deepStrictEqual(payload.profileIds, ['agent_newer', 'agent_older']);
      assert.deepStrictEqual(payload.profiles, [
        { id: 'agent_newer', name: 'Newer' },
        { id: 'agent_older', name: 'Older' },
      ]);
    });
  });
});
