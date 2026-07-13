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
