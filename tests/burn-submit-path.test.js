const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'burn-to-become-public.js'),
  'utf8'
);

describe('burn submit path regression guard', () => {
  it('accepts wallet-broadcast txSignature submissions', () => {
    assert.match(source, /const \{ wallet, nftMint, signedTransaction, txSignature, submissionMode \} = req\.body \|\| \{\}/);
    assert.match(source, /either signedTransaction or txSignature required/);
    assert.match(source, /resolvedSubmissionMode/);
  });

  it('validates confirmed on-chain burn transactions for txSignature flow', () => {
    assert.match(source, /async function getConfirmedTransactionWithRetry\(signature, attempts = 8\)/);
    assert.match(source, /await connection\.confirmTransaction\(txSignature, 'confirmed'\)/);
    assert.match(source, /const confirmedTx = await getConfirmedTransactionWithRetry\(txSignature\)/);
  });

  it('allows lighthouse helper instructions in the burn validator', () => {
    assert.match(source, /const LIGHTHOUSE_PROGRAM = new PublicKey\('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95'\)/);
    assert.match(source, /LIGHTHOUSE_PROGRAM\.toBase58\(\)/);
  });

  it('accepts versioned signedTransaction payloads', () => {
    assert.match(source, /submittedTx = isVersionedSerializedTransaction\(signedTxBuffer\)\s*\? VersionedTransaction\.deserialize\(signedTxBuffer\)\s*:\s*Transaction\.from\(signedTxBuffer\)/);
    assert.match(source, /const submittedFeePayer = getSubmittedTransactionFeePayer\(submittedTx\)/);
    assert.match(source, /getSubmittedTransactionSignerMatches\(submittedTx, walletPubkey\)/);
    assert.match(source, /return sendJson\(400, \{ error: 'Invalid signed transaction payload' \}\)/);
  });

  it('validates versioned burn instructions via staticAccountKeys and compiledInstructions', () => {
    assert.match(source, /submittedTx\.message\.compiledInstructions\.find\(ix => \{/);
    assert.match(source, /submittedTx\.message\.staticAccountKeys\[ix\.programIdIndex\]/);
    assert.match(source, /for \(const ix of submittedTx\.message\.compiledInstructions\)/);
    assert.match(source, /const ixKeys = getVersionedInstructionKeys\(submittedTx, ix\)/);
  });
});
