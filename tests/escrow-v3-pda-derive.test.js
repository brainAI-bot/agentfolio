const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const { PublicKey } = require('@solana/web3.js');

const ESCROW_V3_PROGRAM_ID = new PublicKey('HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C');
const CLIENT_WALLET = '11111111111111111111111111111111';

function expectedPDA(client, description, nonce) {
  const descriptionHash = crypto.createHash('sha256').update(description).digest();
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(BigInt(nonce));
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('escrow_v3'), new PublicKey(client).toBuffer(), descriptionHash, nonceBuf],
    ESCROW_V3_PROGRAM_ID,
  );
  return { pda: pda.toBase58(), bump, descriptionHash: descriptionHash.toString('hex') };
}

test('V3 escrow PDA derive accepts clientWallet alias without requiring SDK/RPC', async (t) => {
  const previousNetwork = process.env.SATP_NETWORK;
  process.env.SATP_NETWORK = 'mainnet';
  t.after(() => {
    if (previousNetwork === undefined) delete process.env.SATP_NETWORK;
    else process.env.SATP_NETWORK = previousNetwork;
  });

  const app = express();
  app.use('/api/v3/escrow', require('../src/routes/escrow-v3-routes'));

  const server = app.listen(0);
  t.after(() => server.close());

  const url = new URL(`http://127.0.0.1:${server.address().port}/api/v3/escrow/pda/derive`);
  url.searchParams.set('clientWallet', CLIENT_WALLET);
  url.searchParams.set('description', 't');
  url.searchParams.set('nonce', '0');

  const res = await fetch(url);
  const body = await res.json();
  const expected = expectedPDA(CLIENT_WALLET, 't', 0);

  assert.equal(res.status, 200);
  assert.equal(body.client, CLIENT_WALLET);
  assert.equal(body.nonce, 0);
  assert.equal(body.escrowPDA, expected.pda);
  assert.equal(body.bump, expected.bump);
  assert.equal(body.descriptionHash, expected.descriptionHash);
});
