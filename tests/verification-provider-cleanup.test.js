const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const {
  CANONICAL_TRUST_PROVIDERS,
  filterCanonicalTrustData,
  isAutoPassAttestation,
} = require('../src/lib/canonical-verification-providers');
const { computeTrustScore } = require('../src/lib/compute-trust-score');
const {
  cleanup,
  cleanupMatchForRow,
  cleanupWithDeployedAttestations,
  rowIsRetiredOrAutoPass,
} = require('../scripts/cleanup-retired-trust-providers');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('canonical trust provider set is exactly solana, github, domain, website', () => {
  assert.deepEqual(CANONICAL_TRUST_PROVIDERS, ['solana', 'github', 'domain', 'website']);
});

test('retired and auto-pass verification data cannot earn canonical trust score', () => {
  const verificationData = {
    solana: { verified: true, source: 'satp-auto-v3-confirm', auto: true },
    solana_wallet: { verified: true, proof: '{"source":"satp-auto-v3-confirm","auto":true}' },
    github: { verified: true, username: 'octo' },
    domain: { verified: true, domain: 'agent.example' },
    website: { verified: true, url: 'https://agent.example' },
    telegram: { verified: true, username: 'operator' },
    agentmail: { verified: true, email: 'agent@agentmail.to' },
    ens: { verified: true, name: 'agent.eth' },
    farcaster: { verified: true, username: 'agent' },
  };

  assert.equal(isAutoPassAttestation(verificationData.solana), true);
  assert.equal(isAutoPassAttestation(verificationData.solana_wallet), true);
  assert.deepEqual(Object.keys(filterCanonicalTrustData(verificationData)), ['github', 'domain', 'website']);

  const result = computeTrustScore({ profile: { verificationData } });
  assert.equal(result.breakdown.canonicalVerifications, 320);
  assert.deepEqual(result.details.canonicalVerifications.verified, ['github', 'domain', 'website']);
});

test('cleanup identifies retired rows and auto-pass rows for purge', () => {
  assert.equal(rowIsRetiredOrAutoPass({ platform: 'telegram', proof: '{}' }), true);
  assert.equal(rowIsRetiredOrAutoPass({ platform: 'agentmail', proof: '{}' }), true);
  assert.equal(rowIsRetiredOrAutoPass({ platform: 'ens', proof: '{}' }), true);
  assert.equal(rowIsRetiredOrAutoPass({ platform: 'farcaster', proof: '{}' }), true);
  assert.equal(rowIsRetiredOrAutoPass({ platform: 'discord', proof: '{}' }), false);
  assert.equal(rowIsRetiredOrAutoPass({ platform: 'ethereum', proof: '{"signature":"0xsig"}' }), false);
  assert.equal(rowIsRetiredOrAutoPass({ platform: 'satp', proof: '{"txSignature":"sig"}' }), false);
  assert.equal(rowIsRetiredOrAutoPass({ platform: 'x', proof: '{"tweetId":"123"}' }), false);
  assert.equal(rowIsRetiredOrAutoPass({ platform: 'solana', proof: '{"source":"satp-auto-v3-confirm","auto":true}' }), true);
  assert.equal(rowIsRetiredOrAutoPass({ platform: 'solana', proof: '{"txSignature":"signed-solana-proof"}' }), false);
});

test('cleanup matching avoids free-text substring deletion', () => {
  assert.equal(rowIsRetiredOrAutoPass({
    platform: 'solana',
    proof: '{"txSignature":"signed-solana-proof"}',
    reason: 'manual review mentioned satp-auto in notes but kept signed proof',
  }), false);
  assert.equal(cleanupMatchForRow({
    platform: 'solana',
    proof: '{"source":"satp-auto-v3-confirm"}',
  })?.reason, 'auto_pass_attestation');
});

test('cleanup dry-run reports profile filtering and rescoring without mutating files', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-cleanup-'));
  const profilePath = path.join(temp, 'agent.json');
  const profile = {
    id: 'agent',
    verificationData: {
      solana: { verified: true, source: 'satp-auto-v3-confirm', auto: true },
      github: { verified: true },
      discord: { verified: true, username: 'agent#0001' },
      ethereum: { verified: true, address: '0x123' },
      satp: { verified: true, did: 'did:satp:sol:abc' },
      x: { verified: false, handle: 'agent' },
      telegram: { verified: true },
    },
    trustScore: 240,
    reputationScore: 240,
    verification: { score: 240 },
  };
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));

  const summary = cleanup({ profilesDir: temp, dbPath: path.join(temp, 'missing.db'), write: false });

  assert.equal(summary.jsonProfilesUpdated, 1);
  assert.equal(summary.jsonProfilesRescored, 1);
  assert.deepEqual(summary.jsonProfileMatches.map((match) => match.match), [
    ['solana', 'auto=true'],
    ['telegram', 'platform'],
  ]);
  assert.deepEqual(JSON.parse(fs.readFileSync(profilePath, 'utf8')), profile);
});

test('cleanup dry-run exposes matched SQLite tuples', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-cleanup-db-'));
  const dbPath = path.join(temp, 'agentfolio.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE verifications (id TEXT PRIMARY KEY, platform TEXT, proof TEXT);
    CREATE TABLE attestations (platform TEXT, proof TEXT, source TEXT, method TEXT);
  `);
  db.prepare('INSERT INTO verifications (id, platform, proof) VALUES (?, ?, ?)').run('v1', 'telegram', '{}');
  db.prepare('INSERT INTO verifications (id, platform, proof) VALUES (?, ?, ?)').run('v2', 'solana', '{"txSignature":"sig"}');
  db.prepare('INSERT INTO verifications (id, platform, proof) VALUES (?, ?, ?)').run('v3', 'discord', '{"challengeId":"manual"}');
  db.prepare('INSERT INTO attestations (platform, proof, source, method) VALUES (?, ?, ?, ?)').run('solana', '{}', 'satp-auto-v3-confirm', null);
  db.close();

  const summary = cleanup({ profilesDir: path.join(temp, 'missing-profiles'), dbPath, write: false });

  assert.deepEqual(summary.sqliteVerificationMatches, [{
    table: 'verifications',
    rowId: 'v1',
    platform: 'telegram',
    reason: 'retired_provider',
    match: ['telegram', 'platform'],
  }]);
  assert.deepEqual(summary.sqliteAttestationMatches, [{
    table: 'attestations',
    rowId: 1,
    platform: 'solana',
    reason: 'auto_pass_attestation',
    match: ['solana', 'source=satp-auto-v3-confirm'],
  }]);
});

test('cleanup dry-run tolerates production attestation schema without proof column', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-production-attestation-db-'));
  const dbPath = path.join(temp, 'agentfolio.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE attestations (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      tx_signature TEXT NOT NULL,
      memo TEXT NOT NULL,
      proof_hash TEXT NOT NULL,
      signer TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO attestations (id, profile_id, platform, tx_signature, memo, proof_hash, signer, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'att-telegram',
    'agent-prod',
    'telegram',
    'retired-provider-proof',
    'VERIFY|agent-prod|telegram|2026-08-03T00:00:00.000Z|hash',
    'hash',
    'signer',
    '2026-08-03T00:00:00.000Z'
  );
  db.prepare(`
    INSERT INTO attestations (id, profile_id, platform, tx_signature, memo, proof_hash, signer, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'att-github',
    'agent-prod',
    'github',
    'signed-github-proof',
    'VERIFY|agent-prod|github|2026-08-03T00:00:00.000Z|hash',
    'hash',
    'signer',
    '2026-08-03T00:00:00.000Z'
  );
  db.close();

  const summary = cleanup({ profilesDir: path.join(temp, 'missing-profiles'), dbPath, write: false });

  assert.equal(summary.sqliteAttestationRowsRemoved, 1);
  assert.deepEqual(summary.sqliteAttestationMatches, [{
    table: 'attestations',
    rowId: 'att-telegram',
    platform: 'telegram',
    reason: 'retired_provider',
    match: ['telegram', 'platform'],
  }]);
});

test('cleanup dry-run tolerates SQLite files without AgentFolio tables', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-empty-db-'));
  const dbPath = path.join(temp, 'empty.db');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE unrelated (id TEXT PRIMARY KEY)');
  db.close();

  const summary = cleanup({ profilesDir: path.join(temp, 'missing-profiles'), dbPath, write: false });

  assert.equal(summary.sqliteVerificationRowsRemoved, 0);
  assert.equal(summary.sqliteAttestationRowsRemoved, 0);
  assert.equal(summary.sqliteProfilesUpdated, 0);
  assert.equal(summary.sqliteProfilesRescored, 0);
});

test('cleanup can detect deployed attestations through public API without deploy-host shell', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/profiles?page=1&limit=100') {
      res.end(JSON.stringify({ profiles: [{ id: 'agent_live' }], total: 1, pages: 1 }));
      return;
    }
    if (req.url === '/api/satp/attestations/by-agent/agent_live') {
      res.end(JSON.stringify({
        ok: true,
        data: {
          attestations: [
            {
              platform: 'solana',
              txSignature: 'signed-solana-proof',
              memo: 'VERIFY|agent_live|solana|2026-08-03T00:00:00.000Z|hash',
            },
            {
              platform: 'telegram',
              txSignature: 'retired-provider-proof',
              memo: 'VERIFY|agent_live|telegram|2026-08-03T00:00:00.000Z|hash',
            },
          ],
        },
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });

  const port = await listen(server);
  try {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-deployed-cleanup-'));
    const summary = await cleanupWithDeployedAttestations({
      dbPath: path.join(temp, 'missing.db'),
      profilesDir: path.join(temp, 'missing-profiles'),
      deployedBaseUrl: `http://127.0.0.1:${port}`,
    });

    assert.equal(summary.deployedAttestationRowsDetected, 2);
    assert.equal(summary.deployedDetectionRan, true);
    assert.equal(summary.deployedDetectionComplete, true);
    assert.equal(summary.deployedVerifiedClean, false);
    assert.equal(summary.deployedBaseUrl, `http://127.0.0.1:${port}`);
    assert.deepEqual(summary.deployedProfileCoverage, {
      source: 'api-profiles',
      requestedAgentIds: 0,
      discoveredAgentIds: 1,
      coveredAgentIds: 1,
      totalProfiles: 1,
      pagesFetched: 1,
      truncated: false,
    });
    assert.deepEqual(summary.deployedAttestationMatches, [{
      agentId: 'agent_live',
      platform: 'telegram',
      reason: 'retired_provider',
      match: ['telegram', 'platform'],
      txSignature: 'retired-provider-proof',
      solscanUrl: null,
    }]);
    assert.deepEqual(summary.deployedAttestationErrors, []);
  } finally {
    await closeServer(server);
  }
});

test('cleanup marks deployed detection skipped when no base URL is supplied', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-deployed-skip-'));
  const summary = await cleanupWithDeployedAttestations({
    dbPath: path.join(temp, 'missing.db'),
    profilesDir: path.join(temp, 'missing-profiles'),
  });

  assert.equal(summary.deployedDetectionRan, false);
  assert.equal(summary.deployedDetectionComplete, false);
  assert.equal(summary.deployedVerifiedClean, false);
  assert.deepEqual(summary.deployedAttestationMatches, []);
  assert.deepEqual(summary.deployedAttestationErrors, []);
  assert.deepEqual(summary.deployedAnomalies, [{
    type: 'deployed_detection_skipped',
    reason: 'missing_base_url',
  }]);
});

test('cleanup pages through deployed profiles before reporting clean coverage', async () => {
  const requestedUrls = [];
  const server = http.createServer((req, res) => {
    requestedUrls.push(req.url);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/profiles?page=1&limit=100') {
      res.end(JSON.stringify({ profiles: [{ id: 'agent_page_1' }], total: 2, page: 1, limit: 100, pages: 2 }));
      return;
    }
    if (req.url === '/api/profiles?page=2&limit=100') {
      res.end(JSON.stringify({ profiles: [{ id: 'agent_page_2' }], total: 2, page: 2, limit: 100, pages: 2 }));
      return;
    }
    if (req.url?.startsWith('/api/satp/attestations/by-agent/')) {
      res.end(JSON.stringify({
        ok: true,
        data: {
          attestations: [{
            platform: 'github',
            txSignature: 'signed-github-proof',
            memo: 'VERIFY|agent|github|2026-08-03T00:00:00.000Z|hash',
          }],
        },
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });

  const port = await listen(server);
  try {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-deployed-pages-'));
    const summary = await cleanupWithDeployedAttestations({
      dbPath: path.join(temp, 'missing.db'),
      profilesDir: path.join(temp, 'missing-profiles'),
      deployedBaseUrl: `http://127.0.0.1:${port}`,
    });

    assert.deepEqual(requestedUrls.slice(0, 2), [
      '/api/profiles?page=1&limit=100',
      '/api/profiles?page=2&limit=100',
    ]);
    assert.equal(summary.deployedProfilesDiscovered, 2);
    assert.equal(summary.deployedProfilesCovered, 2);
    assert.equal(summary.deployedProfilePagesFetched, 2);
    assert.equal(summary.deployedProfilesTruncated, false);
    assert.equal(summary.deployedDetectionComplete, true);
    assert.equal(summary.deployedVerifiedClean, true);
    assert.deepEqual(summary.deployedAnomalies, []);
  } finally {
    await closeServer(server);
  }
});

test('cleanup reports explicit deployed profile truncation instead of clean coverage', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/profiles?page=1&limit=100') {
      res.end(JSON.stringify({ profiles: [{ id: 'agent_page_1' }], total: 2, page: 1, limit: 100, pages: 2 }));
      return;
    }
    if (req.url === '/api/satp/attestations/by-agent/agent_page_1') {
      res.end(JSON.stringify({
        ok: true,
        data: {
          attestations: [{
            platform: 'github',
            txSignature: 'signed-github-proof',
            memo: 'VERIFY|agent_page_1|github|2026-08-03T00:00:00.000Z|hash',
          }],
        },
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });

  const port = await listen(server);
  try {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-deployed-truncated-'));
    const summary = await cleanupWithDeployedAttestations({
      dbPath: path.join(temp, 'missing.db'),
      profilesDir: path.join(temp, 'missing-profiles'),
      deployedBaseUrl: `http://127.0.0.1:${port}`,
      deployedProfileMaxPages: 1,
    });

    assert.equal(summary.deployedProfilesTruncated, true);
    assert.equal(summary.deployedDetectionComplete, false);
    assert.equal(summary.deployedVerifiedClean, false);
    assert.deepEqual(summary.deployedAnomalies, [{
      type: 'profile_detection_truncated',
      discoveredAgentIds: 1,
      totalProfiles: 2,
      pagesFetched: 1,
    }]);
  } finally {
    await closeServer(server);
  }
});

test('cleanup reports cold empty deployed by-agent attestations as anomalies', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/profiles?page=1&limit=100') {
      res.end(JSON.stringify({
        profiles: [{
          id: 'agent_cold',
          verificationData: { github: { verified: true, username: 'octo' } },
        }],
        total: 1,
        pages: 1,
      }));
      return;
    }
    if (req.url === '/api/satp/attestations/by-agent/agent_cold') {
      res.end(JSON.stringify({ ok: true, data: { attestations: [] } }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });

  const port = await listen(server);
  try {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-deployed-cold-'));
    const summary = await cleanupWithDeployedAttestations({
      dbPath: path.join(temp, 'missing.db'),
      profilesDir: path.join(temp, 'missing-profiles'),
      deployedBaseUrl: `http://127.0.0.1:${port}`,
    });

    assert.equal(summary.deployedAttestationRowsDetected, 0);
    assert.deepEqual(summary.deployedAttestationEmptyAgents, ['agent_cold']);
    assert.equal(summary.deployedDetectionComplete, true);
    assert.equal(summary.deployedVerifiedClean, false);
    assert.deepEqual(summary.deployedAnomalies, [{
      type: 'empty_attestations',
      agentId: 'agent_cold',
      reason: 'profile_has_verification_evidence_but_chain_cache_returned_empty',
    }]);
  } finally {
    await closeServer(server);
  }
});

test('chain-cache by-agent read falls back to SQLite attestations when memory cache is cold', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-chain-cache-db-'));
  const dbPath = path.join(temp, 'agentfolio.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE attestations (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      tx_signature TEXT NOT NULL,
      memo TEXT NOT NULL,
      proof_hash TEXT NOT NULL,
      signer TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO attestations (id, profile_id, platform, tx_signature, memo, proof_hash, signer, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'att-github',
    'agent_cold_cache',
    'github',
    'signed-github-proof',
    'VERIFY|agent_cold_cache|github|2026-08-03T00:00:00.000Z|hash',
    'hash',
    'JAbcYnKy4p2c5SYV3bHu14VtD6EDDpzj44uGYW8BMud4',
    '2026-08-03T00:00:00.000Z'
  );
  db.prepare(`
    INSERT INTO attestations (id, profile_id, platform, tx_signature, memo, proof_hash, signer, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'att-untrusted',
    'agent_cold_cache',
    'x',
    'untrusted-proof',
    'VERIFY|agent_cold_cache|x|2026-08-03T00:00:00.000Z|hash',
    'hash',
    'UntrustedSigner11111111111111111111111111111111',
    '2026-08-03T00:00:01.000Z'
  );
  db.close();

  const oldDbPath = process.env.AGENTFOLIO_DB_PATH;
  const originalLoad = Module._load;
  const chainCachePath = path.resolve(__dirname, '../src/lib/chain-cache.js');
  delete require.cache[chainCachePath];
  process.env.AGENTFOLIO_DB_PATH = dbPath;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@brainai/satp-v3') {
      return {
        SatpV3Client: class SatpV3Client {},
        deriveGenesisPda: () => [{ toBase58: () => 'GenesisPda111' }],
        agentIdHash: () => Buffer.alloc(32),
        deserializeGenesis: () => ({}),
        deserializeAttestation: () => ({}),
        trustTier: () => 'unknown',
        verificationLabel: () => 'Unverified',
        reputationPct: () => 0,
        isBorn: () => false,
        PROGRAM_IDS: {},
      };
    }
    return originalLoad(request, parent, isMain);
  };
  try {
    const chainCache = require(chainCachePath);
    const attestations = chainCache.getVerifications('agent_cold_cache');

    assert.deepEqual(attestations, [{
      platform: 'github',
      txSignature: 'signed-github-proof',
      memo: 'VERIFY|agent_cold_cache|github|2026-08-03T00:00:00.000Z|hash',
      proofHash: 'hash',
      signer: 'JAbcYnKy4p2c5SYV3bHu14VtD6EDDpzj44uGYW8BMud4',
      timestamp: '2026-08-03T00:00:00.000Z',
      solscanUrl: 'https://solscan.io/tx/signed-github-proof',
    }]);
  } finally {
    if (oldDbPath === undefined) {
      delete process.env.AGENTFOLIO_DB_PATH;
    } else {
      process.env.AGENTFOLIO_DB_PATH = oldDbPath;
    }
    Module._load = originalLoad;
    delete require.cache[chainCachePath];
  }
});
