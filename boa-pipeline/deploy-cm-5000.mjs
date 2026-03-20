/**
 * Deploy new Core Candy Machine with 5,000 items
 * Uses existing collection, loads all metadata URIs
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

const RPC = 'https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const DATA_DIR = process.env.HOME + '/agentfolio/boa-pipeline/candy-machine-data';
const UPLOADED_PATH = path.join(DATA_DIR, 'uploaded-assets.json');
const CM_STATE_PATH = path.join(DATA_DIR, 'core-cm-5000-state.json');
const EXISTING_COLLECTION = 'CCw8NjAS3QpfDU4fBYkJ2kD4znNy468e3wqAJQKoJCFk';

const MAX_SUPPLY = 5000;
const BATCH_SIZE = 8; // Config lines per TX (Core CM limit is ~10 per TX)

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

  console.log(`Authority: ${keypair.publicKey}`);
  console.log(`Collection: ${EXISTING_COLLECTION}`);

  let cmAddress;
  let startIndex = 0;

  // Check if CM already created
  if (fs.existsSync(CM_STATE_PATH)) {
    const state = JSON.parse(fs.readFileSync(CM_STATE_PATH, 'utf-8'));
    cmAddress = state.candyMachine;
    startIndex = state.itemsLoaded || 0;
    console.log(`\nResuming: CM ${cmAddress}, ${startIndex} items already loaded`);
  } else {
    // Create new CM
    console.log(`\nCreating Core CM with ${MAX_SUPPLY} items...`);
    const candyMachine = generateSigner(umi);

    const createTx = await create(umi, {
      candyMachine,
      collection: publicKey(EXISTING_COLLECTION),
      collectionUpdateAuthority: umi.identity,
      itemsAvailable: MAX_SUPPLY,
      authority: umi.identity.publicKey,
      isMutable: true,
      configLineSettings: some({
        prefixName: 'Burned-Out Agent #',
        nameLength: 4,
        prefixUri: '',
        uriLength: 200,
        isSequential: false,
      }),
      guards: {},
    });
    await createTx.sendAndConfirm(umi, options);

    cmAddress = candyMachine.publicKey.toString();
    console.log(`✅ CM created: ${cmAddress}`);

    fs.writeFileSync(CM_STATE_PATH, JSON.stringify({
      type: 'core',
      candyMachine: cmAddress,
      collection: EXISTING_COLLECTION,
      maxSupply: MAX_SUPPLY,
      itemsLoaded: 0,
      createdAt: new Date().toISOString(),
      authority: keypair.publicKey.toString(),
    }, null, 2));
  }

  // Load items in batches
  console.log(`\nLoading items ${startIndex}-${MAX_SUPPLY - 1}...`);

  for (let i = startIndex; i < MAX_SUPPLY; i += BATCH_SIZE) {
    const batchEnd = Math.min(i + BATCH_SIZE, MAX_SUPPLY);
    const configLines = [];

    for (let j = i; j < batchEnd; j++) {
      const num = j + 1; // Images are 1-indexed
      const entry = uploaded[String(num)];
      if (!entry || !entry.metadataUri) {
        console.error(`Missing metadata for #${num}`);
        continue;
      }

      // Name suffix: the number (up to 4 chars)
      const nameSuffix = String(num);

      configLines.push({
        name: nameSuffix,
        uri: entry.metadataUri,
      });
    }

    if (configLines.length === 0) continue;

    try {
      await transactionBuilder()
        .add(setComputeUnitLimit(umi, { units: 400_000 }))
        .add(
          addConfigLines(umi, {
            candyMachine: publicKey(cmAddress),
            index: i,
            configLines,
          })
        )
        .sendAndConfirm(umi, options);

      // Update state
      const state = JSON.parse(fs.readFileSync(CM_STATE_PATH, 'utf-8'));
      state.itemsLoaded = batchEnd;
      fs.writeFileSync(CM_STATE_PATH, JSON.stringify(state, null, 2));

      if (batchEnd % 100 === 0 || batchEnd === MAX_SUPPLY) {
        console.log(`  ✅ Loaded ${batchEnd}/${MAX_SUPPLY}`);
      }
    } catch (e) {
      console.error(`  ❌ Batch ${i}-${batchEnd}: ${e.message}`);
      // Retry once
      try {
        await new Promise(r => setTimeout(r, 2000));
        await transactionBuilder()
          .add(setComputeUnitLimit(umi, { units: 400_000 }))
          .add(
            addConfigLines(umi, {
              candyMachine: publicKey(cmAddress),
              index: i,
              configLines,
            })
          )
          .sendAndConfirm(umi, options);
        
        const state = JSON.parse(fs.readFileSync(CM_STATE_PATH, 'utf-8'));
        state.itemsLoaded = batchEnd;
        fs.writeFileSync(CM_STATE_PATH, JSON.stringify(state, null, 2));
        console.log(`  ✅ Retry OK: ${batchEnd}/${MAX_SUPPLY}`);
      } catch (retryErr) {
        console.error(`  ❌ Retry failed at ${i}: ${retryErr.message}`);
        console.log(`  💾 State saved at index ${i}. Re-run to resume.`);
        process.exit(1);
      }
    }
  }

  // Verify
  console.log('\n🔍 Verifying...');
  const cm = await fetchCandyMachine(umi, publicKey(cmAddress));
  console.log(`  Items available: ${Number(cm.data.itemsAvailable)}`);
  console.log(`  Items loaded: ${cm.items.length}`);
  console.log(`  Items redeemed: ${Number(cm.itemsRedeemed)}`);

  console.log('\n🎉 Done!');
  console.log(`CM: ${cmAddress}`);
  console.log(`Collection: ${EXISTING_COLLECTION}`);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
