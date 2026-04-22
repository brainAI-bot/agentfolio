const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'burn-to-become-public.js'), 'utf8');

test('submit-genesis route exists and tolerates confirmation timeouts', () => {
  assert.match(source, /\/api\/burn-to-become\/submit-genesis/);
  assert.match(source, /if \(!signedTransaction && !txSignature\) return sendJson\(400, \{ error: 'signedTransaction or txSignature required' \}\);/);
  assert.match(source, /const confirmedTx = await getConfirmedTransactionWithRetry\(sig, confirmError \? 20 : 8\);/);
  assert.match(source, /if \(\/invalid length\/i\.test\(confirmMessage\)\) \{/);
  assert.match(source, /return sendJson\(404, \{ error: 'Transaction not found or not confirmed yet\. Try again in a few seconds\.', signature: sig, confirmError: confirmMessage \|\| null \}\);/);
  assert.match(source, /console\.log\('\[SubmitGenesis\] burnToBecome TX confirmed:'/);
});
