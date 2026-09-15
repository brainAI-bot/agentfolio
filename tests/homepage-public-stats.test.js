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
const leaderboardSource = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'components', 'LeaderboardTable.tsx'),
  'utf8'
);
const leaderboardPageSource = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'app', 'leaderboard', 'page.tsx'),
  'utf8'
);
const agentsRouteSource = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'app', 'api', 'agents', 'route.ts'),
  'utf8'
);
const statsPageSource = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'app', 'stats', 'page.tsx'),
  'utf8'
);
const satpPageSource = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'app', 'satp', 'page.tsx'),
  'utf8'
);

test('fetchStats maps the canonical live payload into homepage counts', async () => {
  const { fetchStats, getPublicStatCounters } = await import(pathToFileURL(
    path.join(__dirname, '..', 'frontend', 'src', 'lib', 'api.ts')
  ));
  const request = async (url, options) => {
    assert.equal(url, 'http://localhost:3333/api/stats?excludeFixtures=true');
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
      publicTraction: { excludedFixtures: true },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const stats = await fetchStats(request);
  assert.deepEqual(stats, {
    totalAgents: 11,
    totalSkills: 9,
    claimed: 8,
    verified: 4,
    onChain: 7,
    verificationTypes: 2,
  });
  assert.deepEqual(getPublicStatCounters(stats), [
    { key: 'totalAgents', label: 'Agents', value: 11 },
    { key: 'claimed', label: 'Claimed', value: 8 },
    { key: 'verified', label: 'Verified', value: 4 },
    { key: 'onChain', label: 'On-Chain', value: 7 },
  ]);
});

test('homepage rejects stats that do not prove fixture exclusion', async () => {
  const { fetchStats } = await import(pathToFileURL(
    path.join(__dirname, '..', 'frontend', 'src', 'lib', 'api.ts')
  ));
  const responseFor = (publicTraction) => async () => new Response(JSON.stringify({
    total: 12,
    claimed: 9,
    verified: 5,
    onChain: 8,
    publicTraction,
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  await assert.rejects(
    fetchStats(responseFor({ excludedFixtures: false })),
    /did not confirm fixture exclusion/,
  );
  await assert.rejects(
    fetchStats(responseFor(undefined)),
    /did not confirm fixture exclusion/,
  );
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

test('homepage leaderboard uses only the already filtered public cohort', async () => {
  const { getHomepageLeaderboard } = await import(pathToFileURL(
    path.join(__dirname, '..', 'frontend', 'src', 'lib', 'homepage.ts')
  ));
  const agents = Array.from({ length: 11 }, (_, id) => ({ id }));

  const leaderboard = getHomepageLeaderboard(agents);

  assert.deepEqual(leaderboard.agents, agents.slice(0, 24));
  assert.equal(leaderboard.totalAgents, agents.length);
  assert.equal(leaderboard.cohortLabel, 'agents');
  assert.equal(leaderboard.totalAgents, 11);
});

test('homepage source uses the fail-closed stats view model without hardcoded counts', () => {
  assert.match(apiSource, /fetchImpl\(`\$\{API_BASE\}\/api\/stats\?excludeFixtures=true`, \{ cache: 'no-store' \}\)/);
  assert.match(apiSource, /data\.publicTraction\?\.excludedFixtures !== true/);
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
  assert.match(homepageSource, /cohortLabel=\{leaderboard\.cohortLabel\}/);
  assert.match(leaderboardSource, /cohortLabel = "agents"/);
  assert.match(leaderboardSource, /of \{total\} \{cohortLabel\}/);
});

test('leaderboard page renders only the public non-fixture cohort', () => {
  assert.match(leaderboardPageSource, /getAllPublicAgents/);
  assert.match(leaderboardPageSource, /agents listed from the public non-fixture cohort/);
  assert.match(leaderboardPageSource, /cohortLabel="agents"/);
  assert.doesNotMatch(leaderboardPageSource, /agents ranked by evidence-backed trust score/);
});

test('all homepage identity surfaces use the shared public cohort', () => {
  const dataSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'data.ts'), 'utf8');
  assert.match(dataSource, /public-fixture-cohort\.json/);
  assert.match(dataSource, /export function getAllPublicAgents/);
  assert.match(homepageSource, /const agents = await getAllPublicAgents\(\)/);
  assert.match(dataSource, /export function getTopVerifiedAgents[\s\S]*?const agents = getAllPublicAgents\(\)/);
  assert.match(dataSource, /export function getActivityFeed[\s\S]*?const agents = getAllPublicAgents\(\)/);
  assert.match(dataSource, /export function getRecentlyVerified[\s\S]*?const agents = getAllPublicAgents\(\)/);
});

test('interactive and secondary public surfaces use the non-fixture cohort', () => {
  assert.match(agentsRouteSource, /const publicAgents = getAllPublicAgents\(\)/);
  assert.match(agentsRouteSource, /let agents = \[\.\.\.publicAgents\]/);
  assert.match(agentsRouteSource, /new Set\(publicAgents\.flatMap\(a => a\.skills\)\)/);
  assert.doesNotMatch(agentsRouteSource, /\bgetAllAgents\b/);
  assert.match(statsPageSource, /const agents = await getAllPublicAgents\(\)/);
  assert.match(satpPageSource, /const agents = await getAllPublicAgents\(\)/);
});

test('frontend fixture cohort mirror is identical to the server source', () => {
  const serverCohort = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'src', 'lib', 'public-fixture-cohort.json'),
    'utf8'
  ));
  const frontendCohort = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'src', 'lib', 'public-fixture-cohort.json'),
    'utf8'
  ));

  assert.deepEqual(frontendCohort, serverCohort);
});

test('empty public cohorts do not render misleading social proof or pagination ranges', () => {
  assert.match(homepageSource, /topAgents\.length > 0 &&/);
  assert.match(leaderboardSource, /total === 0[\s\S]*?Showing 0 of 0/);
});
