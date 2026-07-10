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
