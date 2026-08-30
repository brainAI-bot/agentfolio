const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const rateLimit = require('express-rate-limit');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
const dataSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'data.ts'), 'utf8');
const clientSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'MarketplaceClient.tsx'), 'utf8');
const applicationsSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'ApplicationsList.tsx'), 'utf8');
const detailSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'app', 'marketplace', 'job', '[id]', 'page.tsx'), 'utf8');

test('marketplace surface regression guard', async (t) => {
  await t.test('api/jobs is backed by the jobs table instead of a placeholder payload', () => {
    assert.match(serverSource, /app\.get\('\/api\/jobs', publicMarketplaceReadLimiter, listSqliteMarketplaceJobs\)/);
    assert.match(serverSource, /SELECT \* FROM jobs\s+ORDER BY datetime\(created_at\) DESC/);
    assert.match(serverSource, /is_public_marketplace_job\(client_id, title, description\) = 1/);
    assert.match(serverSource, /LIMIT \? OFFSET \?/);
    assert.match(serverSource, /MARKETPLACE_LIST_DATABASE_BOUND = 1000/);
    assert.doesNotMatch(serverSource, /SELECT \* FROM jobs ORDER BY datetime\(created_at\) DESC'\)\.all\(\)/);
    assert.match(serverSource, /poster: profileMap\.get\(row\.client_id\) \|\| row\.client_id \|\| 'Unknown client'/);
    assert.match(serverSource, /skills_required: skills/);
    assert.doesNotMatch(serverSource, /jobs:\s*\[\],\s*total:\s*0,\s*page:\s*1,\s*message:\s*'Jobs marketplace endpoint active'/);
  });

  await t.test('public marketplace compatibility reads cannot fall through to JSON files', () => {
    const canonicalRead = serverSource.indexOf("app.get('/api/marketplace/jobs', publicMarketplaceReadLimiter, listSqliteMarketplaceJobs)");
    const legacyMount = serverSource.indexOf("marketplace.registerRoutes(app)");
    assert.ok(canonicalRead > -1 && canonicalRead < legacyMount);
    assert.match(serverSource, /app\.get\('\/api\/marketplace\/jobs\/:id\/applications', publicMarketplaceReadLimiter, getSqliteMarketplaceApplications\)/);
    assert.match(dataSource, /fetch\(`\$\{API_BASE\}\/api\/jobs\?limit=100`/);
    assert.doesNotMatch(dataSource, /data\/marketplace\/jobs|JOBS_DIR|DELIVERABLES_DIR/);
  });

  await t.test('one shared limiter covers every public SQLite read alias', () => {
    const aliases = [
      "'/api/jobs'",
      "'/api/jobs/:id'",
      "'/api/jobs/:id/applications'",
      "'/api/marketplace/jobs'",
      "'/api/marketplace/jobs/:id'",
      "'/api/marketplace/jobs/:id/applications'",
    ];
    for (const alias of aliases) {
      assert.match(
        serverSource,
        new RegExp(`app\\.get\\(${alias.replaceAll('/', '\\/')}, publicMarketplaceReadLimiter,`)
      );
    }
    assert.equal((serverSource.match(/const publicMarketplaceReadLimiter = rateLimit\(/g) || []).length, 1);
  });

  await t.test('shared limiter aggregates alternating aliases and enforces the budget', async () => {
    const app = express();
    const sharedLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 2,
      standardHeaders: true,
      legacyHeaders: false,
    });
    app.get('/api/jobs', sharedLimiter, (_req, res) => res.json({ ok: true }));
    app.get('/api/marketplace/jobs', sharedLimiter, (_req, res) => res.json({ ok: true }));

    const server = await new Promise((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });
    try {
      const { port } = server.address();
      const statuses = [];
      for (const route of ['/api/jobs', '/api/marketplace/jobs', '/api/jobs']) {
        const response = await fetch(`http://127.0.0.1:${port}${route}`);
        statuses.push(response.status);
      }
      assert.deepEqual(statuses, [200, 200, 429]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await t.test('marketplace rendering guards invalid data and uses hydrated application counts', () => {
    assert.match(clientSource, /Number\.isFinite\(then\)/);
    assert.match(clientSource, /const poster = job\.poster \|\| "Unknown client"/);
    assert.match(applicationsSource, /api\/jobs\/\$\{jobId\}\/applications/);
    assert.match(applicationsSource, /Number\.isFinite\(createdAt\)/);
    assert.match(clientSource, /label="Budget \(SOL\)"/);
    assert.doesNotMatch(detailSource, /API: POST \/api\/marketplace\/jobs/);
  });

  await t.test('dead v2 marketplace surface is removed', () => {
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'public', 'v2', 'marketplace.html')), false);
  });

  await t.test('api/stats includes live job totals instead of hardcoded zeroes', () => {
    assert.match(serverSource, /SELECT client_id, agent_id, title, description, status, agreed_budget, budget_amount FROM jobs/);
    assert.match(serverSource, /isFixtureJob/);
    assert.match(serverSource, /marketplace:\s*\{[\s\S]*totalJobs,[\s\S]*openJobs,[\s\S]*inProgress:[\s\S]*completed:/);
    assert.doesNotMatch(serverSource, /totalJobs:\s*0,\s*totalVolume:\s*0/);
  });
});
