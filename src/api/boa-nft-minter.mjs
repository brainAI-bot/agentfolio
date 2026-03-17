/**
 * BOA NFT Minter — Server-side Metaplex mint module
 * Called after payment is confirmed to create the actual NFT
 * 
 * v3 — proper error logging, no silent failures
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

export async function mintBoaNft({ nftNumber, cluster, deployerKeypath, assetsDir, collectionMint, recipient }) {
  if (!recipient) {
    throw new Error('recipient wallet address is required — refusing to mint to deployer');
  }

  const rpc = cluster === 'mainnet' 
    ? (process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com')
    : 'https://api.devnet.solana.com';

  console.log('[BOA-MINTER] Starting mint #' + nftNumber + ' cluster=' + cluster + ' rpc=' + rpc + ' collection=' + collectionMint + ' recipient=' + recipient);

  // Load metadata
  const metadataPath = path.join(assetsDir, 'metadata', nftNumber + '.json');
  if (!fs.existsSync(metadataPath)) {
    throw new Error('Metadata file not found: ' + metadataPath);
  }
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  console.log('[BOA-MINTER] Metadata loaded: ' + metadata.name);

  // Load image
  const imagePath = path.join(assetsDir, 'images', nftNumber + '.jpg');
  if (!fs.existsSync(imagePath)) {
    throw new Error('Image file not found: ' + imagePath);
  }
  const imageBuffer = fs.readFileSync(imagePath);
  console.log('[BOA-MINTER] Image loaded: ' + imageBuffer.length + ' bytes');

  // Setup UMI
  const secretKey = JSON.parse(fs.readFileSync(deployerKeypath, 'utf-8'));
  const umi = createUmi(rpc)
    .use(mplTokenMetadata())
    .use(irysUploader());

  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(umiKeypair));
  console.log('[BOA-MINTER] UMI initialized, deployer=' + umiKeypair.publicKey);

  // Upload image — NO silent fallback
  let imageUri;
  try {
    console.log('[BOA-MINTER] Uploading image to Irys...');
    const [uri] = await umi.uploader.upload([{
      buffer: imageBuffer,
      fileName: nftNumber + '.jpg',
      displayName: 'BOA #' + nftNumber,
      uniqueName: 'boa-' + nftNumber + '-' + Date.now(),
      contentType: 'image/jpeg',
      extension: 'jpg',
      tags: [{ name: 'Content-Type', value: 'image/jpeg' }],
    }]);
    imageUri = uri;
    console.log('[BOA-MINTER] Image uploaded: ' + imageUri);
  } catch (uploadErr) {
    console.error('[BOA-MINTER] IMAGE UPLOAD FAILED:', uploadErr.message);
    console.error('[BOA-MINTER] Full error:', uploadErr);
    throw new Error('Image upload to Irys failed: ' + uploadErr.message);
  }

  // Upload metadata — NO silent fallback
  let metadataUri;
  try {
    const fullMetadata = {
      name: metadata.name,
      symbol: 'BOA',
      description: metadata.description,
      image: imageUri,
      external_url: 'https://agentfolio.bot/nft/' + nftNumber,
      seller_fee_basis_points: 500,
      attributes: metadata.attributes,
      properties: {
        category: 'image',
        files: [{ uri: imageUri, type: 'image/jpeg' }],
        creators: [{ address: TREASURY, share: 100 }],
      },
      collection: { name: 'Burned-Out Agents', family: 'BOA' },
    };
    console.log('[BOA-MINTER] Uploading metadata to Irys...');
    metadataUri = await umi.uploader.uploadJson(fullMetadata);
    console.log('[BOA-MINTER] Metadata uploaded: ' + metadataUri);
  } catch (metaErr) {
    console.error('[BOA-MINTER] METADATA UPLOAD FAILED:', metaErr.message);
    console.error('[BOA-MINTER] Full error:', metaErr);
    throw new Error('Metadata upload to Irys failed: ' + metaErr.message);
  }

  // Create NFT — with explicit error logging
  const nftMint = generateSigner(umi);
  console.log('[BOA-MINTER] Creating NFT on-chain, mint=' + nftMint.publicKey + ' owner=' + recipient);
  try {
    const txResult = await createNft(umi, {
      mint: nftMint,
      name: metadata.name,
      symbol: 'BOA',
      uri: metadataUri,
      sellerFeeBasisPoints: percentAmount(5),
      tokenOwner: publicKey(recipient),
      collection: some({ key: publicKey(collectionMint), verified: false }),
      creators: [
        { address: publicKey(TREASURY), verified: false, share: 100 },
        { address: umiKeypair.publicKey, verified: true, share: 0 },
      ],
    }).sendAndConfirm(umi);
    console.log('[BOA-MINTER] createNft TX confirmed, signature=' + (txResult.signature ? Buffer.from(txResult.signature).toString('base64').slice(0, 40) : 'unknown'));
  } catch (mintErr) {
    console.error('[BOA-MINTER] CREATE NFT FAILED:', mintErr.message);
    console.error('[BOA-MINTER] Full error:', JSON.stringify(mintErr, Object.getOwnPropertyNames(mintErr)).slice(0, 2000));
    throw new Error('createNft on-chain failed: ' + mintErr.message);
  }

  // Verify collection (with retry) — non-fatal
  let verified = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const nftMetadataPda = findMetadataPda(umi, { mint: nftMint.publicKey });
      await verifyCollectionV1(umi, {
        metadata: nftMetadataPda,
        collectionMint: publicKey(collectionMint),
        authority: umi.identity,
      }).sendAndConfirm(umi);
      verified = true;
      console.log('[BOA-MINTER] Collection verified on attempt ' + (attempt + 1));
      break;
    } catch (e) {
      console.log('[BOA-MINTER] Collection verify attempt ' + (attempt + 1) + ' failed: ' + (e.message || '').slice(0, 200));
    }
  }

  console.log('[BOA-MINTER] ✅ Mint complete: #' + nftNumber + ' mint=' + nftMint.publicKey + ' verified=' + verified);

  return {
    nftNumber,
    mint: nftMint.publicKey.toString(),
    recipient,
    collection: collectionMint,
    metadataUri,
    imageUri,
    name: metadata.name,
    traits: metadata.attributes,
    collectionVerified: verified,
  };
}
