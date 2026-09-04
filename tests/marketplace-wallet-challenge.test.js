const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const nacl = require('tweetnacl');
const bs58Module = require('bs58');
const { Keypair } = require('@solana/web3.js');

const bs58 = bs58Module.default || bs58Module;

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

function writeJSON(root, kind, id, value) {
  const dir = path.join(root, kind);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(value, null, 2));
}

function readJSON(root, kind, id) {
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

function freshMarketplace(dataDir, profiles, overrides = {}) {
  const marketplacePath = require.resolve('../src/marketplace');
  const profileStorePath = require.resolve('../src/profile-store');
  const atomicFilePath = require.resolve('../src/lib/atomic-file');
  const previousDataDir = process.env.MARKETPLACE_DATA_DIR;
  const previousMarketplace = require.cache[marketplacePath];
  const previousProfileStore = require.cache[profileStorePath];
  const previousAtomicFile = require.cache[atomicFilePath];

  process.env.MARKETPLACE_DATA_DIR = dataDir;
  delete require.cache[marketplacePath];
  require.cache[profileStorePath] = {
    id: profileStorePath,
    filename: profileStorePath,
    loaded: true,
    exports: makeProfileStoreStub(profiles),
  };
  if (overrides.writeJsonAtomicSync) {
    const atomicFile = require(atomicFilePath);
    require.cache[atomicFilePath] = {
      ...require.cache[atomicFilePath],
      exports: { ...atomicFile, writeJsonAtomicSync: overrides.writeJsonAtomicSync },
    };
  }

  const marketplace = require('../src/marketplace');

  function restore() {
    delete require.cache[marketplacePath];
    if (previousMarketplace) require.cache[marketplacePath] = previousMarketplace;
    if (previousProfileStore) require.cache[profileStorePath] = previousProfileStore;
    else delete require.cache[profileStorePath];
    if (previousAtomicFile) require.cache[atomicFilePath] = previousAtomicFile;
    else delete require.cache[atomicFilePath];
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

test('marketplace accept requires a wallet challenge bound to the client SATP identity PDA', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-marketplace-wallet-'));
  const client = Keypair.generate();
  const worker = Keypair.generate();
  const forged = Keypair.generate();
  const { marketplace, restore } = freshMarketplace(dataDir, []);
  const clientIdentity = marketplace.deriveSatpIdentityPDA(client.publicKey.toBase58());
  const workerIdentity = marketplace.deriveSatpIdentityPDA(worker.publicKey.toBase58());

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
      id: 'worker_agent',
      name: 'Worker Agent',
      wallet: worker.publicKey.toBase58(),
      wallets: JSON.stringify({ solana: worker.publicKey.toBase58() }),
      verification_data: JSON.stringify({ solana: { verified: true, address: worker.publicKey.toBase58() }, satp: { identityPDA: workerIdentity } }),
    },
  ]);

  writeJSON(dataDir, 'jobs', 'job_wallet_accept', {
    id: 'job_wallet_accept',
    status: 'open',
    postedBy: 'client_agent',
    clientId: 'client_agent',
    applications: ['app_wallet_accept'],
  });
  writeJSON(dataDir, 'applications', 'app_wallet_accept', {
    id: 'app_wallet_accept',
    jobId: 'job_wallet_accept',
    applicantId: 'worker_agent',
    status: 'pending',
  });

  const app = express();
  app.use(express.json());
  loaded.marketplace.registerRoutes(app);
  const server = await listen(app);

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const unsigned = await postJSON(baseUrl, '/api/marketplace/applications/app_wallet_accept/accept', {
      acceptedBy: 'client_agent',
    });
    assert.equal(unsigned.status, 401);
    assert.equal(unsigned.body.code, 'MARKETPLACE_WALLET_CHALLENGE_REQUIRED');

    const forgedChallenge = signedChallenge(loaded.marketplace, forged, {
      action: 'accept',
      resourceId: 'app_wallet_accept',
      actorId: 'client_agent',
      identityPDA: clientIdentity,
    });
    const forgedResponse = await postJSON(baseUrl, '/api/marketplace/applications/app_wallet_accept/accept', {
      acceptedBy: 'client_agent',
      walletChallenge: forgedChallenge,
    });
    assert.equal(forgedResponse.status, 401);

    const signed = await postJSON(baseUrl, '/api/marketplace/applications/app_wallet_accept/accept', {
      acceptedBy: 'client_agent',
      walletChallenge: signedChallenge(loaded.marketplace, client, {
        action: 'accept',
        resourceId: 'app_wallet_accept',
        actorId: 'client_agent',
        identityPDA: clientIdentity,
      }),
    });
    assert.equal(signed.status, 200);
    assert.equal(readJSON(dataDir, 'applications', 'app_wallet_accept').status, 'accepted');
    assert.equal(readJSON(dataDir, 'jobs', 'job_wallet_accept').acceptedApplicant, 'worker_agent');
  } finally {
    await close(server);
    loaded.restore();
  }
});

test('marketplace application lifecycle is authenticated, spec-shaped, and idempotent', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-marketplace-wallet-'));
  const client = Keypair.generate();
  const worker = Keypair.generate();
  const other = Keypair.generate();
  const bootstrap = freshMarketplace(dataDir, []);
  const identities = {
    client: bootstrap.marketplace.deriveSatpIdentityPDA(client.publicKey.toBase58()),
    worker: bootstrap.marketplace.deriveSatpIdentityPDA(worker.publicKey.toBase58()),
    other: bootstrap.marketplace.deriveSatpIdentityPDA(other.publicKey.toBase58()),
  };
  bootstrap.restore();

  const profile = (id, name, keypair, identityPDA) => ({
    id,
    name,
    wallet: keypair.publicKey.toBase58(),
    wallets: JSON.stringify({ solana: keypair.publicKey.toBase58() }),
    verification_data: JSON.stringify({
      solana: { verified: true, address: keypair.publicKey.toBase58() },
      satp: { identityPDA },
    }),
  });
  const loaded = freshMarketplace(dataDir, [
    profile('client_agent', 'Client Agent', client, identities.client),
    profile('worker_agent', 'Worker Agent', worker, identities.worker),
    profile('other_agent', 'Other Agent', other, identities.other),
  ]);

  writeJSON(dataDir, 'jobs', 'job_application_flow', {
    id: 'job_application_flow',
    status: 'open',
    postedBy: 'client_agent',
    clientId: 'client_agent',
    budget: 500,
    budgetAmount: 500,
    timeline: '1_week',
    applications: [],
  });

  const app = express();
  app.use(express.json());
  loaded.marketplace.registerRoutes(app);
  const server = await listen(app);

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const terms = {
      applicantId: 'worker_agent',
      coverMessage: 'I have shipped three production trading agents.',
      proposedBudget: 450,
      proposedTimeline: '5_days',
      portfolioItems: ['project_1', 'project_2'],
    };
    const unsigned = await postJSON(baseUrl, '/api/marketplace/jobs/job_application_flow/apply', terms);
    assert.equal(unsigned.status, 401);

    const walletChallenge = signedChallenge(loaded.marketplace, worker, {
      action: 'apply',
      resourceId: 'job_application_flow#0',
      actorId: 'worker_agent',
      identityPDA: identities.worker,
    });
    const created = await postJSON(baseUrl, '/api/marketplace/jobs/job_application_flow/apply', {
      ...terms,
      walletChallenge,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.agentId, 'worker_agent');
    assert.equal(created.body.coverMessage, terms.coverMessage);
    assert.equal(created.body.proposedBudget, 450);
    assert.equal(created.body.proposedTimeline, '5_days');
    assert.deepEqual(created.body.portfolioItems, ['project_1', 'project_2']);
    assert.equal(readJSON(dataDir, 'jobs', 'job_application_flow').applicationCount, 1);

    const retried = await postJSON(baseUrl, '/api/marketplace/jobs/job_application_flow/apply', {
      ...terms,
      walletChallenge,
    });
    assert.equal(retried.status, 200);
    assert.equal(retried.body.id, created.body.id);
    assert.equal(retried.body.idempotent, true);

    const conflicting = await postJSON(baseUrl, '/api/marketplace/jobs/job_application_flow/apply', {
      ...terms,
      proposedBudget: 400,
      walletChallenge,
    });
    assert.equal(conflicting.status, 409);

    const wrongActor = await postJSON(baseUrl, `/api/marketplace/applications/${created.body.id}/withdraw`, {
      withdrawnBy: 'other_agent',
      walletChallenge: signedChallenge(loaded.marketplace, other, {
        action: 'withdraw',
        resourceId: created.body.id,
        actorId: 'other_agent',
        identityPDA: identities.other,
      }),
    });
    assert.equal(wrongActor.status, 403);

    const withdrawalBody = {
      withdrawnBy: 'worker_agent',
      walletChallenge: signedChallenge(loaded.marketplace, worker, {
        action: 'withdraw',
        resourceId: created.body.id,
        actorId: 'worker_agent',
        identityPDA: identities.worker,
      }),
    };
    const withdrawn = await postJSON(baseUrl, `/api/marketplace/applications/${created.body.id}/withdraw`, withdrawalBody);
    assert.equal(withdrawn.status, 200);
    assert.equal(withdrawn.body.status, 'withdrawn');

    const withdrawalRetry = await postJSON(baseUrl, `/api/marketplace/applications/${created.body.id}/withdraw`, withdrawalBody);
    assert.equal(withdrawalRetry.status, 200);
    assert.equal(withdrawalRetry.body.idempotent, true);

    const jobAfterWithdrawal = readJSON(dataDir, 'jobs', 'job_application_flow');
    assert.deepEqual(jobAfterWithdrawal.applications, []);
    assert.equal(jobAfterWithdrawal.applicationCount, 0);
    assert.equal(jobAfterWithdrawal.applyChallengeRevisions.worker_agent, 1);

    const staleReplay = await postJSON(baseUrl, '/api/marketplace/jobs/job_application_flow/apply', {
      ...terms,
      walletChallenge,
    });
    assert.equal(staleReplay.status, 401);
    assert.match(staleReplay.body.error, /message mismatch/);
    assert.deepEqual(readJSON(dataDir, 'jobs', 'job_application_flow').applications, []);

    const freshWalletChallenge = signedChallenge(loaded.marketplace, worker, {
      action: 'apply',
      resourceId: 'job_application_flow#1',
      actorId: 'worker_agent',
      identityPDA: identities.worker,
    });
    const reapplied = await postJSON(baseUrl, '/api/marketplace/jobs/job_application_flow/apply', {
      ...terms,
      walletChallenge: freshWalletChallenge,
    });
    assert.equal(reapplied.status, 201);
    assert.notEqual(reapplied.body.id, created.body.id);
    const jobAfterReapply = readJSON(dataDir, 'jobs', 'job_application_flow');
    assert.deepEqual(jobAfterReapply.applications, [reapplied.body.id]);
    assert.equal(jobAfterReapply.applicationCount, 1);
    assert.equal(readJSON(dataDir, 'applications', created.body.id).status, 'withdrawn');
  } finally {
    await close(server);
    loaded.restore();
  }
});

test('withdrawal revocation survives a second-write failure and remains actor-scoped', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-marketplace-wallet-'));
  const client = Keypair.generate();
  const worker = Keypair.generate();
  const other = Keypair.generate();
  const bootstrap = freshMarketplace(dataDir, []);
  const identities = {
    client: bootstrap.marketplace.deriveSatpIdentityPDA(client.publicKey.toBase58()),
    worker: bootstrap.marketplace.deriveSatpIdentityPDA(worker.publicKey.toBase58()),
    other: bootstrap.marketplace.deriveSatpIdentityPDA(other.publicKey.toBase58()),
  };
  bootstrap.restore();

  const profile = (id, name, keypair, identityPDA) => ({
    id,
    name,
    wallet: keypair.publicKey.toBase58(),
    wallets: JSON.stringify({ solana: keypair.publicKey.toBase58() }),
    verification_data: JSON.stringify({
      solana: { verified: true, address: keypair.publicKey.toBase58() },
      satp: { identityPDA },
    }),
  });
  const atomicFile = require('../src/lib/atomic-file');
  let failPath = null;
  let failNextWrite = false;
  const loaded = freshMarketplace(dataDir, [
    profile('client_agent', 'Client Agent', client, identities.client),
    profile('worker_agent', 'Worker Agent', worker, identities.worker),
    profile('other_agent', 'Other Agent', other, identities.other),
  ], {
    writeJsonAtomicSync(filePath, value, options) {
      if (failNextWrite && filePath === failPath) {
        failNextWrite = false;
        throw new Error('injected application write failure');
      }
      return atomicFile.writeJsonAtomicSync(filePath, value, options);
    },
  });

  writeJSON(dataDir, 'jobs', 'job_failure_atomic', {
    id: 'job_failure_atomic',
    status: 'open',
    postedBy: 'client_agent',
    clientId: 'client_agent',
    budget: 500,
    applications: [],
  });

  const app = express();
  app.use(express.json());
  loaded.marketplace.registerRoutes(app);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  const server = await listen(app);

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const workerTerms = {
      applicantId: 'worker_agent',
      coverMessage: 'I can deliver the requested production integration.',
      proposedBudget: 450,
      proposedTimeline: '5_days',
      portfolioItems: ['project_1'],
    };
    const workerApplyChallenge = signedChallenge(loaded.marketplace, worker, {
      action: 'apply',
      resourceId: 'job_failure_atomic#0',
      actorId: 'worker_agent',
      identityPDA: identities.worker,
    });
    const otherApplyChallenge = signedChallenge(loaded.marketplace, other, {
      action: 'apply',
      resourceId: 'job_failure_atomic#0',
      actorId: 'other_agent',
      identityPDA: identities.other,
    });
    const created = await postJSON(baseUrl, '/api/marketplace/jobs/job_failure_atomic/apply', {
      ...workerTerms,
      walletChallenge: workerApplyChallenge,
    });
    assert.equal(created.status, 201);

    const withdrawalBody = {
      withdrawnBy: 'worker_agent',
      walletChallenge: signedChallenge(loaded.marketplace, worker, {
        action: 'withdraw',
        resourceId: created.body.id,
        actorId: 'worker_agent',
        identityPDA: identities.worker,
      }),
    };
    failPath = path.join(dataDir, 'applications', `${created.body.id}.json`);
    failNextWrite = true;
    const failedWithdrawal = await postJSON(
      baseUrl,
      `/api/marketplace/applications/${created.body.id}/withdraw`,
      withdrawalBody,
    );
    assert.equal(failedWithdrawal.status, 500);

    const jobAfterFailure = readJSON(dataDir, 'jobs', 'job_failure_atomic');
    assert.deepEqual(jobAfterFailure.applications, []);
    assert.equal(jobAfterFailure.applicationCount, 0);
    assert.equal(jobAfterFailure.applyChallengeRevisions.worker_agent, 1);
    assert.equal(jobAfterFailure.applyChallengeRevisions.other_agent, undefined);
    assert.equal(jobAfterFailure.withdrawalTombstones[created.body.id].applicantId, 'worker_agent');
    assert.equal(readJSON(dataDir, 'applications', created.body.id).status, 'pending');

    const staleReplay = await postJSON(baseUrl, '/api/marketplace/jobs/job_failure_atomic/apply', {
      ...workerTerms,
      walletChallenge: workerApplyChallenge,
    });
    assert.equal(staleReplay.status, 401);
    assert.match(staleReplay.body.error, /message mismatch/);

    const acceptAfterPartialWithdrawal = await postJSON(
      baseUrl,
      `/api/marketplace/applications/${created.body.id}/accept`,
      { acceptedBy: 'client_agent' },
    );
    assert.equal(acceptAfterPartialWithdrawal.status, 409);
    assert.match(acceptAfterPartialWithdrawal.body.error, /withdrawn/);

    const otherApplied = await postJSON(baseUrl, '/api/marketplace/jobs/job_failure_atomic/apply', {
      ...workerTerms,
      applicantId: 'other_agent',
      walletChallenge: otherApplyChallenge,
    });
    assert.equal(otherApplied.status, 201);

    const repairedWithdrawal = await postJSON(
      baseUrl,
      `/api/marketplace/applications/${created.body.id}/withdraw`,
      withdrawalBody,
    );
    assert.equal(repairedWithdrawal.status, 200);
    assert.equal(repairedWithdrawal.body.status, 'withdrawn');
    assert.equal(repairedWithdrawal.body.idempotent, true);
    assert.equal(readJSON(dataDir, 'jobs', 'job_failure_atomic').applyChallengeRevisions.worker_agent, 1);

    const freshWorkerChallenge = signedChallenge(loaded.marketplace, worker, {
      action: 'apply',
      resourceId: 'job_failure_atomic#1',
      actorId: 'worker_agent',
      identityPDA: identities.worker,
    });
    const reapplied = await postJSON(baseUrl, '/api/marketplace/jobs/job_failure_atomic/apply', {
      ...workerTerms,
      walletChallenge: freshWorkerChallenge,
    });
    assert.equal(reapplied.status, 201);
    assert.notEqual(reapplied.body.id, created.body.id);
  } finally {
    await close(server);
    loaded.restore();
  }
});

test('marketplace application rejects invalid payloads and invalid withdraw transitions', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-marketplace-wallet-'));
  const worker = Keypair.generate();
  const bootstrap = freshMarketplace(dataDir, []);
  const workerIdentity = bootstrap.marketplace.deriveSatpIdentityPDA(worker.publicKey.toBase58());
  bootstrap.restore();
  const loaded = freshMarketplace(dataDir, [{
    id: 'worker_agent',
    name: 'Worker Agent',
    wallet: worker.publicKey.toBase58(),
    wallets: JSON.stringify({ solana: worker.publicKey.toBase58() }),
    verification_data: JSON.stringify({ solana: { verified: true }, satp: { identityPDA: workerIdentity } }),
  }]);
  writeJSON(dataDir, 'jobs', 'job_invalid_application', {
    id: 'job_invalid_application', status: 'open', postedBy: 'client_agent', clientId: 'client_agent',
    budget: 500, timeline: '1_week', applications: [],
  });
  writeJSON(dataDir, 'applications', 'app_already_accepted', {
    id: 'app_already_accepted', jobId: 'job_invalid_application', applicantId: 'worker_agent', status: 'accepted',
  });
  writeJSON(dataDir, 'jobs', 'job_corrupt_application_index', {
    id: 'job_corrupt_application_index', status: 'open', postedBy: 'client_agent', clientId: 'client_agent',
    budget: 500, timeline: '1_week', applications: [{ id: 'legacy_embedded_record' }],
  });

  const app = express();
  app.use(express.json());
  loaded.marketplace.registerRoutes(app);
  const server = await listen(app);
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const applyChallenge = signedChallenge(loaded.marketplace, worker, {
      action: 'apply', resourceId: 'job_invalid_application#0', actorId: 'worker_agent', identityPDA: workerIdentity,
    });
    const invalid = await postJSON(baseUrl, '/api/marketplace/jobs/job_invalid_application/apply', {
      applicantId: 'worker_agent', coverMessage: 'short', proposedBudget: -1,
      portfolioItems: 'not-an-array', walletChallenge: applyChallenge,
    });
    assert.equal(invalid.status, 400);
    assert.match(invalid.body.error, /coverMessage/);

    const corruptIndex = await postJSON(baseUrl, '/api/marketplace/jobs/job_corrupt_application_index/apply', {
      applicantId: 'worker_agent',
      coverMessage: 'A valid proposal must not write through corrupt state.',
      proposedBudget: 450,
      proposedTimeline: '1_week',
      portfolioItems: [],
      walletChallenge: signedChallenge(loaded.marketplace, worker, {
        action: 'apply', resourceId: 'job_corrupt_application_index#0', actorId: 'worker_agent', identityPDA: workerIdentity,
      }),
    });
    assert.equal(corruptIndex.status, 409);
    assert.match(corruptIndex.body.error, /index is invalid/);
    assert.equal(readJSON(dataDir, 'jobs', 'job_corrupt_application_index').applications.length, 1);

    const invalidTransition = await postJSON(baseUrl, '/api/marketplace/applications/app_already_accepted/withdraw', {
      withdrawnBy: 'worker_agent',
      walletChallenge: signedChallenge(loaded.marketplace, worker, {
        action: 'withdraw', resourceId: 'app_already_accepted', actorId: 'worker_agent', identityPDA: workerIdentity,
      }),
    });
    assert.equal(invalidTransition.status, 409);
    assert.match(invalidTransition.body.error, /accepted/);
  } finally {
    await close(server);
    loaded.restore();
  }
});

test('marketplace deliver and release reject body-claimed identities and accept signed actors', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-marketplace-wallet-'));
  const client = Keypair.generate();
  const worker = Keypair.generate();
  const { marketplace, restore } = freshMarketplace(dataDir, []);
  const clientIdentity = marketplace.deriveSatpIdentityPDA(client.publicKey.toBase58());
  const workerIdentity = marketplace.deriveSatpIdentityPDA(worker.publicKey.toBase58());

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
      id: 'worker_agent',
      name: 'Worker Agent',
      wallet: worker.publicKey.toBase58(),
      wallets: JSON.stringify({ solana: worker.publicKey.toBase58() }),
      verification_data: JSON.stringify({ solana: { verified: true, address: worker.publicKey.toBase58() }, satp: { identityPDA: workerIdentity } }),
    },
  ]);

  writeJSON(dataDir, 'jobs', 'job_wallet_flow', {
    id: 'job_wallet_flow',
    status: 'in_progress',
    postedBy: 'client_agent',
    clientId: 'client_agent',
    acceptedApplicant: 'worker_agent',
    applications: [],
  });

  const app = express();
  app.use(express.json());
  loaded.marketplace.registerRoutes(app);
  const server = await listen(app);

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const forgedDeliver = await postJSON(baseUrl, '/api/marketplace/jobs/job_wallet_flow/deliver', {
      submittedBy: 'worker_agent',
      description: 'body-only delivery',
    });
    assert.equal(forgedDeliver.status, 401);

    const deliver = await postJSON(baseUrl, '/api/marketplace/jobs/job_wallet_flow/deliver', {
      submittedBy: 'worker_agent',
      description: 'signed delivery',
      walletChallenge: signedChallenge(loaded.marketplace, worker, {
        action: 'deliver',
        resourceId: 'job_wallet_flow',
        actorId: 'worker_agent',
        identityPDA: workerIdentity,
      }),
    });
    assert.equal(deliver.status, 201);
    assert.equal(readJSON(dataDir, 'deliverables', deliver.body.id).submittedBy, 'worker_agent');

    const forgedRelease = await postJSON(baseUrl, '/api/marketplace/jobs/job_wallet_flow/complete', {
      approvedBy: 'client_agent',
      completionNote: 'body-only release',
    });
    assert.equal(forgedRelease.status, 401);

    const release = await postJSON(baseUrl, '/api/marketplace/jobs/job_wallet_flow/complete', {
      approvedBy: 'client_agent',
      completionNote: 'signed release',
      walletChallenge: signedChallenge(loaded.marketplace, client, {
        action: 'release',
        resourceId: 'job_wallet_flow',
        actorId: 'client_agent',
        identityPDA: clientIdentity,
      }),
    });
    assert.equal(release.status, 200);
    assert.equal(readJSON(dataDir, 'jobs', 'job_wallet_flow').status, 'completed');
  } finally {
    await close(server);
    loaded.restore();
  }
});

test('legacy escrow release checks signed actor challenges when a release actor is claimed', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-marketplace-wallet-'));
  const client = Keypair.generate();
  const { marketplace, restore } = freshMarketplace(dataDir, []);
  const clientIdentity = marketplace.deriveSatpIdentityPDA(client.publicKey.toBase58());

  restore();
  const loaded = freshMarketplace(dataDir, [
    {
      id: 'client_agent',
      name: 'Client Agent',
      wallet: client.publicKey.toBase58(),
      wallets: JSON.stringify({ solana: client.publicKey.toBase58() }),
      verification_data: JSON.stringify({ solana: { verified: true, address: client.publicKey.toBase58() }, satp: { identityPDA: clientIdentity } }),
    },
  ]);

  const app = express();
  app.use(express.json());
  loaded.marketplace.registerRoutes(app);
  const server = await listen(app);

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const bodyOnly = await postJSON(baseUrl, '/api/marketplace/escrow/escrow_wallet_release/release', {
      releasedBy: 'client_agent',
    });
    assert.equal(bodyOnly.status, 401);

    const noActor = await postJSON(baseUrl, '/api/marketplace/escrow/escrow_wallet_release/release', {});
    assert.equal(noActor.status, 423);
  } finally {
    await close(server);
    loaded.restore();
  }
});

test('AF17/AF23 escrow funding routes require signed actor auth before paused 423 gate', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-marketplace-wallet-'));
  const client = Keypair.generate();
  const { marketplace, restore } = freshMarketplace(dataDir, []);
  const clientIdentity = marketplace.deriveSatpIdentityPDA(client.publicKey.toBase58());

  restore();
  const loaded = freshMarketplace(dataDir, [
    {
      id: 'client_agent',
      name: 'Client Agent',
      wallet: client.publicKey.toBase58(),
      wallets: JSON.stringify({ solana: client.publicKey.toBase58() }),
      verification_data: JSON.stringify({ solana: { verified: true, address: client.publicKey.toBase58() }, satp: { identityPDA: clientIdentity } }),
    },
  ]);

  writeJSON(dataDir, 'jobs', 'job_af17_af23', {
    id: 'job_af17_af23',
    postedBy: 'client_agent',
    clientId: 'client_agent',
    status: 'in_progress',
    escrowId: 'escrow_af17_af23',
  });
  writeJSON(dataDir, 'escrow', 'escrow_af17_af23', {
    id: 'escrow_af17_af23',
    jobId: 'job_af17_af23',
    depositConfirmed: false,
  });

  const app = express();
  app.use(express.json());
  loaded.marketplace.registerRoutes(app);
  const server = await listen(app);

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const bodyOnlyConfirm = await postJSON(baseUrl, '/api/marketplace/jobs/job_af17_af23/confirm-deposit', {
      txHash: 'sig_body_only',
      confirmedBy: 'client_agent',
    });
    assert.equal(bodyOnlyConfirm.status, 401);

    const signedConfirm = await postJSON(baseUrl, '/api/marketplace/jobs/job_af17_af23/confirm-deposit', {
      txHash: 'sig_signed',
      confirmedBy: 'client_agent',
      walletChallenge: signedChallenge(loaded.marketplace, client, {
        action: 'confirm_deposit',
        resourceId: 'job_af17_af23',
        actorId: 'client_agent',
        identityPDA: clientIdentity,
      }),
    });
    assert.equal(signedConfirm.status, 423);
    assert.equal(readJSON(dataDir, 'escrow', 'escrow_af17_af23').depositConfirmed, false);

    const bodyOnlyV3 = await postJSON(baseUrl, '/api/marketplace/jobs/job_af17_af23/v3-escrow-funded', {
      clientId: 'client_agent',
      escrowPDA: 'pda_body_only',
      txSignature: 'tx_body_only',
    });
    assert.equal(bodyOnlyV3.status, 401);

    const signedV3 = await postJSON(baseUrl, '/api/marketplace/jobs/job_af17_af23/v3-escrow-funded', {
      clientId: 'client_agent',
      escrowPDA: 'pda_signed',
      txSignature: 'tx_signed',
      walletChallenge: signedChallenge(loaded.marketplace, client, {
        action: 'v3_escrow_funded',
        resourceId: 'job_af17_af23',
        actorId: 'client_agent',
        identityPDA: clientIdentity,
      }),
    });
    assert.equal(signedV3.status, 423);
    const job = readJSON(dataDir, 'jobs', 'job_af17_af23');
    assert.equal(job.v3EscrowPDA, undefined);
    assert.equal(job.escrowFunded, undefined);
  } finally {
    await close(server);
    loaded.restore();
  }
});
