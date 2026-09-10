const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const REGISTRATION_ID = 'CV5Wd9YGFX5A4dvuaFuEDuKQWp14NfnLrSdxY7EHFyeB';
const V3_IDENTITY_ID = 'GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG';

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('AF14: every public program-ID surface consumes one displayed-ID registry', () => {
  const registry = read('frontend/src/lib/satp-mainnet-programs.ts');
  assert.match(registry, /SATP_DISPLAYED_MAINNET_PROGRAMS/);
  assert.match(registry, /name:\s*"Live Registration Identity"/);
  assert.match(registry, /name:\s*key === "IDENTITY" \? "V3 Identity Cluster" : key/);
  assert.match(registry, new RegExp(REGISTRATION_ID));
  assert.match(registry, new RegExp(V3_IDENTITY_ID));

  for (const surface of [
    'frontend/src/app/docs/page.tsx',
    'frontend/src/app/how-it-works/page.tsx',
    'frontend/src/app/satp/page.tsx',
    'frontend/src/app/stats/page.tsx',
  ]) {
    const source = read(surface);
    assert.match(source, /SATP_DISPLAYED_MAINNET_PROGRAMS/, `${surface} must consume the displayed-ID registry`);
    assert.doesNotMatch(source, new RegExp(REGISTRATION_ID), `${surface} must not hard-code the registration ID`);
    assert.doesNotMatch(source, new RegExp(V3_IDENTITY_ID), `${surface} must not hard-code the V3 identity ID`);
  }
});

test('AF14: the transaction builder and strict verifier share the registration registry ID', () => {
  const transactionBuilder = read('frontend/src/lib/identity-registry.ts');
  const verifier = read('scripts/verify-satp-mainnet-programs.mjs');

  assert.match(transactionBuilder, /new PublicKey\(\s*SATP_MAINNET_REGISTRATION_PROGRAM_ID\s*\)/);
  assert.match(verifier, /SATP_MAINNET_REGISTRATION_PROGRAM_ID export not found/);
  assert.match(verifier, /name:\s*'REGISTRATION_IDENTITY'/);
});

test('AF14: copy-truth gate fails when registration program evidence is absent', () => {
  const owner = 'BPFLoaderUpgradeab1e11111111111111111111111';
  const verified = { slot: 1, owner, exists: true, executable: true, status: 'verified' };
  const fixture = {
    IDENTITY: verified,
    REVIEWS: verified,
    REPUTATION: verified,
    ATTESTATIONS: verified,
    VALIDATION: verified,
    ESCROW: verified,
  };
  const fixturePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'af14-copy-truth-')), 'accounts.json');
  fs.writeFileSync(fixturePath, JSON.stringify(fixture));

  const result = spawnSync(process.execPath, ['scripts/verify-satp-mainnet-programs.mjs', '--allow-fixture'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      CI: '',
      AGENTFOLIO_SATP_PROGRAM_VERIFY_FIXTURE: fixturePath,
    },
    encoding: 'utf8',
  });
  const evidence = JSON.parse(result.stdout);
  const registration = evidence.programs.find((program) => program.name === 'REGISTRATION_IDENTITY');

  assert.equal(result.status, 1);
  assert.equal(evidence.status, 'blocked_onchain_program_mismatch');
  assert.equal(registration.id, REGISTRATION_ID);
  assert.equal(registration.exists, false);
  assert.equal(registration.executable, false);
});

test('AF14: pull-request CI requires the copy-truth regression', () => {
  const workflow = read('.github/workflows/ci-on-merge.yml');
  assert.match(workflow, /^\s{2}pull_request:$/m);
  assert.match(workflow, /tests\/deepaudit-af-surface-remediation\.test\.js/);
  assert.match(workflow, /tests\/escrow-v3-authority\.test\.js/);
  assert.match(workflow, /npm run verify:satp-mainnet-programs/);
});
