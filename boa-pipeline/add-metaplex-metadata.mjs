/**
 * Add Metaplex metadata accounts to existing Token-2022 soulbound NFTs
 * Uses UMI + mpl-token-metadata createMetadataAccountV3
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createMetadataAccountV3 } from '@metaplex-foundation/mpl-token-metadata';
import { keypairIdentity, publicKey } from '@metaplex-foundation/umi';
import fs from 'fs';

const RPC = 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';

const MINTS = [
  { agent: 'brainKID', mint: '7PrXkGrMnXvZNrNxCiF1V1Q3hcKkfGvMqcjnrtDHygWR', name: 'brainKID Soulbound', symbol: 'BOA', uri: 'https://gateway.irys.xyz/8s4xBk5mzmg7b_IIK9kw-qZUHGQUi7MYlM6ttiJDR74' },
  { agent: 'brainForge', mint: 'Ct3BdFaDZbd4yJnt6oaAihPsw5jn1nFh7LZGzA9LaLHu', name: 'brainForge Soulbound', symbol: 'BOA', uri: 'https://gateway.irys.xyz/fXvkZ1KppBo2Z2DDaXo1_vLCbWPcXRmtuKrY-Gsxacw' },
  { agent: 'brainChain', mint: 'FSgZvU6qhfURo38syFo74AKU9969JZXnazGWd53D2Aam', name: 'brainChain Soulbound', symbol: 'BOA', uri: 'https://gateway.irys.xyz/nFczPmc_aRtxpAcAlNFm48nplzG5fI5E1gxU0Y8RuiM' },
  { agent: 'brainGrowth', mint: '7wMyPuwfSScT7DVmcFz7jz8NCKTKPdiLfo4EFdVi6roN', name: 'brainGrowth Soulbound', symbol: 'BOA', uri: 'https://gateway.irys.xyz/8xvW2g9PXaOsqPfxwjzJnIQh-8wKVQIfeVWXavMdK_A' },
  { agent: 'brainTrade', mint: 'JCVKCXfb5cBpZudECDiWFpPxGJ87sWcuEiux4fiLmH4N', name: 'brainTrade Soulbound', symbol: 'BOA', uri: 'https://gateway.irys.xyz/5urNWn8jBiepvZcxkNkHWbU6ANtWVWXdrcXk8TqL6cPH' },
];

const TOKEN_METADATA_PROGRAM = publicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

async function main() {
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
  
  const umi = createUmi(RPC);
  // Register mpl-token-metadata
  const { mplTokenMetadata } = await import('@metaplex-foundation/mpl-token-metadata');
  umi.use(mplTokenMetadata());
  
  const keypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(keypair));
  
  console.log('Deployer:', keypair.publicKey.toString());

  const target = process.argv[2];
  const options = { send: { skipPreflight: true }, confirm: { commitment: 'confirmed' } };

  for (const entry of MINTS) {
    if (target && entry.agent !== target) continue;
    
    const mintPk = publicKey(entry.mint);
    
    // Let the SDK derive the PDA automatically (pass mint, it handles it)

    console.log(`\n⏳ ${entry.agent}: Creating metadata for ${entry.mint}...`);
    
    try {
      await createMetadataAccountV3(umi, {
        mint: mintPk,
        mintAuthority: umi.identity,
        payer: umi.identity,
        updateAuthority: umi.identity.publicKey,
        data: {
          name: entry.name,
          symbol: entry.symbol,
          uri: entry.uri,
          sellerFeeBasisPoints: 0,
          creators: [{ address: umi.identity.publicKey, verified: true, share: 100 }],
          collection: null,
          uses: null,
        },
        isMutable: false,
        collectionDetails: null,
      }).sendAndConfirm(umi, options);
      console.log(`✅ ${entry.agent}: Done!`);
    } catch (e) {
      const msg = e.message || String(e);
      if (msg.includes('already in use')) {
        console.log(`✅ ${entry.agent}: Metadata already exists`);
      } else {
        console.error(`❌ ${entry.agent}: Failed — ${msg.slice(0, 200)}`);
      }
    }
    
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\nDone!');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
