const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('SATP explorer client latency', () => {
  it('does not fan out per-card SATP wallet fetches during initial load', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/app/satp/explorer/SATPExplorerClient.tsx'),
      'utf8'
    );

    assert.doesNotMatch(source, /\/api\/satp\/scores\/\$\{wallet\}/);
    assert.doesNotMatch(source, /\/api\/satp\/reputation\/\$\{wallet\}/);
    assert.doesNotMatch(source, /\/api\/satp\/reviews\/\$\{wallet\}/);
    assert.match(source, /reviewCount:\s*Number\(agent\.reviewCount \?\? 0\)/);
    assert.match(source, /reviewAvg:\s*Number\(agent\.reviewAvg \?\? 0\)/);
  });
});
