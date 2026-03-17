/**
 * BOA NFT Mint Finalization — Server-side Metaplex minting
 * Called after payment TX is confirmed on-chain
 * 
 * POST /api/boa/mint/finalize
 * Body: { wallet: "...", payment_tx: "...", nft_number: N }
 * Returns: { mint: "...", metadata_uri: "...", image_uri: "...", tx: "..." }
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createNft, verifyCollectionV1, findMetadataPda, mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { generateSigner, keypairIdentity, percentAmount, publicKey, some } from '@metaplex-foundation/umi';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import { transferSol } from '@metaplex-foundation/umi';
import fs from 'fs';
import path from 'path';

const TREASURY = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const ASSETS_DIR = process.env.HOME + '/boa-assets';

export async function mintBoaNft(cluster, nftNumber, recipientWallet) {
  const RPC = cluster === 'mainnet' 
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.devnet.solana.com';
  
  const collectionPath = path.join(path.dirname(new URL(import.meta.url).pathname), `collection-${cluster}.json`);
  if (!fs.existsSync(collectionPath)) {
    throw new Error(`Collection not found for ${cluster}. Run create-collection.mjs first.`);
  }
  const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf-8'));
  
  // Load metadata
  const metadataPath = path.join(ASSETS_DIR, 'metadata', `${nftNumber}.json`);
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Metadata not found for NFT #${nftNumber}`);
  }
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  
  // Load image
  const imagePath = path.join(ASSETS_DIR, 'images', `${nftNumber}.jpg`);
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image not found for NFT #${nftNumber}`);
  }
  
  // Setup UMI
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
  const umi = createUmi(RPC)
    .use(mplTokenMetadata())
    .use(irysUploader());
  
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(umiKeypair));
  
  // Upload image
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
  } catch (e) {
    throw new Error(`Image upload failed: ${e.message}`);
  }
  
  // Upload metadata
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
      creators: [{ address: TREASURY, share: 100 }],
    },
    collection: { name: 'Burned-Out Agents', family: 'BOA' },
  };
  
  const metadataUri = await umi.uploader.uploadJson(fullMetadata);
  
  // Create NFT
  const nftMint = generateSigner(umi);
  
  await createNft(umi, {
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
  }).sendAndConfirm(umi);
  
  // Verify collection
  await new Promise(r => setTimeout(r, 2000));
  try {
    const nftMetadataPda = findMetadataPda(umi, { mint: nftMint.publicKey });
    await verifyCollectionV1(umi, {
      metadata: nftMetadataPda,
      collectionMint: publicKey(collection.collectionMint),
      authority: umi.identity,
    }).sendAndConfirm(umi);
  } catch (e) {
    console.error('[BOA MINT] Collection verification deferred:', e.message?.slice(0, 200));
  }
  
  // TODO: Transfer NFT to recipient wallet if different from authority
  
  return {
    mint: nftMint.publicKey.toString(),
    collection: collection.collectionMint,
    metadataUri,
    imageUri,
    nftNumber,
    name: metadata.name,
    traits: metadata.attributes,
  };
}

// CLI mode
if (process.argv[1] && process.argv[1].includes('boa-mint-finalize')) {
  const cluster = process.env.CLUSTER || 'devnet';
  const num = parseInt(process.argv[2]) || 1;
  const recipient = process.argv[3] || null;
  mintBoaNft(cluster, num, recipient)
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => console.error(e));
}
