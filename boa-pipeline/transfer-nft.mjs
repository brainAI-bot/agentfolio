/**
 * Transfer an NFT from deployer to recipient
 * Usage: node transfer-nft.mjs <mint_address> <recipient_wallet>
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { transferV1, mplTokenMetadata, TokenStandard } from '@metaplex-foundation/mpl-token-metadata';
import { keypairIdentity, publicKey } from '@metaplex-foundation/umi';
import fs from 'fs';

const mintAddr = process.argv[2];
const recipient = process.argv[3];
if (!mintAddr || !recipient) {
  console.error('Usage: node transfer-nft.mjs <mint> <recipient>');
  process.exit(1);
}

const RPC = 'https://api.mainnet-beta.solana.com';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';

const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
const umi = createUmi(RPC).use(mplTokenMetadata());
const umiKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
umi.use(keypairIdentity(umiKeypair));

console.log(`Transferring ${mintAddr} to ${recipient}...`);

const sig = await transferV1(umi, {
  mint: publicKey(mintAddr),
  destinationOwner: publicKey(recipient),
  tokenStandard: TokenStandard.NonFungible,
}).sendAndConfirm(umi);

console.log(JSON.stringify({ success: true, mint: mintAddr, recipient, signature: sig.signature.toString() }));
