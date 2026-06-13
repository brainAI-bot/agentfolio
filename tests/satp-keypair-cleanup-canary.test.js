const { describe, it } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function runInventory() {
  const output = execFileSync('node', ['scripts/satp-keypair-inventory.js', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return JSON.parse(output);
}

describe('SATP keypair cleanup canary', () => {
  it('keeps real keypair-style JSON artifacts out of tracked source', () => {
    const inventory = runInventory();
    assert.deepStrictEqual(inventory.trackedSecretPaths, []);
  });

  it('keeps explicit ignore coverage for known SATP key filenames', () => {
    const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
    for (const requiredPattern of [
      'keys/',
      '*keypair*.json',
      '*deployer*.json',
      'brainforge-personal.json',
      'satp-mainnet-platform.json',
      'satp-platform*.json',
    ]) {
      assert.match(gitignore, new RegExp(`(^|\\n)${requiredPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\n|$)`));
    }
  });

  it('continues to inventory signer surfaces for follow-up cleanup', () => {
    const inventory = runInventory();
    for (const category of [
      'env-configured-signer',
      'hardcoded-mainnet-deployer-path',
      'hardcoded-devnet-deployer-path',
      'platform-key-filename',
      'legacy-authority-pubkey',
      'secret-key-loader',
    ]) {
      assert.ok(Object.hasOwn(inventory.categories, category));
      assert.ok(Number.isInteger(inventory.categories[category].count));
    }
  });
});
