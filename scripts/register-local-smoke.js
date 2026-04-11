#!/usr/bin/env node
const crypto = require('crypto');
const nacl = require('tweetnacl');
const { Keypair } = require('@solana/web3.js');

const baseUrl = process.env.AGENTFOLIO_BASE_URL || 'http://127.0.0.1:3333';
const allowNonLocal = process.env.ALLOW_NONLOCAL_TESTS === '1';
const withWallet = process.argv.includes('--wallet');

function assertLocal(url) {
  if (allowNonLocal) return;
  const { hostname } = new URL(url);
  const isLocal = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '0.0.0.0';
  if (!isLocal) {
    throw new Error(`Refusing to run registration smoke test against non-local host: ${url}`);
  }
}

async function main() {
  assertLocal(baseUrl);

  const suffix = Date.now();
  const payload = {
    customId: `localreg${suffix}`,
    name: `Local Smoke ${suffix}`,
    tagline: 'Local registration smoke test',
    skills: 'testing',
  };

  if (withWallet) {
    const kp = Keypair.generate();
    const walletAddress = kp.publicKey.toBase58();
    const signedMessage = `AgentFolio Registration\nAgent: ${payload.name}\nWallet: ${walletAddress}\nTimestamp: ${suffix}`;
    const signature = Buffer.from(nacl.sign.detached(Buffer.from(signedMessage), kp.secretKey)).toString('base64');
    payload.walletAddress = walletAddress;
    payload.signedMessage = signedMessage;
    payload.signature = signature;
  }

  const res = await fetch(`${baseUrl}/api/register/simple`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Registration smoke test failed: HTTP ${res.status} ${JSON.stringify(data)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    mode: withWallet ? 'wallet' : 'basic',
    baseUrl,
    profileId: data.id,
    apiKeyPresent: !!data.api_key,
    message: data.message || null,
  }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
