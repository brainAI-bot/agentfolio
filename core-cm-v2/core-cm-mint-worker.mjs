/**
 * Core CM Mint Worker v2 — with priority fee + retry logic
 * 
 * Improvements over v1:
 * - Priority fee (50k microLamports) for faster block inclusion
 * - Retry logic: up to 3 attempts with fresh blockhash on timeout
 * - Better error classification (6006 vs timeout vs insufficient funds)
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
import fs from 'fs';
import path from 'path';

const recipient = process.argv[2];
if (!recipient) {
  console.log(JSON.stringify({ error: 'Usage: node core-cm-mint-worker.mjs <wallet>' }));
  process.exit(1);
}

const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const DATA_DIR = process.env.HOME + '/agentfolio/boa-pipeline/candy-machine-data';
const CM_STATE_PATH = path.join(DATA_DIR, 'core-cm-state.json');
const UPLOADED_PATH = path.join(DATA_DIR, 'uploaded-assets.json');
const RECORDS_DIR = process.env.HOME + '/agentfolio/boa-pipeline/mint-records';

const MAX_RETRIES = 3;
const PRIORITY_FEE = 50_000; // microLamports — enough for fast inclusion without overpaying

async function attemptMint(umi, cmPk, collPk, recipientPk, asset, attempt) {
  console.error(`[Core CM] Attempt ${attempt}/${MAX_RETRIES}...`);
  
  return transactionBuilder()
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
    )
    .sendAndConfirm(umi, {
      send: { skipPreflight: true, commitment: 'confirmed' },
      confirm: { commitment: 'confirmed' },
    });
}

async function run() {
  const cmState = JSON.parse(fs.readFileSync(CM_STATE_PATH, 'utf-8'));
  const uploaded = JSON.parse(fs.readFileSync(UPLOADED_PATH, 'utf-8'));
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));

  const umi = createUmi(RPC).use(mplCoreCandyMachine());
  const keypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(keypair));

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
    console.log(JSON.stringify({ error: `No item at index ${nextIndex}` }));
    process.exit(1);
  }

  const nameMatch = item.name.match(/(\d+)/);
  const boaId = nameMatch ? parseInt(nameMatch[1]) : nextIndex + 1;
  console.error(`[Core CM] Minting index ${nextIndex} → BOA #${boaId} → ${recipient}`);

  // Retry loop — fresh asset signer each attempt (new blockhash)
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const asset = generateSigner(umi);
    
    try {
      const t0 = Date.now();
      await attemptMint(umi, cmPk, collPk, recipientPk, asset, attempt);
      const elapsed = Date.now() - t0;
      
      console.error(`[Core CM] ✅ BOA #${boaId} → ${asset.publicKey} (${elapsed}ms)`);
      
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
      };
      if (!fs.existsSync(RECORDS_DIR)) fs.mkdirSync(RECORDS_DIR, { recursive: true });
      fs.writeFileSync(path.join(RECORDS_DIR, `${boaId}.json`), JSON.stringify(record, null, 2));

      console.log(JSON.stringify({
        success: true,
        boaId,
        boaName: `Burned-Out Agent #${boaId}`,
        mintAddress: asset.publicKey.toString(),
        metadataUri: item.uri,
        imageUri: assetData.imageUri || '',
        collection: cmState.collection,
        cmIndex: nextIndex,
        itemsRedeemed: nextIndex + 1,
        itemsAvailable: Number(cm.data.itemsAvailable),
      }));
      return; // Success — exit
    } catch (e) {
      lastError = e;
      const isTimeout = e.message.includes('block height') || e.message.includes('expired');
      const is6006 = e.message.includes('6006');
      
      if (is6006) {
        // 6006 = guard config issue — retrying won't help
        console.error(`[Core CM] ❌ Guard error 6006 — not retryable`);
        break;
      }
      
      if (isTimeout && attempt < MAX_RETRIES) {
        console.error(`[Core CM] ⏱ TX expired (attempt ${attempt}), retrying with fresh blockhash...`);
        // Small delay before retry
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      
      console.error(`[Core CM] ❌ Attempt ${attempt} failed: ${e.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  
  // All retries exhausted
  console.error(`[Core CM] Fatal after ${MAX_RETRIES} attempts: ${lastError.message}`);
  console.log(JSON.stringify({ error: lastError.message }));
  process.exit(1);
}

run().catch(e => {
  console.error(`[Core CM] Fatal: ${e.message}`);
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
});
