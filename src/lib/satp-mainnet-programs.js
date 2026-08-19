/**
 * Canonical SATP mainnet program IDs — V3 cluster, one escrow.
 * Keep in lockstep with frontend/src/lib/satp-mainnet-programs.ts and
 * satp/Anchor.toml [programs.mainnet].
 */

const SATP_MAINNET_PROGRAMS = {
  IDENTITY: 'GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG',
  REVIEWS: 'r9XX4frcqxxAZ6Au9V5PA3EAxs1zoNckqLLmoSRcNr4',
  REPUTATION: '2Lz7KzMvKdrGeAuS8WPHu7jK2yScrnKVgacpYVEuDjkJ',
  ATTESTATIONS: '6Xd1dAQJPvQRJ4Ntr6LtPTjDjPUZ8nfnmYLZaZ2DtrdD',
  VALIDATION: '6rYRiCYidJYV7QvKrzKGgNu4oMh6BAvynked69R7xMbV',
  ESCROW: 'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C',
};

const SATP_V2_MAINNET_PROGRAMS = {
  IDENTITY: '97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq',
  REVIEWS: 'Ge1sD2qwmH8QaaKCPZzZERvsFXNVMvKbAgTp2p17yjLK',
  REPUTATION: 'C9ogv8TBrvFy4pLKDoGQg9B73Q5rKPPsQ4kzkcDk6Jd',
  ATTESTATIONS: 'ENvaD19QzwWWMJFu5r5xJ9SmHqWN6GvyzxACRejqbdug',
  VALIDATION: '9p795d2j3eGqzborG2AncucWBaU6PieKxmhKVroV3LNh',
  ESCROW: 'HXCUWKR2NvRcZ7rNAJHwPcH6QAAWaLR4bRFbfyuDND6C',
};

const SATP_V3_DESCRIPTION = 'SATP v3 — Solana Agent Trust Protocol. 6-program mainnet cluster (identity, reviews, reputation, attestations, validation, one escrow).';

function programIdToString(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.toBase58 === 'function') return value.toBase58();
  return String(value);
}

function mapProgramIds(programs) {
  return Object.fromEntries(
    Object.entries(programs || {})
      .map(([key, value]) => [String(key).toLowerCase(), programIdToString(value)])
      .filter(([, value]) => Boolean(value))
  );
}

module.exports = {
  SATP_MAINNET_PROGRAMS,
  SATP_V2_MAINNET_PROGRAMS,
  SATP_V3_DESCRIPTION,
  programIdToString,
  mapProgramIds,
};
