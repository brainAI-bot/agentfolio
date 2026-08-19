const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('@brainai/satp-client pin', () => {
  it('pins 2.0.6 exactly in package.json and the lockfile', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies['@brainai/satp-client'], '2.0.6');
    const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
    const locked = lock.packages?.['node_modules/@brainai/satp-client'];
    assert.ok(locked, 'expected lockfile entry for @brainai/satp-client');
    assert.equal(locked.version, '2.0.6');
    assert.doesNotMatch(JSON.stringify(lock.packages['']?.dependencies?.['@brainai/satp-client'] || ''), /\^2\.0\.5/);
  });
});
