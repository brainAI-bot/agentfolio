/**
 * Create Candy Machine WITHOUT guard (direct CM, no wrapper)
 * Then mint uses mintFromCandyMachineV2 directly
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplTokenMetadata, TokenStandard, createNft } from '@metaplex-foundation/mpl-token-metadata';
import {
  mplCandyMachine,
  createCandyMachineV2,
  addConfigLines,
  fetchCandyMachine,
} from '@metaplex-foundation/mpl-candy-machine';
import { generateSigner, keypairIdentity, percentAmount, some, publicKey, transactionBuilder } from '@metaplex-foundation/umi';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import fs from 'fs';
import path from 'path';

const MAX_SUPPLY = parseInt(process.argv[2]) || 100;
const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const OUTPUT_DIR = process.env.HOME + '/agentfolio/boa-pipeline/candy-machine-data';
const TREASURY = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';
const CM_STATE_PATH = path.join(OUTPUT_DIR, 'candy-machine-state.json');

async function run() {
  if (fs.existsSync(CM_STATE_PATH)) {
    const backup = CM_STATE_PATH.replace('.json', `-backup-${Date.now()}.json`);
    fs.copyFileSync(CM_STATE_PATH, backup);
    fs.unlinkSync(CM_STATE_PATH);
    console.log(`Backed up old state`);
  }

  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
  const umi = createUmi(RPC).use(mplTokenMetadata()).use(mplCandyMachine()).use(irysUploader());
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(umiKeypair));

  console.log(`Creating CM v3 WITHOUT guard (max: ${MAX_SUPPLY})...`);

  // Create collection NFT
  const collectionMint = generateSigner(umi);
  const collImgBuf = fs.readFileSync(process.env.HOME + '/boa-assets/images/1.jpg');
  const [collImgUri] = await umi.uploader.upload([{
    buffer: collImgBuf, fileName: 'coll-v3.jpg', displayName: 'BOA Collection v3',
    uniqueName: `boa-coll-noguard-${Date.now()}`, contentType: 'image/jpeg', extension: 'jpg',
    tags: [{ name: 'Content-Type', value: 'image/jpeg' }],
  }]);
  const collMetaUri = await umi.uploader.uploadJson({
    name: 'Burned-Out Agents', symbol: 'BOA',
    description: 'Burned-Out Agents — 5,000 unique streetwear robots for the AI agent economy.',
    image: collImgUri.replace('https://gateway.irys.xyz/', 'https://uploader.irys.xyz/'),
    external_url: 'https://agentfolio.bot/mint', seller_fee_basis_points: 500,
    properties: { category: 'image', creators: [{ address: TREASURY, share: 100 }] },
  });
  await createNft(umi, {
    mint: collectionMint, name: 'Burned-Out Agents', symbol: 'BOA',
    uri: collMetaUri.replace('https://gateway.irys.xyz/', 'https://uploader.irys.xyz/'),
    sellerFeeBasisPoints: percentAmount(5), isCollection: true,
    creators: [
      { address: publicKey(TREASURY), verified: false, share: 100 },
      { address: umiKeypair.publicKey, verified: true, share: 0 },
    ],
  }).sendAndConfirm(umi);
  console.log(`✅ Collection: ${collectionMint.publicKey}`);

  // Create CM directly (no guard wrapper)
  const candyMachine = generateSigner(umi);
  await transactionBuilder()
    .add(createCandyMachineV2(umi, {
      candyMachine,
      collectionMint: collectionMint.publicKey,
      collectionUpdateAuthority: umi.identity.publicKey,
      tokenStandard: TokenStandard.NonFungible,
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
    }))
    .sendAndConfirm(umi);
  console.log(`✅ Candy Machine (no guard): ${candyMachine.publicKey}`);

  const state = {
    candyMachine: candyMachine.publicKey.toString(),
    collection: collectionMint.publicKey.toString(),
    maxSupply: MAX_SUPPLY,
    tokenStandard: 'NonFungible',
    hasGuard: false,
    createdAt: new Date().toISOString(),
    authority: umiKeypair.publicKey.toString(),
  };
  fs.writeFileSync(CM_STATE_PATH, JSON.stringify(state, null, 2));
  console.log(`State saved`);

  const cm = await fetchCandyMachine(umi, candyMachine.publicKey);
  console.log(`Items: ${cm.itemsRedeemed}/${cm.data.itemsAvailable}`);
}

run().catch(e => { console.error('Fatal:', e.message || e); console.error(e.stack || e); process.exit(1); });
