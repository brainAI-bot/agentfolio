const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PIN_SHA = '93fc6c0d86302cfe8b0d8c798ba2817d7eeace44';

describe('@brainai/satp-client git pin (G5)', () => {
  it('package.json pin contains the HQ SATP SHA', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const pin = pkg.dependencies['@brainai/satp-client'];
    assert.equal(typeof pin, 'string');
    assert.match(pin, new RegExp(PIN_SHA));
  });

  it('runtime recertification checks out the same authoritative SATP source', () => {
    const workflow = fs.readFileSync(
      path.join(__dirname, '..', '.github', 'workflows', 'escrow-v3-runtime-recert.yml'),
      'utf8',
    );
    const verifier = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'verify-escrow-v3-runtime-recert.mjs'),
      'utf8',
    );
    assert.match(workflow, new RegExp(`SATP_SOURCE_COMMIT: ["']${PIN_SHA}["']`));
    assert.match(verifier, new RegExp(`sourceCommit: ["']${PIN_SHA}["']`));
  });

  it('require() yields verifyIdentityAttestationRequest', () => {
    const c = require('@brainai/satp-client');
    assert.strictEqual(typeof c.verifyIdentityAttestationRequest, 'function');
  });
});
