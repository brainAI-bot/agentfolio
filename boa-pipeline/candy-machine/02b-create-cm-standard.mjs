/**
 * Step 2b: Create Candy Machine v3 with standard NonFungible + freeze after mint
 * Usage: node 02b-create-cm-standard.mjs [maxSupply]
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplTokenMetadata, TokenStandard, createNft } from '@metaplex-foundation/mpl-token-metadata';
import {
  mplCandyMachine,
  create,
  addConfigLines,
  fetchCandyMachine,
} from '@metaplex-foundation/mpl-candy-machine';
import { generateSigner, keypairIdentity, percentAmount, some, publicKey, none } from '@metaplex-foundation/umi';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import fs from 'fs';
import path from 'path';

const MAX_SUPPLY = parseInt(process.argv[2]) || 100;

const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const OUTPUT_DIR = process.env.HOME + '/agentfolio/boa-pipeline/candy-machine-data';
const TREASURY = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';
const CM_STATE_PATH = path.join(OUTPUT_DIR, 'candy-machine-state.json');

async function run() {
  // Back up old state if exists
  if (fs.existsSync(CM_STATE_PATH)) {
    const backup = CM_STATE_PATH.replace('.json', `-backup-${Date.now()}.json`);
    fs.copyFileSync(CM_STATE_PATH, backup);
    fs.unlinkSync(CM_STATE_PATH);
    console.log(`Backed up old state to ${backup}`);
  }

  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
  const umi = createUmi(RPC).use(mplTokenMetadata()).use(mplCandyMachine()).use(irysUploader());
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(umiKeypair));

  console.log(`Creating Candy Machine v3 (NonFungible + post-mint freeze, max: ${MAX_SUPPLY})...`);

  // Create collection NFT
  const collectionMint = generateSigner(umi);
  const collectionImageBuffer = fs.readFileSync(process.env.HOME + '/boa-assets/images/1.jpg');
  const [collectionImageUri] = await umi.uploader.upload([{
    buffer: collectionImageBuffer,
    fileName: 'collection-v2.jpg',
    displayName: 'BOA Collection v2',
    uniqueName: `boa-collection-v3-std-${Date.now()}`,
    contentType: 'image/jpeg',
    extension: 'jpg',
    tags: [{ name: 'Content-Type', value: 'image/jpeg' }],
  }]);

  const collectionMetadataUri = await umi.uploader.uploadJson({
    name: 'Burned-Out Agents',
    symbol: 'BOA',
    description: 'Burned-Out Agents — 5,000 unique streetwear robots for the AI agent economy. Soulbound on Solana.',
    image: collectionImageUri.replace('https://gateway.irys.xyz/', 'https://uploader.irys.xyz/'),
    external_url: 'https://agentfolio.bot/mint',
    seller_fee_basis_points: 500,
    properties: { category: 'image', creators: [{ address: TREASURY, share: 100 }] },
  });

  console.log('Creating collection NFT...');
  await createNft(umi, {
    mint: collectionMint,
    name: 'Burned-Out Agents',
    symbol: 'BOA',
    uri: collectionMetadataUri.replace('https://gateway.irys.xyz/', 'https://uploader.irys.xyz/'),
    sellerFeeBasisPoints: percentAmount(5),
    isCollection: true,
    creators: [
      { address: publicKey(TREASURY), verified: false, share: 100 },
      { address: umiKeypair.publicKey, verified: true, share: 0 },
    ],
  }).sendAndConfirm(umi);
  console.log(`✅ Collection: ${collectionMint.publicKey}`);

  // Create Candy Machine with NonFungible standard
  const candyMachine = generateSigner(umi);
  const createBuilder = await create(umi, {
    candyMachine,
    collectionMint: collectionMint.publicKey,
    collectionUpdateAuthority: umi.identity,
    tokenStandard: TokenStandard.NonFungible, // Standard NFT — freeze after mint for soulbound
    sellerFeeBasisPoints: percentAmount(5),
    itemsAvailable: MAX_SUPPLY,
    creators: [
      { address: publicKey(TREASURY), verified: false, percentageShare: 100 },
      { address: umi.identity.publicKey, verified: true, percentageShare: 0 },
    ],
    configLineSettings: some({
      prefixName: 'Burned-Out Agent #',
      nameLength: 4,
      prefixUri: '',
      uriLength: 200,
      isSequential: false,
    }),
    guards: {},
  });
  await createBuilder.sendAndConfirm(umi);
  console.log(`✅ Candy Machine: ${candyMachine.publicKey}`);

  const state = {
    candyMachine: candyMachine.publicKey.toString(),
    collection: collectionMint.publicKey.toString(),
    maxSupply: MAX_SUPPLY,
    tokenStandard: 'NonFungible',
    soulboundMethod: 'freeze-delegate-after-mint',
    createdAt: new Date().toISOString(),
    authority: umiKeypair.publicKey.toString(),
  };
  fs.writeFileSync(CM_STATE_PATH, JSON.stringify(state, null, 2));
  console.log(`State saved to ${CM_STATE_PATH}`);

  const cm = await fetchCandyMachine(umi, candyMachine.publicKey);
  console.log(`\nItems: ${cm.itemsRedeemed}/${cm.data.itemsAvailable}`);
  console.log(`Token Standard: NonFungible (+ freeze delegate = soulbound)`);
}

run().catch(e => {
  console.error('Fatal:', e.message || e);
  process.exit(1);
});
