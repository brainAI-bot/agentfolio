const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const {
  ENABLE_WRITES_ENV,
  ENABLE_LIVE_ESCROW_ENV,
  ESCROW_KILL_SWITCH_CODE,
  ESCROW_KILL_SWITCH_ENV,
  LIVE_ESCROW_READ_ONLY_CODE,
  READ_ONLY_CODE,
  WriteSurfaceReadOnlyError,
  envValueAllowsWrites,
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
  assert.equal(isLiveEscrowEnabled({ [ENABLE_LIVE_ESCROW_ENV]: '1' }), true);
  assert.equal(isEscrowKillSwitchActive({ [ESCROW_KILL_SWITCH_ENV]: 'on' }), true);
  assert.equal(isLiveEscrowEnabled({
    [ENABLE_LIVE_ESCROW_ENV]: '1',
    [ESCROW_KILL_SWITCH_ENV]: '1',
  }), false);

  assert.deepEqual(liveEscrowGateStatus({
    [ENABLE_LIVE_ESCROW_ENV]: '1',
    [ESCROW_KILL_SWITCH_ENV]: '1',
  }), {
    enabled: false,
    killSwitchActive: true,
    enableWith: ENABLE_LIVE_ESCROW_ENV,
    killSwitchEnv: ESCROW_KILL_SWITCH_ENV,
  });

  assert.equal(liveEscrowWriteGatePayload('escrow release').code, LIVE_ESCROW_READ_ONLY_CODE);
  const previousKill = process.env[ESCROW_KILL_SWITCH_ENV];
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
    ['src/lib/solana-escrow.js', 'assertSolanaIrysWriteEnabled'],
    ['src/lib/escrow-onchain.js', 'assertSolanaIrysWriteEnabled'],
    ['src/lib/satp-reviews.js', 'assertSolanaIrysWriteEnabled'],
    ['src/lib/satp-reviews-onchain.js', 'assertSolanaIrysWriteEnabled'],
    ['src/sync-v3.js', 'assertSolanaIrysWriteEnabled'],
    ['frontend/src/lib/write-surface-gate.ts', 'assertFrontendLiveEscrowEnabled'],
    ['frontend/src/lib/v3-escrow.ts', 'assertFrontendLiveEscrowEnabled'],
    ['frontend/src/lib/satp-identity-v2.ts', 'assertFrontendSolanaIrysWriteEnabled'],
    ['frontend/src/app/mint/page.tsx', 'assertFrontendSolanaIrysWriteEnabled'],
    ['frontend/src/app/register/page.tsx', 'assertFrontendSolanaIrysWriteEnabled'],
    ['frontend/src/app/verify/page.tsx', 'assertFrontendSolanaIrysWriteEnabled'],
    ['frontend/src/app/profile/[id]/WriteReviewForm.tsx', 'assertFrontendSolanaIrysWriteEnabled'],
    ['frontend/src/components/BurnToBecome.tsx', 'assertFrontendSolanaIrysWriteEnabled'],
    ['frontend/src/components/GenesisRecordCard.tsx', 'assertFrontendSolanaIrysWriteEnabled'],
    ['frontend/src/components/MarketplaceClient.tsx', 'assertFrontendSolanaIrysWriteEnabled'],
    ['frontend/public/mint/index.html', 'assertFrontendSolanaIrysWriteEnabled'],
  ]);

  for (const [relativeFile, marker] of expected) {
    const source = fs.readFileSync(path.join(ROOT, relativeFile), 'utf8');
    assert.ok(source.includes(marker), relativeFile + ' is missing ' + marker);
  }
});

test('executable Solana/Irys write surfaces are covered by the read-only gate', () => {
  const roots = ['src', 'frontend', 'scripts', 'boa-pipeline', 'core-cm', 'core-cm-v2'];
  const writePattern = /send(Transaction|RawTransaction)|sendAndConfirm|create(Burn|MintTo|Transfer)Instruction|uploadFolder|uploadJson|\.upload\(|\.fund\(|mintV1|createNft|irysUploader|Irys\(/;
  const gatePattern = /write-surface-gate|assertSolanaIrysWriteEnabled|sendSolanaIrysWriteGateResponse|sendBoaWriteGateResponse|assertFrontendSolanaIrysWriteEnabled|AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES/;
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
      if (writePattern.test(source) && !gatePattern.test(source)) {
        missing.push(path.relative(ROOT, fullPath));
      }
    }
  }

  for (const root of roots) walk(path.join(ROOT, root));
  assert.deepEqual(missing.sort(), []);
});
