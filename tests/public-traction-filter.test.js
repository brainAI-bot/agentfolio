const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isFixtureIdentity, isPublicTractionIdentity, isFixtureJob } = require('../src/lib/public-traction');

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

  it('is wired into public stats and leaderboard', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
    assert.match(serverSource, /isFixtureIdentity/);
    assert.match(serverSource, /isFixtureJob/);
    assert.match(serverSource, /publicTraction/);
    const statsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'ecosystem-stats.js'), 'utf8');
    assert.match(statsSource, /isFixtureIdentity/);
    assert.match(statsSource, /isFixtureJob/);
  });
});
