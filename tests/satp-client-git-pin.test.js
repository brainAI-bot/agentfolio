const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PIN_SHA = '91455b6824798c9993c29816acca7d394ae39365';
const PROVENANCE_SOURCE_SHA = PIN_SHA;

describe('@brainai/satp-client git pin (G5)', () => {
  it('package.json pin contains the HQ SATP SHA', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const pin = pkg.dependencies['@brainai/satp-client'];
    assert.equal(typeof pin, 'string');
    assert.match(pin, new RegExp(PIN_SHA));
  });

  it('runtime recertification checks out the canonical consumer and source commit', () => {
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
    assert.equal(receipt.source.commit, PIN_SHA);
  });

  it('require() yields verifyIdentityAttestationRequest', () => {
    const c = require('@brainai/satp-client');
    assert.strictEqual(typeof c.verifyIdentityAttestationRequest, 'function');
  });
});
