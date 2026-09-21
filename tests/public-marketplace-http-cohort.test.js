'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const { initializeMarketplaceCoreSchema } = require('../src/lib/marketplace-schema');

const repoRoot = path.resolve(__dirname, '..');

async function reservePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForJson(url, child, logs) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited ${child.exitCode}: ${logs.join('')}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become ready: ${logs.join('')}`);
}

async function getJson(baseUrl, route, logs = []) {
  const response = await fetch(`${baseUrl}${route}`);
  const text = await response.text();
  assert.equal(response.status, 200, `${route} returned ${response.status}: ${text}\n${logs.join('')}`);
  return JSON.parse(text);
}

test('public stats, marketplace stats, and marketplace jobs use one fixture-free cohort over HTTP', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-public-cohort-'));
  const dbPath = path.join(tempDir, 'agentfolio.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      handle TEXT DEFAULT '',
      description TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      website TEXT DEFAULT '',
      framework TEXT DEFAULT '',
      capabilities TEXT DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      wallet TEXT DEFAULT '',
      wallets TEXT DEFAULT '{}',
      skills TEXT DEFAULT '[]',
      portfolio TEXT DEFAULT '[]',
      track_record TEXT,
      verification TEXT DEFAULT '{}',
      verification_data TEXT DEFAULT '{}',
      links TEXT DEFAULT '{}',
      moltbook_stats TEXT,
      endorsements TEXT DEFAULT '[]',
      endorsements_given TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      twitter TEXT DEFAULT '',
      github TEXT DEFAULT '',
      email TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      claimed INTEGER DEFAULT 0,
      hidden INTEGER DEFAULT 0,
      api_key TEXT UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  initializeMarketplaceCoreSchema(db);

  const insert = db.prepare(`
    INSERT INTO jobs (
      id, client_id, title, description, status, budget_amount, agreed_budget, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run('job-public-open', 'agent-customer', 'Implement parser', 'Production work', 'open', 4, null, '2026-09-20T00:03:00Z', '2026-09-20T00:03:00Z');
  insert.run('job_b3f22a01478b8f1a', 'p0_audit_client_1776215395', 'P0 auth audit 1776215395', 'Temporary auth-gate verification job', 'open', 0.01, null, '2026-09-20T00:02:00Z', '2026-09-20T00:02:00Z');
  insert.run('job-public-complete', 'agent-customer', 'Write documentation', 'Production work', 'completed', 2, 3, '2026-09-20T00:01:00Z', '2026-09-20T00:01:00Z');
  db.close();

  const port = await reservePort();
  const logs = [];
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH,
      AGENTFOLIO_DB_PATH: dbPath,
      AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES: 'false',
      DEPLOYER_KEY_PATH: path.join(tempDir, 'missing-deployer.json'),
      NODE_ENV: 'test',
      PORT: String(port),
      SATP_PLATFORM_KEYPAIR: path.join(tempDir, 'missing-satp-keypair.json'),
      SOLANA_RPC_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGTERM');
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForJson(`${baseUrl}/api/health`, child, logs);

  const [stats, marketplaceStats, marketplaceJobs] = await Promise.all([
    getJson(baseUrl, '/api/stats', logs),
    getJson(baseUrl, '/api/marketplace/stats', logs),
    getJson(baseUrl, '/api/marketplace/jobs?limit=100', logs),
  ]);

  assert.equal(stats.totalJobs, 2);
  assert.equal(stats.marketplace.totalJobs, 2);
  assert.equal(stats.marketplace.openJobs, 1);
  assert.equal(stats.marketplace.completed, 1);
  assert.equal(stats.totalVolume, 7);

  assert.equal(marketplaceStats.jobs.total_jobs, stats.totalJobs);
  assert.equal(marketplaceStats.jobs.open_jobs, stats.marketplace.openJobs);
  assert.equal(marketplaceStats.jobs.completed_jobs, stats.marketplace.completed);
  assert.equal(marketplaceStats.jobs.completion_rate, 50);

  assert.equal(marketplaceJobs.total, stats.totalJobs);
  assert.deepEqual(
    marketplaceJobs.jobs.map((job) => job.id),
    ['job-public-open', 'job-public-complete']
  );
  assert.equal(marketplaceJobs.publicTraction.excludedFixtures, 1);
});
