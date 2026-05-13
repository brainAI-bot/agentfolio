const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { registerWorkflowReadRoutes } = require('../src/routes/workflow-read-routes');

function makeApp() {
  const routes = new Map();
  return {
    routes,
    get(routePath, handler) {
      assert.equal(routes.has(routePath), false, `duplicate test route registration: ${routePath}`);
      routes.set(routePath, handler);
    },
  };
}

function makeRes() {
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

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-workflow-routes-'));
  const dbPath = path.join(dir, 'agentfolio.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY,
      name TEXT,
      handle TEXT,
      avatar TEXT,
      skills TEXT,
      hidden INTEGER DEFAULT 0,
      created_at TEXT
    );
    CREATE TABLE activity_feed (
      profile_id TEXT,
      event_type TEXT,
      detail TEXT,
      created_at TEXT
    );
    CREATE TABLE score_history (
      agent_id TEXT,
      score REAL,
      tier TEXT,
      reason TEXT,
      created_at TEXT
    );
    CREATE TABLE jobs (id TEXT PRIMARY KEY, status TEXT);
    CREATE TABLE escrows (id TEXT PRIMARY KEY, amount REAL, platform_fee REAL, status TEXT);
    CREATE TABLE applications (id TEXT PRIMARY KEY);

    INSERT INTO profiles (id, name, handle, skills, created_at) VALUES
      ('agent_new', 'New Agent', 'new', '["node"]', '2026-05-13T10:00:00Z');
    INSERT INTO activity_feed (profile_id, event_type, detail, created_at) VALUES
      ('agent_new', 'verification', '{"platform":"github"}', '2026-05-13T10:05:00Z');
    INSERT INTO score_history (agent_id, score, tier, reason, created_at) VALUES
      ('agent_new', 81, 'Established', 'verification_bonus', '2026-05-13T10:10:00Z');

    INSERT INTO jobs (id, status) VALUES ('job_1', 'open'), ('job_2', 'completed');
    INSERT INTO escrows (id, amount, platform_fee, status) VALUES
      ('escrow_1', 10, 0.5, 'released'), ('escrow_2', 20, 1, 'pending');
    INSERT INTO applications (id) VALUES ('app_1'), ('app_2');
  `);
  db.close();
  return { dbPath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('registers only the canonical workflow mismatch routes', () => {
  const { dbPath, cleanup } = makeDb();
  try {
    const app = makeApp();
    registerWorkflowReadRoutes(app, { dbPath });

    assert.deepEqual([...app.routes.keys()].sort(), [
      '/api/activity',
      '/api/fees/tiers',
      '/api/marketplace/stats',
    ].sort());
  } finally {
    cleanup();
  }
});

test('returns read-only fee tiers without mounting legacy fee writes', () => {
  const { dbPath, cleanup } = makeDb();
  try {
    const app = makeApp();
    registerWorkflowReadRoutes(app, { dbPath });

    const res = makeRes();
    app.routes.get('/api/fees/tiers')({ query: {} }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.tiers.length, 6);
    assert.equal(res.body.tiers[0].name, 'New');
    assert.equal(res.body.minRate, 0.005);
  } finally {
    cleanup();
  }
});

test('returns marketplace stats from the canonical owner route', () => {
  const { dbPath, cleanup } = makeDb();
  try {
    const app = makeApp();
    registerWorkflowReadRoutes(app, { dbPath });

    const res = makeRes();
    app.routes.get('/api/marketplace/stats')({ query: {} }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.jobs.total_jobs, 2);
    assert.equal(res.body.jobs.open_jobs, 1);
    assert.equal(res.body.jobs.completed_jobs, 1);
    assert.equal(res.body.jobs.completion_rate, 50);
    assert.equal(res.body.escrow.total_volume, 30);
    assert.equal(res.body.escrow.total_fees, 1.5);
    assert.equal(res.body.applications.total_applications, 2);
  } finally {
    cleanup();
  }
});

test('returns activity events from registration, verification, and score tables', () => {
  const { dbPath, cleanup } = makeDb();
  try {
    const app = makeApp();
    registerWorkflowReadRoutes(app, { dbPath });

    const res = makeRes();
    app.routes.get('/api/activity')({ query: { limit: '10' } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.count, 3);
    assert.deepEqual(res.body.events.map((event) => event.type), [
      'score_change',
      'verification',
      'registration',
    ]);
  } finally {
    cleanup();
  }
});
