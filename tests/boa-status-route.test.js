const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildBoaStatusPayload,
  registerBoaStatusRoutes,
} = require('../src/routes/boa-status');

test('BOA status payload exposes mounted status route metadata', () => {
  const payload = buildBoaStatusPayload();

  assert.equal(payload.status, 'ok');
  assert.equal(payload.module, 'boa');
  assert.equal(payload.mounted, true);
  assert.equal(payload.routes.status, '/api/boa/status');
  assert.equal(payload.routes.eligibility, '/api/boa/eligibility');
  assert.match(payload.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('BOA status route registers GET /api/boa/status', () => {
  const routes = [];
  const app = {
    get(route, handler) {
      routes.push({ route, handler });
    },
  };

  registerBoaStatusRoutes(app);

  assert.equal(routes.length, 1);
  assert.equal(routes[0].route, '/api/boa/status');

  let body;
  routes[0].handler({}, { json(payload) { body = payload; } });
  assert.equal(body.status, 'ok');
  assert.equal(body.routes.status, '/api/boa/status');
});

test('production server mounts BOA status route wiring', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/server.js'), 'utf8');

  assert.match(source, /registerBoaStatusRoutes/);
  assert.match(source, /require\(['"]\.\/routes\/boa-status['"]\)/);
});
