/**
 * Core Burn Worker — Burns a Metaplex Core asset
 * 
 * Usage: node core-burn-worker.mjs <asset_address> <owner_wallet>
 * 
 * Core NFTs use the Metaplex Core program (CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d)
 * NOT the SPL Token program. The burn instruction is burnV1 from @metaplex-foundation/mpl-core.
 * 
 * Returns JSON: { success, asset, burnTx }
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { burnV1, fetchAssetV1 } from '@metaplex-foundation/mpl-core';
import { setComputeUnitLimit, setComputeUnitPrice } from '@metaplex-foundation/mpl-toolbox';
import {
  keypairIdentity,
  publicKey,
  transactionBuilder,
  createNoopSigner,
  none,
} from '@metaplex-foundation/umi';
import { toWeb3JsTransaction } from '@metaplex-foundation/umi-web3js-adapters';
import { Connection } from '@solana/web3.js';
import fs from 'fs';

const assetAddress = process.argv[2];
const ownerWallet = process.argv[3];
const mode = process.argv[4] || 'prepare'; // 'prepare' = unsigned TX, 'execute' = server-signed (deployer owns)

if (!assetAddress || !ownerWallet) {
  console.log(JSON.stringify({ error: 'Usage: node core-burn-worker.mjs <asset> <wallet> [prepare|execute]' }));
  process.exit(1);
}

const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';

async function run() {
  const umi = createUmi(RPC).use(import('@metaplex-foundation/mpl-core').then(m => m.mplCore()));
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
  const deployerKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(deployerKeypair));

  const assetPk = publicKey(assetAddress);
  const ownerPk = publicKey(ownerWallet);

  // Fetch the asset to verify it exists and get collection info
  let asset;
  try {
    asset = await fetchAssetV1(umi, assetPk);
  } catch (e) {
    console.log(JSON.stringify({ error: 'Asset not found: ' + e.message }));
    process.exit(1);
  }

  console.error('[Core Burn] Asset:', assetAddress);
  console.error('[Core Burn] Owner:', asset.owner.toString());
  console.error('[Core Burn] Collection:', asset.updateAuthority?.address?.toString() || 'none');

  // Verify ownership
  if (asset.owner.toString() !== ownerWallet) {
    console.log(JSON.stringify({ error: 'Asset not owned by wallet. Owner: ' + asset.owner.toString() }));
    process.exit(1);
  }

  // Get collection address if it exists
  const collection = asset.updateAuthority?.type === 'Collection' 
    ? asset.updateAuthority.address 
    : undefined;

  if (mode === 'execute') {
    // Server-side burn (deployer is authority)
    const builder = transactionBuilder()
      .add(setComputeUnitLimit(umi, { units: 200_000 }))
      .add(setComputeUnitPrice(umi, { microLamports: 100_000 }))
      .add(burnV1(umi, {
        asset: assetPk,
        collection,
        payer: umi.identity,
        authority: umi.identity, // Only works if deployer is owner/delegate
        compressionProof: none(),
      }));

    const signedTx = await builder.buildAndSign(umi);
    const web3Tx = toWeb3JsTransaction(signedTx);
    const connection = new Connection(RPC, 'confirmed');
    const sig = await connection.sendRawTransaction(web3Tx.serialize(), { skipPreflight: false });
    await connection.confirmTransaction(sig, 'confirmed');
    
    console.log(JSON.stringify({ success: true, asset: assetAddress, burnTx: sig }));
  } else {
    // Prepare mode: build unsigned TX for client-side signing
    const ownerSigner = createNoopSigner(ownerPk);
    
    const builder = transactionBuilder()
      .add(setComputeUnitLimit(umi, { units: 200_000 }))
      .add(setComputeUnitPrice(umi, { microLamports: 100_000 }))
      .add(burnV1(umi, {
        asset: assetPk,
        collection,
        payer: ownerSigner,
        authority: ownerSigner, // Owner must sign to burn their own asset
        compressionProof: none(),
      }));

    const tx = await builder.setFeePayer(ownerSigner).buildWithLatestBlockhash(umi);
    const web3Tx = toWeb3JsTransaction(tx);
    const base64Tx = Buffer.from(web3Tx.serialize()).toString('base64');

    console.log(JSON.stringify({
      success: true,
      transaction: base64Tx,
      asset: assetAddress,
      collection: collection?.toString() || null,
      mode: 'prepare',
      message: 'Sign this transaction in your wallet to burn the Core NFT',
    }));
  }
}

run().catch(e => {
  console.error('[Core Burn] Fatal:', e.message);
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
});
