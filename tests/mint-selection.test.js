const { describe, it } = require('node:test');
const assert = require('node:assert');
const { reconcileMintSelection } = require('../frontend/src/lib/mint-selection');

describe('reconcileMintSelection', () => {
  it('clears stale selection and returns to choose when no burnable NFTs remain', () => {
    const selectedNft = { mint: 'burned-mint' };
    const result = reconcileMintSelection('preview', selectedNft, [], false);
    assert.strictEqual(result.selectedNft, null);
    assert.strictEqual(result.step, 'choose');
  });

  it('keeps selection and step when the selected NFT is still present', () => {
    const selectedNft = { mint: 'live-mint' };
    const result = reconcileMintSelection('preview', selectedNft, [{ mint: 'live-mint' }], false);
    assert.strictEqual(result.selectedNft, selectedNft);
    assert.strictEqual(result.step, 'preview');
  });

  it('returns to select when stale selection is gone but other options still exist', () => {
    const selectedNft = { mint: 'old-mint' };
    const result = reconcileMintSelection('burning', selectedNft, [{ mint: 'new-mint' }], false);
    assert.strictEqual(result.selectedNft, null);
    assert.strictEqual(result.step, 'select');
  });
});
