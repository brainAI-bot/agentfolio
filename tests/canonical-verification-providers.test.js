const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CANONICAL_TRUST_PROVIDERS,
  filterCanonicalTrustData,
  filterCanonicalTrustVerifications,
  hasVerifiedCanonicalTrustData,
  isCanonicalTrustProvider,
  retiredProviderResponse,
} = require('../src/lib/canonical-verification-providers');
const { calculateVerificationLevel, calculateReputationScore } = require('../src/lib/scoring-engine-v2');
const { calculateVerificationScore } = require('../src/lib/verification-score');
const { normalizeVerifications } = require('../src/lib/verification-categories');

test('canonical trust set is exactly solana, github, domain, and website', () => {
  assert.deepEqual(CANONICAL_TRUST_PROVIDERS, ['solana', 'github', 'domain', 'website']);
  assert.equal(isCanonicalTrustProvider('solana_wallet'), true);
  assert.equal(isCanonicalTrustProvider('telegram'), false);
  assert.equal(isCanonicalTrustProvider('agentmail'), false);
  assert.equal(isCanonicalTrustProvider('ens'), false);
  assert.equal(isCanonicalTrustProvider('farcaster'), false);
});

test('retired providers are filtered from profile verification data and rows', () => {
  assert.deepEqual(
    filterCanonicalTrustData({
      solana_wallet: { verified: true },
      github: { verified: true },
      telegram: { verified: true },
      agentmail: { verified: true },
      ens: { verified: true },
      farcaster: { verified: true },
    }),
    {
      solana: { verified: true },
      github: { verified: true },
    }
  );

  assert.deepEqual(
    filterCanonicalTrustVerifications([
      { platform: 'github' },
      { platform: 'telegram' },
      { platform: 'agentmail' },
      { platform: 'ens' },
      { platform: 'farcaster' },
      { platform: 'website' },
    ]),
    [{ platform: 'github' }, { platform: 'website' }]
  );
});

test('retired-only verification_data is not exposed or counted as claimed/verified', () => {
  const retiredOnlyVerificationData = {
    telegram: { verified: true, linked: true, handle: 'agent' },
    agentmail: { verified: true, linked: true, address: 'agent@example.test' },
    ens: { verified: true, success: true, name: 'agent.eth' },
    farcaster: { verified: true, fid: 123 },
  };

  assert.deepEqual(filterCanonicalTrustData(retiredOnlyVerificationData), {});
  assert.equal(hasVerifiedCanonicalTrustData(retiredOnlyVerificationData), false);
});

test('canonical verification_data survives exposure filtering and counts as claimed', () => {
  const mixedVerificationData = {
    telegram: { verified: true, linked: true },
    solana_wallet: { verified: true, address: 'So11111111111111111111111111111111111111112' },
    github: { verified: true, username: 'agentfolio' },
  };

  assert.deepEqual(filterCanonicalTrustData(mixedVerificationData), {
    solana: { verified: true, address: 'So11111111111111111111111111111111111111112' },
    github: { verified: true, username: 'agentfolio' },
  });
  assert.equal(hasVerifiedCanonicalTrustData(mixedVerificationData), true);
});

test('scoring ignores retired auto-pass providers', () => {
  const profile = {
    bio: 'This profile has enough biography text to count as complete for scoring.',
    avatar: '/avatar.png',
    skills: ['one', 'two', 'three'],
    burnedAvatar: false,
    verificationData: {
      telegram: { verified: true },
      agentmail: { verified: true },
      ens: { verified: true },
      farcaster: { verified: true },
      satp: { verified: true },
    },
  };

  assert.equal(calculateVerificationLevel(profile), 0);
  assert.equal(calculateReputationScore(profile), 0);

  const verificationScore = calculateVerificationScore(profile);
  assert.equal(verificationScore.breakdown.some((entry) => entry.key === 'telegram'), false);
  assert.equal(verificationScore.breakdown.some((entry) => entry.key === 'agentmail'), false);
});

test('verification normalization and retired responses make noncanonical providers non-verifying', () => {
  assert.deepEqual(
    normalizeVerifications([
      { platform: 'github', txSignature: 'sig1' },
      { platform: 'telegram', txSignature: 'sig2' },
      { platform: 'ens', txSignature: 'sig3' },
      { platform: 'website', txSignature: 'sig4' },
    ]),
    [
      { platform: 'github', txSignature: 'sig1', identifier: null, category: 'platform' },
      { platform: 'website', txSignature: 'sig4', identifier: null, category: 'infra' },
    ]
  );

  assert.deepEqual(retiredProviderResponse('telegram'), {
    verified: false,
    platform: 'telegram',
    retired: true,
    reason: 'telegram is a non-verifying profile link and no longer grants AgentFolio trust credit',
    canonicalTrustProviders: ['solana', 'github', 'domain', 'website'],
  });
});
