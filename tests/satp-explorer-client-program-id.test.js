const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('SATP explorer client program id', () => {
  it('links the explorer header to the V3 SATP program id', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../frontend/src/app/satp/explorer/SATPExplorerClient.tsx'),
      'utf8'
    );

    assert.match(source, /const SATP_V3_PROGRAM_ID = "GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG";/);
    assert.doesNotMatch(source, /explorer\.solana\.com\/address\/97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq/);
  });
});
