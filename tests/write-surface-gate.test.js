const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const {
  ENABLE_WRITES_ENV,
  ENABLE_LIVE_ESCROW_ENV,
  LIVE_ESCROW_OWNER_AUTHORIZATION_ENV,
  LIVE_ESCROW_OWNER_AUTHORIZATION_VALUE,
  ESCROW_KILL_SWITCH_CODE,
  ESCROW_KILL_SWITCH_ENV,
  LIVE_ESCROW_READ_ONLY_CODE,
  LiveEscrowReadOnlyError,
  READ_ONLY_CODE,
  WriteSurfaceReadOnlyError,
  assertLiveEscrowWriteEnabled,
  envValueAllowsWrites,
  hasLiveEscrowOwnerAuthorization,
  isEscrowKillSwitchActive,
  isLiveEscrowEnabled,
  isSolanaIrysWriteEnabled,
  assertSolanaIrysWriteEnabled,
  liveEscrowGateStatus,
  liveEscrowWriteGatePayload,
  solanaIrysWriteGatePayload,
} = require('../src/lib/write-surface-gate');

const ROOT = path.join(__dirname, '..');

test('Solana/Irys write gate defaults to read-only', () => {
  assert.equal(isSolanaIrysWriteEnabled({}), false);
  assert.equal(isSolanaIrysWriteEnabled({ [ENABLE_WRITES_ENV]: 'false' }), false);
  assert.equal(envValueAllowsWrites('yes'), true);
  assert.equal(envValueAllowsWrites('ON'), true);

  assert.throws(
    () => assertSolanaIrysWriteEnabled('test write'),
    (err) => err instanceof WriteSurfaceReadOnlyError && err.code === READ_ONLY_CODE && err.statusCode === 423,
  );

  assert.deepEqual(solanaIrysWriteGatePayload('test write'), {
    ok: false,
    code: READ_ONLY_CODE,
    error: 'Solana/Irys writes are disabled in this environment.',
    operation: 'test write',
    enableWith: ENABLE_WRITES_ENV,
  });
});

test('Solana/Irys write gate allows explicit opt-in env values', () => {
  assert.equal(isSolanaIrysWriteEnabled({ [ENABLE_WRITES_ENV]: '1' }), true);
  assert.equal(isSolanaIrysWriteEnabled({ [ENABLE_WRITES_ENV]: 'true' }), true);
});

test('live escrow write gate requires explicit opt-in and honors kill switch', () => {
  assert.equal(isLiveEscrowEnabled({}), false);
  assert.equal(isLiveEscrowEnabled({ [ENABLE_LIVE_ESCROW_ENV]: '1' }), false);
  assert.equal(hasLiveEscrowOwnerAuthorization({
    [LIVE_ESCROW_OWNER_AUTHORIZATION_ENV]: LIVE_ESCROW_OWNER_AUTHORIZATION_VALUE,
  }), true);
  assert.equal(isLiveEscrowEnabled({
    [ENABLE_LIVE_ESCROW_ENV]: '1',
    [LIVE_ESCROW_OWNER_AUTHORIZATION_ENV]: LIVE_ESCROW_OWNER_AUTHORIZATION_VALUE,
  }), true);
  assert.equal(liveEscrowGateStatus({
    [ENABLE_LIVE_ESCROW_ENV]: '1',
  }).status, 'live_funds_gated_pending_owner_authorization');
  assert.equal(isEscrowKillSwitchActive({ [ESCROW_KILL_SWITCH_ENV]: 'on' }), true);
  assert.equal(isLiveEscrowEnabled({
    [ENABLE_LIVE_ESCROW_ENV]: '1',
    [LIVE_ESCROW_OWNER_AUTHORIZATION_ENV]: LIVE_ESCROW_OWNER_AUTHORIZATION_VALUE,
    [ESCROW_KILL_SWITCH_ENV]: '1',
  }), false);

  assert.deepEqual(liveEscrowGateStatus({
    [ENABLE_LIVE_ESCROW_ENV]: '1',
    [ESCROW_KILL_SWITCH_ENV]: '1',
  }), {
    enabled: false,
    requested: true,
    ownerAuthorized: false,
    killSwitchActive: true,
    status: 'live_funds_blocked_by_kill_switch',
    liveFundsCleared: false,
    ownerAuthorization: {
      required: true,
      env: LIVE_ESCROW_OWNER_AUTHORIZATION_ENV,
      expectedValue: LIVE_ESCROW_OWNER_AUTHORIZATION_VALUE,
      status: 'missing_owner_authorization',
    },
    verifiedRuntime: {
      network: 'devnet',
      programId: 'B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg',
      pdaDerive: 'verified',
    },
    runtimeNetwork: 'devnet',
    leftoverRuntimeNetwork: 'devnet',
    leftoverRuntimeProgramId: 'B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg',
    advertisedNetwork: 'mainnet-beta',
    advertisedEscrowProgramId: 'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C',
    hostEnvSplit: 'HXCU-vs-B1Se is a host env split (advertised SATP /api/satp/programs mainnet-beta HXCU vs leftover host runtime devnet B1Se), not a missing IDL',
    mainnetLiveFundsCleared: false,
    readOnlyPosture: 'GET health and PDA derivation routes remain read-only HTTP 200 when program IDs resolve; live-funds POST routes fail closed.',
    publicCopy: 'Live escrow writes are disabled by the escrow kill switch.',
    enableWith: ENABLE_LIVE_ESCROW_ENV,
    killSwitchEnv: ESCROW_KILL_SWITCH_ENV,
  });

  const previousEnable = process.env[ENABLE_LIVE_ESCROW_ENV];
  const previousKill = process.env[ESCROW_KILL_SWITCH_ENV];
  delete process.env[ENABLE_LIVE_ESCROW_ENV];
  delete process.env[ESCROW_KILL_SWITCH_ENV];
  try {
    const gatedPayload = liveEscrowWriteGatePayload('escrow release');
    assert.equal(gatedPayload.code, LIVE_ESCROW_READ_ONLY_CODE);
    assert.equal(gatedPayload.liveEscrow.runtimeNetwork, 'devnet');
    assert.equal(gatedPayload.liveEscrow.leftoverRuntimeProgramId, 'B1Se8SPx7GLUisa4LYeXY1tDZy5TviJrsV2yMLgqUXmg');
    assert.equal(gatedPayload.liveEscrow.advertisedNetwork, 'mainnet-beta');
    assert.equal(gatedPayload.liveEscrow.advertisedEscrowProgramId, 'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C');
    assert.match(gatedPayload.liveEscrow.hostEnvSplit, /host env split/);
    assert.match(gatedPayload.liveEscrow.hostEnvSplit, /not a missing IDL/);
    assert.equal(gatedPayload.liveEscrow.mainnetLiveFundsCleared, false);
    assert.throws(
      () => assertLiveEscrowWriteEnabled('escrow release'),
      (err) => err instanceof LiveEscrowReadOnlyError && err.code === LIVE_ESCROW_READ_ONLY_CODE && err.statusCode === 423,
    );
  } finally {
    if (previousEnable === undefined) delete process.env[ENABLE_LIVE_ESCROW_ENV];
    else process.env[ENABLE_LIVE_ESCROW_ENV] = previousEnable;
    if (previousKill === undefined) delete process.env[ESCROW_KILL_SWITCH_ENV];
    else process.env[ESCROW_KILL_SWITCH_ENV] = previousKill;
  }

  process.env[ESCROW_KILL_SWITCH_ENV] = '1';
  try {
    assert.equal(liveEscrowWriteGatePayload('escrow release').code, ESCROW_KILL_SWITCH_CODE);
  } finally {
    if (previousKill === undefined) delete process.env[ESCROW_KILL_SWITCH_ENV];
    else process.env[ESCROW_KILL_SWITCH_ENV] = previousKill;
  }
});

test('runtime Solana/Irys write entry points are wired through the gate', () => {
  const expected = new Map([
    ['src/server.js', 'sendBoaWriteGateResponse'],
    ['tools/fix-aremes-authority.js', 'assertSolanaIrysWriteEnabled'],
    ['tools/score-sync.js', 'assertSolanaIrysWriteEnabled'],
    ['tools/self-attest.js', 'assertSolanaIrysWriteEnabled'],
    ['src/scripts/batch-genesis.js', 'assertSolanaIrysWriteEnabled'],
    ['src/routes/satp-write-api.js', 'sendSolanaIrysWriteGateResponse'],
    ['src/routes/escrow-v3-routes.js', 'sendLiveEscrowGateResponse'],
    ['src/satp-write-client.js', 'assertSolanaIrysWriteEnabled'],
    ['src/routes/burn-to-become-public.js', 'sendBoaWriteGateResponse'],
    ['src/routes/burn-to-become-public-birth.js', 'sendSolanaIrysWriteGateResponse'],
    ['src/routes/prepare-birth-endpoint.js', 'assertSolanaIrysWriteEnabled'],
    ['src/routes/satp-boa-linker-v3.js', 'assertSolanaIrysWriteEnabled'],
    ['src/routes/safe-burn-to-become.js', 'assertSolanaIrysWriteEnabled'],
    ['src/routes/reputation-v3-routes.js', 'sendSolanaIrysWriteGateResponse'],
    ['src/profile-store.js', 'write-surface-gate'],
    ['src/api/boa-mint.js', 'sendBoaWriteGateResponse'],
    ['src/api/boa-mint-v2.js', 'sendBoaWriteGateResponse'],
    ['src/api/boa-mint-finalize.js', 'sendBoaWriteGateResponse'],
    ['src/api/boa-nft-minter.mjs', 'assertSolanaIrysWriteEnabled'],
    ['src/lib/satp-boa-linker.js', 'assertSolanaIrysWriteEnabled'],
    ['src/lib/satp-face-registry.js', 'assertSolanaIrysWriteEnabled'],
    ['src/lib/satp-verification-bridge.js', 'assertSolanaIrysWriteEnabled'],
    ['src/lib/memo-attestation.js', 'assertSolanaIrysWriteEnabled'],
    ['src/lib/memo-trust-score.js', 'assertSolanaIrysWriteEnabled'],
    ['src/lib/verification-onchain.js', 'assertSolanaIrysWriteEnabled'],
    ['src/lib/solana-escrow.js', 'assertLiveEscrowWriteEnabled'],
    ['src/lib/escrow-onchain.js', 'assertSolanaIrysWriteEnabled'],
    ['src/lib/satp-reviews.js', 'assertSolanaIrysWriteEnabled'],
    ['src/lib/satp-reviews-onchain.js', 'assertSolanaIrysWriteEnabled'],
    ['src/sync-v3.js', 'assertSolanaIrysWriteEnabled'],
    ['frontend/src/lib/write-surface-gate.ts', 'assertFrontendLiveEscrowEnabled'],
    ['frontend/src/lib/v3-escrow.ts', 'assertFrontendLiveEscrowEnabled'],
    ['frontend/src/lib/satp-identity-v2.ts', 'assertFrontendSolanaIrysWriteEnabled'],
    ['frontend/src/app/mint/page.tsx', 'assertFrontendSolanaIrysWriteEnabled'],
    ['frontend/src/app/verify/page.tsx', 'assertFrontendSolanaIrysWriteEnabled'],
    ['frontend/src/app/profile/[id]/WriteReviewForm.tsx', 'assertFrontendSolanaIrysWriteEnabled'],
    ['frontend/src/components/GenesisRecordCard.tsx', 'assertFrontendSolanaIrysWriteEnabled'],
    ['frontend/src/components/MarketplaceClient.tsx', 'assertFrontendSolanaIrysWriteEnabled'],
    ['frontend/public/mint/index.html', 'assertFrontendSolanaIrysWriteEnabled'],
  ]);

  for (const [relativeFile, marker] of expected) {
    const source = fs.readFileSync(path.join(ROOT, relativeFile), 'utf8');
    assert.ok(source.includes(marker), relativeFile + ' is missing ' + marker);
  }
});

test('Burn-to-Become collection creation fails closed before reading or writing data', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');
  const routeStart = source.indexOf("app.post('/api/burn-to-become/collections'");
  const routeEnd = source.indexOf("// Burn-to-Become full flow routes", routeStart);
  const route = source.slice(routeStart, routeEnd);
  const gateIndex = route.indexOf('sendBoaWriteGateResponse');
  const bodyIndex = route.indexOf('req.body');
  const writeIndex = route.indexOf('writeJsonAtomicSync');

  assert.notEqual(routeStart, -1, 'expected collection creation route');
  assert.ok(gateIndex >= 0, 'collection creation route must invoke the BOA write gate');
  assert.ok(gateIndex < bodyIndex, 'write gate must run before request body data is read');
  assert.ok(gateIndex < writeIndex, 'write gate must run before collections data is written');
});

test('executable Solana/Irys write surfaces are covered by the read-only gate', () => {
  const roots = ['src', 'frontend', 'scripts', 'boa-pipeline', 'core-cm', 'core-cm-v2'];
  const writePattern = /send(Transaction|RawTransaction)|sendAndConfirm|create(Burn|MintTo|Transfer)Instruction|uploadFolder|uploadJson|\.upload\(|\.fund\(|mintV1|createNft|irysUploader|Irys\(/;
  const gatePattern = /write-surface-gate|assertSolanaIrysWriteEnabled|assertLiveEscrowWriteEnabled|sendSolanaIrysWriteGateResponse|sendBoaWriteGateResponse|assertFrontendSolanaIrysWriteEnabled|AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES/;
  const missing = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build' || entry.name === '.next' || entry.name === 'coverage') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!/\.(mjs|js|ts|tsx|html)$/.test(entry.name) || /\.backup/.test(entry.name)) continue;
      const source = fs.readFileSync(fullPath, 'utf8');
      const relative = path.relative(ROOT, fullPath);
      // Client-signed SATP V3 identity/genesis is allowed without the Irys/escrow gate.
      if (relative === 'frontend/src/lib/satp-identity-v3.ts') continue;
      if (relative === 'frontend/src/app/register/page.tsx') continue;
      if (writePattern.test(source) && !gatePattern.test(source)) {
        missing.push(relative);
      }
    }
  }

  for (const root of roots) walk(path.join(ROOT, root));
  assert.deepEqual(missing.sort(), []);
});
