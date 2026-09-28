const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

// Moved here from the Makings boundary test when Makings left this repository.
const statsPath = path.join(__dirname, '..', 'frontend', 'src', 'app', 'stats', 'page.tsx');

test('token advertising is retired without deleting independent chain receipts', () => {
  const stats = fs.readFileSync(statsPath, 'utf8');
  assert.doesNotMatch(stats, /TokenStatsSection|Token Launches|recentLaunches/);
  assert.match(stats, /On-Chain Receipts/);
  assert.match(stats, /Historical Escrow Release Receipt/);
});
