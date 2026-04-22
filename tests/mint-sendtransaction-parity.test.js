const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mintPageSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'app', 'mint', 'page.tsx'), 'utf8');

test('mint burn flow prefers sendTransaction before signTransaction', () => {
  const sendIndex = mintPageSource.indexOf('if (wallet.sendTransaction) {');
  const signIndex = mintPageSource.indexOf('} else if (wallet.signTransaction) {');

  assert.notEqual(sendIndex, -1, 'sendTransaction branch should exist');
  assert.notEqual(signIndex, -1, 'signTransaction fallback branch should exist');
  assert.ok(sendIndex < signIndex, 'sendTransaction should be attempted before signTransaction');
  assert.match(mintPageSource, /submitPayload\.submissionMode = "sendTransaction"/);
  assert.match(mintPageSource, /submitPayload\.submissionMode = "signTransaction"/);
});
