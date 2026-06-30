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
