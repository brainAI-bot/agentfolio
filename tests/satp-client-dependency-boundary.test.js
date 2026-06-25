const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { client } = require('../src/adapters/satp');

test('SATP adapter resolves extracted @brainai/satp-client dependency without embedded fallback', () => {
  const resolved = require.resolve('@brainai/satp-client');
  assert.match(resolved, /node_modules[\/]@brainai[\/]satp-client/);

  const satpClient = client.loadSatpClient();
  assert.equal(client.assertRequiredSatpClientExports(satpClient), true);
  assert.equal(typeof satpClient.SATPSDK, 'function');
  assert.equal(typeof satpClient.SATPV3SDK, 'function');
  assert.equal(typeof satpClient.createSATPClient, 'function');
  assert.equal(typeof satpClient.getV3ProgramIds, 'function');
  assert.equal(typeof satpClient.hashAgentId, 'function');
  assert.equal(typeof satpClient.getGenesisPDA, 'function');
  assert.equal(typeof satpClient.prepareIdentityAttestationRequest, 'function');
});

test('SATP client exposes D1 V3 mainnet program IDs for escrow runtime', () => {
  const satpClient = client.loadSatpClient();
  const mainnetIds = satpClient.getV3ProgramIds('mainnet');
  const expected = {
    IDENTITY: 'GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG',
    REVIEWS: 'r9XX4frcqxxAZ6Au9V5PA3EAxs1zoNckqLLmoSRcNr4',
    REPUTATION: '2Lz7KzMvKdrGeAuS8WPHu7jK2yScrnKVgacpYVEuDjkJ',
    ATTESTATIONS: '6Xd1dAQJPvQRJ4Ntr6LtPTjDjPUZ8nfnmYLZaZ2DtrdD',
    VALIDATION: '6rYRiCYidJYV7QvKrzKGgNu4oMh6BAvynked69R7xMbV',
    ESCROW: 'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C',
  };

  for (const [name, address] of Object.entries(expected)) {
    assert.equal(mainnetIds[name].toBase58(), address);
  }
});

test('SATP candidate review subpaths resolve from the extracted package', () => {
  const walletControlPath = require.resolve('@brainai/satp-client/wallet-control-challenge');
  const x402DiscoveryPath = require.resolve('@brainai/satp-client/x402-discovery');

  assert.match(walletControlPath, /node_modules[\/]@brainai[\/]satp-client/);
  assert.match(x402DiscoveryPath, /node_modules[\/]@brainai[\/]satp-client/);

  const walletControl = require('@brainai/satp-client/wallet-control-challenge');
  const x402Discovery = require('@brainai/satp-client/x402-discovery');

  assert.equal(typeof walletControl.buildWalletControlChallenge, 'function');
  assert.equal(typeof walletControl.verifyWalletControlChallengeSignature, 'function');
  assert.equal(typeof x402Discovery.parseX402DiscoveryMetadata, 'function');
  assert.equal(typeof x402Discovery.buildX402EvidenceLookup, 'function');
});

test('legacy SATP deep-require shims resolve against extracted package source paths', () => {
  const shimCases = [
    ['../src/satp-client/src/constants', 'getProgramIds'],
    ['../src/satp-client/src/pda', 'getIdentityPDA'],
    ['../src/satp-client/src/schema', 'IdentityAccount'],
    ['../src/satp-client/src/v3-sdk', 'SATPV3SDK'],
    ['../src/satp-client/src/v3-pda', 'getV3ReviewPDA'],
    ['../src/satp-client/src/borsh-reader', 'BorshReader'],
  ];

  for (const [shimPath, expectedExport] of shimCases) {
    const resolved = require.resolve(shimPath);
    assert.match(resolved, /src[\\/]satp-client[\\/]src[\\/]/);
    const shim = require(shimPath);
    assert.equal(typeof shim[expectedExport], 'function');
  }
});

test('embedded SATP source-of-truth directories are not present in AgentFolio', () => {
  const repoRoot = path.resolve(__dirname, '..');
  for (const embeddedDir of ['satp-client', 'satp-idls']) {
    assert.equal(fs.existsSync(path.join(repoRoot, embeddedDir)), false, `${embeddedDir} should be supplied by @brainai/satp-client`);
  }

  const allowedLegacyShimFiles = [
    'index.js',
    'src/borsh-reader.js',
    'src/constants.js',
    'src/index.js',
    'src/pda.js',
    'src/schema.js',
    'src/v3-pda.js',
    'src/v3-sdk.js',
  ].sort();

  const legacyShimRoot = path.join(repoRoot, 'src/satp-client');
  const actualLegacyFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      if (entry.isFile()) actualLegacyFiles.push(path.relative(legacyShimRoot, full));
    }
  };

  walk(legacyShimRoot);
  assert.deepEqual(actualLegacyFiles.sort(), allowedLegacyShimFiles);
});

test('V3 route modules use the AgentFolio SATP adapter package boundary', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const routeFiles = [
    'src/routes/reputation-v3-routes.js',
    'src/routes/reviews-v3-routes.js',
    'src/routes/satp-api.js',
    'src/routes/satp-auto-identity.js',
    'src/routes/satp-auto-identity-v3.js',
  ];

  for (const routeFile of routeFiles) {
    const source = fs.readFileSync(path.join(repoRoot, routeFile), 'utf8');
    assert.match(source, /adapters\/satp/, `${routeFile} should use the SATP adapter boundary`);
    assert.doesNotMatch(source, /require\(['"]\.\.\/\.\.\/satp-client/, `${routeFile} should not deep-require the removed embedded SATP client`);
    assert.doesNotMatch(source, /require\(['"]satp-client['"]\)/, `${routeFile} should not require the retired satp-client package name`);
  }
});

test('escrow and profile genesis paths use extracted SATP package name', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const sourceFiles = [
    'src/routes/escrow-v3-routes.js',
    'src/routes/escrow-routes.js',
    'src/profile-store.js',
    'src/routes/restored-verify-routes.js',
    'src/routes/burn-to-become-public.js',
    'src/lib/wallet.js',
    'src/routes/prepare-birth-endpoint.js',
    'src/satp-write-client.js',
    'src/routes/safe-burn-to-become.js',
    'scripts/sync-scores-onchain.js',
    'scripts/push-onchain-levels.js',
    'scripts/push-v2-scores.js',
    'scripts/backfill-satp-scores.js',
  ];

  for (const sourceFile of sourceFiles) {
    const source = fs.readFileSync(path.join(repoRoot, sourceFile), 'utf8');
    assert.match(source, /require\(['"]@brainai\/satp-client['"]\)/, `${sourceFile} should use @brainai/satp-client`);
    assert.doesNotMatch(source, /require\(['"]satp-client['"]\)/, `${sourceFile} should not require the retired satp-client package name`);
    assert.doesNotMatch(source, /require\(['"](?:\.\.\/)+satp-client\/src/, `${sourceFile} should not deep-require AgentFolio SATP shims`);
    assert.doesNotMatch(source, /require\(['"]\.\/satp-client\/src/, `${sourceFile} should not deep-require AgentFolio SATP shims`);
  }
});
