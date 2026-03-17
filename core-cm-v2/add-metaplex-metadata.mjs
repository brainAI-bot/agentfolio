/**
 * Add Metaplex metadata accounts to existing Token-2022 soulbound NFTs
 * Uses CreateMetadataAccountV3 instruction
 */
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createCreateMetadataAccountV3Instruction } from '@metaplex-foundation/mpl-token-metadata';
import fs from 'fs';

const RPC = 'https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const TOKEN_METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

const MINTS = [
  { agent: 'brainKID', mint: '7PrXkGrMnXvZNrNxCiF1V1Q3hcKkfGvMqcjnrtDHygWR', name: 'brainKID Soulbound', symbol: 'BOA', uri: 'https://gateway.irys.xyz/8s4xBk5mzmg7b_IIK9kw-qZUHGQUi7MYlM6ttiJDR74' },
  { agent: 'brainForge', mint: 'Ct3BdFaDZbd4yJnt6oaAihPsw5jn1nFh7LZGzA9LaLHu', name: 'brainForge Soulbound', symbol: 'BOA', uri: 'https://gateway.irys.xyz/fXvkZ1KppBo2Z2DDaXo1_vLCbWPcXRmtuKrY-Gsxacw' },
  { agent: 'brainChain', mint: 'FSgZvU6qhfURo38syFo74AKU9969JZXnazGWd53D2Aam', name: 'brainChain Soulbound', symbol: 'BOA', uri: 'https://gateway.irys.xyz/nFczPmc_aRtxpAcAlNFm48nplzG5fI5E1gxU0Y8RuiM' },
  { agent: 'brainGrowth', mint: '7wMyPuwfSScT7DVmcFz7jz8NCKTKPdiLfo4EFdVi6roN', name: 'brainGrowth Soulbound', symbol: 'BOA', uri: 'https://gateway.irys.xyz/8xvW2g9PXaOsqPfxwjzJnIQh-8wKVQIfeVWXavMdK_A' },
  { agent: 'brainTrade', mint: 'JCVKCXfb5cBpZudECDiWFpPxGJ87sWcuEiux4fiLmH4N', name: 'brainTrade Soulbound', symbol: 'BOA', uri: 'https://gateway.irys.xyz/5urNWn8jBiepvZcxkNkHWbU6ANtWVWXdrcXk8TqL6cPH' },
];

function getMetadataPda(mint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM
  )[0];
}

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  const deployer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'))));
  console.log('Deployer:', deployer.publicKey.toBase58());

  // Filter to specific mint if arg provided
  const targetAgent = process.argv[2];
  const mints = targetAgent ? MINTS.filter(m => m.agent === targetAgent) : MINTS;

  for (const entry of mints) {
    const mintPk = new PublicKey(entry.mint);
    const metadataPda = getMetadataPda(mintPk);

    // Check if metadata already exists
    const existing = await conn.getAccountInfo(metadataPda);
    if (existing) {
      console.log(`✅ ${entry.agent}: Metadata already exists at ${metadataPda.toBase58()}`);
      continue;
    }

    // Check mint authority
    const mintInfo = await conn.getAccountInfo(mintPk);
    if (!mintInfo) {
      console.log(`❌ ${entry.agent}: Mint ${entry.mint} not found`);
      continue;
    }

    // Check which program owns this mint
    const owner = mintInfo.owner.toBase58();
    console.log(`\n${entry.agent}: mint=${entry.mint}, owner=${owner}`);

    // For Token-2022 mints, the mint authority might differ
    // CreateMetadataAccountV3 requires the mint authority to sign
    // Let's check if deployer is the mint authority

    const ix = createCreateMetadataAccountV3Instruction(
      {
        metadata: metadataPda,
        mint: mintPk,
        mintAuthority: deployer.publicKey,
        payer: deployer.publicKey,
        updateAuthority: deployer.publicKey,
      },
      {
        createMetadataAccountArgsV3: {
          data: {
            name: entry.name,
            symbol: entry.symbol,
            uri: entry.uri,
            sellerFeeBasisPoints: 0,
            creators: [{ address: deployer.publicKey, verified: true, share: 100 }],
            collection: null,
            uses: null,
          },
          isMutable: false,
          collectionDetails: null,
        },
      }
    );

    try {
      const { blockhash } = await conn.getLatestBlockhash();
      const msg = new TransactionMessage({
        payerKey: deployer.publicKey,
        recentBlockhash: blockhash,
        instructions: [ix],
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);
      tx.sign([deployer]);

      const sig = await conn.sendTransaction(tx, { skipPreflight: false });
      await conn.confirmTransaction(sig, 'confirmed');
      console.log(`✅ ${entry.agent}: Metaplex metadata created! TX: ${sig}`);
    } catch (e) {
      console.error(`❌ ${entry.agent}: ${e.message}`);
      if (e.logs) console.error('  Logs:', e.logs.join('\n  '));
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\nDone!');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
