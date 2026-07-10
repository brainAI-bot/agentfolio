'use strict';

const BOA_PAYMENT_REPLAY_CODE = 'BOA_PAYMENT_TX_ALREADY_RESERVED';
const BOA_NFT_RESERVED_CODE = 'BOA_NFT_NUMBER_ALREADY_RESERVED';
const BOA_PAYMENT_REQUIRED_CODE = 'BOA_PAYMENT_TX_REQUIRED';

function normalizePaymentTx(paymentTx) {
  return String(paymentTx || '').trim();
}

function normalizeNftNumber(nftNumber) {
  const parsed = Number.parseInt(nftNumber, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    const err = new Error('nft_number must be a positive integer');
    err.code = BOA_NFT_RESERVED_CODE;
    err.statusCode = 400;
    throw err;
  }
  return parsed;
}

function reservationError(code, message, statusCode = 409, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  Object.assign(err, detail);
  return err;
}

function ensureBoaMintReservationSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS boa_mints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nft_number INTEGER NOT NULL,
    wallet TEXT NOT NULL,
    mint_address TEXT,
    payment_tx TEXT,
    metadata_uri TEXT,
    image_uri TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  )`);

  try { db.exec(`ALTER TABLE boa_mints ADD COLUMN payment_tx TEXT`); } catch (e) { /* column already exists */ }
  try { db.exec(`ALTER TABLE boa_mints ADD COLUMN status TEXT DEFAULT 'pending'`); } catch (e) { /* column already exists */ }
  try { db.exec(`ALTER TABLE boa_mints ADD COLUMN completed_at TEXT`); } catch (e) { /* column already exists */ }

  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_boa_mints_nft_number_unique
    ON boa_mints(nft_number)`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_boa_mints_payment_tx_unique
    ON boa_mints(payment_tx)
    WHERE payment_tx IS NOT NULL AND payment_tx <> ''`);
}

function reserveBoaMintPayment(db, {
  nftNumber,
  wallet,
  paymentTx,
  status = 'pending',
  now = new Date().toISOString(),
}) {
  ensureBoaMintReservationSchema(db);

  const normalizedNftNumber = normalizeNftNumber(nftNumber);
  const normalizedWallet = String(wallet || '').trim();
  const normalizedPaymentTx = normalizePaymentTx(paymentTx);

  if (!normalizedWallet) {
    throw reservationError('BOA_WALLET_REQUIRED', 'wallet is required', 400);
  }
  if (!normalizedPaymentTx) {
    throw reservationError(BOA_PAYMENT_REQUIRED_CODE, 'payment_tx is required', 400);
  }

  return db.transaction(() => {
    const byPayment = db.prepare('SELECT * FROM boa_mints WHERE payment_tx = ?').get(normalizedPaymentTx);
    if (byPayment) {
      if (Number(byPayment.nft_number) === normalizedNftNumber && byPayment.wallet === normalizedWallet) {
        return { reserved: false, idempotent: true, record: byPayment };
      }
      throw reservationError(
        BOA_PAYMENT_REPLAY_CODE,
        'payment_tx is already reserved for a BOA mint',
        409,
        { existingNftNumber: byPayment.nft_number },
      );
    }

    const byNft = db.prepare('SELECT * FROM boa_mints WHERE nft_number = ?').get(normalizedNftNumber);
    if (byNft) {
      throw reservationError(
        BOA_NFT_RESERVED_CODE,
        'nft_number is already reserved for a BOA mint',
        409,
        { existingPaymentTx: byNft.payment_tx },
      );
    }

    db.prepare(`
      INSERT INTO boa_mints (nft_number, wallet, payment_tx, status, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(normalizedNftNumber, normalizedWallet, normalizedPaymentTx, status, now);

    return {
      reserved: true,
      idempotent: false,
      record: db.prepare('SELECT * FROM boa_mints WHERE payment_tx = ?').get(normalizedPaymentTx),
    };
  })();
}

function completeBoaMintReservation(db, {
  nftNumber,
  mintAddress = '',
  metadataUri = '',
  imageUri = '',
  now = new Date().toISOString(),
}) {
  ensureBoaMintReservationSchema(db);
  const normalizedNftNumber = normalizeNftNumber(nftNumber);
  db.prepare(`
    UPDATE boa_mints
    SET mint_address = ?, metadata_uri = ?, image_uri = ?, status = ?, completed_at = ?
    WHERE nft_number = ?
  `).run(mintAddress, metadataUri, imageUri, 'completed', now, normalizedNftNumber);
}

function failBoaMintReservation(db, nftNumber) {
  ensureBoaMintReservationSchema(db);
  const normalizedNftNumber = normalizeNftNumber(nftNumber);
  db.prepare('UPDATE boa_mints SET status = ? WHERE nft_number = ?')
    .run('failed', normalizedNftNumber);
}

module.exports = {
  BOA_NFT_RESERVED_CODE,
  BOA_PAYMENT_REPLAY_CODE,
  BOA_PAYMENT_REQUIRED_CODE,
  completeBoaMintReservation,
  ensureBoaMintReservationSchema,
  failBoaMintReservation,
  normalizePaymentTx,
  reserveBoaMintPayment,
};
