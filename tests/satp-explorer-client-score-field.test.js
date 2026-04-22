const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('SATP explorer client score mapping', () => {
  it('prefers computedTrustScore before lower-level raw reputation fields', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/app/satp/explorer/SATPExplorerClient.tsx'),
      'utf8'
    );

    assert.match(
      source,
      /trustScore:\s*agent\.computedTrustScore\s*\?\?\s*agent\.trustScore\s*\?\?\s*agent\.reputationScore/
    );
  });
});
