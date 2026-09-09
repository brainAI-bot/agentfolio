const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const homepageSource = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'app', 'page.tsx'),
  'utf8'
);
const apiSource = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'lib', 'api.ts'),
  'utf8'
);

test('fetchStats maps the canonical live payload into homepage counts', async () => {
  const { fetchStats } = await import(pathToFileURL(
    path.join(__dirname, '..', 'frontend', 'src', 'lib', 'api.ts')
  ));
  const request = async (url, options) => {
    assert.equal(url, 'http://localhost:3333/api/stats');
    assert.deepEqual(options, { cache: 'no-store' });
    return new Response(JSON.stringify({
      agents: { total: 11, verified: 4, claimed: 8, avgSkills: 3 },
      total: 11,
      totalAgents: 11,
      totalSkills: 9,
      verified: 4,
      verifiedAgents: 4,
      claimed: 8,
      onChain: 7,
      on_chain: 7,
      verificationTypes: 2,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  assert.deepEqual(await fetchStats(request), {
    totalAgents: 11,
    totalSkills: 9,
    claimed: 8,
    verified: 4,
    onChain: 7,
    verificationTypes: 2,
  });
});

test('homepage omits public counters when the stats endpoint is unavailable', async () => {
  const { fetchHomepageStats, fetchStats, getPublicStatCounters } = await import(pathToFileURL(
    path.join(__dirname, '..', 'frontend', 'src', 'lib', 'api.ts')
  ));
  const unavailableRequest = async () => new Response(null, { status: 503 });

  const stats = await fetchHomepageStats(
    () => fetchStats(unavailableRequest),
    () => {},
  );

  assert.equal(stats, null);
  assert.deepEqual(getPublicStatCounters(stats), []);
});

test('homepage source uses the fail-closed stats view model without hardcoded counts', () => {
  assert.match(apiSource, /fetchImpl\(`\$\{API_BASE\}\/api\/stats`, \{ cache: 'no-store' \}\)/);
  assert.doesNotMatch(apiSource, /api\/ecosystem\/stats/);
  assert.match(apiSource, /data\.total \?\? data\.totalAgents \?\? data\.agents\?\.total/);
  assert.match(apiSource, /data\.claimed \?\? data\.agents\?\.claimed/);
  assert.match(apiSource, /data\.verified \?\? data\.verifiedAgents \?\? data\.agents\?\.verified/);
  assert.match(apiSource, /data\.onChain \?\? data\.on_chain/);

  assert.match(homepageSource, /const platformStats = await fetchHomepageStats\(\)/);
  assert.match(homepageSource, /const statCounters = getPublicStatCounters\(platformStats\)/);
  assert.doesNotMatch(homepageSource, /\bgetStats\b/);
  assert.doesNotMatch(homepageSource, /bornAgents|\$\{platformStats\.totalAgents\}\+/);
  assert.match(homepageSource, /statCounters\.length > 0/);
  assert.match(homepageSource, /totalAgents=\{platformStats\?\.totalAgents\}/);
  assert.doesNotMatch(homepageSource, /totalAgents=\{agents\.length\}/);
});
