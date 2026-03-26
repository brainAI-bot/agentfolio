/**
 * Update Candy Machine guards for public minting
 * 
 * Two guard groups:
 * 1. "free" — thirdPartySigner guard (server co-signs for eligible agents)
 * 2. "paid" — solPayment guard (1 SOL to treasury) + mintLimit (3 per wallet)
 * 
 * Run: node update-cm-guards.mjs [--devnet]
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  mplCandyMachine,
  findCandyGuardPda,
  fetchCandyGuard,
  updateCandyGuard,
} from '@metaplex-foundation/mpl-core-candy-machine';
import { publicKey, keypairIdentity, some, none, sol } from '@metaplex-foundation/umi';
import fs from 'fs';

const isDevnet = process.argv.includes('--devnet');
const RPC = isDevnet 
  ? 'https://api.devnet.solana.com'
  : 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';

const CM_ADDRESS = isDevnet
  ? process.env.DEVNET_CM || 'TODO_DEVNET_CM'
  : 'BVso8ZjrV2G16eKZnVVhrfk8hPBgD7wgLKyxVbu489Gz';

const TREASURY = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';

console.log(`Network: ${isDevnet ? 'DEVNET' : 'MAINNET'}`);
console.log(`Candy Machine: ${CM_ADDRESS}`);
console.log(`Treasury: ${TREASURY}`);

if (!isDevnet) {
  console.log('\n⚠️  MAINNET UPDATE — Are you sure? (Ctrl+C to cancel, wait 5s to proceed)');
  await new Promise(r => setTimeout(r, 5000));
}

const umi = createUmi(RPC).use(mplCandyMachine());
const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
const keypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
umi.use(keypairIdentity(keypair));

const cmPk = publicKey(CM_ADDRESS);
const [guardPda] = findCandyGuardPda(umi, { base: cmPk });

console.log('Guard PDA:', guardPda);
console.log('Authority (deployer):', keypair.publicKey);

// Fetch current guard
const guard = await fetchCandyGuard(umi, guardPda);
console.log('\nCurrent groups:', guard.groups?.length || 0);

// Build new guard config with TWO groups:
// 
// Default guards (apply to all mints): none
// 
// Group "paid": SOL payment (1 SOL) + mint limit (3)
// Group "free": thirdPartySigner (deployer co-signs for eligible agents)

const guardConfig = {
  guards: {}, // no default guards (must use a group)
  groups: [
    {
      label: 'paid',
      guards: {
        solPayment: some({
          lamports: sol(1), // 1 SOL
          destination: publicKey(TREASURY),
        }),
        mintLimit: some({
          id: 1,
          limit: 3,
        }),
      },
    },
    {
      label: 'free',
      guards: {
        thirdPartySigner: some({
          signerKey: keypair.publicKey, // deployer co-signs for eligible agents
        }),
        mintLimit: some({
          id: 2,
          limit: 1, // only 1 free mint per wallet
        }),
      },
    },
  ],
};

console.log('\nUpdating guards...');
console.log('  Group "paid": 1 SOL + max 3/wallet');
console.log('  Group "free": thirdPartySigner + max 1/wallet');

try {
  await updateCandyGuard(umi, {
    candyGuard: guardPda,
    guards: guardConfig.guards,
    groups: guardConfig.groups,
  }).sendAndConfirm(umi);
  
  console.log('\n✅ Guards updated successfully!');
  console.log('\nMinting instructions:');
  console.log('  Paid: mintV1 with group="paid", include SOL payment to treasury');
  console.log('  Free: mintV1 with group="free", include thirdPartySigner (deployer signature)');
} catch (e) {
  console.error('\n❌ Failed:', e.message);
  if (e.logs) console.error('Logs:', e.logs.join('\n'));
}
