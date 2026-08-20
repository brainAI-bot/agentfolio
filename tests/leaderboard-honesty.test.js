const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const {
  CURRENT_SATP_EXPLORER,
  isUnlabeledOffchainL3_320,
  labelLeaderboardHonesty,
  labelLeaderboardResponse,
} = require('../src/lib/leaderboard-honesty');

const P1REG = {
  agentId: 'agent_p1reg_35028542',
  id: 'agent_p1reg_35028542',
  name: 'p1reg_35028542',
  handle: 'agent_p1reg_35028542',
  score: 320,
  reputationScore: 320,
  level: 3,
  levelName: 'Established',
  verificationLevel: 3,
  verificationLabel: 'Established',
  source: 'verifiable-trust-score',
  profileJoined: true,
};

const EXPLORER_P1REG = {
  agentId: 'agent_p1reg_35028542',
  profileId: 'agent_p1reg_35028542',
  name: 'p1reg_35028542',
  verificationLevel: 2,
  reputationScore: 8,
  profileJoined: true,
};

describe('AF-LB-001 leftover leaderboard honesty', () => {
  it('does not return a joined agent with off-chain 3/320 unlabeled as L3/320', () => {
    assert.equal(isUnlabeledOffchainL3_320(P1REG), true, 'fixture must start as unlabeled leftover 3/320');

    const labeled = labelLeaderboardHonesty(P1REG, [EXPLORER_P1REG]);

    assert.equal(isUnlabeledOffchainL3_320(labeled), false);
    assert.equal(labeled.source, 'offchain-stale');
    assert.notEqual(labeled.source, 'verifiable-trust-score');
    assert.equal(labeled.notSatpV3, true);
    assert.equal(labeled.leftoverSource, 'verifiable-trust-score');
    assert.equal(labeled.current, CURRENT_SATP_EXPLORER);
    assert.equal(labeled.current, '/api/satp/explorer/agents');

    // Rank stays leftover 3/320 — do not rewrite from explorer 2/8.
    assert.equal(labeled.score, 320);
    assert.equal(labeled.reputationScore, 320);
    assert.equal(labeled.level, 3);
    assert.equal(labeled.verificationLevel, 3);

    assert.equal(labeled.v3VerificationLevel, 2);
    assert.equal(labeled.v3ReputationScore, 8);
  });

  it('points the public leaderboard envelope at SATP explorer current', () => {
    const payload = labelLeaderboardResponse({
      ok: true,
      leaderboard: [P1REG],
      payment: { required: false, paidEndpoint: '/api/leaderboard/scores' },
    }, [EXPLORER_P1REG]);

    assert.equal(payload.current, '/api/satp/explorer/agents');
    assert.equal(payload.leaderboard[0].source, 'offchain-stale');
    assert.equal(isUnlabeledOffchainL3_320(payload.leaderboard[0]), false);
    assert.equal(payload.payment.required, false);
  });

  it('leaves a satp_trust_scores row source unchanged so rank fixtures stay stable', () => {
    const row = {
      agentId: 'agent_alice',
      score: 777,
      level: 4,
      verificationLevel: 4,
      source: 'satp_trust_scores',
    };
    const labeled = labelLeaderboardHonesty(row, []);
    assert.equal(labeled.source, 'satp_trust_scores');
    assert.equal(labeled.score, 777);
    assert.equal(labeled.notSatpV3, undefined);
  });
});

describe('AF-LB-001 is wired on GET /api/leaderboard', () => {
  it('server labels leftover verifiable-trust-score via the honesty helper', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
    assert.match(source, /leaderboard-honesty/);
    assert.match(source, /labelLeaderboardResponse|labelLeaderboardHonesty/);
    assert.match(source, /CURRENT_SATP_EXPLORER|\/api\/satp\/explorer\/agents/);
    assert.doesNotMatch(source, /AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES\s*=/);
  });
});
