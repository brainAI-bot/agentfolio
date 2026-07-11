const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const Database = require('better-sqlite3');

const {
  BOA_NFT_RESERVED_CODE,
  BOA_PAYMENT_REPLAY_CODE,
  BOA_PAYMENT_REQUIRED_CODE,
  completeBoaMintReservation,
  ensureBoaMintReservationSchema,
  failBoaMintReservation,
  reserveBoaMintPayment,
} = require('../src/lib/boa-mint-reservations');

const ROOT = path.join(__dirname, '..');

function withTempDb(callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boa-reserve-'));
  const dbPath = path.join(dir, 'agentfolio.db');
  const db = new Database(dbPath);
  try {
    return callback(db);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('BOA payment reservation enforces one payment_tx per mint', () => {
  withTempDb((db) => {
    const first = reserveBoaMintPayment(db, {
      nftNumber: 7,
      wallet: 'wallet_a',
      paymentTx: '  payment_signature_1  ',
      now: '2026-07-10T10:00:00.000Z',
    });

    assert.equal(first.reserved, true);
    assert.equal(first.record.payment_tx, 'payment_signature_1');

    assert.throws(
      () => reserveBoaMintPayment(db, {
        nftNumber: 8,
        wallet: 'wallet_b',
        paymentTx: 'payment_signature_1',
      }),
      (err) => err.code === BOA_PAYMENT_REPLAY_CODE && err.statusCode === 409,
    );

    const rows = db.prepare('SELECT nft_number, wallet, payment_tx FROM boa_mints').all();
    assert.deepEqual(rows, [
      { nft_number: 7, wallet: 'wallet_a', payment_tx: 'payment_signature_1' },
    ]);
  });
});

test('BOA payment reservation enforces one payment per nft_number', () => {
  withTempDb((db) => {
    reserveBoaMintPayment(db, {
      nftNumber: 11,
      wallet: 'wallet_a',
      paymentTx: 'payment_signature_11',
    });

    assert.throws(
      () => reserveBoaMintPayment(db, {
        nftNumber: 11,
        wallet: 'wallet_a',
        paymentTx: 'payment_signature_12',
      }),
      (err) => err.code === BOA_NFT_RESERVED_CODE && err.statusCode === 409,
    );
  });
});

test('BOA payment reservation rejects blank payment_tx instead of creating replayable blanks', () => {
  withTempDb((db) => {
    assert.throws(
      () => reserveBoaMintPayment(db, {
        nftNumber: 1,
        wallet: 'wallet_a',
        paymentTx: '',
      }),
      (err) => err.code === BOA_PAYMENT_REQUIRED_CODE && err.statusCode === 400,
    );
  });
});

test('BOA payment reservation schema adds UNIQUE payment_tx index for existing tables', () => {
  withTempDb((db) => {
    db.exec(`CREATE TABLE boa_mints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nft_number INTEGER NOT NULL UNIQUE,
      wallet TEXT NOT NULL,
      payment_tx TEXT,
      status TEXT DEFAULT 'pending'
    )`);

    ensureBoaMintReservationSchema(db);
    const indexes = db.prepare("PRAGMA index_list('boa_mints')").all();
    assert.ok(indexes.some((idx) => idx.name === 'idx_boa_mints_payment_tx_unique' && idx.unique === 1));
    assert.ok(indexes.some((idx) => idx.name === 'idx_boa_mints_nft_number_unique' && idx.unique === 1));
  });
});

test('BOA payment reservation status updates preserve the reserved row', () => {
  withTempDb((db) => {
    reserveBoaMintPayment(db, {
      nftNumber: 21,
      wallet: 'wallet_a',
      paymentTx: 'payment_signature_21',
    });

    completeBoaMintReservation(db, {
      nftNumber: 21,
      mintAddress: 'mint_21',
      metadataUri: 'metadata_21',
      imageUri: 'image_21',
      now: '2026-07-10T10:01:00.000Z',
    });

    let row = db.prepare('SELECT * FROM boa_mints WHERE payment_tx = ?').get('payment_signature_21');
    assert.equal(row.status, 'completed');
    assert.equal(row.mint_address, 'mint_21');
    assert.equal(row.completed_at, '2026-07-10T10:01:00.000Z');

    failBoaMintReservation(db, 21);
    row = db.prepare('SELECT * FROM boa_mints WHERE payment_tx = ?').get('payment_signature_21');
    assert.equal(row.status, 'failed');
    assert.equal(row.mint_address, 'mint_21');
  });
});

test('BOA finalization routes keep 423 pause before reservation and reserve before mint side effects', () => {
  const finalizeSource = fs.readFileSync(path.join(ROOT, 'src/api/boa-mint-finalize.js'), 'utf8');
  const completeSource = fs.readFileSync(path.join(ROOT, 'src/api/boa-mint.js'), 'utf8');

  const finalizeGate = finalizeSource.indexOf("sendBoaWriteGateResponse(res, 'BOA mint finalization')");
  const finalizeReserve = finalizeSource.indexOf('const reservation = reserveBoaMintPayment');
  const finalizeWorker = finalizeSource.indexOf('exec(cmd');
  assert.ok(finalizeGate >= 0, 'BOA finalize route must keep the 423 write pause');
  assert.ok(finalizeReserve > finalizeGate, 'BOA finalize route must reserve after the pause gate');
  assert.ok(finalizeReserve < finalizeWorker, 'BOA finalize route must reserve before worker mint side effects');
  assert.match(finalizeSource, /wallet, payment_tx and nft_number required/);

  const completeGate = completeSource.indexOf("sendBoaWriteGateResponse(res, 'BOA mint completion')");
  const completeReserve = completeSource.indexOf('const reservation = reserveBoaMintPayment');
  const completeMint = completeSource.indexOf('await mintBoaNft');
  assert.ok(completeGate >= 0, 'BOA complete route must keep the 423 write pause');
  assert.ok(completeReserve > completeGate, 'BOA complete route must reserve after the pause gate');
  assert.ok(completeReserve < completeMint, 'BOA complete route must reserve before mint side effects');
});
