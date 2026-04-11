#!/usr/bin/env node

const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const nacl = require('tweetnacl');
const _bs58 = require('bs58');
const bs58 = _bs58.default || _bs58;
const { Keypair } = require('@solana/web3.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createTempDb() {
  const dbPath = path.join(os.tmpdir(), `agentfolio-register-test-${Date.now()}.db`);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
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
    CREATE TABLE verifications (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      identifier TEXT NOT NULL,
      proof TEXT,
      verified_at TEXT
    );
  `);
  return { db, dbPath };
}

function buildRegistrationPayload() {
  const keypair = Keypair.generate();
  const walletAddress = keypair.publicKey.toBase58();
  const timestamp = Date.now();
  const name = `Local Harness ${timestamp}`;
  const signedMessage = `AgentFolio Registration\nAgent: ${name}\nWallet: ${walletAddress}\nTimestamp: ${timestamp}`;
  const signature = Buffer.from(
    nacl.sign.detached(Buffer.from(signedMessage), keypair.secretKey)
  ).toString('base64');

  return {
    customId: `localharness${timestamp}`,
    name,
    tagline: 'local-only registration harness',
    skills: 'testing,mocks',
    github: 'brainforge-local',
    website: 'https://example.invalid',
    walletAddress,
    signedMessage,
    signature,
  };
}

function verifyWalletSignature(payload) {
  const pubkeyBytes = payload.walletAddress ? Buffer.from(bs58.decode(payload.walletAddress)) : null;
  const sigBytes = Buffer.from(payload.signature, 'base64');
  const msgBytes = new TextEncoder().encode(payload.signedMessage);
  assert(pubkeyBytes && pubkeyBytes.length === 32, 'wallet pubkey must decode to 32 bytes');
  assert(sigBytes.length === 64, 'signature must decode to 64 bytes');
  assert(nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes), 'wallet signature must verify');
}

function runLocalRegistrationFlow(db, payload) {
  verifyWalletSignature(payload);

  const now = new Date().toISOString();
  const id = payload.customId;
  const apiKey = `af_${crypto.randomBytes(24).toString('hex')}`;
  const handle = payload.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 64);
  const resolvedSkills = payload.skills.split(',').map(s => s.trim()).filter(Boolean).map(name => ({ name, category: 'general', verified: false }));

  db.prepare(`
    INSERT INTO profiles (
      id, name, handle, description, bio, avatar, website, framework, capabilities,
      tags, wallet, wallets, twitter, github, email, api_key, status, claimed,
      claimed_by, skills, links, verification_data, created_at, updated_at
    ) VALUES (
      @id, @name, @handle, @description, @bio, '', @website, '', @capabilities,
      '[]', @wallet, @wallets, '', @github, '', @api_key, 'active', 1,
      @claimed_by, @skills, @links, @verification_data, @created_at, @updated_at
    )
  `).run({
    id,
    name: payload.name.trim(),
    handle,
    description: payload.tagline,
    bio: payload.tagline,
    website: payload.website,
    capabilities: JSON.stringify(resolvedSkills.map(s => s.name)),
    wallet: payload.walletAddress,
    wallets: JSON.stringify({ solana: payload.walletAddress }),
    github: payload.github,
    api_key: apiKey,
    claimed_by: payload.walletAddress,
    skills: JSON.stringify(resolvedSkills),
    links: JSON.stringify({ github: payload.github, website: payload.website }),
    verification_data: JSON.stringify({
      solana: {
        address: payload.walletAddress,
        verified: true,
        linked: true,
        source: 'local-test-harness',
      },
    }),
    created_at: now,
    updated_at: now,
  });

  db.prepare(`
    INSERT INTO verifications (id, profile_id, platform, identifier, proof, verified_at)
    VALUES (?, ?, 'solana', ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    id,
    payload.walletAddress,
    JSON.stringify({
      source: 'local-test-harness',
      signedMessage: payload.signedMessage,
      signaturePreview: `${payload.signature.slice(0, 16)}...`,
      verifiedAt: now,
    }),
    now,
  );

  return { id, apiKey, now };
}

function verifyLocalResults(db, payload, result) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(result.id);
  const verification = db.prepare('SELECT * FROM verifications WHERE profile_id = ? AND platform = ?').get(result.id, 'solana');

  assert(profile, 'profile row should exist');
  assert(profile.wallet === payload.walletAddress, 'wallet should be stored on the profile');
  assert(profile.claimed === 1, 'wallet-backed local registration should mark claimed=1');

  const wallets = JSON.parse(profile.wallets || '{}');
  const verificationData = JSON.parse(profile.verification_data || '{}');
  assert(wallets.solana === payload.walletAddress, 'wallets.solana should match payload wallet');
  assert(verificationData.solana?.verified === true, 'verification_data.solana.verified should be true');
  assert(verification, 'solana verification row should exist');

  console.log(JSON.stringify({
    ok: true,
    mode: 'local-only',
    profileId: result.id,
    walletAddress: payload.walletAddress,
    db: 'temp-sqlite',
    proof: {
      claimed: profile.claimed,
      storedWallet: profile.wallet,
      verificationPlatform: verification.platform,
    },
  }, null, 2));
}

(function main() {
  const { db, dbPath } = createTempDb();
  try {
    const payload = buildRegistrationPayload();
    const result = runLocalRegistrationFlow(db, payload);
    verifyLocalResults(db, payload, result);
  } finally {
    db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  }
})();
