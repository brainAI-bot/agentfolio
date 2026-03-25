#!/usr/bin/env node
/**
 * Self-Attestation CLI Tool
 * 
 * Allows external agents to write their own attestation memos on-chain.
 * The agent signs with their own wallet key — proving wallet ownership.
 * 
 * Usage:
 *   node self-attest.js --agent-id <agent_id> --platform <platform> --keypair <path>
 *   node self-attest.js --agent-id agent_newagent --platform github --keypair ~/.config/solana/id.json
 *   node self-attest.js --agent-id agent_newagent --platform github --keypair ~/.config/solana/id.json --proof '{"username":"octocat"}'
 *   node self-attest.js --agent-id agent_newagent --platform github --keypair ~/.config/solana/id.json --network devnet
 *   node self-attest.js --agent-id agent_newagent --platform github --keypair ~/.config/solana/id.json --dry-run
 * 
 * Output: TX signature + Solscan link
 * 
 * Memo format: VERIFY|<agent_id>|<platform>|<timestamp>|<proof_hash>
 * Signer: agent's own wallet (self-attested, not platform-attested)
 * 
 * The chain-cache on AgentFolio discovers these memos and includes them in
 * the explorer if the signer matches a known wallet.
 * 
 * brainChain — 2026-03-25
 */

const { Connection, Keypair, Transaction, TransactionInstruction, PublicKey } = require('@solana/web3.js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── Constants ───────────────────────────────────────────
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

const NETWORKS = {
  mainnet: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
};

const VALID_PLATFORMS = [
  'solana', 'github', 'twitter', 'x', 'ethereum', 'discord',
  'agentmail', 'moltbook', 'hyperliquid', 'polymarket',
  'website', 'domain', 'satp', 'telegram', 'mcp', 'a2a',
  'review', 'linkedin', 'farcaster',
];

// ── Argument Parsing ────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    agentId: null,
    platform: null,
    keypairPath: null,
    proof: '{}',
    network: 'mainnet',
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--agent-id':
      case '-a':
        parsed.agentId = args[++i];
        break;
      case '--platform':
      case '-p':
        parsed.platform = args[++i]?.toLowerCase();
        break;
      case '--keypair':
      case '-k':
        parsed.keypairPath = args[++i];
        break;
      case '--proof':
        parsed.proof = args[++i];
        break;
      case '--network':
      case '-n':
        parsed.network = args[++i]?.toLowerCase();
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
    }
  }

  return parsed;
}

function printUsage() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║  SATP Self-Attestation Tool                              ║
║  Write verification memos on Solana as proof of identity ║
╚═══════════════════════════════════════════════════════════╝

Usage:
  node self-attest.js --agent-id <id> --platform <platform> --keypair <path>

Required:
  --agent-id, -a    Agent profile ID (e.g. agent_myagent)
  --platform, -p    Platform to attest (e.g. github, twitter, solana)
  --keypair, -k     Path to Solana keypair JSON file

Optional:
  --proof           JSON proof data (e.g. '{"username":"octocat"}')
  --network, -n     Network: mainnet (default) or devnet
  --dry-run         Build TX but don't send
  --help, -h        Show this help

Valid platforms:
  ${VALID_PLATFORMS.join(', ')}

Examples:
  # Attest GitHub identity on mainnet
  node self-attest.js -a agent_mybot -p github -k ~/.config/solana/id.json --proof '{"username":"mybot"}'

  # Test on devnet first
  node self-attest.js -a agent_mybot -p github -k ~/.config/solana/id.json -n devnet

  # Dry run (build TX, don't send)
  node self-attest.js -a agent_mybot -p github -k ~/.config/solana/id.json --dry-run

Memo format written on-chain:
  VERIFY|<agent_id>|<platform>|<unix_timestamp>|<proof_hash>

The proof_hash is sha256(proof_data) truncated to 16 hex chars.
The signer is YOUR wallet — this is a self-attestation, not platform-attested.
`);
}

// ── Main ────────────────────────────────────────────────
async function main() {
  const args = parseArgs();

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  // Validate inputs
  if (!args.agentId) {
    console.error('❌ Missing --agent-id');
    printUsage();
    process.exit(1);
  }
  if (!args.platform) {
    console.error('❌ Missing --platform');
    printUsage();
    process.exit(1);
  }
  if (!args.keypairPath) {
    console.error('❌ Missing --keypair');
    printUsage();
    process.exit(1);
  }

  // Validate platform
  if (!VALID_PLATFORMS.includes(args.platform)) {
    console.error(`❌ Invalid platform: ${args.platform}`);
    console.error(`   Valid: ${VALID_PLATFORMS.join(', ')}`);
    process.exit(1);
  }

  // Validate network
  if (!NETWORKS[args.network]) {
    console.error(`❌ Invalid network: ${args.network}. Use mainnet or devnet`);
    process.exit(1);
  }

  // Load keypair
  let keypair;
  try {
    const resolvedPath = args.keypairPath.startsWith('~')
      ? path.join(process.env.HOME || '', args.keypairPath.slice(1))
      : path.resolve(args.keypairPath);
    const raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
    keypair = Keypair.fromSecretKey(Uint8Array.from(raw));
  } catch (e) {
    console.error(`❌ Failed to load keypair from ${args.keypairPath}: ${e.message}`);
    process.exit(1);
  }

  const walletAddress = keypair.publicKey.toBase58();

  // Build proof hash
  const proofString = typeof args.proof === 'string' ? args.proof : JSON.stringify(args.proof);
  const proofHash = crypto.createHash('sha256')
    .update(`${args.agentId}|${args.platform}|${walletAddress}|${proofString}`)
    .digest('hex')
    .slice(0, 16);

  const timestamp = Math.floor(Date.now() / 1000);
  const memo = `VERIFY|${args.agentId}|${args.platform}|${timestamp}|${proofHash}`;

  // Display info
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SATP SELF-ATTESTATION');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`  Agent ID:    ${args.agentId}`);
  console.log(`  Platform:    ${args.platform}`);
  console.log(`  Wallet:      ${walletAddress}`);
  console.log(`  Network:     ${args.network}`);
  console.log(`  Memo:        ${memo}`);
  console.log(`  Proof Hash:  ${proofHash}`);
  console.log(`  Proof Data:  ${proofString}`);
  console.log(`  Memo Size:   ${Buffer.byteLength(memo)} bytes`);
  console.log();

  if (Buffer.byteLength(memo) > 566) {
    console.error('❌ Memo exceeds 566-byte limit. Shorten agent_id or proof data.');
    process.exit(1);
  }

  if (args.dryRun) {
    console.log('  🏁 DRY RUN — Transaction built but NOT sent.\n');
    console.log('  To send for real, remove --dry-run flag.');
    console.log('═══════════════════════════════════════════════════════════');
    process.exit(0);
  }

  // Connect to network
  const rpcUrl = NETWORKS[args.network];
  const connection = new Connection(rpcUrl, 'confirmed');

  // Check balance
  const balance = await connection.getBalance(keypair.publicKey);
  const balanceSol = balance / 1e9;
  console.log(`  Balance:     ${balanceSol.toFixed(6)} SOL`);

  if (balance < 5000) { // ~0.000005 SOL minimum for a memo TX
    console.error(`\n  ❌ Insufficient balance. Need at least 0.000005 SOL for TX fee.`);
    if (args.network === 'devnet') {
      console.error(`     Get devnet SOL: solana airdrop 1 ${walletAddress} --url devnet`);
    }
    process.exit(1);
  }

  // Build and send TX
  console.log('\n  ⏳ Sending transaction...');

  try {
    const tx = new Transaction().add(
      new TransactionInstruction({
        keys: [{ pubkey: keypair.publicKey, isSigner: true, isWritable: false }],
        programId: MEMO_PROGRAM_ID,
        data: Buffer.from(memo, 'utf-8'),
      })
    );

    tx.feePayer = keypair.publicKey;
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.sign(keypair);

    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    console.log(`  📡 TX sent: ${signature}`);
    console.log('  ⏳ Confirming...');

    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed'
    );

    const explorerBase = args.network === 'devnet' ? 'https://solscan.io/tx/' + signature + '?cluster=devnet' : 'https://solscan.io/tx/' + signature;

    console.log('\n  ✅ ATTESTATION CONFIRMED!\n');
    console.log(`  TX Signature: ${signature}`);
    console.log(`  Solscan:      ${explorerBase}`);
    console.log(`  Memo:         ${memo}`);
    console.log(`  Signer:       ${walletAddress}`);
    console.log(`  Network:      ${args.network}`);
    console.log(`  Cost:         ~0.000005 SOL`);

    console.log('\n  ── Next Steps ──');
    console.log(`  1. AgentFolio chain-cache will discover this memo within 2 minutes`);
    console.log(`  2. Check: curl https://agentfolio.bot/api/satp/attestations/by-agent/${args.agentId}`);
    console.log(`  3. View on explorer: https://agentfolio.bot/satp/explorer`);
    console.log(`  4. Verify: node verify-attestations.js ${args.agentId}`);

    console.log('\n═══════════════════════════════════════════════════════════');

    // Output machine-readable JSON to stderr for scripting
    process.stderr.write(JSON.stringify({
      success: true,
      signature,
      explorerUrl: explorerBase,
      memo,
      proofHash,
      signer: walletAddress,
      agentId: args.agentId,
      platform: args.platform,
      network: args.network,
      timestamp,
    }) + '\n');

  } catch (err) {
    console.error(`\n  ❌ Transaction failed: ${err.message}`);
    if (err.logs) {
      console.error('  Logs:', err.logs.join('\n        '));
    }
    process.exit(1);
  }
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
