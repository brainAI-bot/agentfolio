/**
 * Core CM Prepare Worker — builds partially-signed mint TX for client-side signing
 * Usage: node core-cm-prepare-worker.mjs <recipient_wallet> <flow>
 * flow: "free" (thirdPartySigner group, deployer co-signs) or "paid" (solPayment group)
 * 
 * Returns JSON: { transaction: base64, asset: pubkey, boaId, ... }
 * 
 * For "free" flow: deployer signs as thirdPartySigner + asset signer signs.
 *   User must sign as minter/payer.
 * For "paid" flow: asset signer signs.
 *   User must sign as minter/payer (SOL payment guard enforced on-chain).
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  mplCandyMachine,
  fetchCandyMachine,
  mintV1,
} from '@metaplex-foundation/mpl-core-candy-machine';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';
import {
  generateSigner,
  keypairIdentity,
  publicKey,
  transactionBuilder,
  signerIdentity,
  createNoopSigner,
} from '@metaplex-foundation/umi';
import { toWeb3JsLegacyTransaction } from '@metaplex-foundation/umi-web3js-adapters';
import { Connection, Transaction, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

const recipient = process.argv[2];
const flow = process.argv[3] || 'paid';

if (!recipient) {
  console.log(JSON.stringify({ error: 'Usage: node core-cm-prepare-worker.mjs <wallet> <free|paid>' }));
  process.exit(1);
}

const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const DATA_DIR = process.env.HOME + '/agentfolio/boa-pipeline/candy-machine-data';
const CM_STATE_PATH = path.join(DATA_DIR, 'core-cm-state.json');
const UPLOADED_PATH = path.join(DATA_DIR, 'uploaded-assets.json');

async function run() {
  const cmState = JSON.parse(fs.readFileSync(CM_STATE_PATH, 'utf-8'));
  const uploaded = JSON.parse(fs.readFileSync(UPLOADED_PATH, 'utf-8'));
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));

  const umi = createUmi(RPC).use(mplCandyMachine());
  const deployerKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  
  // Set deployer as identity (needed for building instructions)
  umi.use(keypairIdentity(deployerKeypair));

  const cmPk = publicKey(cmState.candyMachine);
  const collPk = publicKey(cmState.collection);

  const cm = await fetchCandyMachine(umi, cmPk);
  const nextIndex = Number(cm.itemsRedeemed);

  if (nextIndex >= Number(cm.data.itemsAvailable)) {
    console.log(JSON.stringify({ error: 'Collection sold out.' }));
    process.exit(1);
  }

  const item = cm.items[nextIndex];
  if (!item) {
    console.log(JSON.stringify({ error: `No item at index ${nextIndex}` }));
    process.exit(1);
  }

  const nameMatch = item.name.match(/(\d+)/);
  const boaId = nameMatch ? parseInt(nameMatch[1]) : nextIndex + 1;
  console.error(`[Prepare] Building TX for index ${nextIndex} → BOA #${boaId} → ${recipient} (${flow})`);

  // Generate new asset signer (the NFT address)
  const asset = generateSigner(umi);
  
  // Create a noop signer for the recipient (they'll sign client-side)
  const ownerPk = publicKey(recipient);
  const ownerSigner = createNoopSigner(ownerPk);

  // Build the mint instruction
  const mintArgs = {
    candyMachine: cmPk,
    asset,
    collection: collPk,
    owner: ownerPk, // NFT goes to user's wallet
    mintArgs: {},
  };

  if (flow === 'free') {
    mintArgs.group = 'free';
    // thirdPartySigner guard: deployer will co-sign below
  } else {
    mintArgs.group = 'paid';
    // solPayment guard: user pays 1 SOL (enforced on-chain)
  }

  // Build transaction with recipient as payer (they pay gas)
  const builder = transactionBuilder()
    .add(setComputeUnitLimit(umi, { units: 800_000 }))
    .add(mintV1(umi, mintArgs));

  // Set the recipient as the payer for the transaction
  const tx = await builder.setFeePayer(ownerSigner).buildWithLatestBlockhash(umi);
  
  // Convert to web3.js Transaction for partial signing
  const web3Tx = toWeb3JsLegacyTransaction(tx);
  
  // Server-side partial signing:
  // 1. Asset signer MUST sign (it's a generated keypair for the NFT)
  // 2. For "free" flow: deployer signs as thirdPartySigner
  const { Keypair } = await import('@solana/web3.js');
  const assetWeb3Kp = Keypair.fromSecretKey(Uint8Array.from(asset.secretKey));
  web3Tx.partialSign(assetWeb3Kp);
  
  if (flow === 'free') {
    const deployerWeb3Kp = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    web3Tx.partialSign(deployerWeb3Kp);
    console.error('[Prepare] Deployer co-signed for free flow (thirdPartySigner guard)');
  }

  // Serialize (user still needs to sign as payer/owner)
  const serialized = web3Tx.serialize({ requireAllSignatures: false });
  const base64Tx = Buffer.from(serialized).toString('base64');

  const assetData = uploaded[boaId] || {};

  console.log(JSON.stringify({
    success: true,
    transaction: base64Tx,
    asset: asset.publicKey.toString(),
    boaId,
    boaName: `Burned-Out Agent #${boaId}`,
    metadataUri: item.uri,
    imageUri: assetData.imageUri || '',
    collection: cmState.collection,
    cmIndex: nextIndex,
    flow,
    message: flow === 'free' 
      ? 'Sign this transaction in your wallet to mint your free Burn-to-Become NFT'
      : 'Sign this transaction in your wallet to mint a Bored Robot (1 SOL)',
  }));
}

run().catch(e => {
  console.error(`[Prepare] Fatal: ${e.message}`);
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
});
