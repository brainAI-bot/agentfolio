const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

// Load database first (initializes schema including new SATP tables)
const database = require('../src/lib/database');
const {
  computeTrustScore,
  getAttestation,
  listAttestations,
  getTrustScore,
  getRegistryStats,
  syncAllTrustScores
} = require('../src/lib/satp-registry');

// Helper: create a test profile
function createTestProfile(id, overrides = {}) {
  const profile = {
    id,
    name: overrides.name || 'Test Agent',
    handle: overrides.handle || `test-${id}`,
    bio: overrides.bio || 'A test agent for SATP registry tests',
    avatar: null,
    links: { twitter: 'https://x.com/test', github: 'https://github.com/test' },
    wallets: { solana: 'So1ana...' },
    skills: overrides.skills || [{ name: 'coding', verified: true }, { name: 'trading', verified: false }],
    portfolio: overrides.portfolio || [{ name: 'Project A', verified: true }],
    trackRecord: null,
    verification: {},
    verificationData: overrides.verificationData || {
      solana: { verified: true, wallet: 'So1ana...', verifiedAt: '2026-01-01T00:00:00Z' },
      github: { verified: true, username: 'testagent', verifiedAt: '2026-01-01T00:00:00Z' }
    },
    moltbookStats: null,
    endorsements: overrides.endorsements || [],
    endorsementsGiven: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z'
  };
  database.saveProfile(profile);
  return profile;
}

describe('SATP Registry', () => {
  const testId = 'satp_test_agent_' + Date.now();
  const testId2 = 'satp_test_agent2_' + Date.now();

  before(() => {
    createTestProfile(testId);
    createTestProfile(testId2, {
      handle: `test2-${testId2}`,
      name: 'Agent Two',
      verificationData: {
        twitter: { verified: true, handle: '@agent2', verifiedAt: '2026-01-15T00:00:00Z' }
      },
      endorsements: [{ from: testId, skill: 'trading', createdAt: '2026-01-10T00:00:00Z' }]
    });
  });

  after(() => {
    // Clean up test profiles
    try { database.deleteProfile(testId); } catch (e) { /* ok */ }
    try { database.deleteProfile(testId2); } catch (e) { /* ok */ }
    // Clean up SATP data
    database.db.prepare('DELETE FROM satp_attestations WHERE agent_id IN (?, ?)').run(testId, testId2);
    database.db.prepare('DELETE FROM satp_trust_scores WHERE agent_id IN (?, ?)').run(testId, testId2);
  });

  describe('computeTrustScore', () => {
    it('should return an object with overall_score, verification_score, activity_score, social_score', () => {
      const result = computeTrustScore(testId);
      assert.ok(typeof result.overall_score === 'number');
      assert.ok(typeof result.verification_score === 'number');
      assert.ok(typeof result.activity_score === 'number');
      assert.ok(typeof result.social_score === 'number');
      assert.ok(typeof result.last_computed === 'string');
    });

    it('should return scores in 0-100 range', () => {
      const result = computeTrustScore(testId);
      assert.ok(result.overall_score >= 0 && result.overall_score <= 100);
      assert.ok(result.verification_score >= 0 && result.verification_score <= 100);
      assert.ok(result.activity_score >= 0 && result.activity_score <= 100);
      assert.ok(result.social_score >= 0 && result.social_score <= 100);
    });

    it('should throw for non-existent profile', () => {
      assert.throws(() => computeTrustScore('nonexistent_id_xyz'), /Profile not found/);
    });

    it('should persist score to satp_trust_scores table', () => {
      computeTrustScore(testId);
      const stored = getTrustScore(testId);
      assert.ok(stored !== null);
      assert.ok(typeof stored.overall_score === 'number');
    });
  });

  describe('getAttestation', () => {
    it('should return null for non-existent attestation', () => {
      assert.strictEqual(getAttestation('nonexistent_att'), null);
    });

    it('should return attestation after computeTrustScore syncs them', () => {
      computeTrustScore(testId);
      const attId = `att_${testId}_verification_solana`;
      const att = getAttestation(attId);
      assert.ok(att !== null);
      assert.strictEqual(att.attestationType, 'verification');
      assert.strictEqual(att.issuer, 'solana');
      assert.ok(typeof att.evidence === 'object');
    });
  });

  describe('listAttestations', () => {
    it('should return an array of attestation objects for a given agent', () => {
      const atts = listAttestations(testId);
      assert.ok(Array.isArray(atts));
      assert.ok(atts.length > 0);
      // Each should have expected keys
      for (const att of atts) {
        assert.ok(att.id);
        assert.ok(att.agentId);
        assert.ok(att.attestationType);
        assert.ok(typeof att.score === 'number');
      }
    });

    it('should filter by type when opts.type is provided', () => {
      const atts = listAttestations(testId, { type: 'github' });
      assert.ok(Array.isArray(atts));
      for (const att of atts) {
        assert.strictEqual(att.attestationType, 'github');
      }
    });

    it('should return empty array for agent with no attestations', () => {
      const atts = listAttestations('nonexistent_agent_xyz');
      assert.ok(Array.isArray(atts));
      assert.strictEqual(atts.length, 0);
    });
  });

  describe('getTrustScore', () => {
    it('should return null for agent without computed score', () => {
      const result = getTrustScore('never_computed_xyz');
      assert.strictEqual(result, null);
    });

    it('should return stored trust score after compute', () => {
      computeTrustScore(testId);
      const result = getTrustScore(testId);
      assert.ok(result !== null);
      assert.strictEqual(result.agentId, testId);
      assert.ok(typeof result.overall_score === 'number');
      assert.ok(typeof result.verification_score === 'number');
      assert.ok(typeof result.activity_score === 'number');
      assert.ok(typeof result.social_score === 'number');
    });
  });

  describe('getRegistryStats', () => {
    it('should return an object with totalAgents, totalAttestations, avgScore, tierDistribution', () => {
      // Ensure at least one score exists
      computeTrustScore(testId);

      const stats = getRegistryStats();
      assert.ok(typeof stats.totalAgents === 'number');
      assert.ok(typeof stats.totalAttestations === 'number');
      assert.ok(typeof stats.avgScore === 'number');
      assert.ok(typeof stats.tierDistribution === 'object');
      assert.ok('elite' in stats.tierDistribution);
      assert.ok('newcomer' in stats.tierDistribution);
    });
  });

  describe('syncAllTrustScores', () => {
    it('should compute scores for all profiles and return results array', () => {
      const results = syncAllTrustScores();
      assert.ok(Array.isArray(results));
      // Should include our test agents
      const testResult = results.find(r => r.agentId === testId);
      assert.ok(testResult, 'Should include test agent in results');
      assert.ok(typeof testResult.overall_score === 'number');
    });
  });
});
