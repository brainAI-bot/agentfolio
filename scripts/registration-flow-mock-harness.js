#!/usr/bin/env node
const assert = require('assert/strict');

function createMockDb() {
  return {
    profiles: new Map(),
    verifications: [],
  };
}

function registerSimple(db, { profileId, walletAddress }) {
  db.profiles.set(profileId, {
    id: profileId,
    wallet: walletAddress,
    verification_data: {},
  });
  db.verifications.push({
    profile_id: profileId,
    platform: 'solana',
    identifier: walletAddress,
    proof: { source: 'simple-registration' },
  });
}

async function confirmSatpIdentity(db, { profileId, walletAddress, genesisTxSignature, replaySolanaAttestation }) {
  const profile = db.profiles.get(profileId);
  assert(profile, 'profile must exist');

  profile.verification_data.satp_v3 = {
    verified: true,
    txSignature: genesisTxSignature,
  };

  const solanaVerification = db.verifications.find(
    (row) => row.profile_id === profileId && row.platform === 'solana'
  );
  assert(solanaVerification, 'solana verification row must exist');

  if (!solanaVerification.proof.txSignature) {
    const replay = await replaySolanaAttestation(profileId, walletAddress, genesisTxSignature);
    if (!replay || !replay.txSignature) {
      throw new Error('Solana attestation replay failed');
    }

    solanaVerification.proof = {
      ...solanaVerification.proof,
      txSignature: replay.txSignature,
      replayedAfterGenesis: true,
    };

    profile.verification_data.solana = {
      verified: true,
      address: walletAddress,
      txSignature: replay.txSignature,
    };

    return { ok: true, solanaAttestation: { ok: true, txSignature: replay.txSignature } };
  }

  return { ok: true, solanaAttestation: { ok: true, skipped: true, txSignature: solanaVerification.proof.txSignature } };
}

async function testSuccessPath() {
  const db = createMockDb();
  const profileId = 'local_autotest';
  const walletAddress = 'MockWallet1111111111111111111111111111111111';
  registerSimple(db, { profileId, walletAddress });

  const result = await confirmSatpIdentity(db, {
    profileId,
    walletAddress,
    genesisTxSignature: 'genesis_tx_mock',
    replaySolanaAttestation: async () => ({ txSignature: 'solana_tx_mock' }),
  });

  assert.equal(result.solanaAttestation.ok, true);
  assert.equal(db.profiles.get(profileId).verification_data.satp_v3.txSignature, 'genesis_tx_mock');
  assert.equal(db.profiles.get(profileId).verification_data.solana.txSignature, 'solana_tx_mock');
  assert.equal(db.verifications[0].proof.replayedAfterGenesis, true);
}

async function testReplayFailureBubbles() {
  const db = createMockDb();
  const profileId = 'local_autotest_fail';
  const walletAddress = 'MockWallet2222222222222222222222222222222222';
  registerSimple(db, { profileId, walletAddress });

  let failed = false;
  try {
    await confirmSatpIdentity(db, {
      profileId,
      walletAddress,
      genesisTxSignature: 'genesis_tx_mock',
      replaySolanaAttestation: async () => null,
    });
  } catch (err) {
    failed = true;
    assert.match(String(err.message), /replay failed/i);
  }
  assert.equal(failed, true, 'confirm must fail loudly when Solana replay fails');
}

async function main() {
  assert.equal(process.env.API_BASE || '', '', 'Harness must not target any live API');
  await testSuccessPath();
  await testReplayFailureBubbles();
  console.log('PASS registration-flow-mock-harness');
}

main().catch((err) => {
  console.error('FAIL registration-flow-mock-harness');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
