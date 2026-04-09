#!/usr/bin/env node
const fs = require('fs');
const { Keypair } = require('@solana/web3.js');
const { SATPV3SDK } = require('../src/satp-client/src/v3-sdk');
const { getAgentAttestations, triggerRecomputeOnly } = require('../src/lib/satp-verification-bridge');
const { deserializeAttestation } = require('@brainai/satp-v3');

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY';
const CONFIGURED_KEYPAIR_PATH = process.env.SATP_PLATFORM_KEYPAIR || '/home/ubuntu/.config/solana/satp-mainnet-platform.json';
const KEYPAIR_PATH = CONFIGURED_KEYPAIR_PATH === '/home/ubuntu/.config/solana/satp-mainnet-platform.json'
  ? '/home/ubuntu/.config/solana/mainnet-deployer.json'
  : CONFIGURED_KEYPAIR_PATH;

const CLEANUP_PLANS = {
  braintest: {
    agentId: 'agent_braintest',
    keep: [
      '7k5xYWpmh4LEDFtmrU2yE1qVAj9VZFZLngBwGjdMGV93',
    ],
    revoke: [
      '12eCW2HJfaNwLJWfFHb8bratpJoJQtMp2b8pDyC1GRFE',
      '7KHwvJBuFqqwvF8a2duiQQ1erbXwbrf5x7AXWLFyzXEf',
      '2uZygZdkq6w2dQezqSRWgUMs5N5UuJrWVohZs8qK6s1L',
      'FmZM9e2DoQXRtr8oVcBDu4sDhrNXPUMgYXjT4X28QFHJ',
      '8CE3ZvJmv8AwHu3CRVrF62JYusYyZUVZLdUDW8tcwWa8',
      'F2ewnHWEv1WN6nfYQrkh93pQRNXmsbmr6TZSr5AYGQDX',
      '64ArDYo93ezB7TpmgeM8eq6AvMKQEYnNMst7cEiTxLx2',
    ],
  },
};

function usage() {
  console.log('Usage: node scripts/revoke-attestations.js --plan <name> [--execute]');
  console.log('Plans:', Object.keys(CLEANUP_PLANS).join(', '));
}

function parseArgs(argv) {
  const out = { execute: false, plan: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--execute') out.execute = true;
    else if (arg === '--plan') out.plan = argv[++i];
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function loadKeypair() {
  const raw = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.plan) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const plan = CLEANUP_PLANS[String(args.plan).toLowerCase()];
  if (!plan) {
    usage();
    throw new Error(`Unknown plan: ${args.plan}`);
  }

  const sdk = new SATPV3SDK({ rpcUrl: RPC_URL, network: 'mainnet', commitment: 'confirmed' });
  const signer = loadKeypair();
  const current = await getAgentAttestations(plan.agentId, sdk.connection);
  const parsed = [];

  for (const pda of current) {
    const acct = await sdk.connection.getAccountInfo(pda);
    const att = deserializeAttestation(acct.data);
    parsed.push({
      pda: pda.toBase58(),
      type: att.attestationType,
      verified: !!att.verified,
      revoked: !!att.isRevoked,
      proofData: att.proofData,
      createdAt: att.createdAt,
    });
  }

  console.log(`Plan: ${args.plan}`);
  console.log(`Agent: ${plan.agentId}`);
  console.log(`Signer: ${signer.publicKey.toBase58()}`);
  console.log(`Mode: ${args.execute ? 'EXECUTE' : 'DRY RUN'}`);
  console.log('');
  console.log('Current attestations:');
  console.log(JSON.stringify(parsed, null, 2));
  console.log('');
  console.log('Keep PDAs:', JSON.stringify(plan.keep, null, 2));
  console.log('Revoke PDAs:', JSON.stringify(plan.revoke, null, 2));

  const missing = plan.revoke.filter(pda => !parsed.some(row => row.pda === pda));
  if (missing.length) {
    throw new Error(`Plan references missing PDAs: ${missing.join(', ')}`);
  }

  if (!args.execute) {
    console.log('');
    console.log('Dry run only. No transactions sent. Re-run with --execute after approval.');
    return;
  }

  const revokeResults = [];
  for (const pda of plan.revoke) {
    const { transaction } = await sdk.buildRevokeAttestation(signer.publicKey, pda);
    transaction.sign(signer);
    const sig = await sdk.connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false });
    await sdk.connection.confirmTransaction(sig, 'confirmed');
    revokeResults.push({ pda, txSignature: sig });
    console.log(`Revoked ${pda}: ${sig}`);
  }

  const recompute = await triggerRecomputeOnly(plan.agentId, signer, sdk.connection);
  const genesis = await sdk.getGenesisRecord(plan.agentId);

  console.log('');
  console.log(JSON.stringify({ revokeResults, recompute, genesis }, null, 2));
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
