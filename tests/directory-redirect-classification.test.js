const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('directory route classification', () => {
  it('keeps /directory classified as an intentional frontend redirect to /leaderboard', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../frontend/src/app/directory/page.tsx'), 'utf8');

    assert.match(source, /redirect\(['"]\/leaderboard['"]\)/);
  });
});
