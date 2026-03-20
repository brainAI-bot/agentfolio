/**
 * Deploy new Core Candy Machine with 5000 items
 * Uses EXISTING collection (CCw8NjAS3QpfDU4fBYkJ2kD4znNy468e3wqAJQKoJCFk)
 * Loads all 5000 metadata URIs from uploaded-assets.json
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  mplCandyMachine as mplCoreCandyMachine,
  create,
  addConfigLines,
  fetchCandyMachine,
} from '@metaplex-foundation/mpl-core-candy-machine';
import {
  generateSigner,
  keypairIdentity,
  some,
  publicKey,
  transactionBuilder,
} from '@metaplex-foundation/umi';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';
import fs from 'fs';
import path from 'path';

const MAX_SUPPLY = 5000;
const RPC = 'https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const DATA_DIR = process.env.HOME + '/agentfolio/boa-pipeline/candy-machine-data';
const UPLOADED_PATH = path.join(DATA_DIR, 'uploaded-assets.json');
const CM_STATE_PATH = path.join(DATA_DIR, 'core-cm-state.json');

// Existing collection from old CM
const COLLECTION_MINT = 'CCw8NjAS3QpfDU4fBYkJ2kD4znNy468e3wqAJQKoJCFk';

const options = {
  send: { skipPreflight: true },
  confirm: { commitment: 'confirmed' },
};

async function main() {
  const uploaded = JSON.parse(fs.readFileSync(UPLOADED_PATH, 'utf-8'));
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));

  const umi = createUmi(RPC).use(mplCoreCandyMachine());
  const keypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(keypair));

  console.log('Authority:', keypair.publicKey.toString());
  console.log(`Deploying Core CM (${MAX_SUPPLY} items) on mainnet...`);
  console.log(`Collection: ${COLLECTION_MINT}\n`);

  // Create Core Candy Machine
  const candyMachine = generateSigner(umi);
  console.log('1. Creating Core Candy Machine...');
  console.log('   CM address:', candyMachine.publicKey.toString());

  const createTx = await create(umi, {
    candyMachine,
    collection: publicKey(COLLECTION_MINT),
    collectionUpdateAuthority: umi.identity,
    itemsAvailable: MAX_SUPPLY,
    authority: umi.identity.publicKey,
    isMutable: true,
    configLineSettings: some({
      prefixName: 'Burned-Out Agent #',
      nameLength: 4,
      prefixUri: '',
      uriLength: 200,
      isSequential: false, // RANDOM order
    }),
  });

  await createTx.sendAndConfirm(umi, options);
  console.log('✅ Candy Machine created!\n');

  // Load items in batches (max ~10 per TX due to size limits)
  console.log('2. Loading items...');
  const BATCH_SIZE = 8;
  let loaded = 0;

  for (let batchStart = 0; batchStart < MAX_SUPPLY; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, MAX_SUPPLY);
    const configLines = [];

    for (let i = batchStart; i < batchEnd; i++) {
      const nftNum = i + 1; // 1-indexed
      const entry = uploaded[String(nftNum)];
      if (!entry || !entry.metadataUri) {
        console.error(`Missing metadata for #${nftNum}!`);
        continue;
      }

      configLines.push({
        name: String(nftNum).padStart(4, ' '), // nameLength: 4
        uri: entry.metadataUri,
      });
    }

    if (configLines.length === 0) continue;

    try {
      await transactionBuilder()
        .add(setComputeUnitLimit(umi, { units: 400_000 }))
        .add(
          addConfigLines(umi, {
            candyMachine: candyMachine.publicKey,
            index: batchStart,
            configLines,
          })
        )
        .sendAndConfirm(umi, options);

      loaded += configLines.length;
      if (loaded % 100 === 0 || loaded <= 20) {
        console.log(`   Loaded: ${loaded}/${MAX_SUPPLY}`);
      }
    } catch (e) {
      console.error(`   ❌ Batch ${batchStart}-${batchEnd}: ${e.message}`);
      // Retry once
      try {
        await new Promise(r => setTimeout(r, 2000));
        await transactionBuilder()
          .add(setComputeUnitLimit(umi, { units: 400_000 }))
          .add(
            addConfigLines(umi, {
              candyMachine: candyMachine.publicKey,
              index: batchStart,
              configLines,
            })
          )
          .sendAndConfirm(umi, options);
        loaded += configLines.length;
        console.log(`   ✅ Retry succeeded: ${loaded}/${MAX_SUPPLY}`);
      } catch (retryErr) {
        console.error(`   ❌ Retry failed: ${retryErr.message}`);
      }
    }
  }

  console.log(`\n✅ Loaded ${loaded}/${MAX_SUPPLY} items`);

  // Verify
  const cm = await fetchCandyMachine(umi, candyMachine.publicKey);
  console.log(`\n3. Verification:`);
  console.log(`   CM: ${candyMachine.publicKey.toString()}`);
  console.log(`   Collection: ${cm.collectionMint?.toString()}`);
  console.log(`   Items available: ${Number(cm.data.itemsAvailable)}`);
  console.log(`   Items redeemed: ${Number(cm.itemsRedeemed)}`);
  console.log(`   Items loaded: ${cm.items?.length || 0}`);
  console.log(`   Sequential: ${cm.data.configLineSettings?.value?.isSequential}`);

  // Save state
  const state = {
    type: 'core',
    candyMachine: candyMachine.publicKey.toString(),
    collection: COLLECTION_MINT,
    maxSupply: MAX_SUPPLY,
    itemsLoaded: loaded,
    createdAt: new Date().toISOString(),
    authority: keypair.publicKey.toString(),
    oldCandyMachine: '2BmStMMfG8uH1crHwEopbrcPPevQ3qj9SN7Y67M8DYPV',
  };
  fs.writeFileSync(CM_STATE_PATH, JSON.stringify(state, null, 2));
  console.log('\n✅ State saved to core-cm-state.json');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
