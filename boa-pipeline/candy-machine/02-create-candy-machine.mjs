/**
 * Step 2: Create Candy Machine v3 with pNFT (non-transferable) config
 * Usage: node 02-create-candy-machine.mjs [maxSupply]
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplTokenMetadata, TokenStandard } from '@metaplex-foundation/mpl-token-metadata';
import {
  mplCandyMachine,
  create,
  addConfigLines,
  fetchCandyMachine,
} from '@metaplex-foundation/mpl-candy-machine';
import { generateSigner, keypairIdentity, percentAmount, some, publicKey, sol, none } from '@metaplex-foundation/umi';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import fs from 'fs';
import path from 'path';

const MAX_SUPPLY = parseInt(process.argv[2]) || 100;

const RPC = process.env.SOLANA_RPC_URL || process.env.SOLANA_RPC || 'https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const OUTPUT_DIR = process.env.HOME + '/agentfolio/boa-pipeline/candy-machine-data';
const TREASURY = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';
const CM_STATE_PATH = path.join(OUTPUT_DIR, 'candy-machine-state.json');

async function run() {
  if (fs.existsSync(CM_STATE_PATH)) {
    const existing = JSON.parse(fs.readFileSync(CM_STATE_PATH, 'utf-8'));
    console.log(`Candy Machine already exists: ${existing.candyMachine}`);
    console.log(`Collection: ${existing.collection}`);
    console.log('Delete candy-machine-state.json to create a new one.');
    process.exit(0);
  }

  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
  const umi = createUmi(RPC).use(mplTokenMetadata()).use(mplCandyMachine()).use(irysUploader());
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(umiKeypair));

  console.log(`Creating Candy Machine v3 (pNFT, max supply: ${MAX_SUPPLY})...`);
  console.log(`Authority: ${umiKeypair.publicKey}`);

  // Create collection NFT first
  const { createNft } = await import('@metaplex-foundation/mpl-token-metadata');
  const collectionMint = generateSigner(umi);

  // Upload collection metadata
  const collectionImageBuffer = fs.readFileSync(process.env.HOME + '/boa-assets/images/1.jpg'); // Use #1 as collection image
  const [collectionImageUri] = await umi.uploader.upload([{
    buffer: collectionImageBuffer,
    fileName: 'collection.jpg',
    displayName: 'BOA Collection',
    uniqueName: 'boa-collection-v3',
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
    properties: {
      category: 'image',
      creators: [{ address: TREASURY, share: 100 }],
    },
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

  console.log(`✅ Collection NFT: ${collectionMint.publicKey}`);

  // Create Candy Machine
  const candyMachine = generateSigner(umi);

  const createBuilder = await create(umi, {
    candyMachine,
    collectionMint: collectionMint.publicKey,
    collectionUpdateAuthority: umi.identity,
    tokenStandard: TokenStandard.ProgrammableNonFungible,
    sellerFeeBasisPoints: percentAmount(5),
    itemsAvailable: MAX_SUPPLY,
    creators: [
      { address: publicKey(TREASURY), verified: false, percentageShare: 100 },
      { address: umi.identity.publicKey, verified: true, percentageShare: 0 },
    ],
    configLineSettings: some({
      prefixName: 'Burned-Out Agent #',
      nameLength: 4, // Up to 4 digit numbers (1-5000)
      prefixUri: '',
      uriLength: 200, // Full Irys URI
      isSequential: false, // Random order
    }),
    guards: {},
  });
  await createBuilder.sendAndConfirm(umi);

  console.log(`✅ Candy Machine created: ${candyMachine.publicKey}`);

  // Save state
  const state = {
    candyMachine: candyMachine.publicKey.toString(),
    collection: collectionMint.publicKey.toString(),
    maxSupply: MAX_SUPPLY,
    tokenStandard: 'ProgrammableNonFungible',
    createdAt: new Date().toISOString(),
    authority: umiKeypair.publicKey.toString(),
  };
  fs.writeFileSync(CM_STATE_PATH, JSON.stringify(state, null, 2));
  console.log(`State saved to ${CM_STATE_PATH}`);

  // Verify
  const cm = await fetchCandyMachine(umi, candyMachine.publicKey);
  console.log(`\nCandy Machine Details:`);
  console.log(`  Items Available: ${cm.itemsRedeemed}/${cm.data.itemsAvailable}`);
  console.log(`  Token Standard: ProgrammableNonFungible (soulbound)`);
  console.log(`  Collection: ${collectionMint.publicKey}`);
}

run().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
