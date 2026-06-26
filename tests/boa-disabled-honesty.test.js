const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');

test('BOA mint page is explicitly paused and avoids live/permanent claims', () => {
  const source = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'app', 'mint', 'page.tsx'), 'utf8');

  assert.match(source, /const MINTING_PAUSED = true;/);
  assert.match(source, /BOA writes paused/);
  assert.match(source, /BOA mint and burn writes are safely disabled/);
  assert.doesNotMatch(source, /Soft Launch/);
  assert.doesNotMatch(source, /Limited to 100 Mints/);
  assert.doesNotMatch(source, /Your agent’s face, permanently on-chain\. Choose your path\./);
  assert.doesNotMatch(source, /Each agent is unique\. Yours will be assigned randomly on mint\./);
});

test('BOA mint write endpoints are blocked by the Solana/Irys read-only gate', () => {
  const expected = new Map([
    ['src/api/boa-mint.js', 'BOA mint transaction build'],
    ['src/api/boa-mint.js', 'BOA mint completion'],
    ['src/api/boa-mint.js', 'BOA agent mint'],
    ['src/routes/burn-to-become-public.js', 'BOA client mint transaction build'],
    ['src/routes/burn-to-become-public.js', 'BOA Metaplex mint'],
    ['src/routes/burn-to-become-public.js', 'BOA mint confirmation'],
    ['src/routes/burn-to-become-public.js', 'Burn-to-Become '],
  ]);

  for (const [relativeFile, operation] of expected) {
    const source = fs.readFileSync(path.join(ROOT, relativeFile), 'utf8');
    assert.ok(source.includes('sendSolanaIrysWriteGateResponse'), relativeFile + ' is missing the gate helper');
    assert.ok(source.includes(operation), relativeFile + ' is missing gate operation ' + operation);
  }
});
