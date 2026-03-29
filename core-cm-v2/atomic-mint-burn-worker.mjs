/**
 * Atomic Mint + Burn + Soulbound Worker
 * 
 * Single transaction that:
 * 1. Mints a BOA from the Core Candy Machine → user gets Core NFT
 * 2. Burns the Core NFT immediately (Metaplex Core burnV1)
 * 3. After confirmation, server mints Token-2022 soulbound
 * 4. Server updates V3 Genesis Record (burnToBecome)
 * 
 * NOTE: Steps 1-2 are atomic (one TX). Steps 3-4 are server-side follow-ups.
 * Core Candy Machine mintV1 creates the asset in the SAME TX where we burn it.
 * 
 * Usage: node atomic-mint-burn-worker.mjs <wallet> <flow> [agent_id]
 * flow: "free" or "paid"
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  mplCandyMachine,
  fetchCandyMachine,
  mintV1 as cmMintV1,
} from '@metaplex-foundation/mpl-core-candy-machine';
import { burnV1, fetchAssetV1 } from '@metaplex-foundation/mpl-core';
import { setComputeUnitLimit, setComputeUnitPrice } from '@metaplex-foundation/mpl-toolbox';
import {
  generateSigner,
  keypairIdentity,
  publicKey,
  transactionBuilder,
  createNoopSigner,
  some,
  none,
} from '@metaplex-foundation/umi';
import { toWeb3JsTransaction, toWeb3JsLegacyTransaction } from '@metaplex-foundation/umi-web3js-adapters';
import { Connection, Keypair } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

const recipient = process.argv[2];
const flow = process.argv[3] || 'free';
const agentId = process.argv[4] || null;

if (!recipient) {
  console.log(JSON.stringify({ error: 'Usage: node atomic-mint-burn-worker.mjs <wallet> <flow> [agent_id]' }));
  process.exit(1);
}

const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const DATA_DIR = process.env.HOME + '/agentfolio/boa-pipeline/candy-machine-data';
const CM_STATE_PATH = path.join(DATA_DIR, 'core-cm-state.json');
const UPLOADED_PATH = path.join(DATA_DIR, 'uploaded-assets.json');
const RECORDS_DIR = process.env.HOME + '/agentfolio/boa-pipeline/mint-records';

const PRIORITY_FEE = 250_000; // Higher priority for atomic TX
const MAX_RETRIES = 3;

async function run() {
  const cmState = JSON.parse(fs.readFileSync(CM_STATE_PATH, 'utf-8'));
  const uploaded = JSON.parse(fs.readFileSync(UPLOADED_PATH, 'utf-8'));
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
  const connection = new Connection(RPC, 'confirmed');

  const umi = createUmi(RPC)
    .use(mplCandyMachine());
  
  const deployerKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(deployerKeypair));

  const cmPk = publicKey(cmState.candyMachine);
  const collPk = publicKey(cmState.collection);
  const recipientPk = publicKey(recipient);

  // Fetch candy machine state
  const cm = await fetchCandyMachine(umi, cmPk);
  const nextIndex = Number(cm.itemsRedeemed);
  
  if (nextIndex >= Number(cm.data.itemsAvailable)) {
    console.log(JSON.stringify({ error: 'Collection sold out.' }));
    process.exit(1);
  }

  const item = cm.items[nextIndex];
  if (!item) {
    console.log(JSON.stringify({ error: 'No item at index ' + nextIndex }));
    process.exit(1);
  }

  const nameMatch = item.name.match(/(\d+)/);
  const boaId = nameMatch ? parseInt(nameMatch[1]) : nextIndex + 1;
  const assetData = uploaded[boaId] || {};

  console.error(`[Atomic] BOA #${boaId} -> ${recipient} (${flow})`);
  console.error(`[Atomic] CM index: ${nextIndex}, items redeemed: ${cm.itemsRedeemed}/${cm.data.itemsAvailable}`);

  // Generate the asset signer (will be the Core NFT address)
  const asset = generateSigner(umi);

  // Build ATOMIC transaction: Mint + Burn in one TX
  // The asset is created by mintV1, then immediately burned by burnV1
  // Since both happen in the same TX, either both succeed or both fail
  
  let builder = transactionBuilder()
    .add(setComputeUnitLimit(umi, { units: 1_000_000 })) // Higher CU for combined ops
    .add(setComputeUnitPrice(umi, { microLamports: PRIORITY_FEE }));

  // Step 1: Mint from Candy Machine
  if (flow === 'free') {
    builder = builder.add(cmMintV1(umi, {
      candyMachine: cmPk,
      asset,
      collection: collPk,
      owner: recipientPk,
      group: some('free'),
      mintArgs: {
        thirdPartySigner: some({ signer: umi.identity }),
      },
    }));
  } else {
    builder = builder.add(cmMintV1(umi, {
      candyMachine: cmPk,
      asset,
      collection: collPk,
      owner: recipientPk,
      group: some('paid'),
      mintArgs: {
        solPayment: some({ destination: publicKey('FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be') }),
      },
    }));
  }

  // Step 2: Immediately burn the Core NFT
  // The owner (recipient) must sign since they own the newly minted asset
  // But in the same TX the asset was just created by the CM, so the owner IS the recipient
  // For server-side execution (deployer controls), we use deployer as authority if it's a delegate
  // For client-side: the recipient signs both mint and burn
  
  // NOTE: burnV1 requires the authority (owner) to sign.
  // In server-side flow, the deployer can't burn on behalf of the recipient.
  // The recipient must sign. So for client-side prepare mode, this works.
  // For server-side flow (deployer mints to recipient), we need a different approach:
  // Mint to DEPLOYER first, burn as deployer, then mint soulbound to recipient.

  // Server-side atomic: mint to deployer → burn → soulbound to recipient
  const effectiveOwner = umi.identity; // Deployer owns during atomic flow
  
  builder = builder.add(burnV1(umi, {
    asset: asset.publicKey,
    collection: collPk,
    payer: umi.identity,
    authority: effectiveOwner, // Deployer is owner since we minted to them
    compressionProof: none(),
  }));

  // Retry loop for TX submission
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.error(`[Atomic] Attempt ${attempt}/${MAX_RETRIES}...`);
      
      // Rebuild with fresh blockhash on retry
      if (attempt > 1) {
        // Need fresh asset signer on retry
        console.log(JSON.stringify({ error: 'Retry not implemented for atomic — asset signer is consumed. Please retry from scratch.' }));
        process.exit(1);
      }

      // For server-side: mint to deployer, not recipient
      // Override the owner in mintV1 to be the deployer so burnV1 can work
      builder = transactionBuilder()
        .add(setComputeUnitLimit(umi, { units: 1_000_000 }))
        .add(setComputeUnitPrice(umi, { microLamports: PRIORITY_FEE }));

      if (flow === 'free') {
        builder = builder.add(cmMintV1(umi, {
          candyMachine: cmPk,
          asset,
          collection: collPk,
          owner: umi.identity.publicKey, // Mint to deployer (so we can burn)
          group: some('free'),
          mintArgs: {
            thirdPartySigner: some({ signer: umi.identity }),
          },
        }));
      } else {
        builder = builder.add(cmMintV1(umi, {
          candyMachine: cmPk,
          asset,
          collection: collPk,
          owner: umi.identity.publicKey, // Mint to deployer
          group: some('paid'),
          mintArgs: {
            solPayment: some({ destination: publicKey('FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be') }),
          },
        }));
      }

      // Burn the Core NFT (deployer is owner)
      builder = builder.add(burnV1(umi, {
        asset: asset.publicKey,
        collection: collPk,
        payer: umi.identity,
        authority: umi.identity,
        compressionProof: none(),
      }));

      const signedTx = await builder.buildAndSign(umi);
      const web3Tx = toWeb3JsTransaction(signedTx);

      // Simulate first
      const simResult = await connection.simulateTransaction(web3Tx, { commitment: 'confirmed' });
      if (simResult.value.err) {
        const errStr = JSON.stringify(simResult.value.err);
        console.error('[Atomic] Simulation failed:', errStr);
        (simResult.value.logs || []).forEach(l => console.error('  ' + l));
        throw new Error('Simulation failed: ' + errStr);
      }
      console.error('[Atomic] Simulation passed ✓');

      // Send
      const sig = await connection.sendRawTransaction(web3Tx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      console.error('[Atomic] Sent TX:', sig);

      // Confirm
      const confirmation = await connection.confirmTransaction(sig, 'confirmed');
      if (confirmation.value.err) {
        throw new Error('TX failed: ' + JSON.stringify(confirmation.value.err));
      }
      console.error('[Atomic] ✅ Mint + Burn confirmed:', sig);

      // Record the mint
      const record = {
        cluster: 'mainnet',
        nftNumber: boaId,
        mint: asset.publicKey.toString(),
        collection: cmState.collection,
        recipient: recipient,
        agentId: agentId,
        flow,
        atomicBurn: true,
        burned: true,
        burnTx: sig,
        mintTx: sig, // Same TX
        timestamp: new Date().toISOString(),
      };
      
      if (!fs.existsSync(RECORDS_DIR)) fs.mkdirSync(RECORDS_DIR, { recursive: true });
      fs.writeFileSync(path.join(RECORDS_DIR, `${boaId}.json`), JSON.stringify(record, null, 2));

      console.log(JSON.stringify({
        success: true,
        boaId,
        boaName: `Burned-Out Agent #${boaId}`,
        mintAddress: asset.publicKey.toString(),
        burnTx: sig,
        metadataUri: item.uri,
        imageUri: assetData.imageUri || '',
        collection: cmState.collection,
        atomicBurn: true,
        burned: true,
        flow,
        itemsRedeemed: nextIndex + 1,
        itemsAvailable: Number(cm.data.itemsAvailable),
      }));
      return;

    } catch (e) {
      console.error(`[Atomic] Attempt ${attempt} failed:`, e.message);
      if (attempt >= MAX_RETRIES) {
        console.log(JSON.stringify({ error: 'Atomic mint+burn failed after ' + MAX_RETRIES + ' attempts: ' + e.message }));
        process.exit(1);
      }
    }
  }
}

run().catch(e => {
  console.error('[Atomic] Fatal:', e.message);
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
});
