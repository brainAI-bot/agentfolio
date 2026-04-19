/**
 * Test BOA mint end-to-end — calls mintBoaNft directly
 * Mints NFT #99 to a test wallet (the deployer itself for testing)
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { 
  createNft, verifyCollectionV1, findMetadataPda, mplTokenMetadata 
} from '@metaplex-foundation/mpl-token-metadata';
import { 
  generateSigner, keypairIdentity, percentAmount, publicKey, some 
} from '@metaplex-foundation/umi';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import fs from 'fs';
import path from 'path';

const TREASURY = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';
const COLLECTION_MINT = 'xNQmPj1Tcx3PyNNN1RLPeNkaMsZMRthAgWZ7Tbn6RHY';
const DEPLOYER_KEY = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const ASSETS_DIR = '/home/ubuntu/boa-assets';
const RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Pick an NFT number that hasn't been minted yet — use 99
const NFT_NUMBER = 99;
// Mint TO the deployer wallet for testing (we own it)
const RECIPIENT = 'Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc';

async function main() {
  console.log('=== BOA MINT TEST ===');
  console.log('NFT #' + NFT_NUMBER + ' → ' + RECIPIENT);
  
  // Load metadata
  const metadataPath = path.join(ASSETS_DIR, 'metadata', NFT_NUMBER + '.json');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  console.log('Metadata:', metadata.name);
  
  // Load image
  const imagePath = path.join(ASSETS_DIR, 'images', NFT_NUMBER + '.jpg');
  const imageBuffer = fs.readFileSync(imagePath);
  console.log('Image: ' + imageBuffer.length + ' bytes');
  
  // Setup UMI
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_KEY, 'utf-8'));
  const umi = createUmi(RPC)
    .use(mplTokenMetadata())
    .use(irysUploader());
  
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(umiKeypair));
  console.log('Deployer: ' + umiKeypair.publicKey);
  
  // Upload image
  console.log('Uploading image to Irys...');
  const [imageUri] = await umi.uploader.upload([{
    buffer: imageBuffer,
    fileName: NFT_NUMBER + '.jpg',
    displayName: 'BOA #' + NFT_NUMBER,
    uniqueName: 'boa-test-' + NFT_NUMBER + '-' + Date.now(),
    contentType: 'image/jpeg',
    extension: 'jpg',
    tags: [{ name: 'Content-Type', value: 'image/jpeg' }],
  }]);
  console.log('Image URI: ' + imageUri);
  
  // Upload metadata
  console.log('Uploading metadata to Irys...');
  const fullMetadata = {
    name: metadata.name,
    symbol: 'BOA',
    description: metadata.description,
    image: imageUri,
    external_url: 'https://agentfolio.bot/nft/' + NFT_NUMBER,
    seller_fee_basis_points: 500,
    attributes: metadata.attributes,
    properties: {
      category: 'image',
      files: [{ uri: imageUri, type: 'image/jpeg' }],
      creators: [{ address: TREASURY, share: 100 }],
    },
    collection: { name: 'Burned-Out Agents', family: 'BOA' },
  };
  const metadataUri = await umi.uploader.uploadJson(fullMetadata);
  console.log('Metadata URI: ' + metadataUri);
  
  // Create NFT
  const nftMint = generateSigner(umi);
  console.log('Creating NFT on-chain, mint=' + nftMint.publicKey + ' owner=' + RECIPIENT);
  
  const txResult = await createNft(umi, {
    mint: nftMint,
    name: metadata.name,
    symbol: 'BOA',
    uri: metadataUri,
    sellerFeeBasisPoints: percentAmount(5),
    tokenOwner: publicKey(RECIPIENT),
    collection: some({ key: publicKey(COLLECTION_MINT), verified: false }),
    creators: [
      { address: publicKey(TREASURY), verified: false, share: 100 },
      { address: umiKeypair.publicKey, verified: true, share: 0 },
    ],
  }).sendAndConfirm(umi);
  
  console.log('TX confirmed!');
  console.log('Mint address: ' + nftMint.publicKey);
  
  // Verify collection
  console.log('Verifying collection...');
  try {
    await new Promise(r => setTimeout(r, 3000));
    const nftMetadataPda = findMetadataPda(umi, { mint: nftMint.publicKey });
    await verifyCollectionV1(umi, {
      metadata: nftMetadataPda,
      collectionMint: publicKey(COLLECTION_MINT),
      authority: umi.identity,
    }).sendAndConfirm(umi);
    console.log('Collection verified!');
  } catch (e) {
    console.log('Collection verify failed (non-fatal):', e.message?.slice(0, 200));
  }
  
  console.log('\n=== SUCCESS ===');
  console.log('NFT: ' + nftMint.publicKey);
  console.log('View: https://solscan.io/token/' + nftMint.publicKey);
  console.log('Owner: ' + RECIPIENT);
  
  // Save result
  const result = {
    nftNumber: NFT_NUMBER,
    mint: nftMint.publicKey.toString(),
    recipient: RECIPIENT,
    metadataUri,
    imageUri,
    name: metadata.name,
    collection: COLLECTION_MINT,
    mintedAt: new Date().toISOString(),
  };
  fs.writeFileSync('/home/ubuntu/boa-test-mint-result.json', JSON.stringify(result, null, 2));
  console.log('Result saved to /home/ubuntu/boa-test-mint-result.json');
}

main().catch(e => {
  console.error('MINT FAILED:', e.message);
  console.error(e);
  process.exit(1);
});
