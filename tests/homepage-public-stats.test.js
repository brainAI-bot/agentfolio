const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const homepageSource = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'app', 'page.tsx'),
  'utf8'
);
const apiSource = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'lib', 'api.ts'),
  'utf8'
);

test('homepage public counters use the live canonical stats endpoint', () => {
  assert.match(apiSource, /fetch\(`\$\{API_BASE\}\/api\/stats`, \{ cache: 'no-store' \}\)/);
  assert.doesNotMatch(apiSource, /api\/ecosystem\/stats/);
  assert.match(apiSource, /data\.total \?\? data\.totalAgents \?\? data\.agents\?\.total/);
  assert.match(apiSource, /data\.claimed \?\? data\.agents\?\.claimed/);
  assert.match(apiSource, /data\.verified \?\? data\.verifiedAgents \?\? data\.agents\?\.verified/);
  assert.match(apiSource, /data\.onChain \?\? data\.on_chain/);

  assert.match(homepageSource, /const platformStats = await fetchStats\(\)/);
  assert.doesNotMatch(homepageSource, /\bgetStats\b/);
  assert.doesNotMatch(homepageSource, /bornAgents|\$\{platformStats\.totalAgents\}\+/);
  assert.match(homepageSource, /label: "Agents", value: platformStats\.totalAgents/);
  assert.match(homepageSource, /label: "Claimed", value: platformStats\.claimed/);
  assert.match(homepageSource, /label: "Verified", value: platformStats\.verified/);
  assert.match(homepageSource, /label: "On-Chain", value: platformStats\.onChain/);
  assert.match(homepageSource, /totalAgents=\{platformStats\.totalAgents\}/);
  assert.doesNotMatch(homepageSource, /totalAgents=\{agents\.length\}/);
});
