const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function createCaptureApp() {
  const routes = new Map();
  const app = {};
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    app[method] = (path, ...handlers) => {
      routes.set(`${method.toUpperCase()} ${path}`, handlers[handlers.length - 1]);
    };
  }
  app.use = () => {};
  return { app, routes };
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function writeFixture(baseDir, area, id, value) {
  const dir = path.join(baseDir, area);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(value, null, 2));
}

function readFixture(baseDir, area, id) {
  return JSON.parse(fs.readFileSync(path.join(baseDir, area, `${id}.json`), 'utf8'));
}

function loadMarketplaceWithData() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-marketplace-'));
  for (const area of ['jobs', 'applications', 'escrow', 'deliverables']) {
    fs.mkdirSync(path.join(dataDir, area), { recursive: true });
  }
  process.env.MARKETPLACE_DATA_DIR = dataDir;
  delete require.cache[require.resolve('../src/marketplace')];
  const marketplace = require('../src/marketplace');
  const { app, routes } = createCaptureApp();
  marketplace.registerRoutes(app);
  delete process.env.MARKETPLACE_DATA_DIR;
  return { dataDir, routes };
}

describe('P1-F5 disabled write surfaces', () => {
  it('keeps unauthenticated profile review and endorsement writers disabled', () => {
    const profileStore = require('../src/profile-store');
    const { app, routes } = createCaptureApp();
    profileStore.registerRoutes(app);

    for (const route of ['POST /api/profile/:id/reviews', 'POST /api/profile/:id/endorsements']) {
      const handler = routes.get(route);
      assert.ok(handler, `expected ${route} to be registered`);
      const res = createResponse();

      handler({ params: { id: 'agent_alice' }, body: { reviewer_id: 'agent_bob', rating: 5, skill: 'shipping' } }, res);

      assert.equal(res.statusCode, 403);
      assert.equal(res.body.disabled, true);
    }
  });

  it('keeps SATP review writes disabled without returning synthetic PDAs', async () => {
    const satpReviews = require('../src/satp-reviews');
    const { app, routes } = createCaptureApp();
    satpReviews.registerRoutes(app);

    const writeRes = createResponse();
    routes.get('POST /api/satp/reviews')({ body: { reviewer_id: 'a', reviewee_id: 'b', rating: 5 } }, writeRes);
    assert.equal(writeRes.statusCode, 403);
    assert.equal(writeRes.body.disabled, true);

    const readRes = createResponse();
    await routes.get('GET /api/satp/reviews')({
      query: { agent: '11111111111111111111111111111111' },
    }, readRes);
    assert.equal(readRes.statusCode, 200);
    assert.equal(Object.prototype.hasOwnProperty.call(readRes.body, 'identityPDA'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(readRes.body, 'reviewPDA'), false);
  });

  it('keeps marketplace refunds disabled without mutating escrow or job state', () => {
    const { dataDir, routes } = loadMarketplaceWithData();
    const handler = routes.get('POST /api/marketplace/escrow/:id/refund');
    assert.ok(handler, 'expected refund route to be registered');

    writeFixture(dataDir, 'jobs', 'job_refund_disabled', {
      id: 'job_refund_disabled',
      postedBy: 'client_1',
      clientId: 'client_1',
      status: 'in_progress',
    });
    writeFixture(dataDir, 'escrow', 'esc_disabled', {
      id: 'esc_disabled',
      jobId: 'job_refund_disabled',
      fundedBy: 'client_1',
      status: 'funded',
    });

    const res = createResponse();
    handler({ params: { id: 'esc_disabled' }, body: { refundedBy: 'client_1', reason: 'cancelled' } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.disabled, true);
    assert.equal(readFixture(dataDir, 'escrow', 'esc_disabled').status, 'funded');
    assert.equal(readFixture(dataDir, 'jobs', 'job_refund_disabled').status, 'in_progress');
  });

  it('keeps marketplace completion disabled without releasing escrow', () => {
    const { dataDir, routes } = loadMarketplaceWithData();
    const handler = routes.get('POST /api/marketplace/jobs/:id/complete');
    assert.ok(handler, 'expected complete route to be registered');

    writeFixture(dataDir, 'jobs', 'job_complete', {
      id: 'job_complete',
      postedBy: 'client_1',
      clientId: 'client_1',
      status: 'in_progress',
      escrowId: 'esc_complete',
    });
    writeFixture(dataDir, 'escrow', 'esc_complete', {
      id: 'esc_complete',
      jobId: 'job_complete',
      fundedBy: 'client_1',
      status: 'funded',
    });

    const res = createResponse();
    handler({ params: { id: 'job_complete' }, body: { approvedBy: 'client_1', releaseTxSignature: 'tx_release_1' } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.disabled, true);
    assert.equal(readFixture(dataDir, 'jobs', 'job_complete').status, 'in_progress');
    assert.equal(readFixture(dataDir, 'escrow', 'esc_complete').status, 'funded');
    assert.equal(readFixture(dataDir, 'jobs', 'job_complete').fundsReleased, undefined);
  });

  it('keeps marketplace request-changes disabled without clearing deliverables', () => {
    const { dataDir, routes } = loadMarketplaceWithData();
    const handler = routes.get('POST /api/marketplace/jobs/:id/request-changes');
    assert.ok(handler, 'expected request-changes route to be registered');

    writeFixture(dataDir, 'jobs', 'job_changes', {
      id: 'job_changes',
      postedBy: 'client_1',
      clientId: 'client_1',
      status: 'in_progress',
      deliverableId: 'deliverable_1',
    });

    const res = createResponse();
    handler({ params: { id: 'job_changes' }, body: { requestedBy: 'client_1', note: 'revise' } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.disabled, true);
    const job = readFixture(dataDir, 'jobs', 'job_changes');
    assert.equal(job.changeRequests, undefined);
    assert.equal(job.deliverableId, 'deliverable_1');
  });
});
