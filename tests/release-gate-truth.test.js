const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const noticeSource = fs.readFileSync(
  path.join(ROOT, 'frontend', 'src', 'components', 'ReleaseGateNotice.tsx'),
  'utf8'
);
const layoutSource = fs.readFileSync(
  path.join(ROOT, 'frontend', 'src', 'app', 'layout.tsx'),
  'utf8'
);

test('public shell carries release-gate truth copy for live verification', () => {
  assert.match(noticeSource, /No completion banner is present\./);
  assert.match(noticeSource, /Escrow live-funds writes and token launch claims remain gated pending security re-review\./);
  assert.match(layoutSource, /<ReleaseGateNotice \/>/);
});

test('release-gate notice avoids completed-launch or production-ready claims', () => {
  assert.doesNotMatch(noticeSource, /production[- ]ready/i);
  assert.doesNotMatch(noticeSource, /all[- ]gates[- ]passed/i);
  assert.doesNotMatch(noticeSource, /launch[- ]complete/i);
});
