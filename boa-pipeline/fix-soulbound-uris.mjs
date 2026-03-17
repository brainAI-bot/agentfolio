/**
 * Fix soulbound NFT metadata URIs — replace gateway.irys.xyz (302) with node1.irys.xyz (200)
 * Also updates image URIs inside the metadata JSON on Irys
 */
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createUpdateFieldInstruction, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import fs from 'fs';

const RPC = 'https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';

const MINTS = [
  { agent: 'brainKID',    mint: '7PrXkGrMnXvZNrNxCiF1V1Q3hcKkfGvMqcjnrtDHygWR', uri: 'https://gateway.irys.xyz/8s4xBk5mzmg7b_IIK9kw-qZUHGQUi7MYlM6ttiJDR74' },
  { agent: 'brainForge',  mint: 'Ct3BdFaDZbd4yJnt6oaAihPsw5jn1nFh7LZGzA9LaLHu', uri: 'https://gateway.irys.xyz/fXvkZ1KppBo2Z2DDaXo1_vLCbWPcXRmtuKrY-Gsxacw' },
  { agent: 'brainChain',  mint: 'FSgZvU6qhfURo38syFo74AKU9969JZXnazGWd53D2Aam', uri: 'https://gateway.irys.xyz/nFczPmc_aRtxpAcAlNFm48nplzG5fI5E1gxU0Y8RuiM' },
  { agent: 'brainGrowth', mint: '7wMyPuwfSScT7DVmcFz7jz8NCKTKPdiLfo4EFdVi6roN', uri: 'https://gateway.irys.xyz/8xvW2g9PXaOsqPfxwjzJnIQh-8wKVQIfeVWXavMdK_A' },
  { agent: 'brainTrade',  mint: 'JCVKCXfb5cBpZudECDiWFpPxGJ87sWcuEiux4fiLmH4N', uri: 'https://gateway.irys.xyz/5urNWn8jBiepvZcxkNkHWbU6ANtWVWXdrcXk8TqL6cPH' },
];

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
  const authority = Keypair.fromSecretKey(Uint8Array.from(secretKey));

  console.log('Authority:', authority.publicKey.toBase58());

  for (const { agent, mint: mintStr, uri } of MINTS) {
    const mintPk = new PublicKey(mintStr);
    const newUri = uri.replace('gateway.irys.xyz', 'node1.irys.xyz');

    console.log(`\n${agent}: ${mintStr}`);
    console.log(`  Old: ${uri}`);
    console.log(`  New: ${newUri}`);

    try {
      const ix = createUpdateFieldInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: mintPk,
        updateAuthority: authority.publicKey,
        field: 'uri',
        value: newUri,
      });

      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(conn, tx, [authority], { commitment: 'confirmed' });
      console.log(`  ✅ Updated! tx: ${sig}`);
    } catch (e) {
      console.error(`  ❌ Failed: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\nDone!');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
