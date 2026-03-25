#!/usr/bin/env node
/**
 * Fix AREMES Authority Transfer
 * 
 * Problem: propose_authority was called with wrong wallet address
 *   On-chain pending: Ewhn1YZdj2kGfKpT9rPbNQs1Wz7j7oD1t5iqxXC2DZFC (wrong)
 *   DB wallet:        Ewhn1YZdvZTkLnbgQBkLDcEJaRb2nFiQLLks8xdMDZFC (correct)
 *
 * Fix: Re-propose with correct address (deployer is still the authority)
 * 
 * brainChain — 2026-03-25
 */

const { Connection, PublicKey, Transaction, TransactionInstruction, Keypair } = require('@solana/web3.js');
const crypto = require('crypto');
const fs = require('fs');

const IDENTITY_V3 = new PublicKey('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');
const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED';
const DEPLOYER_KEY_PATH = '/home/ubuntu/.config/solana/mainnet-deployer.json';

const AGENT_ID = 'agent_aremes';
const CORRECT_WALLET = 'Ewhn1YZdvZTkLnbgQBkLDcEJaRb2nFiQLLks8xdMDZFC';

function agentIdHash(agentId) {
  return crypto.createHash('sha256').update(agentId).digest();
}

async function main() {
  const conn = new Connection(RPC, 'confirmed');

  // Load deployer key
  const raw = JSON.parse(fs.readFileSync(DEPLOYER_KEY_PATH, 'utf-8'));
  const deployer = Keypair.fromSecretKey(Uint8Array.from(raw));
  console.log('Deployer:', deployer.publicKey.toBase58());

  // Get Genesis PDA
  const hashBuf = agentIdHash(AGENT_ID);
  const [genesisPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('genesis'), hashBuf],
    IDENTITY_V3
  );
  console.log('Genesis PDA:', genesisPda.toBase58());
  console.log('Agent:', AGENT_ID);
  console.log('New authority:', CORRECT_WALLET);

  // Build propose_authority instruction
  // Discriminator: sha256('global:propose_authority')[0..8]
  const disc = crypto.createHash('sha256').update('global:propose_authority').digest().slice(0, 8);

  // Data: discriminator + new_authority (32 bytes)
  const newAuthPubkey = new PublicKey(CORRECT_WALLET);
  const data = Buffer.concat([disc, newAuthPubkey.toBuffer()]);

  const ix = new TransactionInstruction({
    programId: IDENTITY_V3,
    keys: [
      { pubkey: genesisPda, isSigner: false, isWritable: true },
      { pubkey: deployer.publicKey, isSigner: true, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = deployer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;

  console.log('\nSending propose_authority TX...');
  const sig = await conn.sendTransaction(tx, [deployer], { skipPreflight: false });
  console.log('TX sent:', sig);
  console.log('Solscan: https://solscan.io/tx/' + sig);

  await conn.confirmTransaction(sig, 'confirmed');
  console.log('✅ Confirmed!');

  // Verify
  const acct = await conn.getAccountInfo(genesisPda);
  const acctData = Buffer.from(acct.data);
  // Quick parse to check pending authority
  let offset = 8 + 32; // discriminator + hash
  const readStr = () => { const len = acctData.readUInt32LE(offset); offset += 4; offset += len; };
  const readVec = () => { const c = acctData.readUInt32LE(offset); offset += 4; for(let i=0;i<c;i++) readStr(); };
  readStr(); // name
  readStr(); // description
  readStr(); // category
  readVec(); // capabilities
  readStr(); // metadataUri
  readStr(); // faceImage
  offset += 32; // faceMint
  readStr(); // faceBurnTx
  offset += 8; // genesisRecord
  const authority = new PublicKey(acctData.slice(offset, offset + 32)); offset += 32;
  const hasPending = acctData[offset]; offset += 1;
  let pending = null;
  if (hasPending === 1) {
    pending = new PublicKey(acctData.slice(offset, offset + 32)).toBase58();
  }

  console.log('\nPost-fix verification:');
  console.log('  Authority:', authority.toBase58());
  console.log('  Has Pending:', hasPending === 1);
  console.log('  Pending Authority:', pending);
  console.log('  Expected:', CORRECT_WALLET);
  console.log('  Match:', pending === CORRECT_WALLET ? '✅' : '❌');
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
