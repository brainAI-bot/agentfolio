/**
 * Simulate mint TX first, then send if simulation passes
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
const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED';
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

  console.error('[Sim] Fetching CM state...');
  const cm = await fetchCandyMachine(umi, cmPk, { commitment: 'confirmed' });
  const nextIndex = Number(cm.itemsRedeemed);
  console.error('[Sim] Next index: ' + nextIndex);

  const item = cm.items[nextIndex];
  const nameMatch = item.name.match(/(\d+)/);
  const boaId = nameMatch ? parseInt(nameMatch[1]) : nextIndex + 1;

  const asset = generateSigner(umi);
  
  console.error('[Sim] Building TX...');
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
  
  const signedTx = await builder.buildAndSign(umi);
  const web3Tx = toWeb3JsTransaction(signedTx);
  
  const connection = new Connection(RPC, { commitment: 'confirmed' });
  
  // SIMULATE first
  console.error('[Sim] Simulating TX...');
  const simResult = await connection.simulateTransaction(web3Tx, { commitment: 'confirmed' });
  console.error('[Sim] Simulation result:');
  console.error('  err: ' + JSON.stringify(simResult.value.err));
  console.error('  logs:');
  if (simResult.value.logs) {
    for (const log of simResult.value.logs) {
      console.error('    ' + log);
    }
  }
  console.error('  unitsConsumed: ' + simResult.value.unitsConsumed);
  
  if (simResult.value.err) {
    console.log(JSON.stringify({ error: 'Simulation failed', details: simResult.value.err, logs: simResult.value.logs }));
    process.exit(1);
  }
  
  // Simulation passed — now send with preflight enabled to double-check
  console.error('[Sim] Simulation PASSED! Sending TX...');
  const t0 = Date.now();
  
  try {
    const sig = await connection.sendRawTransaction(web3Tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 10,
    });
    console.error('[Sim] TX sent: ' + sig);
    
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const confirmation = await connection.confirmTransaction({
      signature: sig,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');
    
    const elapsed = Date.now() - t0;
    
    if (confirmation.value.err) {
      console.error('[Sim] TX FAILED on-chain: ' + JSON.stringify(confirmation.value.err));
      // Get the actual logs
      try {
        const txInfo = await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
        if (txInfo && txInfo.meta && txInfo.meta.logMessages) {
          console.error('[Sim] TX logs:');
          txInfo.meta.logMessages.forEach(l => console.error('  ' + l));
        }
      } catch {}
      console.log(JSON.stringify({ error: JSON.stringify(confirmation.value.err), signature: sig }));
      process.exit(1);
    }
    
    console.error('[Sim] CONFIRMED in ' + elapsed + 'ms!');
    console.log(JSON.stringify({
      success: true,
      boaId,
      mintAddress: asset.publicKey.toString(),
      signature: sig,
      elapsed,
    }));
  } catch (e) {
    console.error('[Sim] Send failed: ' + e.message);
    if (e.logs) {
      console.error('[Sim] TX logs:');
      e.logs.forEach(l => console.error('  ' + l));
    }
    console.log(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
}

run().catch(e => {
  console.error('[Sim] Fatal: ' + e.message);
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
});
