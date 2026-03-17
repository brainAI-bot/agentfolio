/**
 * Core Candy Machine — Full Deploy Script
 * Creates collection, deploys CM, loads 100 items, and does test mint
 * Usage: node 05-core-cm-deploy.mjs [maxSupply]
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  mplCandyMachine as mplCoreCandyMachine,
  create,
  createCandyMachine,
  addConfigLines,
  fetchCandyMachine,
  mintV1,
} from '@metaplex-foundation/mpl-core-candy-machine';
import { createCollectionV1 } from '@metaplex-foundation/mpl-core';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';
import {
  generateSigner,
  keypairIdentity,
  some,
  publicKey,
  transactionBuilder,
  percentAmount,
} from '@metaplex-foundation/umi';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import fs from 'fs';
import path from 'path';

const MAX_SUPPLY = parseInt(process.argv[2]) || 100;
const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const OUTPUT_DIR = process.env.HOME + '/agentfolio/boa-pipeline/candy-machine-data';
const UPLOADED_PATH = path.join(OUTPUT_DIR, 'uploaded-assets.json');
const CM_STATE_PATH = path.join(OUTPUT_DIR, 'core-cm-state.json');
const TREASURY = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function run() {
  if (fs.existsSync(CM_STATE_PATH)) {
    console.log('Core CM state already exists. Delete core-cm-state.json to re-deploy.');
    const state = JSON.parse(fs.readFileSync(CM_STATE_PATH, 'utf-8'));
    console.log(JSON.stringify(state, null, 2));
    process.exit(0);
  }

  const uploaded = JSON.parse(fs.readFileSync(UPLOADED_PATH, 'utf-8'));
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));

  const umi = createUmi(RPC).use(mplCoreCandyMachine()).use(irysUploader());
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(umiKeypair));

  const options = { confirm: { commitment: 'confirmed' } };

  console.log(`Authority: ${umiKeypair.publicKey}`);
  console.log(`Deploying Core Candy Machine (${MAX_SUPPLY} items)...`);

  // === 1. Create Core Collection ===
  console.log('\n--- Step 1: Create Core Collection ---');
  const collectionMint = generateSigner(umi);

  // Upload collection image + metadata
  const collImgBuf = fs.readFileSync(process.env.HOME + '/boa-assets/images/1.jpg');
  const [collImgUri] = await umi.uploader.upload([{
    buffer: collImgBuf, fileName: 'boa-collection.jpg', displayName: 'BOA Collection',
    uniqueName: `boa-core-collection-${Date.now()}`, contentType: 'image/jpeg', extension: 'jpg',
    tags: [{ name: 'Content-Type', value: 'image/jpeg' }],
  }]);
  const collMetaUri = await umi.uploader.uploadJson({
    name: 'Burned-Out Agents', symbol: 'BOA',
    description: 'Burned-Out Agents — 5,000 unique streetwear robots for the AI agent economy.',
    image: collImgUri.replace('https://gateway.irys.xyz/', 'https://uploader.irys.xyz/'),
    external_url: 'https://agentfolio.bot/mint',
  });

  await createCollectionV1(umi, {
    collection: collectionMint,
    name: 'Burned-Out Agents',
    uri: collMetaUri.replace('https://gateway.irys.xyz/', 'https://uploader.irys.xyz/'),
  }).sendAndConfirm(umi, options);
  console.log(`✅ Collection: ${collectionMint.publicKey}`);

  // === 2. Create Core Candy Machine ===
  console.log('\n--- Step 2: Create Core Candy Machine ---');
  const candyMachine = generateSigner(umi);

  // Use default config line settings (nameLength=32, uriLength=200)
  const cmBuilder = await createCandyMachine(umi, {
    candyMachine,
    collection: collectionMint.publicKey,
    collectionUpdateAuthority: umi.identity,
    itemsAvailable: MAX_SUPPLY,
    authority: umi.identity.publicKey,
    isMutable: true,
    configLineSettings: some({
      prefixName: '',
      nameLength: 32,
      prefixUri: '',
      uriLength: 200,
      isSequential: false,
    }),
  });
  await cmBuilder.sendAndConfirm(umi, options);
  console.log(`✅ Candy Machine: ${candyMachine.publicKey}`);

  // === 3. Load items ===
  console.log('\n--- Step 3: Load items ---');
  const ids = Object.keys(uploaded).map(Number).sort((a, b) => a - b).slice(0, MAX_SUPPLY);
  const BATCH_SIZE = 10;

  for (let batch = 0; batch < ids.length; batch += BATCH_SIZE) {
    const batchIds = ids.slice(batch, batch + BATCH_SIZE);
    const configLines = batchIds.map(id => ({
      name: String(id),
      uri: uploaded[id].metadataUri,
    }));

    await addConfigLines(umi, {
      candyMachine: candyMachine.publicKey,
      index: batch,
      configLines,
    }).sendAndConfirm(umi, options);
    console.log(`  ✅ Loaded items ${batch}-${batch + batchIds.length - 1}`);
    await new Promise(r => setTimeout(r, 500));
  }

  // === 4. Verify ===
  console.log('\n--- Step 4: Verify ---');
  const cm = await fetchCandyMachine(umi, candyMachine.publicKey, options.confirm);
  console.log(`Items loaded: ${cm.itemsLoaded}/${cm.data.itemsAvailable}`);
  console.log(`Items redeemed: ${cm.itemsRedeemed}`);

  // === 5. Save state ===
  const state = {
    type: 'core',
    candyMachine: candyMachine.publicKey.toString(),
    collection: collectionMint.publicKey.toString(),
    maxSupply: MAX_SUPPLY,
    itemsLoaded: cm.itemsLoaded,
    createdAt: new Date().toISOString(),
    authority: umiKeypair.publicKey.toString(),
  };
  fs.writeFileSync(CM_STATE_PATH, JSON.stringify(state, null, 2));
  console.log(`\n✅ Core Candy Machine deployed! State saved to ${CM_STATE_PATH}`);
}

run().catch(e => {
  console.error('Fatal:', e.message || e);
  process.exit(1);
});
