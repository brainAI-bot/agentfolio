const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { writeJsonAtomicSync } = require('../src/lib/atomic-file');

const repoRoot = path.resolve(__dirname, '..');

test('AF2: how-it-works exposes non-empty SATP mainnet program ids', () => {
  const programsSource = fs.readFileSync(
    path.join(repoRoot, 'frontend/src/lib/satp-mainnet-programs.ts'),
    'utf8'
  );
  const pageSource = fs.readFileSync(
    path.join(repoRoot, 'frontend/src/app/how-it-works/page.tsx'),
    'utf8'
  );

  const addresses = [...programsSource.matchAll(/: "([^"]+)"/g)].map((match) => match[1]);
  assert.equal(addresses.length, 6);
  for (const address of addresses) {
    assert.match(address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  }
  assert.match(pageSource, /SATP_MAINNET_PROGRAMS/);
  assert.match(pageSource, /explorer\.solana\.com\/address/);
});

test('AF8: JSON state writes use atomic temp-write and rename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-atomic-write-'));
  const target = path.join(dir, 'state.json');
  writeJsonAtomicSync(target, { ok: true, nested: { count: 1 } }, { baseDir: dir });

  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), {
    ok: true,
    nested: { count: 1 },
  });
  assert.deepEqual(fs.readdirSync(dir), ['state.json']);
  assert.throws(
    () => writeJsonAtomicSync(path.join(dir, '..', 'escape.json'), { ok: false }, { baseDir: dir }),
    /escapes baseDir/
  );
});

test('AF8: server registers process crash and shutdown handlers', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'src/server.js'), 'utf8');
  assert.match(source, /process\.on\('SIGTERM'/);
  assert.match(source, /process\.on\('uncaughtException'/);
  assert.match(source, /process\.on\('unhandledRejection'/);
  assert.match(source, /server\.close/);
  assert.match(source, /profileStore\.closeDb/);
});

test('AF9 and AF13: tracked backup artifacts are absent from repo surface', () => {
  const tracked = execFileSync('git', ['ls-files'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim().split('\n').filter(Boolean);

  const backupArtifacts = tracked.filter((file) => {
    if (file === 'scripts/admin/daily-db-backup.sh') return false;
    return /(^|\/)archive\/.*\.bak\d*$/.test(file)
      || /\.bak\d*$/.test(file)
      || /\.backup($|-)/.test(file)
      || /backup-before/.test(file)
      || /candy-machine-state-backup-/.test(file);
  });

  assert.deepEqual(backupArtifacts, []);
});

test('AF6 and AF10: CI-on-merge workflow runs explicit PR and main-branch merge gates', () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/ci-on-merge.yml'),
    'utf8'
  );

  assert.match(workflow, /^name: AgentFolio CI On Merge$/m);
  assert.match(workflow, /^\s{2}pull_request:$/m);
  assert.match(workflow, /^\s{2}push:\n\s{4}branches:\n\s{6}- main\n\s{6}- master$/m);
  assert.match(workflow, /^\s{2}workflow_dispatch:$/m);
  assert.match(workflow, /name: AF6 AF10 merge gate/);
  assert.match(workflow, /npm run lint:roadmap/);
  assert.match(workflow, /node --test tests\/deepaudit-af-surface-remediation\.test\.js/);
  assert.match(workflow, /git diff --check/);
});
