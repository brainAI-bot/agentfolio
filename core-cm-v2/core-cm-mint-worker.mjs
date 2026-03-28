/**
 * Core CM Mint Worker v4 — Fixed TX delivery
 * 
 * v4 changes:
 * - Use web3.js sendRawTransaction with skipPreflight=false (Helius drops skip-preflight TXs)
 * - Simulate before send as additional safety
 * - Proper blockhash-based confirmation strategy
 * - Priority fee 200k microLamports
 * - Retry with fresh TX on expiry
 * 
 * Usage: node core-cm-mint-worker.mjs <recipient_wallet>
 * Must be run from ~/agentfolio/core-cm-v2/ (correct node_modules)
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  mplCandyMachine as mplCoreCandyMachine,
  fetchCandyMachine,
  mintV1,
} from '@metaplex-foundation/mpl-core-candy-machine';
import { setComputeUnitLimit, setComputeUnitPrice } from '@metaplex-foundation/mpl-toolbox';
import {
  generateSigner,
  keypairIdentity,
  publicKey,
  transactionBuilder,
  some,
} from '@metaplex-foundation/umi';
import { toWeb3JsTransaction } from '@metaplex-foundation/umi-web3js-adapters';
import { Connection } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

const recipient = process.argv[2];
if (!recipient) {
  console.log(JSON.stringify({ error: 'Usage: node core-cm-mint-worker.mjs <wallet>' }));
  process.exit(1);
}

const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const DATA_DIR = process.env.HOME + '/agentfolio/boa-pipeline/candy-machine-data';
const CM_STATE_PATH = path.join(DATA_DIR, 'core-cm-state.json');
const UPLOADED_PATH = path.join(DATA_DIR, 'uploaded-assets.json');
const RECORDS_DIR = process.env.HOME + '/agentfolio/boa-pipeline/mint-records';

const MAX_RETRIES = 3;
const PRIORITY_FEE = 200_000; // microLamports

async function attemptMint(umi, connection, cmPk, collPk, recipientPk, attempt) {
  const asset = generateSigner(umi);
  console.error('[Core CM] Attempt ' + attempt + '/' + MAX_RETRIES + '...');
  
  // Build and sign the TX
  const builder = transactionBuilder()
    .add(setComputeUnitLimit(umi, { units: 800_000 }))
    .add(setComputeUnitPrice(umi, { microLamports: PRIORITY_FEE }))
    .add(
      mintV1(umi, {
        candyMachine: cmPk,
        asset,
        collection: collPk,
        owner: recipientPk,
        group: some('free'),
        mintArgs: {
          thirdPartySigner: some({ signer: umi.identity }),
        },
      })
    );
  
  const signedTx = await builder.buildAndSign(umi);
  const web3Tx = toWeb3JsTransaction(signedTx);
  
  // Simulate first (catches 6006 and other errors before spending SOL on priority fees)
  const simResult = await connection.simulateTransaction(web3Tx, { commitment: 'confirmed' });
  if (simResult.value.err) {
    const errStr = JSON.stringify(simResult.value.err);
    const logs = simResult.value.logs || [];
    console.error('[Core CM] Simulation failed: ' + errStr);
    logs.forEach(l => console.error('  ' + l));
    throw new Error('Simulation failed: ' + errStr);
  }
  console.error('[Core CM] Simulation passed (' + simResult.value.unitsConsumed + ' CU)');
  
  // Send with preflight enabled (Helius drops skipPreflight TXs)
  const sig = await connection.sendRawTransaction(web3Tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 10,
  });
  console.error('[Core CM] TX sent: ' + sig);
  
  // Confirm with blockhash strategy
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const confirmation = await connection.confirmTransaction({
    signature: sig,
    blockhash,
    lastValidBlockHeight,
  }, 'confirmed');
  
  if (confirmation.value.err) {
    throw new Error('TX failed on-chain: ' + JSON.stringify(confirmation.value.err));
  }
  
  return { asset, sig };
}

async function run() {
  const cmState = JSON.parse(fs.readFileSync(CM_STATE_PATH, 'utf-8'));
  const uploaded = JSON.parse(fs.readFileSync(UPLOADED_PATH, 'utf-8'));
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));

  const umi = createUmi(RPC).use(mplCoreCandyMachine());
  const keypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(keypair));

  const connection = new Connection(RPC, { commitment: 'confirmed' });

  const cmPk = publicKey(cmState.candyMachine);
  const collPk = publicKey(cmState.collection);
  const recipientPk = publicKey(recipient);

  const cm = await fetchCandyMachine(umi, cmPk, { commitment: 'confirmed' });
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
  console.error('[Core CM] Minting index ' + nextIndex + ' -> BOA #' + boaId + ' -> ' + recipient);

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const t0 = Date.now();
      const { asset, sig } = await attemptMint(umi, connection, cmPk, collPk, recipientPk, attempt);
      const elapsed = Date.now() - t0;
      
      console.error('[Core CM] BOA #' + boaId + ' minted -> ' + asset.publicKey + ' (' + elapsed + 'ms)');
      
      const assetData = uploaded[boaId] || {};
      const record = {
        cluster: 'mainnet',
        nftNumber: boaId,
        mint: asset.publicKey.toString(),
        collection: cmState.collection,
        metadataUri: item.uri,
        imageUri: assetData.imageUri || '',
        recipient,
        createdAt: new Date().toISOString(),
        source: 'core-candy-machine',
        candyMachine: cmState.candyMachine,
        cmIndex: nextIndex,
        attempt,
        elapsed,
        signature: sig,
      };
      if (!fs.existsSync(RECORDS_DIR)) fs.mkdirSync(RECORDS_DIR, { recursive: true });
      fs.writeFileSync(path.join(RECORDS_DIR, boaId + '.json'), JSON.stringify(record, null, 2));

      console.log(JSON.stringify({
        success: true,
        boaId,
        boaName: 'Burned-Out Agent #' + boaId,
        mintAddress: asset.publicKey.toString(),
        metadataUri: item.uri,
        imageUri: assetData.imageUri || '',
        collection: cmState.collection,
        cmIndex: nextIndex,
        itemsRedeemed: nextIndex + 1,
        itemsAvailable: Number(cm.data.itemsAvailable),
        signature: sig,
      }));
      return; // Success
    } catch (e) {
      lastError = e;
      const is6006 = e.message.includes('6006');
      const isSimFail = e.message.includes('Simulation failed');
      const isTimeout = e.message.includes('block height') || e.message.includes('expired');
      
      if (is6006 || isSimFail) {
        console.error('[Core CM] Not retryable: ' + e.message);
        break;
      }
      
      if (isTimeout && attempt < MAX_RETRIES) {
        const backoff = 2000 * attempt;
        console.error('[Core CM] TX expired (attempt ' + attempt + '), retrying in ' + backoff + 'ms...');
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      
      console.error('[Core CM] Attempt ' + attempt + ' failed: ' + e.message);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  
  console.error('[Core CM] Fatal after ' + MAX_RETRIES + ' attempts: ' + lastError.message);
  console.log(JSON.stringify({ error: lastError.message }));
  process.exit(1);
}

run().catch(e => {
  console.error('[Core CM] Fatal: ' + e.message);
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
});
