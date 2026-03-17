/**
 * Step 3: Load items into the Candy Machine
 * Usage: node 03-load-items.mjs
 * Reads from uploaded-assets.json and candy-machine-state.json
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import {
  mplCandyMachine,
  addConfigLines,
  fetchCandyMachine,
} from '@metaplex-foundation/mpl-candy-machine';
import { keypairIdentity, publicKey } from '@metaplex-foundation/umi';
import fs from 'fs';
import path from 'path';

const BATCH_SIZE = 10; // Items per TX (Candy Machine limit is ~10-14 per TX)

const RPC = process.env.SOLANA_RPC_URL || process.env.SOLANA_RPC || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const OUTPUT_DIR = process.env.HOME + '/agentfolio/boa-pipeline/candy-machine-data';

async function run() {
  const cmState = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, 'candy-machine-state.json'), 'utf-8'));
  const uploaded = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, 'uploaded-assets.json'), 'utf-8'));

  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
  const umi = createUmi(RPC).use(mplTokenMetadata()).use(mplCandyMachine());
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(umiKeypair));

  const cmPublicKey = publicKey(cmState.candyMachine);

  // Fetch current state to know which items are loaded
  const cm = await fetchCandyMachine(umi, cmPublicKey);
  const loadedCount = cm.itemsLoaded || 0;
  console.log(`Candy Machine: ${cmState.candyMachine}`);
  console.log(`Items loaded: ${loadedCount}/${cm.data.itemsAvailable}`);

  // Prepare items sorted by ID
  const ids = Object.keys(uploaded)
    .map(Number)
    .sort((a, b) => a - b)
    .slice(0, cmState.maxSupply);

  console.log(`Preparing ${ids.length} items for loading...`);

  // Skip already loaded items
  const toLoad = ids.slice(loadedCount);
  if (toLoad.length === 0) {
    console.log('All items already loaded!');
    return;
  }

  console.log(`Loading ${toLoad.length} items starting from index ${loadedCount}...`);

  for (let batch = 0; batch < toLoad.length; batch += BATCH_SIZE) {
    const batchIds = toLoad.slice(batch, batch + BATCH_SIZE);
    const index = loadedCount + batch;

    const configLines = batchIds.map((id, i) => ({
      name: String(id), // Appended to prefix "Burned-Out Agent #"
      uri: uploaded[id].metadataUri,
    }));

    try {
      await addConfigLines(umi, {
        candyMachine: cmPublicKey,
        index,
        configLines,
      }).sendAndConfirm(umi);
      console.log(`  ✅ Loaded items ${index}-${index + batchIds.length - 1} (IDs: ${batchIds.join(', ')})`);
    } catch (e) {
      console.error(`  ❌ Failed batch at index ${index}: ${e.message}`);
      // Save progress point
      console.log(`  Resume from index ${index}`);
      break;
    }

    await new Promise(r => setTimeout(r, 500));
  }

  // Verify final state
  const finalCm = await fetchCandyMachine(umi, cmPublicKey);
  console.log(`\n✅ Items loaded: ${finalCm.itemsLoaded}/${finalCm.data.itemsAvailable}`);
  console.log(`Items redeemed: ${finalCm.itemsRedeemed}`);
}

run().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
