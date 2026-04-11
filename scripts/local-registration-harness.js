#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const nacl = require('tweetnacl');
const { Keypair, Connection, Transaction } = require('@solana/web3.js');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function printHelp() {
  console.log(`Local-only AgentFolio registration harness

Usage:
  node scripts/local-registration-harness.js \
    --keypair /path/to/local-wallet.json \
    [--api http://127.0.0.1:3333] \
    [--rpc http://127.0.0.1:8899] \
    [--name "Local Test Agent"] \
    [--custom-id localtest123] \
    [--tagline "local harness"] \
    [--skills "testing,debugging"]

Guards:
  - Refuses any non-local API or RPC URL.
  - Intended for localhost/localnet only. Never prod.
`);
}

function assertLocalUrl(label, raw) {
  const url = new URL(raw);
  const host = url.hostname;
  const allowed = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!allowed.has(host)) {
    throw new Error(`${label} must be localhost/127.0.0.1, got ${raw}`);
  }
  return url.toString().replace(/\/$/, '');
}

function loadKeypair(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printHelp();
    return;
  }

  if (!args.keypair) {
    throw new Error('--keypair is required');
  }

  const apiBase = assertLocalUrl('API URL', args.api || process.env.LOCAL_API_BASE || 'http://127.0.0.1:3333');
  const rpcUrl = assertLocalUrl('RPC URL', args.rpc || process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8899');
  const kp = loadKeypair(path.resolve(args.keypair));
  const walletAddress = kp.publicKey.toBase58();
  const timestamp = Date.now();
  const name = args.name || `Local AutoTest ${timestamp}`;
  const customId = args['custom-id'] || `localautotest${timestamp}`;
  const tagline = args.tagline || 'Local registration harness';
  const skills = args.skills || 'testing';

  const signedMessage = `AgentFolio Registration\nAgent: ${name}\nWallet: ${walletAddress}\nTimestamp: ${timestamp}`;
  const signature = Buffer.from(nacl.sign.detached(Buffer.from(signedMessage), kp.secretKey)).toString('base64');

  const registerRes = await fetch(`${apiBase}/api/register/simple`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customId,
      name,
      tagline,
      skills,
      walletAddress,
      signature,
      signedMessage,
    }),
  });
  const registerData = await registerRes.json();
  if (!registerRes.ok) {
    throw new Error(`register failed: ${JSON.stringify(registerData)}`);
  }

  const profileId = registerData.id;
  const prepareRes = await fetch(`${apiBase}/api/satp/genesis/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: profileId, payer: walletAddress }),
  });
  const prepareData = await prepareRes.json();
  if (!prepareRes.ok || !prepareData.transaction) {
    throw new Error(`genesis prepare failed: ${JSON.stringify(prepareData)}`);
  }

  const connection = new Connection(rpcUrl, 'confirmed');
  const tx = Transaction.from(Buffer.from(prepareData.transaction, 'base64'));
  tx.partialSign(kp);
  const genesisTxSignature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction(genesisTxSignature, 'confirmed');

  const confirmRes = await fetch(`${apiBase}/api/satp-auto/v3/identity/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress, profileId, txSignature: genesisTxSignature }),
  });
  const confirmData = await confirmRes.json();
  if (!confirmRes.ok) {
    throw new Error(`identity confirm failed: ${JSON.stringify(confirmData)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    apiBase,
    rpcUrl,
    walletAddress,
    profileId,
    genesisTxSignature,
    solanaAttestation: confirmData.solanaAttestation || null,
    confirm: confirmData.data || confirmData,
  }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
