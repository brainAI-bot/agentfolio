/**
 * Candy Machine Mint Worker
 * Called by the API to mint a BOA from the Candy Machine
 * Usage: node 04-mint-from-cm.mjs <recipient_wallet>
 * Outputs JSON result to stdout
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import {
  mplCandyMachine,
  fetchCandyMachine,
  mintV2,
  mintFromCandyMachineV2,
  fetchCandyGuard,
} from '@metaplex-foundation/mpl-candy-machine';
import { generateSigner, keypairIdentity, publicKey, some, transactionBuilder } from '@metaplex-foundation/umi';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';
import { transferV1, TokenStandard } from '@metaplex-foundation/mpl-token-metadata';
import fs from 'fs';
import path from 'path';

const recipient = process.argv[2];
if (!recipient) {
  console.error(JSON.stringify({ error: 'Usage: node 04-mint-from-cm.mjs <wallet>' }));
  process.exit(1);
}

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const CM_STATE_PATH = path.join(SCRIPT_DIR, '..', 'candy-machine-data', 'candy-machine-state.json');
const RECORDS_DIR = path.join(SCRIPT_DIR, '..', 'mint-records');
const UPLOADED_PATH = path.join(SCRIPT_DIR, '..', 'candy-machine-data', 'uploaded-assets.json');

async function run() {
  // Load state
  const cmState = JSON.parse(fs.readFileSync(CM_STATE_PATH, 'utf-8'));
  const uploaded = JSON.parse(fs.readFileSync(UPLOADED_PATH, 'utf-8'));

  // Setup UMI
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
  const umi = createUmi(RPC).use(mplTokenMetadata()).use(mplCandyMachine());
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(umiKeypair));

  const cmPublicKey = publicKey(cmState.candyMachine);
  const collectionMint = publicKey(cmState.collection);

  // Fetch CM state for itemsRedeemed (= the on-chain counter!)
  const cm = await fetchCandyMachine(umi, cmPublicKey);
  const nextIndex = Number(cm.itemsRedeemed);

  if (nextIndex >= Number(cm.data.itemsAvailable)) {
    console.log(JSON.stringify({ error: 'All items minted. Collection sold out.' }));
    process.exit(1);
  }

  // The item at this index
  const item = cm.items[nextIndex];
  if (!item) {
    console.log(JSON.stringify({ error: `No item at index ${nextIndex}` }));
    process.exit(1);
  }

  const boaId = parseInt(item.name); // The BOA number from config line name
  const metadataUri = item.uri;

  console.error(`[CM Mint] Minting index ${nextIndex} → BOA #${boaId} → ${recipient}`);

  // Mint via Candy Machine
  const nftMint = generateSigner(umi);

  await transactionBuilder()
    .add(setComputeUnitLimit(umi, { units: 800_000 }))
    .add(
      mintV2(umi, {
        candyMachine: cmPublicKey,
        nftMint,
        collectionMint,
        collectionUpdateAuthority: umi.identity.publicKey,
      })
    )
    .sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });

  console.error(`[CM Mint] Minted BOA #${boaId} to authority. Transferring to ${recipient}...`);

  // Transfer pNFT from authority to recipient
  await transferV1(umi, {
    mint: nftMint.publicKey,
    authority: umi.identity,
    tokenOwner: umi.identity.publicKey,
    destinationOwner: publicKey(recipient),
    tokenStandard: TokenStandard.ProgrammableNonFungible,
  }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });

  console.error(`[CM Mint] ✅ BOA #${boaId} transferred to ${recipient}`);

  // Look up image URI from uploaded assets
  const assetData = uploaded[boaId] || {};

  // Save mint record
  const record = {
    cluster: 'mainnet',
    nftNumber: boaId,
    mint: nftMint.publicKey.toString(),
    collection: cmState.collection,
    metadataUri: metadataUri,
    imageUri: assetData.imageUri || '',
    recipient,
    createdAt: new Date().toISOString(),
    source: 'candy-machine',
    candyMachine: cmState.candyMachine,
    cmIndex: nextIndex,
  };

  if (!fs.existsSync(RECORDS_DIR)) fs.mkdirSync(RECORDS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RECORDS_DIR, `${boaId}.json`), JSON.stringify(record, null, 2));

  // Output result
  console.log(JSON.stringify({
    success: true,
    boaId,
    boaName: `Burned-Out Agent #${boaId}`,
    mintAddress: nftMint.publicKey.toString(),
    metadataUri,
    imageUri: assetData.imageUri || '',
    collection: cmState.collection,
    cmIndex: nextIndex,
    itemsRedeemed: nextIndex + 1,
    itemsAvailable: Number(cm.data.itemsAvailable),
  }));
}

run().catch(e => {
  console.error(`[CM Mint] Fatal: ${e.message}`);
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
});
