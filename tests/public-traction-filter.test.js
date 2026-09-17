const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtureCohort = require('../src/lib/public-fixture-cohort.json');
const {
  REVIEWED_FIXTURE_PROFILE_IDS,
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
    assert.equal(isFixtureIdentity('agent_brainforge', 'brainForge'), false);
    assert.equal(isFixtureIdentity('agent_brainkid', 'brainKID'), false);
    assert.equal(isFixtureIdentity('agent_brainchain', 'brainChain'), false);
    assert.equal(isPublicTractionIdentity('agent_brainforge', 'brainForge'), true);
    assert.equal(isFixtureJob({ title: 'CPI Test escrow', client_id: 'agent_brainforge' }), true);
    assert.equal(isFixtureJob({ title: 'Website copy', client_id: 'agent_brainforge' }), false);
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

  it('is wired into public stats and leaderboard', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
    assert.match(serverSource, /isFixtureIdentity/);
    assert.match(serverSource, /isFixtureJob/);
    assert.match(serverSource, /publicTraction/);
    const statsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'ecosystem-stats.js'), 'utf8');
    assert.match(statsSource, /isFixtureIdentity/);
    assert.match(statsSource, /isFixtureJob/);
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
