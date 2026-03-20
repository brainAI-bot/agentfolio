/**
 * Core Candy Machine — Mainnet Deploy
 * Creates collection, deploys CM, loads 100 items
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  mplCandyMachine as mplCoreCandyMachine,
  create,
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
} from '@metaplex-foundation/umi';
import fs from 'fs';
import path from 'path';

const MAX_SUPPLY = 5000;
const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const DATA_DIR = process.env.HOME + '/agentfolio/boa-pipeline/candy-machine-data';
const UPLOADED_PATH = path.join(DATA_DIR, 'uploaded-assets.json');
const CM_STATE_PATH = path.join(DATA_DIR, 'core-cm-state.json');

const options = {
  send: { skipPreflight: true },
  confirm: { commitment: 'confirmed' },
};

async function main() {
  if (false && fs.existsSync(CM_STATE_PATH)) {
    const state = JSON.parse(fs.readFileSync(CM_STATE_PATH, 'utf-8'));
    console.log('Core CM already deployed:', JSON.stringify(state, null, 2));
    process.exit(0);
  }

  const uploaded = JSON.parse(fs.readFileSync(UPLOADED_PATH, 'utf-8'));
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));

  const umi = createUmi(RPC).use(mplCoreCandyMachine());
  const keypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(keypair));

  const collectionMint = generateSigner(umi);
  const candyMachine = generateSigner(umi);

  console.log('Authority:', keypair.publicKey.toString());
  console.log(`Deploying Core CM (${MAX_SUPPLY} items) on mainnet...`);

  // 1. Use EXISTING collection (not creating new)
  console.log('\n1. Using existing collection: CCw8NjAS3QpfDU4fBYkJ2kD4znNy468e3wqAJQKoJCFk');
  const existingCollection = publicKey('CCw8NjAS3QpfDU4fBYkJ2kD4znNy468e3wqAJQKoJCFk');

  // 2. Create Core Candy Machine
  console.log('\n2. Creating Core Candy Machine...');
  const createTx = await create(umi, {
    candyMachine,
    collection: existingCollection,
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
  console.log('✅ Candy Machine:', candyMachine.publicKey.toString());

  // 3. Load items
  console.log('\n3. Loading items...');
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

  // 4. Verify
  console.log('\n4. Verifying...');
  const cm = await fetchCandyMachine(umi, candyMachine.publicKey, options.confirm);
  console.log(`Items loaded: ${cm.itemsLoaded}/${cm.data.itemsAvailable}`);
  console.log(`Items redeemed: ${cm.itemsRedeemed}`);

  // 5. Test mint
  console.log('\n5. Test minting...');
  const asset = generateSigner(umi);
  await transactionBuilder()
    .add(setComputeUnitLimit(umi, { units: 800_000 }))
    .add(
      mintV1(umi, {
        candyMachine: candyMachine.publicKey,
        asset,
        collection: existingCollection,
      })
    )
    .sendAndConfirm(umi, options);
  console.log('✅ Test mint:', asset.publicKey.toString());

  const cm2 = await fetchCandyMachine(umi, candyMachine.publicKey, options.confirm);
  console.log(`Items redeemed: ${cm2.itemsRedeemed}`);

  // 6. Save state
  const state = {
    type: 'core',
    candyMachine: candyMachine.publicKey.toString(),
    collection: collectionMint.publicKey.toString(),
    maxSupply: MAX_SUPPLY,
    itemsLoaded: cm.itemsLoaded,
    createdAt: new Date().toISOString(),
    authority: keypair.publicKey.toString(),
    testMint: asset.publicKey.toString(),
  };
  fs.writeFileSync(CM_STATE_PATH, JSON.stringify(state, null, 2));
  console.log(`\n🎉 Core CM deployed on mainnet!`);
  console.log(JSON.stringify(state, null, 2));
}

main().catch(e => {
  console.error('Fatal:', e.message || e);
  if (e.logs) console.error('Logs:', JSON.stringify(e.logs, null, 2));
  process.exit(1);
});
