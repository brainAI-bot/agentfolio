const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const express = require('express');
const nacl = require('tweetnacl');
const bs58Module = require('bs58');
const { Keypair } = require('@solana/web3.js');

const { writeJsonAtomicSync } = require('../src/lib/atomic-file');

const repoRoot = path.resolve(__dirname, '..');
const bs58 = bs58Module.default || bs58Module;

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

function writeFixtureJSON(root, kind, id, value) {
  const dir = path.join(root, kind);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(value, null, 2));
}

function readFixtureJSON(root, kind, id) {
  return JSON.parse(fs.readFileSync(path.join(root, kind, `${id}.json`), 'utf8'));
}

function makeProfileStoreStub(rows) {
  return {
    addActivity() {},
    getDb() {
      return {
        prepare(sql) {
          return {
            get(value) {
              if (/LOWER\(name\)/.test(sql)) {
                return rows.find((row) => String(row.name || '').toLowerCase() === String(value).toLowerCase()) || null;
              }
              return rows.find((row) => row.id === value) || null;
            },
            all() {
              return rows;
            },
          };
        },
      };
    },
  };
}

function freshMarketplace(dataDir, profiles) {
  const marketplacePath = require.resolve('../src/marketplace');
  const profileStorePath = require.resolve('../src/profile-store');
  const previousDataDir = process.env.MARKETPLACE_DATA_DIR;
  const previousMarketplace = require.cache[marketplacePath];
  const previousProfileStore = require.cache[profileStorePath];

  process.env.MARKETPLACE_DATA_DIR = dataDir;
  delete require.cache[marketplacePath];
  require.cache[profileStorePath] = {
    id: profileStorePath,
    filename: profileStorePath,
    loaded: true,
    exports: makeProfileStoreStub(profiles),
  };

  const marketplace = require('../src/marketplace');

  function restore() {
    delete require.cache[marketplacePath];
    if (previousMarketplace) require.cache[marketplacePath] = previousMarketplace;
    if (previousProfileStore) require.cache[profileStorePath] = previousProfileStore;
    else delete require.cache[profileStorePath];
    if (previousDataDir === undefined) delete process.env.MARKETPLACE_DATA_DIR;
    else process.env.MARKETPLACE_DATA_DIR = previousDataDir;
  }

  return { marketplace, restore };
}

function signedChallenge(marketplace, keypair, { action, resourceId, actorId, identityPDA }) {
  const walletAddress = keypair.publicKey.toBase58();
  const message = marketplace.buildMarketplaceWalletChallenge({
    action,
    resourceId,
    actorId,
    walletAddress,
    identityPDA,
  });
  return {
    walletAddress,
    identityPDA,
    message,
    signature: bs58.encode(nacl.sign.detached(Buffer.from(message, 'utf8'), keypair.secretKey)),
  };
}

async function postJSON(baseUrl, route, body) {
  const res = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('AF2: how-it-works exposes non-empty SATP mainnet program ids', () => {
  const programsSource = fs.readFileSync(
    path.join(repoRoot, 'frontend/src/lib/satp-mainnet-programs.ts'),
    'utf8'
  );
  const pageSource = fs.readFileSync(
    path.join(repoRoot, 'frontend/src/app/how-it-works/page.tsx'),
    'utf8'
  );

  const addresses = [...programsSource.matchAll(/: "([^"]+)"/g)].map((match) => match[1]);
  assert.equal(addresses.length, 6);
  for (const address of addresses) {
    assert.match(address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  }
  assert.match(pageSource, /SATP_MAINNET_PROGRAMS/);
  assert.match(pageSource, /explorer\.solana\.com\/address/);
  assert.doesNotMatch(pageSource, /BY4jzmnr|TQ4P9R2Y|AdDWFa9o/);
});

test('AF14: displayed SATP IDs preserve V3 and registration program provenance', () => {
  const canonicalDocsSurfaces = [
    'frontend/src/app/docs/page.tsx',
    'frontend/src/app/how-it-works/page.tsx',
  ];

  for (const surface of canonicalDocsSurfaces) {
    const source = fs.readFileSync(path.join(repoRoot, surface), 'utf8');
    assert.match(source, /SATP_MAINNET_PROGRAMS/, `${surface} must source displayed IDs from the verified registry`);
    assert.match(source, /SATP_MAINNET_REGISTRATION_PROGRAM_ID/, `${surface} must label the live registration program separately`);
    assert.match(source, /V3 (Identity Cluster|IDENTITY CLUSTER)/, `${surface} must distinguish the V3 identity cluster from registration`);
    assert.doesNotMatch(source, /BY4jzmnr|TQ4P9R2Y|AdDWFa9o/, `${surface} must not display retired docs program IDs`);
  }

  const registrySource = fs.readFileSync(
    path.join(repoRoot, 'frontend/src/lib/satp-mainnet-programs.ts'),
    'utf8'
  );
  const identityRegistrySource = fs.readFileSync(
    path.join(repoRoot, 'frontend/src/lib/identity-registry.ts'),
    'utf8'
  );
  const backendRegistrySource = fs.readFileSync(
    path.join(repoRoot, 'src/lib/satp-mainnet-programs.js'),
    'utf8'
  );
  const displayedV3IdentityProgram = registrySource.match(/IDENTITY:\s*"([^"]+)"/)?.[1];
  const backendV3IdentityProgram = backendRegistrySource.match(/IDENTITY:\s*'([^']+)'/)?.[1];
  const registrationProgram = registrySource.match(/SATP_MAINNET_REGISTRATION_PROGRAM_ID\s*=\s*"([^"]+)"/)?.[1];

  assert.equal(displayedV3IdentityProgram, 'GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');
  assert.equal(backendV3IdentityProgram, displayedV3IdentityProgram);
  assert.equal(registrationProgram, 'CV5Wd9YGFX5A4dvuaFuEDuKQWp14NfnLrSdxY7EHFyeB');
  assert.notEqual(registrationProgram, displayedV3IdentityProgram);
  assert.match(
    identityRegistrySource,
    /new PublicKey\(\s*SATP_MAINNET_REGISTRATION_PROGRAM_ID\s*\)/,
    'the registration transaction must source the explicitly labeled live registration program'
  );

  for (const surface of [
    'frontend/src/app/satp/page.tsx',
    'frontend/src/app/stats/page.tsx',
  ]) {
    const source = fs.readFileSync(path.join(repoRoot, surface), 'utf8');
    assert.match(source, new RegExp(registrationProgram), `${surface} must agree with the live registration transaction path`);
  }
});

test('AF25: escrow refund authorizes before remaining fail-closed without state mutation', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-escrow-refund-auth-'));
  const client = Keypair.generate();
  const nonOwner = Keypair.generate();
  const { marketplace, restore } = freshMarketplace(dataDir, []);
  const clientIdentity = marketplace.deriveSatpIdentityPDA(client.publicKey.toBase58());
  const nonOwnerIdentity = marketplace.deriveSatpIdentityPDA(nonOwner.publicKey.toBase58());

  restore();
  const loaded = freshMarketplace(dataDir, [
    {
      id: 'client_agent',
      name: 'Client Agent',
      wallet: client.publicKey.toBase58(),
      wallets: JSON.stringify({ solana: client.publicKey.toBase58() }),
      verification_data: JSON.stringify({ solana: { verified: true, address: client.publicKey.toBase58() }, satp: { identityPDA: clientIdentity } }),
    },
    {
      id: 'other_agent',
      name: 'Other Agent',
      wallet: nonOwner.publicKey.toBase58(),
      wallets: JSON.stringify({ solana: nonOwner.publicKey.toBase58() }),
      verification_data: JSON.stringify({ solana: { verified: true, address: nonOwner.publicKey.toBase58() }, satp: { identityPDA: nonOwnerIdentity } }),
    },
  ]);

  writeFixtureJSON(dataDir, 'jobs', 'job_refund_auth', {
    id: 'job_refund_auth',
    status: 'in_progress',
    postedBy: 'client_agent',
    clientId: 'client_agent',
    escrowId: 'escrow_refund_auth',
  });
  writeFixtureJSON(dataDir, 'escrow', 'escrow_refund_auth', {
    id: 'escrow_refund_auth',
    jobId: 'job_refund_auth',
    status: 'funded',
    fundedBy: 'client_agent',
    workerPayout: 90,
    platformFee: 10,
  });

  const app = express();
  app.use(express.json());
  loaded.marketplace.registerRoutes(app);
  const server = await listen(app);

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const unsigned = await postJSON(baseUrl, '/api/marketplace/escrow/escrow_refund_auth/refund', {
      refundedBy: 'client_agent',
      reason: 'body-only refund',
    });
    assert.equal(unsigned.status, 401);
    assert.equal(unsigned.body.code, 'MARKETPLACE_WALLET_CHALLENGE_REQUIRED');
    assert.equal(readFixtureJSON(dataDir, 'escrow', 'escrow_refund_auth').status, 'funded');
    assert.equal(readFixtureJSON(dataDir, 'jobs', 'job_refund_auth').status, 'in_progress');

    const signedNonOwner = await postJSON(baseUrl, '/api/marketplace/escrow/escrow_refund_auth/refund', {
      refundedBy: 'other_agent',
      reason: 'signed non-owner refund',
      walletChallenge: signedChallenge(loaded.marketplace, nonOwner, {
        action: 'refund',
        resourceId: 'escrow_refund_auth',
        actorId: 'other_agent',
        identityPDA: nonOwnerIdentity,
      }),
    });
    assert.equal(signedNonOwner.status, 403);
    assert.equal(readFixtureJSON(dataDir, 'escrow', 'escrow_refund_auth').status, 'funded');
    assert.equal(readFixtureJSON(dataDir, 'jobs', 'job_refund_auth').status, 'in_progress');

    const signedOwner = await postJSON(baseUrl, '/api/marketplace/escrow/escrow_refund_auth/refund', {
      refundedBy: 'client_agent',
      reason: 'signed owner refund',
      walletChallenge: signedChallenge(loaded.marketplace, client, {
        action: 'refund',
        resourceId: 'escrow_refund_auth',
        actorId: 'client_agent',
        identityPDA: clientIdentity,
      }),
    });
    assert.equal(signedOwner.status, 423);
    assert.equal(signedOwner.body.code, 'CUSTODIAL_ESCROW_DISABLED');
    assert.equal(readFixtureJSON(dataDir, 'escrow', 'escrow_refund_auth').status, 'funded');
    assert.equal(readFixtureJSON(dataDir, 'jobs', 'job_refund_auth').status, 'in_progress');
  } finally {
    await close(server);
    loaded.restore();
  }
});

test('AF25: refund route keeps limiter, auth, actor check, and custodial gate before writes', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'src/marketplace.js'), 'utf8');
  const routeStart = source.indexOf("app.post('/api/marketplace/escrow/:id/refund', marketplaceMutationLimiter");
  assert.notEqual(routeStart, -1);
  const routeEnd = source.indexOf("app.post('/api/marketplace/jobs/:id/complete'", routeStart);
  assert.notEqual(routeEnd, -1);
  const routeSource = source.slice(routeStart, routeEnd);

  assert.match(routeSource, /sendCustodialEscrowDisabledResponse\(res, 'legacy marketplace custodial escrow refund'\)/);
  assert.match(routeSource, /verifyMarketplaceMutationSignature\(\{\s*action: 'refund'/);
  assert.match(routeSource, /refundedBy !== job\.postedBy && refundedBy !== job\.clientId/);

  const gateIndex = routeSource.indexOf('sendCustodialEscrowDisabledResponse');
  const authIndex = routeSource.indexOf('verifyMarketplaceMutationSignature');
  const actorIndex = routeSource.indexOf('refundedBy !== job.postedBy');
  const writeIndex = routeSource.indexOf('writeJSON(escrowPath, escrow)');
  assert.ok(authIndex < actorIndex);
  assert.ok(actorIndex < gateIndex);
  assert.ok(gateIndex < writeIndex);
});

test('AF8: JSON state writes use atomic temp-write and rename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-atomic-write-'));
  const target = path.join(dir, 'state.json');
  writeJsonAtomicSync(target, { ok: true, nested: { count: 1 } }, { baseDir: dir });

  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), {
    ok: true,
    nested: { count: 1 },
  });
  assert.deepEqual(fs.readdirSync(dir), ['state.json']);
  assert.throws(
    () => writeJsonAtomicSync(path.join(dir, '..', 'escape.json'), { ok: false }, { baseDir: dir }),
    /escapes baseDir/
  );
});

test('AF8: server registers process crash and shutdown handlers', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'src/server.js'), 'utf8');
  assert.match(source, /process\.on\('SIGTERM'/);
  assert.match(source, /process\.on\('uncaughtException'/);
  assert.match(source, /process\.on\('unhandledRejection'/);
  assert.match(source, /server\.close/);
  assert.match(source, /profileStore\.closeDb/);
});

test('AF9 and AF13: tracked backup artifacts are absent from repo surface', () => {
  const tracked = execFileSync('git', ['ls-files'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim().split('\n').filter(Boolean);

  const backupArtifacts = tracked.filter((file) => {
    if (file === 'scripts/admin/daily-db-backup.sh') return false;
    return /(^|\/)archive\/.*\.bak\d*$/.test(file)
      || /\.bak\d*$/.test(file)
      || /\.backup($|-)/.test(file)
      || /backup-before/.test(file)
      || /candy-machine-state-backup-/.test(file);
  });

  assert.deepEqual(backupArtifacts, []);
});

test('AF6 and AF10: CI-on-merge workflow runs explicit PR and main-branch merge gates', () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/ci-on-merge.yml'),
    'utf8'
  );

  assert.match(workflow, /^name: AgentFolio CI On Merge$/m);
  assert.match(workflow, /^\s{2}pull_request:$/m);
  assert.match(workflow, /^\s{2}push:\n\s{4}branches:\n\s{6}- main\n\s{6}- master$/m);
  assert.match(workflow, /^\s{2}workflow_dispatch:$/m);
  assert.match(workflow, /name: AF6 AF10 merge gate/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run lint:roadmap/);
  assert.match(workflow, /npm run verify:satp-mainnet-programs/);
  assert.match(workflow, /node --test tests\/deepaudit-af-surface-remediation\.test\.js tests\/satp-programs-v3-truth\.test\.js tests\/escrow-release-gate\.test\.js tests\/escrow-v3-authority\.test\.js/);
  assert.match(workflow, /git diff --check/);
});
