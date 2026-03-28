/**
 * Debug Candy Machine Guards — Inspect what's configured on-chain
 * and identify which accounts are missing for the "free" group.
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  mplCandyMachine as mplCoreCandyMachine,
  fetchCandyMachine,
  fetchCandyGuard,
  findCandyGuardPda,
  mintV1,
} from '@metaplex-foundation/mpl-core-candy-machine';
import {
  generateSigner,
  keypairIdentity,
  publicKey,
  transactionBuilder,
  some,
  none,
} from '@metaplex-foundation/umi';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';
import fs from 'fs';

const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const CM_STATE_PATH = process.env.HOME + '/agentfolio/boa-pipeline/candy-machine-data/core-cm-state.json';

async function run() {
  const cmState = JSON.parse(fs.readFileSync(CM_STATE_PATH, 'utf-8'));
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));

  console.log('=== CM State File ===');
  console.log(JSON.stringify(cmState, null, 2));

  const umi = createUmi(RPC).use(mplCoreCandyMachine());
  const keypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(keypair));

  const cmPk = publicKey(cmState.candyMachine);
  const collPk = publicKey(cmState.collection);

  console.log('\n=== Fetching Candy Machine ===');
  const cm = await fetchCandyMachine(umi, cmPk);
  console.log('Authority:', cm.authority);
  console.log('Mint Authority:', cm.mintAuthority);
  console.log('Items Available:', Number(cm.data.itemsAvailable));
  console.log('Items Redeemed:', Number(cm.itemsRedeemed));
  console.log('Collection:', cmState.collection);

  // Check candy guard
  console.log('\n=== Fetching Candy Guard ===');
  const guardPda = findCandyGuardPda(umi, { base: cmPk });
  console.log('Guard PDA:', guardPda[0]);

  try {
    const guard = await fetchCandyGuard(umi, guardPda[0]);
    console.log('\n=== Default Guards ===');
    console.log(JSON.stringify(guard.guards, (key, val) => {
      if (val && val.__option === 'None') return undefined;
      if (val && val.__option === 'Some') return val.value;
      if (typeof val === 'bigint') return val.toString();
      return val;
    }, 2));

    console.log('\n=== Guard Groups ===');
    if (guard.groups && guard.groups.length > 0) {
      for (const group of guard.groups) {
        console.log(`\nGroup: "${group.label}"`);
        const active = {};
        for (const [key, val] of Object.entries(group.guards)) {
          if (val && val.__option === 'Some') {
            active[key] = val.value;
          }
        }
        console.log(JSON.stringify(active, (key, val) => {
          if (typeof val === 'bigint') return val.toString();
          return val;
        }, 2));
      }
    } else {
      console.log('No groups configured');
    }
  } catch (e) {
    console.log('No candy guard found or error:', e.message);
  }

  // Try to build the mint TX without sending
  console.log('\n=== Attempting to build mint TX (simulation only) ===');
  try {
    const asset = generateSigner(umi);
    const recipient = 'Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc';

    const builder = transactionBuilder()
      .add(setComputeUnitLimit(umi, { units: 800_000 }))
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

    // Build but don't send — just check instruction count and accounts
    const tx = await builder.buildWithLatestBlockhash(umi);
    console.log('TX built successfully');
    console.log('Number of instructions:', tx.message.instructions.length);
    
    for (let i = 0; i < tx.message.instructions.length; i++) {
      const ix = tx.message.instructions[i];
      console.log(`\nInstruction ${i}:`);
      console.log(`  Program index: ${ix.programIndex}`);
      console.log(`  Accounts: ${ix.accounts ? ix.accounts.length : 0}`);
      console.log(`  Data length: ${ix.data ? ix.data.length : 0}`);
    }

    // Try simulation
    console.log('\n=== Simulating TX ===');
    const simResult = await umi.rpc.simulateTransaction(tx, { commitment: 'confirmed' });
    console.log('Simulation result:', JSON.stringify(simResult, (key, val) => {
      if (typeof val === 'bigint') return val.toString();
      return val;
    }, 2));

  } catch (e) {
    console.error('\n=== BUILD/SIMULATION ERROR ===');
    console.error('Error:', e.message);
    if (e.logs) {
      console.error('\nProgram logs:');
      for (const log of e.logs) {
        console.error('  ', log);
      }
    }
    // Check for specific Metaplex error codes
    const match6006 = e.message.match(/custom program error: 0x(\w+)/);
    if (match6006) {
      console.error(`\nDecoded error: 0x${match6006[1]} = ${parseInt(match6006[1], 16)}`);
    }
    if (e.message.includes('6006')) {
      console.error('\n⚠️  ERROR 6006 = Missing remaining account');
      console.error('This means a guard expects an account that was not passed.');
      console.error('Check which guards are active and what accounts they need.');
    }
  }
}

run().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
