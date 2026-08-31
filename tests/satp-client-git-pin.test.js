const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PIN_SHA = '93fc6c0d86302cfe8b0d8c798ba2817d7eeace44';
const PROVENANCE_SOURCE_SHA = '3f8188bec89db0d4a081931f35272e10185d1c0d';

describe('@brainai/satp-client git pin (G5)', () => {
  it('package.json pin contains the HQ SATP SHA', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const pin = pkg.dependencies['@brainai/satp-client'];
    assert.equal(typeof pin, 'string');
    assert.match(pin, new RegExp(PIN_SHA));
  });

  it('runtime recertification checks out the current deployed-source candidate', () => {
    const workflow = fs.readFileSync(
      path.join(__dirname, '..', '.github', 'workflows', 'escrow-v3-runtime-recert.yml'),
      'utf8',
    );
    const receipt = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'config', 'escrow-v3-provenance-ef7e4581.json'),
      'utf8',
    ));
    assert.equal(receipt.source.commit, PROVENANCE_SOURCE_SHA);
    assert.match(workflow, new RegExp(`SATP_SOURCE_COMMIT: ["']${PROVENANCE_SOURCE_SHA}["']`));
    assert.notEqual(receipt.source.commit, PIN_SHA, 'consumer package pin is historical until publication is reconciled');
  });

  it('require() yields verifyIdentityAttestationRequest', () => {
    const c = require('@brainai/satp-client');
    assert.strictEqual(typeof c.verifyIdentityAttestationRequest, 'function');
  });
});
