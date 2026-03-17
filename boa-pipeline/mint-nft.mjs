/**
 * BOA NFT Minting Pipeline
 * Mints a single NFT with full Metaplex metadata + collection verification
 * 
 * Usage: CLUSTER=devnet node mint-nft.mjs <nft_number> <recipient_wallet>
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { 
  createNft, verifyCollectionV1, mplTokenMetadata 
} from '@metaplex-foundation/mpl-token-metadata';
import { 
  generateSigner, keypairIdentity, percentAmount, publicKey, some 
} from '@metaplex-foundation/umi';
import { findMetadataPda } from '@metaplex-foundation/mpl-token-metadata';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import fs from 'fs';
import path from 'path';

const CLUSTER = process.env.CLUSTER || 'devnet';
const RPC = CLUSTER === 'mainnet' 
  ? 'https://api.mainnet-beta.solana.com'
  : 'https://api.devnet.solana.com';

const TREASURY = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const ASSETS_DIR = process.env.HOME + '/boa-assets';

async function mintBoaNft(nftNumber, recipientWallet) {
  console.log(`=== Mint BOA #${nftNumber} (${CLUSTER}) ===\n`);
  
  // Load collection info
  const collectionPath = `./collection-${CLUSTER}.json`;
  if (!fs.existsSync(collectionPath)) {
    throw new Error(`Collection not found. Run create-collection.mjs first.`);
  }
  const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf-8'));
  console.log('Collection:', collection.collectionMint);
  
  // Load metadata
  const metadataPath = path.join(ASSETS_DIR, 'metadata', `${nftNumber}.json`);
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Metadata not found: ${metadataPath}`);
  }
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  console.log('NFT:', metadata.name);
  console.log('Traits:', metadata.attributes.length);
  
  // Load image
  const imagePath = path.join(ASSETS_DIR, 'images', `${nftNumber}.jpg`);
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image not found: ${imagePath}`);
  }
  
  // Setup UMI
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
  const umi = createUmi(RPC)
    .use(mplTokenMetadata())
    .use(irysUploader());
  
  const keypairBytes = Uint8Array.from(secretKey);
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(keypairBytes);
  umi.use(keypairIdentity(umiKeypair));
  
  console.log('Authority:', umiKeypair.publicKey);
  
  // Step 1: Upload image to Arweave via Irys
  console.log('\n[1/4] Uploading image to Arweave...');
  const imageBuffer = fs.readFileSync(imagePath);
  let imageUri;
  try {
    const [uploadedUri] = await umi.uploader.upload([{
      buffer: imageBuffer,
      fileName: `${nftNumber}.jpg`,
      displayName: `BOA #${nftNumber}`,
      uniqueName: `boa-${nftNumber}-${Date.now()}`,
      contentType: 'image/jpeg',
      extension: 'jpg',
      tags: [{ name: 'Content-Type', value: 'image/jpeg' }],
    }]);
    imageUri = uploadedUri;
    console.log('Image URI:', imageUri);
  } catch (e) {
    console.error('Image upload FAILED:', e.message);
    throw new Error('Image upload to Irys failed: ' + e.message);
  }
  
  // Step 2: Upload metadata JSON to Arweave
  console.log('\n[2/4] Uploading metadata to Arweave...');
  const fullMetadata = {
    name: metadata.name,
    symbol: 'BOA',
    description: metadata.description,
    image: imageUri,
    external_url: `https://agentfolio.bot/nft/${nftNumber}`,
    seller_fee_basis_points: 500,
    attributes: metadata.attributes,
    properties: {
      category: 'image',
      files: [{ uri: imageUri, type: 'image/jpeg' }],
      creators: [
        { address: TREASURY, share: 100 }
      ],
    },
    collection: {
      name: 'Burned-Out Agents',
      family: 'BOA',
    },
  };
  
  let metadataUri;
  try {
    metadataUri = await umi.uploader.uploadJson(fullMetadata);
    console.log('Metadata URI:', metadataUri);
  } catch (e) {
    console.error('Metadata upload FAILED:', e.message);
    throw new Error('Metadata upload to Irys failed: ' + e.message);
  }
  
  // Step 3: Create NFT (SPL token + Metaplex metadata)
  console.log('\n[3/4] Creating NFT...');
  const nftMint = generateSigner(umi);
  
  const createResult = await createNft(umi, {
    mint: nftMint,
    name: metadata.name,
    symbol: 'BOA',
    uri: metadataUri,
    sellerFeeBasisPoints: percentAmount(5),
    collection: some({ key: publicKey(collection.collectionMint), verified: false }),
    creators: [
      { address: publicKey(TREASURY), verified: false, share: 100 },
      { address: umiKeypair.publicKey, verified: true, share: 0 },
    ],
    // tokenOwner will be the authority initially, then transferred
    // For now mint to authority, transfer handled by API
  }).sendAndConfirm(umi);
  
  console.log('✅ NFT Created!');
  console.log('Mint:', nftMint.publicKey.toString());
  
  // Step 4: Verify collection
  console.log('\n[4/4] Verifying collection...');
  try {
    // Wait for confirmation before verifying
    await new Promise(r => setTimeout(r, 2000));
    const nftMetadataPda = findMetadataPda(umi, { mint: nftMint.publicKey });
    await verifyCollectionV1(umi, {
      metadata: nftMetadataPda,
      collectionMint: publicKey(collection.collectionMint),
      authority: umi.identity,
    }).sendAndConfirm(umi);
    console.log('✅ Collection verified!');
  } catch (e) {
    console.log('⚠️ Collection verification deferred:', e.message?.slice(0, 200));
    console.log('  Run: node verify-collection.mjs', nftMint.publicKey.toString());
  }
  
  const result = {
    cluster: CLUSTER,
    nftNumber,
    mint: nftMint.publicKey.toString(),
    collection: collection.collectionMint,
    metadataUri,
    imageUri,
    recipient: recipientWallet || umiKeypair.publicKey.toString(),
    createdAt: new Date().toISOString(),
  };
  
  console.log('\n=== Result ===');
  console.log(JSON.stringify(result, null, 2));
  
  // Save mint record
  const recordsDir = './mint-records';
  if (!fs.existsSync(recordsDir)) fs.mkdirSync(recordsDir, { recursive: true });
  fs.writeFileSync(path.join(recordsDir, `${nftNumber}.json`), JSON.stringify(result, null, 2));
  
  return result;
}

// CLI
const nftNum = parseInt(process.argv[2]) || 1;
const recipient = process.argv[3] || null;
mintBoaNft(nftNum, recipient).catch(console.error);
