'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { API_DOCS } = require('../src/api/docs');

test('production OpenAPI documents V3 SDK parity and authenticated webhook contracts', () => {
  const requiredPaths = [
    '/api/marketplace/jobs/{id}/claim',
    '/api/marketplace/jobs/{id}/fund-staged',
    '/api/marketplace/jobs/{id}/fund-staged/verify',
    '/api/marketplace/jobs/{id}/release',
    '/api/marketplace/jobs/{id}/close',
    '/api/webhooks',
    '/api/webhooks/{id}',
    '/api/webhooks/{id}/test',
  ];
  for (const route of requiredPaths) assert.ok(API_DOCS.paths[route], `missing OpenAPI path ${route}`);
  for (const route of requiredPaths.slice(0, 5)) {
    const parameters = API_DOCS.paths[route].post.parameters;
    assert.ok(parameters.some((parameter) => parameter.$ref === '#/components/parameters/IdempotencyKey'));
  }
  assert.deepEqual(API_DOCS.paths['/api/webhooks'].post.security, [{ bearerAuth: [] }]);
  assert.deepEqual(API_DOCS.paths['/api/webhooks'].get.security, [{ bearerAuth: [] }]);
  assert.match(API_DOCS.paths['/api/marketplace/jobs/{id}/release'].post.description, /No money moves/);

  const humanDocs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'api', 'api-reference.md'), 'utf8');
  assert.match(humanDocs, /Idempotency-Key/);
  assert.match(humanDocs, /exact raw request body/);
  assert.match(humanDocs, /liveEscrowWritesAllowed: false/);

  const sdkDocs = fs.readFileSync(path.join(__dirname, '..', 'sdk', 'README.md'), 'utf8');
  assert.match(sdkDocs, /\.claim\(jobId/);
  assert.match(sdkDocs, /verifyWebhookSignature/);

  const productionDocsPage = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'app', 'docs', 'page.tsx'), 'utf8');
  assert.match(productionDocsPage, /\/api\/marketplace\/jobs\/:id\/fund-staged/);
  assert.match(productionDocsPage, /Register an authenticated, owner-scoped webhook/);
});
