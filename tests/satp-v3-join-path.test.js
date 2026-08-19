const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('SATP V3 join path is mounted and client-signed', () => {
  it('mounts registerSATPAutoIdentityV3Routes from server.js', () => {
    const server = read('src/server.js');
    assert.match(server, /registerSATPAutoIdentityV3Routes/);
    assert.match(server, /require\('\.\/routes\/satp-auto-identity-v3'\)/);
    assert.match(server, /registerSATPAutoIdentityV3Routes\(app\)/);
    assert.doesNotMatch(server, /registerRestoredRoutes\(app\)/);
  });

  it('registers V3 create, confirm, and check routes', () => {
    const source = read('src/routes/satp-auto-identity-v3.js');
    assert.match(source, /app\.post\('\/api\/satp-auto\/v3\/identity\/create'/);
    assert.match(source, /app\.post\('\/api\/satp-auto\/v3\/identity\/confirm'/);
    assert.match(source, /app\.get\('\/api\/satp-auto\/v3\/identity\/check\/:agentId'/);
    assert.match(source, /SATP_V3_IDENTITY_PROGRAM = new PublicKey\('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG'\)/);
    assert.match(source, /evaluateV3JoinConfirm/);
    assert.doesNotMatch(source, /This legacy V3 confirm route is disabled/);
  });

  it('does not put unsigned SATP identity or genesis build behind the Irys gate', () => {
    const v3 = read('src/routes/satp-auto-identity-v3.js');
    const writeApi = read('src/routes/satp-write-api.js');
    const profileStore = read('src/profile-store.js');
    const writeClient = read('src/satp-write-client.js');

    assert.doesNotMatch(v3, /sendSolanaIrysWriteGateResponse/);
    assert.doesNotMatch(v3, /assertSolanaIrysWriteEnabled/);

    const buildFn = writeApi.split("app.post('/api/satp/register/build'")[1].split("app.post(")[0];
    assert.doesNotMatch(buildFn, /sendSolanaIrysWriteGateResponse/);

    const prepareFn = profileStore.split("app.post('/api/satp/genesis/prepare'")[1].split("app.get('/api/profiles'")[0];
    assert.doesNotMatch(prepareFn, /sendSolanaIrysWriteGateResponse/);
    assert.doesNotMatch(prepareFn, /partialSign\(deployer\)/);
    assert.match(prepareFn, /buildCreateIdentityV3Tx/);

    assert.doesNotMatch(writeClient, /assertSolanaIrysWriteEnabled\('SATP identity registration transaction build'\)/);
    assert.doesNotMatch(writeClient, /assertSolanaIrysWriteEnabled\('SATP V3 genesis transaction build'\)/);
  });

  it('keeps server-signed SATP register, escrow, and BOA writes gated', () => {
    const writeApi = read('src/routes/satp-write-api.js');
    const registerFn = writeApi.split("app.post('/api/satp/register'")[1].split("app.post('/api/satp/register/build'")[0];
    assert.match(registerFn, /sendSolanaIrysWriteGateResponse/);

    const escrow = read('src/routes/escrow-v3-routes.js');
    assert.match(escrow, /sendLiveEscrowGateResponse/);

    const boa = read('src/routes/burn-to-become-public.js');
    assert.match(boa, /sendBoaWriteGateResponse/);
  });

  it('frontend auto-create uses V3 routes and GTpp program, not V2 97yL33', () => {
    const verify = read('frontend/src/app/verify/page.tsx');
    const register = read('frontend/src/app/register/page.tsx');
    const v3 = read('frontend/src/lib/satp-identity-v3.ts');

    assert.match(verify, /satp-identity-v3/);
    assert.match(verify, /autoCreateSatpIdentityV3/);
    assert.doesNotMatch(verify, /satp-identity-v2/);
    assert.doesNotMatch(verify, /97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq/);
    assert.doesNotMatch(verify, /\/api\/satp-auto\/identity\/confirm/);
    assert.doesNotMatch(verify, /frontend SATP identity auto-create/);
    assert.doesNotMatch(verify, /frontend manual SATP identity registration/);

    assert.match(register, /autoCreateSatpIdentityV3/);
    assert.doesNotMatch(register, /\/api\/satp-auto\/identity\/create/);
    assert.doesNotMatch(register, /assertFrontendSolanaIrysWriteEnabled/);

    assert.match(v3, /GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG|SATP_MAINNET_PROGRAMS\.IDENTITY/);
    assert.match(v3, /\/api\/satp-auto\/v3\/identity\/create/);
    assert.match(v3, /\/api\/satp-auto\/v3\/identity\/confirm/);
    assert.doesNotMatch(v3, /assertFrontendSolanaIrysWriteEnabled/);
    assert.doesNotMatch(v3, /97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq/);
  });
});

describe('V3 join confirm policy', () => {
  const { evaluateV3JoinConfirm, getProfileSolanaWallet } = require('../src/lib/satp-v3-join');

  it('rejects missing wallet, missing profile, missing on-chain genesis, and wallet mismatch', () => {
    assert.equal(evaluateV3JoinConfirm({ profile: { id: 'p1reg' }, onChainAccountExists: true, walletAddress: '' }).status, 400);
    assert.equal(evaluateV3JoinConfirm({ profile: null, onChainAccountExists: true, walletAddress: 'Wallet1' }).status, 404);
    assert.equal(evaluateV3JoinConfirm({ profile: { id: 'p1reg' }, onChainAccountExists: false, walletAddress: 'Wallet1' }).status, 409);
    assert.equal(evaluateV3JoinConfirm({
      profile: { id: 'p1reg', wallet: 'WalletStored' },
      onChainAccountExists: true,
      walletAddress: 'WalletOther',
    }).status, 403);
  });

  it('allows confirm for a real profile whose V3 PDA exists and wallet matches or is unset', () => {
    assert.equal(evaluateV3JoinConfirm({
      profile: { id: 'p1reg', wallet: 'Wallet1' },
      onChainAccountExists: true,
      walletAddress: 'Wallet1',
    }).ok, true);
    assert.equal(evaluateV3JoinConfirm({
      profile: { id: 'p1reg' },
      onChainAccountExists: true,
      walletAddress: 'Wallet1',
    }).ok, true);
    assert.equal(getProfileSolanaWallet({ wallets: JSON.stringify({ solana: 'Abc' }) }), 'Abc');
  });
});
