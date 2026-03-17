/**
 * Verify NFTs as part of BOA collection
 * Separate script to debug collection verification
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { verifyCollectionV1, findMetadataPda, findMasterEditionPda, mplTokenMetadata, fetchMetadataFromSeeds } from '@metaplex-foundation/mpl-token-metadata';
import { keypairIdentity, publicKey } from '@metaplex-foundation/umi';
import fs from 'fs';

const CLUSTER = process.env.CLUSTER || 'devnet';
const RPC = CLUSTER === 'mainnet' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';

async function main() {
  const nftMint = process.argv[2];
  if (!nftMint) { console.log('Usage: node verify-collection.mjs <nft_mint>'); return; }
  
  const collection = JSON.parse(fs.readFileSync(`./collection-${CLUSTER}.json`, 'utf-8'));
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
  
  const umi = createUmi(RPC).use(mplTokenMetadata());
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(umiKeypair));
  
  console.log('NFT Mint:', nftMint);
  console.log('Collection:', collection.collectionMint);
  console.log('Authority:', umiKeypair.publicKey);
  
  // Fetch NFT metadata to confirm it exists
  try {
    const metadata = await fetchMetadataFromSeeds(umi, { mint: publicKey(nftMint) });
    console.log('\nNFT Metadata:');
    console.log('  Name:', metadata.name);
    console.log('  Collection:', JSON.stringify(metadata.collection));
    console.log('  Update Authority:', metadata.updateAuthority);
  } catch (e) {
    console.log('Failed to fetch NFT metadata:', e.message);
  }
  
  // Fetch collection metadata
  try {
    const colMeta = await fetchMetadataFromSeeds(umi, { mint: publicKey(collection.collectionMint) });
    console.log('\nCollection Metadata:');
    console.log('  Name:', colMeta.name);
    console.log('  Update Authority:', colMeta.updateAuthority);
    console.log('  Is Collection:', colMeta.collectionDetails);
  } catch (e) {
    console.log('Failed to fetch collection metadata:', e.message);
  }
  
  // Try verify
  console.log('\nVerifying...');
  try {
    const nftMetadataPda = findMetadataPda(umi, { mint: publicKey(nftMint) });
    
    const result = await verifyCollectionV1(umi, {
      metadata: nftMetadataPda,
      collectionMint: publicKey(collection.collectionMint),
      authority: umi.identity,
    }).sendAndConfirm(umi);
    
    console.log('✅ Collection verified!');
  } catch (e) {
    console.log('Verify failed:', e.message?.slice(0, 500));
    if (e.logs) e.logs.forEach(l => console.log('  ', l));
  }
}

main().catch(console.error);
