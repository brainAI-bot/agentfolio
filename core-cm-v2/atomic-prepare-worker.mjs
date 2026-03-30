/**
 * Atomic Prepare Worker — Client-side signing version
 * 
 * Builds a single unsigned TX that:
 * 1. Mints BOA from Core Candy Machine (user gets Core NFT)
 * 2. Burns the Core NFT immediately (Metaplex Core burnV1)
 * 
 * User signs once in Phantom → one click, one signature.
 * Server partially signs (asset keypair + deployer for free flow).
 * After TX confirms, server mints Token-2022 soulbound + updates Genesis Record.
 * 
 * Usage: node atomic-prepare-worker.mjs <wallet> <flow>
 * flow: "free" (thirdPartySigner, deployer co-signs) or "paid" (solPayment)
 * 
 * Returns JSON: { transaction: base64, asset: pubkey, boaId, ... }
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  mplCandyMachine,
  fetchCandyMachine,
  mintV1 as cmMintV1,
} from '@metaplex-foundation/mpl-core-candy-machine';
import { burnV1 } from '@metaplex-foundation/mpl-core';
import { setComputeUnitLimit, setComputeUnitPrice } from '@metaplex-foundation/mpl-toolbox';
import {
  generateSigner,
  keypairIdentity,
  publicKey,
  transactionBuilder,
  createNoopSigner,
  some,
  none,
} from '@metaplex-foundation/umi';
import { toWeb3JsLegacyTransaction } from '@metaplex-foundation/umi-web3js-adapters';
import { Keypair } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

const recipient = process.argv[2];
const flow = process.argv[3] || 'free';
const agentId = process.argv[4] || null; // Optional: for on-chain PDA anti-gaming

if (!recipient) {
  console.log(JSON.stringify({ error: 'Usage: node atomic-prepare-worker.mjs <wallet> <flow>' }));
  process.exit(1);
}

const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY';
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
  umi.use(keypairIdentity(deployerKeypair));

  const cmPk = publicKey(cmState.candyMachine);
  const collPk = publicKey(cmState.collection);
  const recipientPk = publicKey(recipient);

  // Fetch candy machine state
  const cm = await fetchCandyMachine(umi, cmPk);
  const nextIndex = Number(cm.itemsRedeemed);

  if (nextIndex >= Number(cm.data.itemsAvailable)) {
    console.log(JSON.stringify({ error: 'Collection sold out.' }));
    process.exit(1);
  }

  const item = cm.items[nextIndex];
  if (!item) {
    console.log(JSON.stringify({ error: 'No item at index ' + nextIndex }));
    process.exit(1);
  }

  const nameMatch = item.name.match(/(\d+)/);
  const boaId = nameMatch ? parseInt(nameMatch[1]) : nextIndex + 1;
  const assetData = uploaded[boaId] || {};

  console.error(`[Atomic Prepare] BOA #${boaId} -> ${recipient} (${flow})`);

  // Generate the asset signer
  const asset = generateSigner(umi);
  const ownerSigner = createNoopSigner(recipientPk);

  // Build atomic TX: Mint + Burn
  let builder = transactionBuilder()
    .add(setComputeUnitLimit(umi, { units: 1_000_000 }))
    .add(setComputeUnitPrice(umi, { microLamports: 250_000 }));

  // Step 1: Mint from Candy Machine (owner = recipient)
  if (flow === 'free') {
    builder = builder.add(cmMintV1(umi, {
      candyMachine: cmPk,
      asset,
      collection: collPk,
      owner: recipientPk,
      group: some('free'),
      mintArgs: {
        thirdPartySigner: some({ signer: umi.identity }),
      },
    }));
  } else {
    builder = builder.add(cmMintV1(umi, {
      candyMachine: cmPk,
      asset,
      collection: collPk,
      owner: recipientPk,
      group: some('paid'),
      mintArgs: {
        solPayment: some({ destination: publicKey('FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be') }),
      },
    }));
  }

  // Step 2: Burn the Core NFT (owner = recipient, who is already a signer)
  builder = builder.add(burnV1(umi, {
    asset: asset.publicKey,
    collection: collPk,
    payer: ownerSigner,
    authority: ownerSigner, // Recipient is owner and must authorize burn
    compressionProof: none(),
  }));

  // If agentId provided, add SATP V3 initMintTracker + recordMint instructions
  // These create/update a PDA seeded from [agent_id, candy_machine] to prevent wallet-swap gaming
  if (agentId) {
    try {
      const { PublicKey: PK, TransactionInstruction: TI, SystemProgram: SP } = await import('@solana/web3.js');
      const IDENTITY_PROGRAM = new PK('GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG');
      const agentHash = await import('crypto').then(c => c.createHash('sha256').update(agentId).digest());
      
      // Derive genesis PDA: ["genesis", agent_id_hash]
      const [genesisPda] = PK.findProgramAddressSync(
        [Buffer.from('genesis'), agentHash],
        IDENTITY_PROGRAM
      );
      // Derive mint tracker PDA: ["mint_tracker", genesis_pda]
      const [mintTrackerPda] = PK.findProgramAddressSync(
        [Buffer.from('mint_tracker'), genesisPda.toBuffer()],
        IDENTITY_PROGRAM
      );
      
      const deployerPk = new PK(deployerKeypair.publicKey.toString());
      const recipientWeb3 = new PK(recipient);
      
      // initMintTracker discriminator: [176, 203, 116, 40, 206, 205, 156, 145]
      const initDisc = Buffer.from([176, 203, 116, 40, 206, 205, 156, 145]);
      const initIx = new TI({
        programId: IDENTITY_PROGRAM,
        keys: [
          { pubkey: genesisPda, isSigner: false, isWritable: false },
          { pubkey: mintTrackerPda, isSigner: false, isWritable: true },
          { pubkey: deployerPk, isSigner: true, isWritable: true },
          { pubkey: SP.programId, isSigner: false, isWritable: false },
        ],
        data: initDisc,
      });

      // recordMint discriminator: [162, 92, 105, 126, 18, 1, 158, 242]
      const recordDisc = Buffer.from([162, 92, 105, 126, 18, 1, 158, 242]);
      const recordIx = new TI({
        programId: IDENTITY_PROGRAM,
        keys: [
          { pubkey: genesisPda, isSigner: false, isWritable: false },
          { pubkey: mintTrackerPda, isSigner: false, isWritable: true },
          { pubkey: deployerPk, isSigner: true, isWritable: false },
        ],
        data: recordDisc,
      });

      // Add instructions via UMI instruction wrapper
      const { fromWeb3JsInstruction } = await import('@metaplex-foundation/umi-web3js-adapters');
      builder = builder
        .add({ instruction: fromWeb3JsInstruction(initIx), signers: [umi.identity], bytesCreatedOnChain: 64 })
        .add({ instruction: fromWeb3JsInstruction(recordIx), signers: [umi.identity], bytesCreatedOnChain: 0 });
      
      console.error('[Atomic Prepare] Added initMintTracker + recordMint for', agentId, 'PDA:', mintTrackerPda.toBase58());
    } catch (e) {
      console.error('[Atomic Prepare] PDA anti-gaming failed (non-blocking):', e.message);
      // Continue without PDA — the server-side check still works
    }
  }

  // Build with recipient as fee payer
  const tx = await builder.setFeePayer(ownerSigner).buildWithLatestBlockhash(umi);
  const web3Tx = toWeb3JsLegacyTransaction(tx);

  // Server-side partial signing:
  // 1. Asset signer (generated keypair for the NFT)
  const assetWeb3Kp = Keypair.fromSecretKey(Uint8Array.from(asset.secretKey));
  web3Tx.partialSign(assetWeb3Kp);

  // 2. Deployer co-signs for free flow (thirdPartySigner guard)
  if (flow === 'free') {
    const deployerWeb3Kp = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    web3Tx.partialSign(deployerWeb3Kp);
    console.error('[Atomic Prepare] Deployer co-signed for free flow');
  }

  // Serialize (user still needs to sign as payer + authority)
  const serialized = web3Tx.serialize({ requireAllSignatures: false });
  const base64Tx = Buffer.from(serialized).toString('base64');

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
    atomic: true,
    message: flow === 'free'
      ? 'Sign to mint + burn your BOA in one click (free, deployer co-signed)'
      : 'Sign to mint + burn your BOA in one click (1 SOL)',
  }));
}

run().catch(e => {
  console.error('[Atomic Prepare] Fatal:', e.message);
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
});
