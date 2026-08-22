const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CANONICAL_TRUST_PROVIDERS,
  filterCanonicalTrustData,
  filterCanonicalTrustVerifications,
  hasVerifiedCanonicalTrustData,
  isPublicVerificationHostname,
  isPublicVerificationUrl,
  isPublicDisplayVerificationDataEntry,
  isCanonicalTrustProvider,
  retiredProviderResponse,
  sanitizeLegacyVerificationSummary,
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

test('loopback and private website proofs are never canonical trust data', () => {
  for (const value of [
    'http://127.0.0.1:8787',
    'http://127.1:8787',
    'http://localhost:8787',
    'http://10.0.0.1',
    'http://169.254.169.254/latest/meta-data',
    'http://192.168.1.10',
    'http://[::1]:8787',
    'http://[::ffff:127.0.0.1]:8787',
    'http://[::127.0.0.1]',
    'http://[::ffff:169.254.169.254]',
    'http://[::ffff:7f00:1]',
    'http://[::ffff:a9fe:a9fe]',
    'https://brainai.bot:22',
    'http://brainai.bot:8080',
  ]) {
    assert.equal(isPublicVerificationUrl(value), false, value);
  }
  assert.equal(isPublicVerificationHostname('brainai.bot'), true);
  assert.equal(isPublicVerificationUrl('https://brainai.bot'), true);
  assert.equal(isPublicVerificationUrl('https://brainai.bot:443'), true);
  assert.equal(isPublicVerificationUrl('http://brainai.bot:80'), true);
  assert.deepEqual(filterCanonicalTrustData({
    website: { verified: true, url: 'http://127.0.0.1:8787' },
    domain: { verified: true, address: 'brainai.bot' },
  }), {
    domain: { verified: true, address: 'brainai.bot' },
  });
});

test('legacy verification summaries expose only currently valid canonical proofs', () => {
  assert.deepEqual(sanitizeLegacyVerificationSummary({
    score: 200,
    tier: 'verified',
    verifiedPlatforms: ['satp_v3', 'website', 'agentmail', 'domain'],
  }, {
    website: { verified: true, url: 'http://127.0.0.1:8787' },
    domain: { verified: true, address: 'brainai.bot' },
  }), {
    verifiedPlatforms: ['domain'],
  });

  assert.deepEqual(sanitizeLegacyVerificationSummary({
    score: 200,
    tier: 'verified',
    verifiedPlatforms: ['website', 'agentmail'],
  }, {
    website: { verified: true, url: 'http://127.0.0.1:8787' },
    agentmail: { verified: true },
  }), {
    verifiedPlatforms: [],
  });
});

test('display-only providers survive canonical trust filtering', () => {
  assert.equal(isPublicDisplayVerificationDataEntry('mcp', {}), true);
  assert.equal(isPublicDisplayVerificationDataEntry('a2a', {}), true);
  assert.equal(isPublicDisplayVerificationDataEntry('discord', { identifier: 'agent' }), true);
  assert.equal(isPublicDisplayVerificationDataEntry('ethereum', { address: '0xabc' }), true);
  assert.equal(isPublicDisplayVerificationDataEntry('website', { identifier: 'http://127.0.0.1' }), false);
  assert.equal(isPublicDisplayVerificationDataEntry('agentmail', { identifier: 'agent@example.com' }), false);
});

test('website verification initiation rejects loopback targets', async () => {
  const hardened = require('../src/lib/website-verify-hardened');
  const legacy = require('../src/website-verify');

  assert.throws(
    () => hardened.initiateWebsiteVerification('agent-test', 'http://127.0.0.1:8787'),
    /public hostname/
  );
  await assert.rejects(
    legacy.initiateWebsiteVerification('agent-test', 'http://localhost:8787'),
    /public hostname/
  );
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
