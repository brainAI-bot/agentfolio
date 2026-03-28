/**
 * Remove mintLimit from "free" guard group
 * 
 * The "free" guard group's mintLimit(id:2, limit:1) tracks per-minter,
 * but for server-side mints, the minter is always the deployer.
 * After 1 free mint, all subsequent free mints fail.
 * 
 * Fix: Remove mintLimit from "free" group (server already controls eligibility).
 * Keep mintLimit on "paid" group (user-facing).
 * 
 * Run from: ~/agentfolio/core-cm-v2/
 * Usage: node remove-free-mintlimit.mjs
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

const RPC = 'https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED';
const CM_ADDRESS = 'BVso8ZjrV2G16eKZnVVhrfk8hPBgD7wgLKyxVbu489Gz';
const TREASURY = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';

console.log('Network: MAINNET');
console.log('Candy Machine:', CM_ADDRESS);
console.log('Fix: Remove mintLimit from "free" guard group');
console.log('\n⚠️  MAINNET UPDATE — 5s delay before executing...');
await new Promise(r => setTimeout(r, 5000));

const umi = createUmi(RPC).use(mplCandyMachine());
const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
const keypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
umi.use(keypairIdentity(keypair));

const cmPk = publicKey(CM_ADDRESS);
const [guardPda] = findCandyGuardPda(umi, { base: cmPk });

console.log('Guard PDA:', guardPda);
console.log('Authority:', keypair.publicKey);

// Fetch current guard
const guard = await fetchCandyGuard(umi, guardPda);
console.log('\nCurrent groups:', guard.groups?.length || 0);
for (const g of guard.groups || []) {
  console.log(`  "${g.label}":`, JSON.stringify(Object.entries(g.guards).filter(([k,v]) => v.__option === 'Some').map(([k]) => k)));
}

// Updated guard config: keep paid mintLimit, REMOVE free mintLimit
const guardConfig = {
  guards: {}, // no default guards
  groups: [
    {
      label: 'paid',
      guards: {
        solPayment: some({
          lamports: sol(1),
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
          signerKey: keypair.publicKey,
        }),
        // NO mintLimit — server controls eligibility for free mints
      },
    },
  ],
};

console.log('\nUpdating guards...');
console.log('  Group "paid": 1 SOL + max 3/wallet (unchanged)');
console.log('  Group "free": thirdPartySigner only (mintLimit REMOVED)');

try {
  await updateCandyGuard(umi, {
    candyGuard: guardPda,
    guards: guardConfig.guards,
    groups: guardConfig.groups,
  }).sendAndConfirm(umi);
  
  console.log('\n✅ Guards updated! Free group no longer has mintLimit.');
} catch (e) {
  console.error('\n❌ Failed:', e.message);
  if (e.logs) console.error('Logs:', e.logs.join('\n'));
}
