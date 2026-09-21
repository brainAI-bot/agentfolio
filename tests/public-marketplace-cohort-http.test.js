'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const { registerWorkflowReadRoutes } = require('../src/routes/workflow-read-routes');
const {
  getPublicMarketplaceCohort,
  summarizePublicMarketplaceCohort,
} = require('../src/lib/public-marketplace-jobs');

function seedDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'af-public-cohort-http-'));
  const dbPath = path.join(dir, 'agentfolio.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      client_id TEXT,
      title TEXT,
      description TEXT,
      status TEXT,
      budget_amount REAL,
      agreed_budget REAL,
      created_at TEXT
    );
    CREATE TABLE escrows (id TEXT PRIMARY KEY, amount REAL, platform_fee REAL, status TEXT);
    CREATE TABLE applications (id TEXT PRIMARY KEY);
    INSERT INTO jobs (id, client_id, title, description, status, budget_amount, created_at) VALUES
      ('real-open', 'agent_real', 'Production open job', 'Real work', 'open', 10, '2026-09-21T09:00:00Z'),
      ('real-complete', 'agent_real', 'Production completed job', 'Real work', 'completed', 20, '2026-09-21T08:00:00Z'),
      ('fixture-open', 'agent_sm123', 'Test fixture job', 'QA test', 'open', 999, '2026-09-21T10:00:00Z');
  `);
  db.close();
  return {
    dbPath,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function readCohort(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const cohort = getPublicMarketplaceCohort(db);
    return { cohort, summary: summarizePublicMarketplaceCohort(cohort) };
  } finally {
    db.close();
  }
}

test('public HTTP stats and jobs endpoints share the fixture-free marketplace cohort', async () => {
  const { dbPath, cleanup } = seedDatabase();
  const app = express();

  app.get('/api/stats', (_req, res) => {
    const { cohort, summary } = readCohort(dbPath);
    res.json({
      totalJobs: summary.totalJobs,
      marketplace: {
        totalJobs: summary.totalJobs,
        openJobs: summary.openJobs,
        inProgress: summary.inProgressJobs,
        completed: summary.completedJobs,
      },
      publicTraction: { marketplaceExcludedFixtures: cohort.excludedFixtures },
    });
  });
  app.get('/api/marketplace/jobs', (_req, res) => {
    const { cohort } = readCohort(dbPath);
    res.json({ jobs: cohort.rows, total: cohort.total });
  });
  registerWorkflowReadRoutes(app, { dbPath });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const [statsResponse, jobsResponse, marketplaceStatsResponse] = await Promise.all([
      fetch(`${baseUrl}/api/stats`),
      fetch(`${baseUrl}/api/marketplace/jobs`),
      fetch(`${baseUrl}/api/marketplace/stats`),
    ]);
    assert.equal(statsResponse.status, 200);
    assert.equal(jobsResponse.status, 200);
    assert.equal(marketplaceStatsResponse.status, 200);

    const stats = await statsResponse.json();
    const jobs = await jobsResponse.json();
    const marketplaceStats = await marketplaceStatsResponse.json();

    assert.equal(stats.totalJobs, 2);
    assert.equal(stats.marketplace.totalJobs, jobs.total);
    assert.equal(marketplaceStats.jobs.total_jobs, jobs.total);
    assert.equal(stats.marketplace.openJobs, 1);
    assert.equal(marketplaceStats.jobs.open_jobs, 1);
    assert.equal(stats.marketplace.completed, 1);
    assert.equal(marketplaceStats.jobs.completed_jobs, 1);
    assert.equal(stats.publicTraction.marketplaceExcludedFixtures, 1);
    assert.equal(marketplaceStats.jobs.publicTraction.excludedFixtures, 1);
    assert.deepEqual(jobs.jobs.map((job) => job.id).sort(), ['real-complete', 'real-open']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    cleanup();
  }
});
