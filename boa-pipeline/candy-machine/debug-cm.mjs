import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { mplCandyMachine, fetchCandyMachine, findCandyGuardPda, fetchCandyGuard } from '@metaplex-foundation/mpl-candy-machine';
import { publicKey } from '@metaplex-foundation/umi';
import fs from 'fs';

const state = JSON.parse(fs.readFileSync('/home/ubuntu/agentfolio/boa-pipeline/candy-machine-data/candy-machine-state.json','utf8'));
const RPC = process.env.SOLANA_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
const umi = createUmi(RPC).use(mplTokenMetadata()).use(mplCandyMachine());

const cmData = await fetchCandyMachine(umi, publicKey(state.candyMachine));
console.log('CM authority:', cmData.authority);
console.log('CM mintAuthority:', cmData.mintAuthority);
console.log('Token standard:', cmData.tokenStandard);
console.log('Version:', cmData.version);
console.log('Items[0]:', JSON.stringify(cmData.items[0]));
console.log('Items[0] name:', cmData.items[0]?.name, 'parsed:', parseInt(cmData.items[0]?.name));

try {
  const guardPda = findCandyGuardPda(umi, { base: publicKey(state.candyMachine) });
  console.log('Guard PDA:', guardPda);
  const guard = await fetchCandyGuard(umi, guardPda);
  console.log('Guard guards:', JSON.stringify(guard.guards));
  console.log('Guard groups:', JSON.stringify(guard.groups));
} catch(e) {
  console.log('Guard error:', e.message);
}
