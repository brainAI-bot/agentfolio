/**
 * Revert soulbound NFT URIs back to gateway.irys.xyz (uploader.irys.xyz returns 404)
 */
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createUpdateFieldInstruction, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import fs from 'fs';

const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';

const MINTS = [
  { agent: 'brainKID', mint: '7PrXkGrMnXvZNrNxCiF1V1Q3hcKkfGvMqcjnrtDHygWR', uri: 'https://gateway.irys.xyz/8s4xBk5mzmg7b_IIK9kw-qZUHGQUi7MYlM6ttiJDR74' },
  { agent: 'brainForge', mint: 'Ct3BdFaDZbd4yJnt6oaAihPsw5jn1nFh7LZGzA9LaLHu', uri: 'https://gateway.irys.xyz/fXvkZ1KppBo2Z2DDaXo1_vLCbWPcXRmtuKrY-Gsxacw' },
  { agent: 'brainChain', mint: 'FSgZvU6qhfURo38syFo74AKU9969JZXnazGWd53D2Aam', uri: 'https://gateway.irys.xyz/nFczPmc_aRtxpAcAlNFm48nplzG5fI5E1gxU0Y8RuiM' },
  { agent: 'brainGrowth', mint: '7wMyPuwfSScT7DVmcFz7jz8NCKTKPdiLfo4EFdVi6roN', uri: 'https://gateway.irys.xyz/8xvW2g9PXaOsqPfxwjzJnIQh-8wKVQIfeVWXavMdK_A' },
];

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
  const deployer = Keypair.fromSecretKey(Uint8Array.from(secretKey));

  for (const entry of MINTS) {
    console.log(`⏳ ${entry.agent}: Reverting URI to gateway.irys.xyz...`);
    try {
      const ix = createUpdateFieldInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: new PublicKey(entry.mint),
        updateAuthority: deployer.publicKey,
        field: 'uri',
        value: entry.uri,
      });
      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(conn, tx, [deployer], { commitment: 'confirmed' });
      console.log(`   ✅ ${entry.agent}: ${sig}`);
    } catch (e) {
      console.error(`   ❌ ${entry.agent}: ${e.message?.slice(0, 200)}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('Done — all reverted to gateway.irys.xyz');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
