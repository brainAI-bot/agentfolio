const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PIN_SHA = '551c7971766a2f3bf401a6ac0d57900be536bcb4';

describe('@brainai/satp-client git pin (G5)', () => {
  it('package.json pin contains the HQ SATP SHA', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const pin = pkg.dependencies['@brainai/satp-client'];
    assert.equal(typeof pin, 'string');
    assert.match(pin, new RegExp(PIN_SHA));
  });

  it('require() yields verifyIdentityAttestationRequest', () => {
    const c = require('@brainai/satp-client');
    assert.strictEqual(typeof c.verifyIdentityAttestationRequest, 'function');
  });
});
