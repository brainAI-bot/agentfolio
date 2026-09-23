const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const { trustLoopbackProxyHop } = require('../src/lib/loopback-proxy');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
const dataSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'data.ts'), 'utf8');
const clientSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'MarketplaceClient.tsx'), 'utf8');
const applicationsSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'components', 'ApplicationsList.tsx'), 'utf8');
const detailSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'app', 'marketplace', 'job', '[id]', 'page.tsx'), 'utf8');
const marketplacePageSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'app', 'marketplace', 'page.tsx'), 'utf8');
const publicMarketplaceSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'public-marketplace-jobs.js'), 'utf8');
const publicMarketplaceRoutesSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'public-marketplace-read-routes.js'), 'utf8');
const marketplaceFactorySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'marketplace-v3-server.js'), 'utf8');
const apiDocsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'docs.js'), 'utf8');
const publicSkillSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'skill.md'), 'utf8');
const sdkSource = fs.readFileSync(path.join(__dirname, '..', 'sdk', 'src', 'index.ts'), 'utf8');

test('marketplace surface regression guard', async (t) => {
  await t.test('api/jobs is backed by the jobs table instead of a placeholder payload', () => {
    assert.match(serverSource, /registerMarketplaceV3Routes\(app, \{/);
    assert.match(marketplaceFactorySource, /registerPublicMarketplaceReadRoutes\(app, \{ getDb,/);
    assert.match(publicMarketplaceRoutesSource, /app\.get\('\/api\/jobs', limiter, handlers\.listSqliteMarketplaceJobs\)/);
    assert.match(publicMarketplaceRoutesSource, /const cohort = getPublicMarketplaceCohort\(db\)/);
    assert.match(publicMarketplaceSource, /SELECT \* FROM jobs\s+ORDER BY datetime\(created_at\) DESC\s+LIMIT \?/);
    assert.match(publicMarketplaceSource, /PUBLIC_MARKETPLACE_DATABASE_BOUND = 1000/);
    assert.match(publicMarketplaceSource, /scannedRows\.filter\(\(job\) => !isFixtureJob\(job\)\)/);
    assert.doesNotMatch(serverSource, /SELECT \* FROM jobs ORDER BY datetime\(created_at\) DESC'\)\.all\(\)/);
    assert.match(publicMarketplaceRoutesSource, /poster: profileMap\.get\(row\.client_id\) \|\| row\.client_id \|\| 'Unknown client'/);
    assert.match(publicMarketplaceRoutesSource, /skills_required: skills/);
    assert.doesNotMatch(serverSource, /jobs:\s*\[\],\s*total:\s*0,\s*page:\s*1,\s*message:\s*'Jobs marketplace endpoint active'/);
  });

  await t.test('public marketplace compatibility reads resolve only to SQLite routes', () => {
    assert.match(serverSource, /registerMarketplaceV3Routes\(app, \{/);
    assert.doesNotMatch(serverSource, /require\(['"]\.\/marketplace['"]\)/);
    assert.doesNotMatch(serverSource, /marketplace\.registerRoutes\(app\)/);
    assert.match(publicMarketplaceRoutesSource, /app\.get\('\/api\/marketplace\/jobs\/:id\/applications', limiter, handlers\.getSqliteMarketplaceApplications\)/);
    assert.match(dataSource, /fetch\(`\$\{API_BASE\}\/api\/jobs\?limit=100`/);
    assert.doesNotMatch(dataSource, /data\/marketplace\/jobs|JOBS_DIR|DELIVERABLES_DIR/);
  });

  await t.test('canonical route registration covers supported aliases without retired JSON or custodial routes', () => {
    const registrations = new Set();
    const capture = (method) => (route) => registrations.add(`${method} ${route}`);
    const fakeApp = { get: capture('GET'), post: capture('POST') };
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE profiles (
        id TEXT PRIMARY KEY,
        name TEXT,
        api_key TEXT,
        wallet TEXT,
        wallets TEXT DEFAULT '{}',
        verification_data TEXT DEFAULT '{}'
      )
    `);
    try {
      require('../src/marketplace-v3-server').registerMarketplaceV3Routes(fakeApp, { getDb: () => db });
    } finally {
      db.close();
    }

    for (const route of [
      'GET /api/marketplace/jobs',
      'GET /api/marketplace/jobs/:id',
      'GET /api/marketplace/jobs/:id/applications',
      'POST /api/marketplace/jobs',
      'POST /api/marketplace/jobs/:id/apply',
      'POST /api/marketplace/jobs/:id/claim',
      'POST /api/marketplace/jobs/:id/fund-staged',
      'POST /api/marketplace/jobs/:id/fund-staged/verify',
      'POST /api/marketplace/jobs/:jobId/deliverables',
      'POST /api/marketplace/jobs/:jobId/disagreements',
      'GET /api/marketplace/jobs/:jobId/thread',
    ]) {
      assert.ok(registrations.has(route), `${route} must be registered by the canonical SQLite factory`);
    }

    for (const route of [
      'POST /api/marketplace/jobs/:id/escrow',
      'GET /api/marketplace/escrow/:id',
      'POST /api/marketplace/escrow/:id/release',
      'POST /api/marketplace/escrow/:id/refund',
      'POST /api/marketplace/jobs/:id/confirm-deposit',
      'POST /api/marketplace/jobs/:id/v3-escrow-funded',
      'POST /api/marketplace/jobs/:id/review',
      'GET /api/marketplace/jobs/:id/reviews',
      'POST /api/marketplace/deliverables/:id/revision',
      'GET /api/marketplace/deliverables/:id',
    ]) {
      assert.equal(registrations.has(route), false, `${route} must stay retired`);
    }
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
        publicMarketplaceRoutesSource,
        new RegExp(`app\\.get\\(${alias.replaceAll('/', '\\/')}, limiter,`)
      );
    }
    assert.equal((serverSource.match(/const publicMarketplaceReadLimiter = rateLimit\(/g) || []).length, 1);
    assert.match(serverSource, /publicReadLimiter: publicMarketplaceReadLimiter/);
    assert.match(marketplaceFactorySource, /limiter: publicReadLimiter/);
  });

  await t.test('loopback proxy trust is limited to exactly one hop', () => {
    assert.equal(trustLoopbackProxyHop('127.0.0.1', 0), true);
    assert.equal(trustLoopbackProxyHop('::1', 0), true);
    assert.equal(trustLoopbackProxyHop('::ffff:127.0.0.1', 0), true);
    assert.equal(trustLoopbackProxyHop('203.0.113.10', 0), false);
    assert.equal(trustLoopbackProxyHop('127.0.0.1', 1), false);
    assert.match(serverSource, /app\.set\('trust proxy', trustLoopbackProxyHop\)/);
  });

  await t.test('proxy-aware limiter separates clients while sharing one budget across all six aliases', async () => {
    const app = express();
    app.set('trust proxy', trustLoopbackProxyHop);
    const sharedLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 6,
      standardHeaders: true,
      legacyHeaders: false,
    });
    const routes = [
      '/api/jobs',
      '/api/jobs/:id',
      '/api/jobs/:id/applications',
      '/api/marketplace/jobs',
      '/api/marketplace/jobs/:id',
      '/api/marketplace/jobs/:id/applications',
    ];
    for (const route of routes) {
      app.get(route, sharedLimiter, (req, res) => res.json({ ok: true, ip: req.ip }));
    }

    const server = await new Promise((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });
    try {
      const { port } = server.address();
      const concreteRoutes = [
        '/api/jobs',
        '/api/jobs/job-1',
        '/api/jobs/job-1/applications',
        '/api/marketplace/jobs',
        '/api/marketplace/jobs/job-1',
        '/api/marketplace/jobs/job-1/applications',
      ];
      const firstClientStatuses = [];
      for (const route of concreteRoutes) {
        const response = await fetch(`http://127.0.0.1:${port}${route}`, {
          headers: { 'X-Forwarded-For': '198.51.100.10' },
        });
        firstClientStatuses.push(response.status);
      }
      const exhaustedResponse = await fetch(`http://127.0.0.1:${port}/api/jobs`, {
        headers: { 'X-Forwarded-For': '198.51.100.10' },
      });
      const distinctClientResponse = await fetch(`http://127.0.0.1:${port}/api/jobs`, {
        headers: { 'X-Forwarded-For': '198.51.100.11' },
      });

      assert.deepEqual(firstClientStatuses, [200, 200, 200, 200, 200, 200]);
      assert.equal(exhaustedResponse.status, 429);
      assert.equal(distinctClientResponse.status, 200);
      assert.equal((await distinctClientResponse.json()).ip, '198.51.100.11');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await t.test('marketplace rendering guards invalid data and uses hydrated application counts', () => {
    assert.match(clientSource, /Number\.isFinite\(then\)/);
    assert.match(clientSource, /const poster = job\.poster \|\| "Unknown client"/);
    assert.match(applicationsSource, /api\/marketplace\/jobs\/\$\{jobId\}\/applications/);
    assert.match(applicationsSource, /Number\.isFinite\(createdAt\)/);
    assert.match(clientSource, /label="Budget \(SOL\)"/);
    assert.doesNotMatch(detailSource, /API: POST \/api\/marketplace\/jobs/);
    assert.match(marketplacePageSource, /<MarketplaceClient jobs=\{jobs\} total=\{total\} \/>/);
    assert.match(clientSource, /\{total\} canonical SQLite jobs/);
    assert.doesNotMatch(clientSource, /\{jobs\.length\} canonical SQLite jobs/);
  });

  await t.test('dead marketplace artifacts are removed', () => {
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'public', 'v2', 'marketplace.html')), false);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'marketplace.js.pre-v3-escrow-wiring')), false);
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'lib', 'satp-reviews.js')), false);

    const libSource = fs.readdirSync(path.join(__dirname, '..', 'src', 'lib'))
      .filter((name) => name.endsWith('.js'))
      .map((name) => fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', name), 'utf8'))
      .join('\n');
    assert.doesNotMatch(libSource, /SATP_WALLET_PATH|brainchain-personal\.json/);
  });

  await t.test('public docs and SDK expose canonical delivery routes instead of retired JSON contracts', () => {
    for (const source of [apiDocsSource, publicSkillSource, sdkSource]) {
      assert.doesNotMatch(source, /\/api\/marketplace\/jobs\/(?:\{id\}|:id|\$\{encodeURIComponent\(jobId\)\})\/complete/);
      assert.doesNotMatch(source, /\/api\/marketplace\/jobs\/(?:\{id\}|:id|\$\{encodeURIComponent\(jobId\)\})\/review/);
      assert.doesNotMatch(source, /\/api\/marketplace\/jobs\/(?:\{id\}|:id|\$\{encodeURIComponent\((?:jobId|data\.jobId)\)\})\/escrow/);
      assert.doesNotMatch(source, /\/api\/marketplace\/jobs\/(?:\{id\}|:id|\$\{encodeURIComponent\(jobId\)\})\/(?:confirm-deposit|v3-escrow-funded)/);
    }

    assert.match(apiDocsSource, /\/api\/marketplace\/jobs\/\{jobId\}\/deliverables/);
    assert.match(apiDocsSource, /\/api\/marketplace\/jobs\/\{jobId\}\/deliverables\/\{deliverableId\}\/approve/);
    assert.match(publicSkillSource, /\/api\/marketplace\/jobs\/JOB_ID\/deliverables/);
    assert.match(sdkSource, /\/api\/marketplace\/jobs\/\$\{encodeURIComponent\(jobId\)\}\/deliverables/);
    assert.match(sdkSource, /\/api\/v3\/escrow\/create/);
  });

  await t.test('api/stats includes live job totals instead of hardcoded zeroes', () => {
    assert.match(serverSource, /marketplaceCohort = getPublicMarketplaceCohort\(d\)/);
    assert.match(serverSource, /marketplaceSummary = summarizePublicMarketplaceCohort\(marketplaceCohort\)/);
    assert.match(serverSource, /marketplace:\s*\{[\s\S]*totalJobs,[\s\S]*openJobs,[\s\S]*inProgress:[\s\S]*completed:/);
    assert.doesNotMatch(serverSource, /totalJobs:\s*0,\s*totalVolume:\s*0/);
  });
});
