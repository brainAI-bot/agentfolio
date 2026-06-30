const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');

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
