const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

const retiredStakingFiles = [
  'frontend/src/app/staking/page.tsx',
  'frontend/src/components/FolioProfileSection.tsx',
  'src/api/staking.js',
  'src/lib/folio-staking.js',
  'src/lib/staking.js',
];

test('retired staking product surface cannot return through tracked source', () => {
  for (const relativePath of retiredStakingFiles) {
    assert.equal(
      fs.existsSync(path.join(root, relativePath)),
      false,
      `${relativePath} must remain removed`,
    );
  }
});

test('current architecture and API docs do not advertise staking', () => {
  const architecture = fs.readFileSync(path.join(root, 'ARCHITECTURE.md'), 'utf8');
  const apiReference = fs.readFileSync(path.join(root, 'docs/api/api-reference.md'), 'utf8');

  assert.doesNotMatch(architecture, /^\/staking$/m);
  assert.doesNotMatch(apiReference, /\/api\/staking\//);
});
