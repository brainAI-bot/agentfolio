/**
 * Core CM Mainnet — WITHOUT guard (createCandyMachine directly)
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  mplCandyMachine as mplCoreCandyMachine,
  createCandyMachine,
  addConfigLines,
  fetchCandyMachine,
  mintAssetFromCandyMachine,
} from '@metaplex-foundation/mpl-core-candy-machine';
import { createCollectionV1 } from '@metaplex-foundation/mpl-core';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';
import {
  generateSigner,
  keypairIdentity,
  some,
  transactionBuilder,
} from '@metaplex-foundation/umi';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import fs from 'fs';
import path from 'path';

const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const OUTPUT_DIR = process.env.HOME + '/agentfolio/boa-pipeline/candy-machine-data';
const UPLOADED_PATH = path.join(OUTPUT_DIR, 'uploaded-assets.json');
const CM_STATE_PATH = path.join(OUTPUT_DIR, 'core-cm-state.json');

async function main() {
  const uploaded = JSON.parse(fs.readFileSync(UPLOADED_PATH, 'utf-8'));
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));

  const umi = createUmi(RPC).use(mplCoreCandyMachine()).use(irysUploader());
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(umiKeypair));

  const options = { confirm: { commitment: 'confirmed' } };

  // Reuse existing collection from previous attempts
  const collectionMint = generateSigner(umi);
  const collImgBuf = fs.readFileSync(process.env.HOME + '/boa-assets/images/1.jpg');
  const [collImgUri] = await umi.uploader.upload([{
    buffer: collImgBuf, fileName: 'boa-coll-ng.jpg', displayName: 'BOA',
    uniqueName: `boa-ng-${Date.now()}`, contentType: 'image/jpeg', extension: 'jpg',
    tags: [{ name: 'Content-Type', value: 'image/jpeg' }],
  }]);
  const collMetaUri = await umi.uploader.uploadJson({
    name: 'Burned-Out Agents', symbol: 'BOA',
    description: 'BOA collection', image: collImgUri.replace('https://gateway.irys.xyz/', 'https://uploader.irys.xyz/'),
  });

  await createCollectionV1(umi, {
    collection: collectionMint,
    name: 'Burned-Out Agents',
    uri: collMetaUri.replace('https://gateway.irys.xyz/', 'https://uploader.irys.xyz/'),
  }).sendAndConfirm(umi, options);
  console.log('✅ Collection:', collectionMint.publicKey.toString());

  // Create CM WITHOUT guard wrapper
  const candyMachine = generateSigner(umi);
  console.log('Creating CM (no guard)...');

  const cmBuilder = await createCandyMachine(umi, {
    candyMachine,
    collection: collectionMint.publicKey,
    collectionUpdateAuthority: umi.identity,
    itemsAvailable: 3,
    authority: umi.identity.publicKey,
    isMutable: true,
    configLineSettings: some({
      prefixName: 'BOA #',
      nameLength: 4,
      prefixUri: 'https://agentfolio.bot/nft/',
      uriLength: 10,
      isSequential: false,
    }),
  });
  await cmBuilder.sendAndConfirm(umi, options);
  console.log('✅ Candy Machine (no guard):', candyMachine.publicKey.toString());

  // Add items
  await addConfigLines(umi, {
    candyMachine: candyMachine.publicKey,
    index: 0,
    configLines: [
      { name: '1', uri: '1.json' },
      { name: '2', uri: '2.json' },
      { name: '3', uri: '3.json' },
    ],
  }).sendAndConfirm(umi, options);
  console.log('✅ Items added');

  // Mint with mintAssetFromCandyMachine (no guard)
  const asset = generateSigner(umi);
  await transactionBuilder()
    .add(setComputeUnitLimit(umi, { units: 800_000 }))
    .add(
      mintAssetFromCandyMachine(umi, {
        candyMachine: candyMachine.publicKey,
        asset,
        collection: collectionMint.publicKey,
        mintAuthority: umi.identity,
      })
    )
    .sendAndConfirm(umi, options);
  console.log('✅ Minted:', asset.publicKey.toString());
  console.log('🎉 MAINNET NO-GUARD TEST PASSED!');
}

main().catch(e => {
  console.error('FAILED:', e.message || e);
  process.exit(1);
});
