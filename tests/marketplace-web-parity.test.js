'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { initializeMarketplaceCoreSchema } = require('../src/lib/marketplace-schema');
const { initializeMarketplaceState, listMarketplaceEscrowEffects } = require('../src/lib/marketplace-state-machine');
const { createJob, cancelJob, expireJob, MarketplaceJobError } = require('../src/routes/marketplace-job-routes');

function harness() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE profiles (id TEXT PRIMARY KEY, api_key TEXT, wallet TEXT, wallets TEXT, verification_data TEXT)');
  db.prepare('INSERT INTO profiles (id, api_key) VALUES (?, ?)').run('client', 'client-key');
  initializeMarketplaceCoreSchema(db);
  initializeMarketplaceState(db);
  return db;
}

test('fixed-price create, cancel, and expiry stay SQLite-backed and escrow-staged', () => {
  const db = harness();
  try {
    const created = createJob(db, {
      actorId: 'client',
      now: '2026-09-10T00:00:00.000Z',
      body: {
        title: 'Canonical UI parity',
        description: 'Build the fixed-price marketplace interface.',
        category: 'development',
        skills: ['TypeScript'],
        budgetType: 'fixed',
        budgetAmount: 2,
        budgetCurrency: 'SOL',
        timeline: '1w',
        expiresAt: '2026-09-11T00:00:00.000Z',
      },
    });
    assert.equal(created.status, 'open');
    assert.deepEqual(created.escrow, { mode: 'staged', funded: false, moneyMoved: false });
    assert.equal(db.prepare('SELECT budget_type FROM jobs WHERE id = ?').get(created.id).budget_type, 'fixed');
    assert.throws(
      () => createJob(db, {
        actorId: 'client',
        now: '2026-09-10T00:00:00.000Z',
        body: { title: 'Hourly attempt', description: 'This pricing mode must fail closed.', category: 'other', skills: [], budgetType: 'hourly', budgetAmount: 1, timeline: 'flexible' },
      }),
      (error) => error instanceof MarketplaceJobError && error.code === 'FIXED_PRICE_ONLY',
    );
    assert.throws(
      () => cancelJob(db, { jobId: created.id, actorId: 'other', body: { reason: 'not my job' }, now: '2026-09-10T00:30:00.000Z' }),
      (error) => error instanceof MarketplaceJobError && error.code === 'CLIENT_ACTION_FORBIDDEN',
    );

    const cancelled = cancelJob(db, { jobId: created.id, actorId: 'client', body: { reason: 'scope changed' }, now: '2026-09-10T01:00:00.000Z' });
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.escrow.moneyMoved, false);
    assert.equal(listMarketplaceEscrowEffects(db, created.id).length, 0);

    const expiring = createJob(db, {
      actorId: 'client',
      now: '2026-09-10T00:00:00.000Z',
      body: {
        title: 'Expiring fixed job', description: 'This listing expires through the canonical transition.',
        category: 'research', skills: ['Research'], budgetAmount: 1, timeline: 'flexible',
        expiresAt: '2026-09-11T00:00:00.000Z',
      },
    });
    assert.throws(
      () => expireJob(db, { jobId: expiring.id, actorId: 'client', now: '2026-09-10T12:00:00.000Z' }),
      (error) => error instanceof MarketplaceJobError && error.code === 'JOB_NOT_EXPIRED',
    );
    const expired = expireJob(db, { jobId: expiring.id, actorId: 'client', now: '2026-09-11T00:00:00.000Z' });
    assert.equal(expired.status, 'expired');
    assert.equal(expired.escrow.moneyMoved, false);
  } finally {
    db.close();
  }
});

test('frontend parity surface names every P1D action and explicit failure state without legacy money claims', () => {
  const root = path.join(__dirname, '..', 'frontend', 'src');
  const workspace = fs.readFileSync(path.join(root, 'components', 'MarketplaceJobWorkspace.tsx'), 'utf8');
  const list = fs.readFileSync(path.join(root, 'components', 'ApplicationsList.tsx'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'components', 'MarketplaceClient.tsx'), 'utf8');
  const apply = fs.readFileSync(path.join(root, 'components', 'JobApplyForm.tsx'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'lib', 'marketplace-api.ts'), 'utf8');
  const listingPage = fs.readFileSync(path.join(root, 'app', 'marketplace', 'page.tsx'), 'utf8');
  const detailPage = fs.readFileSync(path.join(root, 'app', 'marketplace', 'job', '[id]', 'page.tsx'), 'utf8');
  const combined = [workspace, list, client, apply, api, listingPage, detailPage].join('\n');

  for (const action of ['create', 'apply', 'select', 'accept', 'decline', 'submit', 'revise', 'approve', 'comment', 'cancel', 'expire']) {
    assert.match(combined, new RegExp(`["']${action}["']`), `missing ${action} UI action`);
  }
  for (const state of ['Loading', 'empty', 'Unauthorized', 'current job state', 'timed out']) {
    assert.match(combined.toLowerCase(), new RegExp(state.toLowerCase()), `missing explicit ${state} state`);
  }
  assert.match(combined, /no money moved/i);
  assert.match(combined, /canonical SQLite API/i);
  assert.doesNotMatch(combined, /Payment released|Funds released|sent to worker/i);
  assert.doesNotMatch(workspace, /\/api\/marketplace\/escrow\//);
  assert.doesNotMatch(listingPage + detailPage, /from ["']@\/lib\/data["']/);
  assert.match(listingPage, /jobs=\{\[\]\}/);
  assert.match(detailPage, /getCanonicalJob/);
  assert.match(detailPage, /deployed escrow program charges 5% \(500 bps\)/i);
  assert.doesNotMatch(detailPage, /10% configured fee/i);
  assert.match(workspace, /onApplied=.*refreshJob/);
  assert.match(workspace, /setApplicationsVersion/);
  assert.match(list, /reloadToken/);
});
