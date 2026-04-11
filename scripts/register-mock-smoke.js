#!/usr/bin/env node
const os = require('os');
const path = require('path');
const fs = require('fs');
const express = require('express');
const Database = require('better-sqlite3');

(async () => {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-register-mock-'));
  const tempProfilesDir = path.join(tmpRoot, 'data', 'profiles');
  const tempDbPath = path.join(tmpRoot, 'agentfolio.db');
  fs.mkdirSync(tempProfilesDir, { recursive: true });

  process.env.SATP_PLATFORM_KEYPAIR = path.join(tmpRoot, 'missing-platform-keypair.json');
  process.env.SOLANA_RPC_URL = 'http://127.0.0.1:0';

  const db = new Database(tempDbPath);
  db.exec(`
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY,
      name TEXT,
      handle TEXT,
      description TEXT,
      bio TEXT,
      avatar TEXT,
      website TEXT,
      framework TEXT,
      capabilities TEXT,
      tags TEXT,
      wallet TEXT,
      wallets TEXT,
      twitter TEXT,
      github TEXT,
      email TEXT,
      api_key TEXT,
      status TEXT,
      claimed INTEGER,
      claimed_by TEXT,
      skills TEXT,
      links TEXT,
      verification_data TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);

  const redirectIntoTemp = (targetPath) => {
    const normalized = path.resolve(String(targetPath));
    const prodProfilesDir = path.resolve(repoRoot, 'data', 'profiles');
    if (!normalized.startsWith(prodProfilesDir)) return normalized;
    return path.join(tempProfilesDir, path.basename(normalized));
  };

  const originalMkdirSync = fs.mkdirSync;
  const originalWriteFileSync = fs.writeFileSync;
  const originalExistsSync = fs.existsSync;

  fs.mkdirSync = function patchedMkdirSync(targetPath, ...args) {
    return originalMkdirSync.call(fs, redirectIntoTemp(targetPath), ...args);
  };
  fs.writeFileSync = function patchedWriteFileSync(targetPath, data, ...args) {
    return originalWriteFileSync.call(fs, redirectIntoTemp(targetPath), data, ...args);
  };
  fs.existsSync = function patchedExistsSync(targetPath) {
    return originalExistsSync.call(fs, redirectIntoTemp(targetPath));
  };

  const { registerSimpleRoutes } = require(path.join(repoRoot, 'src', 'routes', 'simple-register'));

  const app = express();
  app.use(express.json());
  registerSimpleRoutes(app, () => db);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const customId = 'mocksmoke_' + Date.now();

    const res = await fetch(baseUrl + '/api/register/simple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customId,
        name: 'Mock Smoke Agent',
        tagline: 'Local temp-db registration harness',
        skills: 'testing,mock',
        github: 'mocksmoke',
        website: 'https://example.com'
      })
    });

    const payload = await res.json();
    if (!res.ok) {
      throw new Error(`register/simple returned ${res.status}: ${JSON.stringify(payload)}`);
    }

    const row = db.prepare('SELECT id, name, website, status, claimed FROM profiles WHERE id = ?').get(customId);
    if (!row) {
      throw new Error('expected temp-db profile row to exist after registration');
    }

    const writtenProfileJson = path.join(tempProfilesDir, `${customId}.json`);
    if (!fs.existsSync(writtenProfileJson)) {
      throw new Error('expected redirected profile JSON to exist in temp dir');
    }

    if (originalExistsSync(path.join(repoRoot, 'data', 'profiles', `${customId}.json`))) {
      throw new Error('mock harness wrote into real repo data/profiles unexpectedly');
    }

    console.log(JSON.stringify({
      ok: true,
      endpoint: '/api/register/simple',
      mode: 'temp-db-mock',
      profileId: customId,
      apiKeyPresent: Boolean(payload.api_key),
      dbRow: row,
      tempDbPath,
      tempProfileJson: writtenProfileJson
    }, null, 2));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.mkdirSync = originalMkdirSync;
    fs.writeFileSync = originalWriteFileSync;
    fs.existsSync = originalExistsSync;
  }
})().catch((err) => {
  console.error('[register-mock-smoke] FAILED:', err && err.stack ? err.stack : err);
  process.exit(1);
});
