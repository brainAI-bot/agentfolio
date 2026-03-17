/**
 * Create Metaplex Certified Collection NFT for Burned-Out Agents
 * Run on devnet first, then mainnet
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createNft, mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { generateSigner, keypairIdentity, percentAmount, publicKey } from '@metaplex-foundation/umi';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import fs from 'fs';

const CLUSTER = process.env.CLUSTER || 'devnet';
const RPC = CLUSTER === 'mainnet' 
  ? 'https://api.mainnet-beta.solana.com'
  : 'https://api.devnet.solana.com';

const TREASURY = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';

async function main() {
  console.log(`=== Create BOA Collection NFT (${CLUSTER}) ===\n`);
  
  // Load deployer keypair
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
  
  // Create UMI instance
  const umi = createUmi(RPC)
    .use(mplTokenMetadata())
    .use(irysUploader());
  
  // Set identity from keypair
  const keypairBytes = Uint8Array.from(secretKey);
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(keypairBytes);
  umi.use(keypairIdentity(umiKeypair));
  
  console.log('Authority:', umiKeypair.publicKey);
  
  // Upload collection metadata to Arweave/Irys
  console.log('\nUploading collection metadata...');
  const collectionMetadata = {
    name: 'Burned-Out Agents',
    symbol: 'BOA',
    description: 'Burned-Out Agents — 5,000 unique streetwear robots for the AI agent economy. Built by brainAI on Solana.',
    image: '', // Will be set after upload
    external_url: 'https://agentfolio.bot/mint',
    seller_fee_basis_points: 500, // 5%
    properties: {
      category: 'image',
      creators: [
        { address: TREASURY, share: 100 }
      ],
    },
  };
  
  // For devnet, use a placeholder image URI
  // For mainnet, upload a real collection image
  let imageUri;
  if (CLUSTER === 'devnet') {
    imageUri = 'https://arweave.net/placeholder-boa-collection';
    console.log('Using placeholder image for devnet');
  } else {
    // TODO: Upload real collection image
    imageUri = 'https://arweave.net/placeholder-boa-collection';
  }
  
  collectionMetadata.image = imageUri;
  
  // Upload metadata JSON
  let metadataUri;
  try {
    metadataUri = await umi.uploader.uploadJson(collectionMetadata);
    console.log('Metadata URI:', metadataUri);
  } catch (e) {
    console.log('Irys upload failed (expected on devnet without funding):', e.message);
    // Use inline metadata for devnet testing
    metadataUri = 'https://arweave.net/placeholder-boa-metadata';
    console.log('Using placeholder metadata URI for devnet');
  }
  
  // Create Collection NFT
  console.log('\nCreating Collection NFT...');
  const collectionMint = generateSigner(umi);
  
  try {
    const tx = await createNft(umi, {
      mint: collectionMint,
      name: 'Burned-Out Agents',
      symbol: 'BOA',
      uri: metadataUri,
      sellerFeeBasisPoints: percentAmount(5), // 5% royalty
      isCollection: true,
      creators: [
        { address: publicKey(TREASURY), verified: false, share: 100 },
        { address: umiKeypair.publicKey, verified: true, share: 0 },
      ],
    }).sendAndConfirm(umi);
    
    console.log('\n✅ Collection NFT Created!');
    console.log('Collection Mint:', collectionMint.publicKey);
    console.log('TX Signature:', Buffer.from(tx.signature).toString('base58'));
    
    // Save collection info
    const info = {
      cluster: CLUSTER,
      collectionMint: collectionMint.publicKey.toString(),
      authority: umiKeypair.publicKey.toString(),
      treasury: TREASURY,
      metadataUri,
      imageUri,
      createdAt: new Date().toISOString(),
    };
    
    const outPath = `./collection-${CLUSTER}.json`;
    fs.writeFileSync(outPath, JSON.stringify(info, null, 2));
    console.log(`\nSaved to ${outPath}`);
    
  } catch (e) {
    console.error('Failed to create collection:', e);
    if (e.logs) e.logs.forEach(l => console.log('  ', l));
  }
}

main().catch(console.error);
