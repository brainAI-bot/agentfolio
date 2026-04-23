const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'app', 'mint', 'page.tsx'), 'utf8');

test('mint burn flow falls back when sendTransaction returns a bogus signature', () => {
  assert.match(source, /function isLikelyBroadcastSignature\(signature: unknown\): signature is string/);
  assert.match(source, /!\/\^1\+\$\/\.test\(signature\)/);
  assert.match(source, /wallet\.sendTransaction returned a non-broadcast signature, falling back to signTransaction/);
  assert.match(source, /wallet\.sendTransaction returned a non-broadcast genesis signature, falling back to signTransaction/);
  assert.match(source, /if \(isLikelyBroadcastSignature\(burnSignature\)\) \{/);
  assert.match(source, /if \(isLikelyBroadcastSignature\(genesisSignature\)\) \{/);
  assert.match(source, /submitPayload\.signedTransaction = Buffer\.from\(signed\.serialize\(\)\)\.toString\("base64"\);/);
  assert.match(source, /genesisPayload\.signedTransaction = Buffer\.from\(signedBtb\.serialize\(\)\)\.toString\("base64"\);/);
});
