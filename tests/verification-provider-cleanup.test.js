const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const {
  CANONICAL_TRUST_PROVIDERS,
  filterCanonicalTrustData,
  isAutoPassAttestation,
} = require('../src/lib/canonical-verification-providers');
const { computeTrustScore } = require('../src/lib/compute-trust-score');
const { cleanup, rowIsRetiredOrAutoPass } = require('../scripts/cleanup-retired-trust-providers');

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
  assert.equal(rowIsRetiredOrAutoPass({ platform: 'solana', proof: '{"source":"satp-auto-v3-confirm","auto":true}' }), true);
  assert.equal(rowIsRetiredOrAutoPass({ platform: 'solana', proof: '{"txSignature":"signed-solana-proof"}' }), false);
});

test('cleanup dry-run reports profile filtering and rescoring without mutating files', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-cleanup-'));
  const profilePath = path.join(temp, 'agent.json');
  const profile = {
    id: 'agent',
    verificationData: {
      solana: { verified: true, source: 'satp-auto-v3-confirm', auto: true },
      github: { verified: true },
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
  assert.deepEqual(JSON.parse(fs.readFileSync(profilePath, 'utf8')), profile);
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
