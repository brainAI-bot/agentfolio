/**
 * Test Mint with Debug Logging
 * Attempts a single mint with verbose output
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

const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const CM_STATE_PATH = process.env.HOME + '/agentfolio/boa-pipeline/candy-machine-data/core-cm-state.json';

async function run() {
  const cmState = JSON.parse(fs.readFileSync(CM_STATE_PATH, 'utf-8'));
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));

  const umi = createUmi(RPC).use(mplCoreCandyMachine());
  const keypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(keypair));

  const cmPk = publicKey(cmState.candyMachine);
  const collPk = publicKey(cmState.collection);
  const recipient = 'Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc'; // deployer itself for test

  console.log('Fetching CM state...');
  const cm = await fetchCandyMachine(umi, cmPk);
  const nextIndex = Number(cm.itemsRedeemed);
  console.log(`Next index: ${nextIndex}, Items available: ${Number(cm.data.itemsAvailable)}`);

  const asset = generateSigner(umi);
  console.log(`Asset signer: ${asset.publicKey}`);
  console.log(`Minting with group: "free", thirdPartySigner: deployer`);

  const t0 = Date.now();
  try {
    const result = await transactionBuilder()
      .add(setComputeUnitLimit(umi, { units: 800_000 }))
      .add(setComputeUnitPrice(umi, { microLamports: 50_000 })) // priority fee for faster inclusion
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
      )
      .sendAndConfirm(umi, {
        send: { skipPreflight: false, commitment: 'confirmed' }, // preflight ON for better errors
        confirm: { commitment: 'confirmed' },
      });

    const elapsed = Date.now() - t0;
    console.log(`\n✅ MINT SUCCESS in ${elapsed}ms`);
    console.log(`Signature: ${result.signature}`);
    console.log(`Asset: ${asset.publicKey}`);
    console.log(JSON.stringify({ success: true, signature: result.signature.toString(), asset: asset.publicKey.toString() }));
  } catch (e) {
    const elapsed = Date.now() - t0;
    console.error(`\n❌ MINT FAILED after ${elapsed}ms`);
    console.error('Error:', e.message);
    
    // Parse logs if available
    if (e.logs) {
      console.error('\nProgram logs:');
      for (const log of e.logs) {
        console.error('  ', log);
      }
    }
    
    // Check for specific errors
    if (e.message.includes('6006')) {
      console.error('\n⚠️  ERROR 6006 = MissingRemainingAccount');
      console.error('A guard requires an account that was not passed in the TX.');
    }
    if (e.message.includes('block height')) {
      console.error('\n⚠️  TX EXPIRED — blockhash too old. RPC may be slow or TX took too long to land.');
      console.error('Try with skipPreflight: true, or use a faster RPC.');
    }
    if (e.message.includes('0x1')) {
      console.error('\n⚠️  InsufficientFunds — deployer may need more SOL.');
    }
    
    // Try to decode any custom error
    const customError = e.message.match(/custom program error: 0x([0-9a-fA-F]+)/);
    if (customError) {
      const code = parseInt(customError[1], 16);
      console.error(`\nCustom error code: ${code} (0x${customError[1]})`);
      const metaplexErrors = {
        6000: 'InvalidAccountSize',
        6001: 'UninitializedAccount', 
        6002: 'MintingNotStarted',
        6003: 'EndedCandyMachine',
        6004: 'MintAlreadyComplete',
        6005: 'GuardEvaluationFailed',
        6006: 'MissingRemainingAccount',
        6007: 'NumericalOverflow',
        6008: 'RequiredAccountMissing',
        6009: 'NotFrozenYet',
        6010: 'MintNotLastTransaction',
        6011: 'MintNotLive',
        6012: 'NotInitialized',
      };
      console.error(`Metaplex error name: ${metaplexErrors[code] || 'Unknown'}`);
    }
    
    process.exit(1);
  }
}

run().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
