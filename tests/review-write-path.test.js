const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { registerReviewChallengeRoutes } = require('../src/api/review-challenge');

const ROOT = path.join(__dirname, '..');

function makeMarketplaceFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-review-gate-'));
  const marketplaceDir = path.join(dir, 'marketplace');
  for (const subdir of ['jobs', 'applications', 'escrow']) {
    fs.mkdirSync(path.join(marketplaceDir, subdir), { recursive: true });
  }
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return marketplaceDir;
}

function writeFixtureJSON(marketplaceDir, subdir, id, value) {
  fs.writeFileSync(
    path.join(marketplaceDir, subdir, `${id}.json`),
    JSON.stringify(value, null, 2),
  );
}

async function postReviewChallenge(marketplaceDir, body) {
  const routes = new Map();
  const app = {
    post(route, handler) {
      routes.set(route, handler);
    },
  };
  registerReviewChallengeRoutes(app, { marketplaceDir });

  let status = 200;
  let responseBody;
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(value) {
      responseBody = value;
      return this;
    },
  };

  await routes.get('/api/reviews/challenge')({ body }, res);
  return { status, body: responseBody };
}

test('production server mounts signed review write routes before the fallback read stub', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');

  const challengeMount = source.indexOf('registerReviewChallengeRoutes(app)');
  const reviewsV2Mount = source.indexOf('registerReviewsV2Routes(app)');
  const fallbackStub = source.indexOf("app.get('/api/reviews/v2'");

  assert.notEqual(challengeMount, -1, 'missing signed review challenge route mount');
  assert.notEqual(reviewsV2Mount, -1, 'missing reviews v2 route mount');
  assert.notEqual(fallbackStub, -1, 'missing fallback reviews v2 read stub');
  assert.ok(challengeMount < fallbackStub, 'challenge routes must register before fallback stubs');
  assert.ok(reviewsV2Mount < fallbackStub, 'reviews v2 routes must register before fallback stubs');
});

test('reviews v2 route module uses the repo database path and exposes a writer', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'api', 'reviews-v2.js'), 'utf8');

  assert.match(source, /DEFAULT_DB_PATH/);
  assert.doesNotMatch(source, /\/home\/ubuntu\/agentfolio\/data\/agentfolio\.db/);
  assert.match(source, /app\.post\('\/api\/reviews\/v2'/);
  assert.match(source, /INSERT INTO reviews/);
});

test('profile review writes support the deployed reviewee_id schema', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'profile-store.js'), 'utf8');
  const routeStart = source.indexOf("app.post('/api/profile/:id/reviews'");
  const routeEnd = source.indexOf("app.get('/api/profile/:id/reviews'", routeStart);
  const route = source.slice(routeStart, routeEnd);

  assert.notEqual(routeStart, -1, 'missing profile review write route');
  assert.match(route, /reviewFk === 'reviewee_id'/);
  assert.match(route, /INSERT INTO reviews \(id, job_id, reviewer_id, reviewee_id, rating, comment, type, created_at\)/);
  assert.doesNotMatch(route, /resolvedEmail/, 'review POST must not reference registration-only email variables');
});

test('marketplace exposes job-scoped review write and read routes', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'marketplace.js'), 'utf8');

  assert.match(source, /'reviews'/);
  assert.match(source, /app\.post\('\/api\/marketplace\/jobs\/:id\/review'/);
  assert.match(source, /app\.get\('\/api\/marketplace\/jobs\/:id\/reviews'/);
  assert.match(source, /'release_complete'/);
});

test('profile review form falls back to signed reviews when live Solana writes are closed', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'frontend', 'src', 'app', 'profile', '[id]', 'WriteReviewForm.tsx'),
    'utf8',
  );

  assert.match(source, /isFrontendSolanaIrysWriteEnabled/);
  assert.match(source, /const v3WritesEnabled = isFrontendSolanaIrysWriteEnabled\(\);/);
  assert.match(
    source,
    /const effectiveMode = v3Available && v3WritesEnabled && chain === 'solana' \? mode : 'v2-signed';/,
  );
  assert.match(source, /\{v3Available && v3WritesEnabled && \(/);
  assert.match(source, /setEscrowCheck\(\{ checking: false, hasEscrow: true, checked: true \}\);/);
});

test('signed review challenge fails closed without a completed released escrow job', async (t) => {
  const marketplaceDir = makeMarketplaceFixture(t);

  const result = await postReviewChallenge(marketplaceDir, {
    reviewerId: 'client_agent',
    revieweeId: 'worker_agent',
    rating: 5,
    chain: 'ethereum',
  });

  assert.equal(result.status, 403);
  assert.equal(result.body.success, false);
  assert.match(result.body.error, /completed job with released escrow/);
});

test('signed review challenge rejects completed jobs that have no released escrow evidence', async (t) => {
  const marketplaceDir = makeMarketplaceFixture(t);
  writeFixtureJSON(marketplaceDir, 'jobs', 'job_no_escrow', {
    id: 'job_no_escrow',
    status: 'completed',
    clientId: 'client_agent',
    acceptedApplicant: 'worker_agent',
  });

  const result = await postReviewChallenge(marketplaceDir, {
    reviewerId: 'client_agent',
    revieweeId: 'worker_agent',
    rating: 5,
    chain: 'ethereum',
  });

  assert.equal(result.status, 403);
  assert.equal(result.body.success, false);
});

test('signed review challenge is allowed after released escrow for the completed job', async (t) => {
  const marketplaceDir = makeMarketplaceFixture(t);
  writeFixtureJSON(marketplaceDir, 'applications', 'app_worker', {
    id: 'app_worker',
    applicantId: 'worker_agent',
    status: 'accepted',
  });
  writeFixtureJSON(marketplaceDir, 'jobs', 'job_released', {
    id: 'job_released',
    status: 'completed',
    clientId: 'client_agent',
    applications: ['app_worker'],
    escrowId: 'escrow_released',
  });
  writeFixtureJSON(marketplaceDir, 'escrow', 'escrow_released', {
    id: 'escrow_released',
    jobId: 'job_released',
    status: 'released',
  });

  const result = await postReviewChallenge(marketplaceDir, {
    reviewerId: 'client_agent',
    revieweeId: 'worker_agent',
    rating: 5,
    chain: 'ethereum',
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.match(result.body.challengeId, /^rc_/);
});
