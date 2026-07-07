const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const nacl = require('tweetnacl');
const _bs58 = require('bs58');
const { registerReviewChallengeRoutes } = require('../src/api/review-challenge');
const { registerReviewsV2Routes } = require('../src/api/reviews-v2');

const ROOT = path.join(__dirname, '..');
const bs58 = _bs58.default || _bs58;

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
  const routes = registerChallengeTestRoutes({ marketplaceDir });
  return callRoute(routes.get('/api/reviews/challenge'), { body });
}

function registerChallengeTestRoutes(options) {
  const routes = new Map();
  const app = {
    post(route, ...handlers) {
      routes.set(route, handlers[handlers.length - 1]);
      routes.set(`${route} handlers`, handlers);
    },
    get(route, handler) {
      routes.set(route, handler);
    },
  };
  registerReviewChallengeRoutes(app, options);
  return routes;
}

function registerReviewsV2TestRoutes(options) {
  const routes = new Map();
  const app = {
    post(route, handler) {
      routes.set(`POST ${route}`, handler);
    },
    get(route, handler) {
      routes.set(`GET ${route}`, handler);
    },
  };
  registerReviewsV2Routes(app, options);
  return routes;
}

async function callRoute(handler, req = {}) {
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

  await handler(req, res);
  return { status, body: responseBody };
}

function createReviewDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-review-db-'));
  const dbPath = path.join(dir, 'agentfolio.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE reviews (
      id TEXT PRIMARY KEY,
      job_id TEXT DEFAULT '',
      reviewer_id TEXT NOT NULL,
      reviewee_id TEXT NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT DEFAULT '',
      type TEXT DEFAULT '',
      created_at TEXT DEFAULT ''
    )
  `);
  db.exec(`
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY,
      wallet TEXT DEFAULT '',
      claimed_by TEXT DEFAULT '',
      wallets TEXT DEFAULT '{}',
      verification_data TEXT DEFAULT '{}'
    )
  `);
  db.close();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dbPath;
}

function seedProfile(dbPath, id, wallets) {
  const db = new Database(dbPath);
  db.prepare('INSERT INTO profiles (id, wallet, wallets) VALUES (?, ?, ?)').run(
    id,
    wallets.solana || wallets.ethereum || '',
    JSON.stringify(wallets),
  );
  db.close();
}

function writeReleasedEscrowFixture(t) {
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
  return marketplaceDir;
}

function signMessage(message, keypair) {
  return bs58.encode(nacl.sign.detached(Buffer.from(message), keypair.secretKey));
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
  assert.match(source, /signed released-escrow flow/);
  assert.doesNotMatch(source, /INSERT INTO reviews/);
});

test('legacy profile review writes are hard-disabled', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'profile-store.js'), 'utf8');
  const routeStart = source.indexOf("app.post('/api/profile/:id/reviews'");
  const routeEnd = source.indexOf("app.get('/api/profile/:id/reviews'", routeStart);
  const route = source.slice(routeStart, routeEnd);

  assert.notEqual(routeStart, -1, 'missing profile review write route');
  assert.match(source, /const profileReviewWriteLimiter = rateLimit\(/);
  assert.match(route, /profileReviewWriteLimiter/);
  assert.match(route, /res\.status\(403\)/);
  assert.match(route, /signed released-escrow flow/);
  assert.doesNotMatch(route, /INSERT INTO reviews/);
  assert.doesNotMatch(route, /resolvedEmail/, 'review POST must not reference registration-only email variables');
});

test('marketplace exposes only the read route and disables job-scoped review writes', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'marketplace.js'), 'utf8');
  const postStart = source.indexOf("app.post('/api/marketplace/jobs/:id/review'");
  const getStart = source.indexOf("app.get('/api/marketplace/jobs/:id/reviews'");
  const postRoute = source.slice(postStart, getStart);

  assert.match(source, /'reviews'/);
  assert.match(source, /app\.post\('\/api\/marketplace\/jobs\/:id\/review'/);
  assert.match(source, /app\.get\('\/api\/marketplace\/jobs\/:id\/reviews'/);
  assert.match(postRoute, /res\.status\(403\)/);
  assert.match(postRoute, /signed released-escrow flow/);
  assert.doesNotMatch(postRoute, /writeJobReviews/);
});

test('marketplace review paths validate job ids before filesystem access', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'marketplace.js'), 'utf8');
  const postStart = source.indexOf("app.post('/api/marketplace/jobs/:id/review'");
  const getStart = source.indexOf("app.get('/api/marketplace/jobs/:id/reviews'");
  const requestChangesStart = source.indexOf("app.post('/api/marketplace/jobs/:id/request-changes'", getStart);
  const postRoute = source.slice(postStart, getStart);
  const getRoute = source.slice(getStart, requestChangesStart);

  assert.match(source, /const SAFE_JOB_ID_RE = \/\^job_\[A-Za-z0-9_-\]\{1,80\}\$\/;/);
  assert.match(source, /function safeJobReviewPath\(jobId\)/);
  assert.match(source, /readJSON\(safeJobReviewPath\(jobId\)\)/);
  assert.match(source, /writeJSON\(safeJobReviewPath\(jobId\), reviews\)/);
  assert.match(postRoute, /res\.status\(403\)/);
  assert.doesNotMatch(postRoute, /readJSON\(safeJobPath\(jobId\)\)/);
  assert.match(getRoute, /validateJobId\(jobId\)/);
  assert.match(getRoute, /safeJobPath\(jobId\)/);
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

test('signed review challenge and submit routes are rate limited', () => {
  const routes = registerChallengeTestRoutes({});

  const challengeHandlers = routes.get('/api/reviews/challenge handlers');
  const submitHandlers = routes.get('/api/reviews/submit handlers');

  assert.equal(challengeHandlers.length, 2, 'challenge route should include a limiter and handler');
  assert.equal(submitHandlers.length, 2, 'submit route should include a limiter and handler');
  assert.notEqual(challengeHandlers[0], challengeHandlers[1]);
  assert.notEqual(submitHandlers[0], submitHandlers[1]);
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
  const marketplaceDir = writeReleasedEscrowFixture(t);

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

test('legacy reviews v2 body-claimed write path returns 403', async (t) => {
  const dbPath = createReviewDb(t);
  const routes = registerReviewsV2TestRoutes({ dbPath });

  const result = await callRoute(routes.get('POST /api/reviews/v2'), {
    body: {
      reviewer_id: 'forged_client',
      reviewee_id: 'worker_agent',
      rating: 5,
    },
  });

  assert.equal(result.status, 403);
  assert.match(result.body.error, /signed released-escrow flow/);
});

test('signed released-escrow review submit creates one review for the bound SATP identity', async (t) => {
  const marketplaceDir = writeReleasedEscrowFixture(t);
  const dbPath = createReviewDb(t);
  const reviewer = nacl.sign.keyPair();
  const reviewerWallet = bs58.encode(reviewer.publicKey);
  seedProfile(dbPath, 'client_agent', { solana: reviewerWallet });
  seedProfile(dbPath, 'worker_agent', { solana: bs58.encode(nacl.sign.keyPair().publicKey) });
  const routes = registerChallengeTestRoutes({ marketplaceDir, dbPath });

  const challenge = await callRoute(routes.get('/api/reviews/challenge'), {
    body: {
      reviewerId: 'client_agent',
      revieweeId: 'worker_agent',
      rating: 5,
      chain: 'solana',
    },
  });
  assert.equal(challenge.status, 200);

  const submit = await callRoute(routes.get('/api/reviews/submit'), {
    body: {
      challengeId: challenge.body.challengeId,
      signature: signMessage(challenge.body.message, reviewer),
      walletAddress: reviewerWallet,
      comment: 'Released escrow went smoothly',
    },
  });

  assert.equal(submit.status, 200);
  assert.equal(submit.body.verified, true);
  assert.equal(submit.body.review.reviewer, 'client_agent');
  assert.equal(submit.body.review.reviewee, 'worker_agent');
  assert.equal(submit.body.review.jobId, 'job_released');

  const db = new Database(dbPath);
  const row = db.prepare('SELECT job_id, reviewer_id, reviewee_id, rating, comment, type FROM reviews').get();
  db.close();
  assert.deepEqual(row, {
    job_id: 'job_released',
    reviewer_id: 'client_agent',
    reviewee_id: 'worker_agent',
    rating: 5,
    comment: 'Released escrow went smoothly',
    type: 'escrow_review',
  });
});

test('signed review submit rejects a forged body-claimed reviewer identity', async (t) => {
  const marketplaceDir = writeReleasedEscrowFixture(t);
  const dbPath = createReviewDb(t);
  const realReviewer = nacl.sign.keyPair();
  const forgedReviewer = nacl.sign.keyPair();
  seedProfile(dbPath, 'client_agent', { solana: bs58.encode(realReviewer.publicKey) });
  seedProfile(dbPath, 'worker_agent', { solana: bs58.encode(nacl.sign.keyPair().publicKey) });
  const routes = registerChallengeTestRoutes({ marketplaceDir, dbPath });

  const challenge = await callRoute(routes.get('/api/reviews/challenge'), {
    body: {
      reviewerId: 'client_agent',
      revieweeId: 'worker_agent',
      rating: 5,
      chain: 'solana',
    },
  });

  const submit = await callRoute(routes.get('/api/reviews/submit'), {
    body: {
      challengeId: challenge.body.challengeId,
      signature: signMessage(challenge.body.message, forgedReviewer),
      walletAddress: bs58.encode(forgedReviewer.publicKey),
      comment: 'I should not write as client_agent',
    },
  });

  assert.equal(submit.status, 403);
  assert.match(submit.body.error, /not bound to the reviewer SATP identity/);
});

test('signed review submit rejects a duplicate review for the same released escrow', async (t) => {
  const marketplaceDir = writeReleasedEscrowFixture(t);
  const dbPath = createReviewDb(t);
  const reviewer = nacl.sign.keyPair();
  const reviewerWallet = bs58.encode(reviewer.publicKey);
  seedProfile(dbPath, 'client_agent', { solana: reviewerWallet });
  seedProfile(dbPath, 'worker_agent', { solana: bs58.encode(nacl.sign.keyPair().publicKey) });
  const routes = registerChallengeTestRoutes({ marketplaceDir, dbPath });

  for (const expectedStatus of [200, 409]) {
    const challenge = await callRoute(routes.get('/api/reviews/challenge'), {
      body: {
        reviewerId: 'client_agent',
        revieweeId: 'worker_agent',
        rating: 5,
        chain: 'solana',
      },
    });

    const submit = await callRoute(routes.get('/api/reviews/submit'), {
      body: {
        challengeId: challenge.body.challengeId,
        signature: signMessage(challenge.body.message, reviewer),
        walletAddress: reviewerWallet,
      },
    });

    assert.equal(submit.status, expectedStatus);
  }

  const db = new Database(dbPath);
  const count = db.prepare('SELECT COUNT(*) AS count FROM reviews').get().count;
  db.close();
  assert.equal(count, 1);
});
