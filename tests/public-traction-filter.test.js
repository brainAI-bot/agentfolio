const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtureCohort = require('../src/lib/public-fixture-cohort.json');
const {
  REVIEWED_FIXTURE_PROFILE_IDS,
  PINNED_FIXTURE_IDENTITIES,
  isFixtureIdentity,
  isPublicTractionIdentity,
  isFixtureJob,
  shouldExcludeFixtures,
} = require('../src/lib/public-traction');

describe('public traction fixture filter', () => {
  it('excludes the documented smoke/QA/fixture patterns and keeps real identities', () => {
    assert.equal(isFixtureIdentity('agent_sm423064591'), true);
    assert.equal(isFixtureIdentity('local_client_mnvm8zu5mqrq5i'), true);
    assert.equal(isFixtureIdentity('CPI Test Agent'), true);
    assert.equal(isFixtureIdentity('Full Test mnbhckxs'), true);
    assert.equal(isFixtureIdentity('forgetest'), true);
    assert.equal(isFixtureIdentity('brainTEST007'), true);
    assert.equal(isFixtureIdentity('Test Agent'), true);
    assert.equal(isFixtureIdentity('agent_latest_release', 'Latest Release'), false);
    assert.equal(isFixtureIdentity('agent_contest_judge', 'Contest Judge'), false);
    assert.equal(isFixtureIdentity('agent_protest_archive', 'Protest Archive'), false);
    assert.equal(isFixtureIdentity('agent_brainforge', 'brainForge'), false);
    assert.equal(isFixtureIdentity('agent_brainkid', 'brainKID'), false);
    assert.equal(isFixtureIdentity('agent_brainchain', 'brainChain'), false);
    assert.equal(isPublicTractionIdentity('agent_brainforge', 'brainForge'), true);
    assert.equal(isFixtureJob({ title: 'CPI Test escrow', client_id: 'agent_brainforge' }), true);
    assert.equal(isFixtureJob({ title: 'Website copy', client_id: 'agent_brainforge' }), false);
  });

  it('pins the post-snapshot rate probes without broad rate-name matching', () => {
    const pinned = ['agent_ratecheck', 'agent_ratelimit_probe', 'agent_ratecheck2'];
    assert.deepEqual([...PINNED_FIXTURE_IDENTITIES], pinned);
    for (const id of pinned) assert.equal(isFixtureIdentity(id), true, `${id} must remain excluded`);
    assert.equal(isFixtureIdentity('agent_ratecheck3'), false);
    assert.equal(isFixtureIdentity('agent_rate_analysis', 'Rate Analysis'), false);
  });

  it('classifies the leaked SATP explorer probes without matching embedded test words', () => {
    const leakedExplorerFixtures = [
      ['agent_ratetest1', 'ratetest1'],
      ['agent_ratetest2', 'ratetest2'],
      ['agent_ratetest3', 'ratetest3'],
      ['agent_ceo_selftest_55648944', 'CEO Selftest 55648944'],
      ['agent_testprobe_agent', 'testprobe_agent'],
    ];
    for (const identities of leakedExplorerFixtures) {
      assert.equal(isFixtureIdentity(...identities), true, `${identities[0]} must be excluded`);
    }

    for (const identities of [
      ['agent_latest_release', 'Latest Release'],
      ['agent_contest_judge', 'Contest Judge'],
      ['agent_protest_archive', 'Protest Archive'],
      ['agent_testimonial_writer', 'Testimonial Writer'],
    ]) {
      assert.equal(isFixtureIdentity(...identities), false, `${identities[0]} must remain public`);
    }
  });

  it('pins the complete reviewed 40-profile QA/demo cohort by provenance id', () => {
    assert.equal(fixtureCohort.reviewedProfileCount, 40);
    assert.equal(fixtureCohort.profileIds.length, 40);
    assert.equal(new Set(fixtureCohort.profileIds).size, 40);
    assert.equal(REVIEWED_FIXTURE_PROFILE_IDS.size, 40);
    for (const id of fixtureCohort.profileIds) {
      assert.equal(isFixtureIdentity(id), true, `${id} must remain in the reviewed fixture cohort`);
    }

    for (const knownQaId of [
      'agent_p1reg_35028542',
      'agent_sm423064591',
      'agent_p1t897160938',
      'agent_sm816063701',
      'agent_c07a79f1de3bf165',
      'agent_a838d53d7b88bce8',
    ]) {
      assert.equal(REVIEWED_FIXTURE_PROFILE_IDS.has(knownQaId), true);
    }

    assert.equal(isFixtureIdentity('agent_legitimate_demo', 'Demo orchestration agent'), false);
    assert.equal(isFixtureIdentity('agent_legitimate_money', 'Not real money documentation'), false);
  });

  it('is wired into public stats, leaderboard, and SATP explorer', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
    assert.match(serverSource, /isFixtureIdentity/);
    assert.match(serverSource, /isFixtureJob/);
    assert.match(serverSource, /publicTraction/);
    const statsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'ecosystem-stats.js'), 'utf8');
    assert.match(statsSource, /isFixtureIdentity/);
    assert.match(statsSource, /isFixtureJob/);
    const explorerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'satp-explorer-api.js'), 'utf8');
    assert.match(explorerSource, /dedupedAgents\.filter\(\(agent\) => !isFixtureIdentity\(agent\?\.name, agent\?\.agentId, agent\?\.profileId, agent\?\.id\)\)/);
  });

  it('honours the stats excludeFixtures query with a fail-closed default', () => {
    assert.equal(shouldExcludeFixtures(undefined), true);
    assert.equal(shouldExcludeFixtures('true'), true);
    assert.equal(shouldExcludeFixtures('false'), false);
    assert.equal(shouldExcludeFixtures(false), false);
    assert.equal(shouldExcludeFixtures(['true', 'false']), false);

    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
    assert.match(serverSource, /getEcosystemStatsPayload\(shouldExcludeFixtures\(req\.query\.excludeFixtures\)\)/);
    assert.match(serverSource, /publicTraction: \{ excludedFixtures: excludeFixtures \}/);
    assert.match(serverSource, /!excludeFixtures \|\| !isFixtureIdentity/);
    assert.match(serverSource, /!excludeFixtures \|\| !isFixtureJob/);
  });
});
