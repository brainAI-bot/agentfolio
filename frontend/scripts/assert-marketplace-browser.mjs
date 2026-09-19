import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nextBin = path.join(frontendRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const sitePort = Number(process.env.MARKETPLACE_BROWSER_TEST_PORT || 3299);
const apiPort = Number(process.env.MARKETPLACE_BROWSER_API_PORT || 3298);
const siteOrigin = `http://127.0.0.1:${sitePort}`;
const internalOrigin = `http://127.0.0.1:${apiPort}`;
const configuredInternalOrigin = process.env.INTERNAL_API_URL;
assert.equal(configuredInternalOrigin || 'http://127.0.0.1:3333', internalOrigin,
  `probe API must match INTERNAL_API_URL or the production fallback ${internalOrigin}`);

const jobs = [
  {
    id: 'probe-job-1', title: 'Production routing probe', description: 'Proves the real marketplace path.',
    clientId: 'probe-client', budgetAmount: 5, budgetCurrency: 'SOL', skills: ['routing'], status: 'open',
    applicationCount: 1, timeline: '1w', escrow: { funded: false }, createdAt: '2026-09-19T00:00:00.000Z',
  },
  {
    id: 'probe-job-2', title: 'Second canonical listing', description: 'Count parity sentinel.',
    clientId: 'probe-client', budgetAmount: 8, budgetCurrency: 'SOL', skills: ['testing'], status: 'open',
    applicationCount: 0, timeline: 'flexible', escrow: { funded: false }, createdAt: '2026-09-19T01:00:00.000Z',
  },
];
const applications = [{
  id: 'probe-application-1', applicantId: 'probe-agent', applicantName: 'Probe Applicant',
  proposal: 'Canonical application panel proof', proposedBudget: 5, proposedTimeline: '1w',
  status: 'pending', createdAt: '2026-09-19T02:00:00.000Z',
}];

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const apiServer = http.createServer((req, res) => {
  const url = new URL(req.url || '/', internalOrigin);
  if (url.pathname === '/api/marketplace/jobs') return json(res, 200, { jobs });
  if (url.pathname === '/api/marketplace/jobs/probe-job-1') return json(res, 200, jobs[0]);
  if (url.pathname === '/api/marketplace/jobs/probe-job-1/applications') return json(res, 200, { applications });
  if (url.pathname.startsWith('/api/profile-by-wallet')) return json(res, 404, { error: 'not linked' });
  return json(res, 404, { error: `Unhandled probe route: ${url.pathname}` });
});
await new Promise((resolve, reject) => {
  apiServer.once('error', reject);
  apiServer.listen(apiPort, '127.0.0.1', resolve);
});

const nextServer = spawn(process.execPath, [nextBin, 'start', '-p', String(sitePort)], {
  cwd: frontendRoot,
  env: { ...process.env, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
for (const stream of [nextServer.stdout, nextServer.stderr]) {
  stream.on('data', (chunk) => { serverLog = `${serverLog}${chunk}`.slice(-12000); });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForSite() {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    if (nextServer.exitCode !== null) throw new Error(`Next.js exited before readiness\n${serverLog}`);
    try {
      const response = await fetch(`${siteOrigin}/marketplace`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await delay(100);
  }
  throw new Error(`Timed out waiting for production Next.js: ${lastError?.message || 'unknown'}\n${serverLog}`);
}

let browser;
try {
  await waitForSite();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const marketplaceRequests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/jobs') || url.pathname.startsWith('/api/marketplace')) marketplaceRequests.push(url.href);
  });

  const apiResponse = await fetch(`${siteOrigin}/api/marketplace/jobs`);
  assert.equal(apiResponse.status, 200, 'same-origin marketplace API must be reachable through the production server');
  const canonical = await apiResponse.json();
  assert.ok(Array.isArray(canonical.jobs), 'canonical marketplace response must contain jobs');

  const canonicalPageResponse = await fetch(`${siteOrigin}/marketplace`);
  assert.equal(canonicalPageResponse.status, 200, 'canonical no-query marketplace URL must be reachable');
  assert.match(canonicalPageResponse.headers.get('cache-control') || '', /(?:^|,\s*)no-store(?:,|$)/,
    'canonical marketplace HTML must explicitly disable intermediary and browser storage');
  assert.equal(canonicalPageResponse.headers.get('x-agentfolio-cache-policy'), 'marketplace-no-store-v1',
    'canonical marketplace HTML must expose the deployed no-store routing contract');

  await page.goto(`${siteOrigin}/marketplace`, { waitUntil: 'networkidle' });
  const listingLinks = page.locator('a[href^="/marketplace/job/"]');
  await listingLinks.first().waitFor({ state: 'visible' });
  const renderedListingCount = await listingLinks.count();
  assert.equal(renderedListingCount, canonical.jobs.length, 'rendered marketplace listing count must match /api/marketplace/jobs');

  await page.goto(`${siteOrigin}/marketplace/job/probe-job-1`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: /Applications \(1\)/ }).waitFor({ state: 'visible' });
  await page.getByText('Probe Applicant').waitFor({ state: 'visible' });

  assert.ok(marketplaceRequests.length >= 2, 'browser must issue marketplace API requests');
  const offSite = marketplaceRequests.filter((requestUrl) => new URL(requestUrl).origin !== siteOrigin);
  assert.deepEqual(offSite, [], `browser marketplace requests must stay on site origin: ${offSite.join(', ')}`);
  assert.equal(marketplaceRequests.some((requestUrl) => /localhost|:3333\b/.test(requestUrl)), false, 'browser marketplace requests must never target localhost or port 3333');

  console.log(`marketplace-browser: listings=${canonical.jobs.length}; rendered=${renderedListingCount}; applications_panel=loaded; browser_api_requests=${marketplaceRequests.length}; same_origin=1; localhost_requests=0; canonical_no_store=1; cache_policy=marketplace-no-store-v1`);
} finally {
  if (browser) await browser.close();
  if (nextServer.exitCode === null) nextServer.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => nextServer.once('exit', resolve)), delay(3000)]);
  apiServer.close();
}
