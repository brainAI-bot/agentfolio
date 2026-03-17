/**
 * Core Candy Machine Mint Worker
 * Usage: node 06-core-cm-mint.mjs <recipient_wallet>
 * Outputs JSON result to stdout
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  mplCandyMachine as mplCoreCandyMachine,
  fetchCandyMachine,
  mintV1,
} from '@metaplex-foundation/mpl-core-candy-machine';
import { fetchCollectionV1 } from '@metaplex-foundation/mpl-core';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';
import {
  generateSigner,
  keypairIdentity,
  publicKey,
  transactionBuilder,
} from '@metaplex-foundation/umi';
import fs from 'fs';
import path from 'path';

const recipient = process.argv[2];
if (!recipient) {
  console.error(JSON.stringify({ error: 'Usage: node 06-core-cm-mint.mjs <wallet>' }));
  process.exit(1);
}

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const CM_STATE_PATH = path.join(SCRIPT_DIR, '..', 'candy-machine-data', 'core-cm-state.json');
const UPLOADED_PATH = path.join(SCRIPT_DIR, '..', 'candy-machine-data', 'uploaded-assets.json');
const RECORDS_DIR = path.join(SCRIPT_DIR, '..', 'mint-records');

async function run() {
  const cmState = JSON.parse(fs.readFileSync(CM_STATE_PATH, 'utf-8'));
  const uploaded = JSON.parse(fs.readFileSync(UPLOADED_PATH, 'utf-8'));

  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
  const umi = createUmi(RPC).use(mplCoreCandyMachine());
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(umiKeypair));

  const cmPublicKey = publicKey(cmState.candyMachine);
  const collectionMint = publicKey(cmState.collection);

  // Fetch CM state
  const cm = await fetchCandyMachine(umi, cmPublicKey);
  const nextIndex = Number(cm.itemsRedeemed);

  if (nextIndex >= Number(cm.data.itemsAvailable)) {
    console.log(JSON.stringify({ error: 'All items minted. Collection sold out.' }));
    process.exit(1);
  }

  const item = cm.items[nextIndex];
  if (!item) {
    console.log(JSON.stringify({ error: `No item at index ${nextIndex}` }));
    process.exit(1);
  }

  const boaId = parseInt(item.name);
  const metadataUri = item.uri;

  console.error(`[Core CM] Minting index ${nextIndex} → BOA #${boaId} → ${recipient}`);

  // Mint via Core Candy Machine
  const asset = generateSigner(umi);

  await transactionBuilder()
    .add(setComputeUnitLimit(umi, { units: 800_000 }))
    .add(
      mintV1(umi, {
        candyMachine: cmPublicKey,
        asset,
        collection: collectionMint,
        mintArgs: {},
      })
    )
    .sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });

  console.error(`[Core CM] ✅ Minted BOA #${boaId} → ${asset.publicKey}`);

  // Look up image URI
  const assetData = uploaded[boaId] || {};

  // Save mint record
  const record = {
    cluster: 'mainnet',
    nftNumber: boaId,
    mint: asset.publicKey.toString(),
    collection: cmState.collection,
    metadataUri,
    imageUri: assetData.imageUri || '',
    recipient,
    createdAt: new Date().toISOString(),
    source: 'core-candy-machine',
    candyMachine: cmState.candyMachine,
    cmIndex: nextIndex,
  };

  if (!fs.existsSync(RECORDS_DIR)) fs.mkdirSync(RECORDS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RECORDS_DIR, `${boaId}.json`), JSON.stringify(record, null, 2));

  console.log(JSON.stringify({
    success: true,
    boaId,
    boaName: `Burned-Out Agent #${boaId}`,
    mintAddress: asset.publicKey.toString(),
    metadataUri,
    imageUri: assetData.imageUri || '',
    collection: cmState.collection,
    cmIndex: nextIndex,
    itemsRedeemed: nextIndex + 1,
    itemsAvailable: Number(cm.data.itemsAvailable),
  }));
}

run().catch(e => {
  console.error(`[Core CM] Fatal: ${e.message}`);
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
});
