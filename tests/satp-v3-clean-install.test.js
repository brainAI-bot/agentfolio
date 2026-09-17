'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..');
const SATP_V3_VERSION = '3.5.1';

function copy(relativePath, installRoot) {
  const source = path.join(REPO_ROOT, relativePath);
  const destination = path.join(installRoot, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

test('clean production install loads SATP V3 chain cache and escrow authority readback', { timeout: 120_000 }, () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'));

  assert.equal(packageJson.dependencies['@brainai/satp-v3'], SATP_V3_VERSION);
  assert.equal(packageLock.packages[''].dependencies['@brainai/satp-v3'], SATP_V3_VERSION);
  assert.equal(packageLock.packages['node_modules/@brainai/satp-v3'].version, SATP_V3_VERSION);

  const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-satp-v3-clean-install-'));
  try {
    for (const relativePath of [
      'package.json',
      'package-lock.json',
      'src/lib/chain-cache.js',
      'src/lib/escrow-v3-authority.js',
      'src/lib/write-surface-gate.js',
    ]) {
      copy(relativePath, installRoot);
    }

    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
      'ci',
      '--ignore-scripts',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
    ], {
      cwd: installRoot,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 90_000,
    });

    const probe = [
      "const assert = require('node:assert/strict');",
      "const chainCache = require('./src/lib/chain-cache');",
      "const satpClient = require('@brainai/satp-client');",
      "const { getEscrowV3AuthorityReadback } = require('./src/lib/escrow-v3-authority');",
      "assert.equal(typeof chainCache.getScore, 'function');",
      "assert.equal(typeof chainCache.fetchV3GenesisRecords, 'function');",
      "const readback = getEscrowV3AuthorityReadback({ satpClient, env: {} });",
      "assert.equal(readback.status, 'verified');",
      "assert.equal(readback.releaseGate.liveEscrowWritesAllowed, false);",
      "assert.equal(readback.releaseGate.ownerAuthorizationRequired, true);",
      "assert.equal(readback.releaseGate.ownerAuthorizationStatus, 'missing_owner_authorization');",
    ].join('\n');

    execFileSync(process.execPath, ['-e', probe], {
      cwd: installRoot,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30_000,
    });

    fs.renameSync(
      path.join(installRoot, 'node_modules', '@brainai', 'satp-v3'),
      path.join(installRoot, 'node_modules', '@brainai', 'satp-v3.missing'),
    );
    const missingDependencyProbe = spawnSync(process.execPath, [
      '-e',
      "require('./src/lib/chain-cache')",
    ], {
      cwd: installRoot,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.notEqual(missingDependencyProbe.status, 0);
    assert.match(missingDependencyProbe.stderr, /Cannot find module '@brainai\/satp-v3'/);
  } finally {
    fs.rmSync(installRoot, { recursive: true, force: true });
  }
});
