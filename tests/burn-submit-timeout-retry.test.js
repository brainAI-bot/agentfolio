const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'burn-to-become-public.js'), 'utf8');

test('burn submit sendTransaction path retries lookup after confirm timeout', () => {
  assert.match(source, /let confirmError = null;/);
  assert.match(source, /await connection\.confirmTransaction\(txSignature, 'confirmed'\);/);
  assert.match(source, /confirmedTx = await getConfirmedTransactionWithRetry\(txSignature, confirmError \? 20 : 8\);/);
  assert.match(source, /if \(\/invalid length\/i\.test\(confirmMessage\)\) \{/);
  assert.match(source, /error: 'Submitted burn transaction not found on-chain'/);
  assert.doesNotMatch(source, /catch \{\s*return sendJson\(400, \{ error: 'Invalid burn transaction signature' \}\);\s*\}/);
});
