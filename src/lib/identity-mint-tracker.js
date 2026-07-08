'use strict';

const crypto = require('crypto');
const { PublicKey } = require('@solana/web3.js');

const SATP_V3_IDENTITY_PROGRAM = new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');
const IDENTITY_MINT_TRACKER_DISCRIMINATOR = Buffer.from([217, 230, 22, 187, 250, 88, 11, 174]);
const IDENTITY_MINT_TRACKER_MAX_MINTS = 3;

function getSatpV3GenesisPDA(agentId) {
  const agentHash = crypto.createHash('sha256').update(String(agentId || '')).digest();
  return PublicKey.findProgramAddressSync(
    [Buffer.from('genesis'), agentHash],
    SATP_V3_IDENTITY_PROGRAM
  );
}

function getIdentityMintTrackerPDA(agentId) {
  const [genesisPda] = getSatpV3GenesisPDA(agentId);
  const [trackerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('mint_tracker'), genesisPda.toBuffer()],
    SATP_V3_IDENTITY_PROGRAM
  );
  return [trackerPda, genesisPda];
}

function parseIdentityMintTrackerAccount(accountInfo, { trackerPda, genesisPda }) {
  if (!accountInfo || !accountInfo.data || accountInfo.data.length === 0) {
    return {
      exists: false,
      pda: trackerPda.toBase58(),
      identity: genesisPda.toBase58(),
      mintCount: 0,
      maxMints: IDENTITY_MINT_TRACKER_MAX_MINTS,
      freeMintAvailable: true,
      capReached: false,
    };
  }

  if (accountInfo.owner && !accountInfo.owner.equals(SATP_V3_IDENTITY_PROGRAM)) {
    throw new Error('Identity mint tracker is not owned by SATP V3 identity program');
  }

  const data = Buffer.from(accountInfo.data);
  if (data.length < 50) {
    throw new Error('Identity mint tracker account is too small');
  }

  const discriminator = data.subarray(0, IDENTITY_MINT_TRACKER_DISCRIMINATOR.length);
  if (!discriminator.equals(IDENTITY_MINT_TRACKER_DISCRIMINATOR)) {
    throw new Error('Identity mint tracker discriminator mismatch');
  }

  const mintCount = Number(data[40] || 0);
  const lastMintTimestamp = Number(data.readBigInt64LE(41));
  const bump = data[49];

  return {
    exists: true,
    pda: trackerPda.toBase58(),
    identity: new PublicKey(data.subarray(8, 40)).toBase58(),
    mintCount,
    maxMints: IDENTITY_MINT_TRACKER_MAX_MINTS,
    lastMintTimestamp,
    bump,
    freeMintAvailable: mintCount === 0,
    capReached: mintCount >= IDENTITY_MINT_TRACKER_MAX_MINTS,
  };
}

async function getIdentityMintTrackerStatus(agentId, conn) {
  if (!agentId) throw new Error('agentId required for identity mint tracker');
  if (!conn || typeof conn.getAccountInfo !== 'function') {
    throw new Error('Solana connection required for identity mint tracker');
  }
  const [trackerPda, genesisPda] = getIdentityMintTrackerPDA(agentId);
  const accountInfo = await conn.getAccountInfo(trackerPda);
  return parseIdentityMintTrackerAccount(accountInfo, { trackerPda, genesisPda });
}

async function requireIdentityMintCapacity(agentId, options = {}) {
  const tracker = await getIdentityMintTrackerStatus(agentId, options.connection);
  if (tracker.capReached) {
    const err = new Error('Maximum 3 mints per identity reached.');
    err.statusCode = 403;
    err.code = 'IDENTITY_MINT_CAP_REACHED';
    err.tracker = tracker;
    throw err;
  }
  if (options.requireFree && !tracker.freeMintAvailable) {
    const err = new Error('Free mint already used for this identity.');
    err.statusCode = 403;
    err.code = 'IDENTITY_FREE_MINT_USED';
    err.tracker = tracker;
    throw err;
  }
  return tracker;
}

module.exports = {
  SATP_V3_IDENTITY_PROGRAM,
  IDENTITY_MINT_TRACKER_DISCRIMINATOR,
  IDENTITY_MINT_TRACKER_MAX_MINTS,
  getSatpV3GenesisPDA,
  getIdentityMintTrackerPDA,
  parseIdentityMintTrackerAccount,
  getIdentityMintTrackerStatus,
  requireIdentityMintCapacity,
};
