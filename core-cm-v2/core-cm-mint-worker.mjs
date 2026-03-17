/**
 * Core CM Mint Worker — called by the backend API
 * Usage: node core-cm-mint-worker.mjs <recipient_wallet>
 * Must be run from ~/agentfolio/core-cm-v2/ (correct node_modules)
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  mplCandyMachine as mplCoreCandyMachine,
  fetchCandyMachine,
  mintV1,
} from '@metaplex-foundation/mpl-core-candy-machine';
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
  console.log(JSON.stringify({ error: 'Usage: node core-cm-mint-worker.mjs <wallet>' }));
  process.exit(1);
}

const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const DATA_DIR = process.env.HOME + '/agentfolio/boa-pipeline/candy-machine-data';
const CM_STATE_PATH = path.join(DATA_DIR, 'core-cm-state.json');
const UPLOADED_PATH = path.join(DATA_DIR, 'uploaded-assets.json');
const RECORDS_DIR = process.env.HOME + '/agentfolio/boa-pipeline/mint-records';

const options = {
  send: { skipPreflight: true },
  confirm: { commitment: 'confirmed' },
};

async function run() {
  const cmState = JSON.parse(fs.readFileSync(CM_STATE_PATH, 'utf-8'));
  const uploaded = JSON.parse(fs.readFileSync(UPLOADED_PATH, 'utf-8'));
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));

  const umi = createUmi(RPC).use(mplCoreCandyMachine());
  const keypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(keypair));

  const cmPk = publicKey(cmState.candyMachine);
  const collPk = publicKey(cmState.collection);

  const cm = await fetchCandyMachine(umi, cmPk, options.confirm);
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

  // Extract BOA number from full name like "Burned-Out Agent #42"
  const nameMatch = item.name.match(/(\d+)/);
  const boaId = nameMatch ? parseInt(nameMatch[1]) : nextIndex + 1;
  console.error(`[Core CM] Minting index ${nextIndex} → BOA #${boaId} → ${recipient}`);

  const asset = generateSigner(umi);

  await transactionBuilder()
    .add(setComputeUnitLimit(umi, { units: 800_000 }))
    .add(
      mintV1(umi, {
        candyMachine: cmPk,
        asset,
        collection: collPk,
      })
    )
    .sendAndConfirm(umi, options);

  console.error(`[Core CM] ✅ BOA #${boaId} → ${asset.publicKey}`);

  const assetData = uploaded[boaId] || {};

  // Save mint record
  const record = {
    cluster: 'mainnet',
    nftNumber: boaId,
    mint: asset.publicKey.toString(),
    collection: cmState.collection,
    metadataUri: item.uri,
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
    metadataUri: item.uri,
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
