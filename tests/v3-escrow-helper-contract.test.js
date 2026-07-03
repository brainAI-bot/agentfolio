const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const helperSource = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'src', 'lib', 'v3-escrow.ts'),
  'utf8',
);

test('deriveV3EscrowPDA matches the server PDA derive contract', () => {
  assert.match(helperSource, /new URLSearchParams\(\{ clientWallet: client, description \}\)/);
  assert.match(helperSource, /return data\.escrowPDA;/);
  assert.doesNotMatch(helperSource, /return data\.pda;/);
});
