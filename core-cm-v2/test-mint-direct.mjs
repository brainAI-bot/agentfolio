/**
 * Direct mint test — bypasses Umi sendAndConfirm, uses web3.js for TX sending
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

const recipient = process.argv[2] || 'FaRsMftyJgiVTGkE8eGDJBABiRcsgtJQPWFtBtHMTg9v';
const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const DATA_DIR = process.env.HOME + '/agentfolio/boa-pipeline/candy-machine-data';
const CM_STATE_PATH = path.join(DATA_DIR, 'core-cm-state.json');

async function run() {
  const cmState = JSON.parse(fs.readFileSync(CM_STATE_PATH, 'utf-8'));
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));

  const umi = createUmi(RPC).use(mplCoreCandyMachine());
  const keypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(keypair));

  const cmPk = publicKey(cmState.candyMachine);
  const collPk = publicKey(cmState.collection);

  console.error('[Test] Fetching CM state...');
  const cm = await fetchCandyMachine(umi, cmPk, { commitment: 'confirmed' });
  const nextIndex = Number(cm.itemsRedeemed);
  console.error('[Test] Next index: ' + nextIndex + ', items: ' + cm.data.itemsAvailable);

  const item = cm.items[nextIndex];
  const nameMatch = item.name.match(/(\d+)/);
  const boaId = nameMatch ? parseInt(nameMatch[1]) : nextIndex + 1;
  console.error('[Test] Will mint BOA #' + boaId + ' -> ' + recipient);

  const asset = generateSigner(umi);
  
  // Build with Umi
  console.error('[Test] Building TX...');
  const builder = transactionBuilder()
    .add(setComputeUnitLimit(umi, { units: 800_000 }))
    .add(setComputeUnitPrice(umi, { microLamports: 200_000 }))
    .add(
      mintV1(umi, {
        candyMachine: cmPk,
        asset,
        collection: collPk,
        owner: publicKey(recipient),
        group: some('free'),
        mintArgs: {
          thirdPartySigner: some({ signer: umi.identity }),
        },
      })
    );
  
  // Build and sign with Umi, then convert to web3.js for sending
  const signedTx = await builder.buildAndSign(umi);
  const web3Tx = toWeb3JsTransaction(signedTx);
  
  // Send via web3.js connection for better control
  const connection = new Connection(RPC, { commitment: 'confirmed', confirmTransactionInitialTimeout: 60000 });
  
  console.error('[Test] Sending TX via web3.js...');
  const t0 = Date.now();
  const sig = await connection.sendRawTransaction(web3Tx.serialize(), {
    skipPreflight: true,
    maxRetries: 10,
    preflightCommitment: 'confirmed',
  });
  console.error('[Test] TX sent: ' + sig);
  
  // Confirm with blockhash strategy
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  console.error('[Test] Waiting for confirmation...');
  const confirmation = await connection.confirmTransaction({
    signature: sig,
    blockhash,
    lastValidBlockHeight,
  }, 'confirmed');
  
  const elapsed = Date.now() - t0;
  
  if (confirmation.value.err) {
    console.error('[Test] TX FAILED: ' + JSON.stringify(confirmation.value.err));
    console.log(JSON.stringify({ error: 'TX failed: ' + JSON.stringify(confirmation.value.err), signature: sig }));
    process.exit(1);
  }
  
  console.error('[Test] CONFIRMED in ' + elapsed + 'ms: ' + sig);
  console.log(JSON.stringify({
    success: true,
    boaId,
    mintAddress: asset.publicKey.toString(),
    signature: sig,
    elapsed,
    collection: cmState.collection,
  }));
}

run().catch(e => {
  console.error('[Test] Fatal: ' + e.message);
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
});
