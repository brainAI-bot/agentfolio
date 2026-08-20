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

  it('labels a joined satp_trust_scores 3/320 row leftover, not unlabeled satp_trust_scores', () => {
    // Handler rewrite: score>0 becomes source=satp_trust_scores before the labeler.
    const row = {
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
      source: 'satp_trust_scores',
      profileJoined: true,
    };

    assert.equal(isUnlabeledOffchainL3_320(row), true, 'satp_trust_scores 3/320 is unlabeled leftover');

    const labeled = labelLeaderboardHonesty(row, [EXPLORER_P1REG]);

    assert.equal(isUnlabeledOffchainL3_320(labeled), false);
    assert.equal(labeled.source, 'offchain-stale');
    assert.notEqual(labeled.source, 'satp_trust_scores');
    assert.equal(labeled.notSatpV3, true);
    assert.equal(labeled.leftoverSource, 'satp_trust_scores');
    assert.equal(labeled.current, CURRENT_SATP_EXPLORER);
    assert.equal(labeled.current, '/api/satp/explorer/agents');

    // Rank stays leftover 3/320 — do not rewrite from explorer 2/8.
    assert.equal(labeled.score, 320);
    assert.equal(labeled.reputationScore, 320);
    assert.equal(labeled.level, 3);
    assert.equal(labeled.verificationLevel, 3);

    const payload = labelLeaderboardResponse({
      ok: true,
      leaderboard: [row],
      payment: { required: false, paidEndpoint: '/api/leaderboard/scores' },
    }, [EXPLORER_P1REG]);
    assert.equal(payload.current, '/api/satp/explorer/agents');
    assert.equal(payload.leaderboard[0].source, 'offchain-stale');
    assert.equal(payload.leaderboard[0].score, 320);
    assert.equal(payload.leaderboard[0].level, 3);
  });

  it('does not relabel v3_onchain or explorer rows as leftover', () => {
    for (const source of ['v3_onchain', 'explorer']) {
      const labeled = labelLeaderboardHonesty({
        agentId: 'agent_p1reg_35028542',
        score: 8,
        reputationScore: 8,
        level: 2,
        verificationLevel: 2,
        source,
      }, []);
      assert.equal(labeled.source, source);
      assert.equal(labeled.notSatpV3, undefined);
      assert.equal(labeled.leftoverSource, undefined);
    }
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
