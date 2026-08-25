const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PIN_SHA = '551c7971766a2f3bf401a6ac0d57900be536bcb4';

describe('@brainai/satp-client pin', () => {
  it('pins the SATP packaged-IDL fix via git commit in package.json and the lockfile', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const pin = pkg.dependencies['@brainai/satp-client'];
    assert.match(String(pin), new RegExp(PIN_SHA));
    const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
    const locked = lock.packages?.['node_modules/@brainai/satp-client'];
    assert.ok(locked, 'expected lockfile entry for @brainai/satp-client');
    const resolved = JSON.stringify(locked);
    assert.match(resolved, new RegExp(PIN_SHA));
    assert.doesNotMatch(JSON.stringify(lock.packages['']?.dependencies?.['@brainai/satp-client'] || ''), /\^2\.0\.5/);
  });
});
