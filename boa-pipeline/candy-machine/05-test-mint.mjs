import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { mplCandyMachine, fetchCandyMachine, mintV2 } from '@metaplex-foundation/mpl-candy-machine';
import { generateSigner, keypairIdentity, publicKey, transactionBuilder, none } from '@metaplex-foundation/umi';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';
import fs from 'fs';

const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const state = JSON.parse(fs.readFileSync('/home/ubuntu/agentfolio/boa-pipeline/candy-machine-data/candy-machine-state.json','utf8'));

const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
const umi = createUmi(RPC).use(mplTokenMetadata()).use(mplCandyMachine());
const umiKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
umi.use(keypairIdentity(umiKeypair));

const cmPublicKey = publicKey(state.candyMachine);
const collectionMint = publicKey(state.collection);

const cm = await fetchCandyMachine(umi, cmPublicKey);
console.log('Items redeemed:', Number(cm.itemsRedeemed));

const nftMint = generateSigner(umi);

try {
  await transactionBuilder()
    .add(setComputeUnitLimit(umi, { units: 800_000 }))
    .add(
      mintV2(umi, {
        candyMachine: cmPublicKey,
        nftMint,
        collectionMint,
        collectionUpdateAuthority: umi.identity.publicKey,
        group: none(),
      })
    )
    .sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });
  
  console.log('✅ Minted:', nftMint.publicKey.toString());
} catch (e) {
  console.error('Mint failed:', e.message);
  if (e.logs) console.error('Logs:', e.logs.join('\n'));
}
