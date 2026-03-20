/**
 * Burn Core test mints from BOA collection
 * Only burns assets with data > 1 (alive) owned by deployer
 */
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { mplCore, burnV1 as coreBurnV1, fetchAssetV1 } from "@metaplex-foundation/mpl-core";
import { keypairIdentity, publicKey } from "@metaplex-foundation/umi";
import fs from "fs";

const RPC = 'https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY';
const umi = createUmi(RPC).use(mplCore());
const raw = JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/mainnet-deployer.json"));
const kp = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(raw));
umi.use(keypairIdentity(kp));

const BOA_COLLECTION = 'CCw8NjAS3QpfDU4fBYkJ2kD4znNy468e3wqAJQKoJCFk';

const testMints = [
  'HV3rPaELcCLauLsSUKLNYx7imiTsQjiGFHh2bZ2G3SB4',
  '7qX3BrvXi2mLkbRpNM9p9F7XujK826gYchBfikiqEbJD',
  '6yAFhmLed7opBxkoLi6DBEE1aXE9xZzBvcBao4UcKJ4T',
  '6qM7sKXoqbuHY1yjUiLVUW6HQbF99yrnjeqJ9PDS4Qbu',
  'UHjeyUxTGjKM4nGHKxFvP8iAf6vR4hUecN9VkkoYhfg',
];

for (const mint of testMints) {
  try {
    // Check if asset is alive
    const acct = await umi.rpc.getAccount(publicKey(mint));
    if (!acct.exists) {
      console.log(`${mint.slice(0,8)}: Already gone`);
      continue;
    }
    if (acct.data.length <= 1) {
      console.log(`${mint.slice(0,8)}: Tombstone (data=${acct.data.length}), already burned`);
      continue;
    }
    
    // Try to fetch as Core asset
    let asset;
    try {
      asset = await fetchAssetV1(umi, publicKey(mint));
    } catch (e) {
      console.log(`${mint.slice(0,8)}: Not a fetchable Core asset (${e.message})`);
      continue;
    }
    
    console.log(`${mint.slice(0,8)}: name="${asset.name}" owner=${asset.owner.toString().slice(0,12)}... collection=${asset.updateAuthority?.address?.toString()?.slice(0,12) || 'none'}`);
    
    // Only burn if deployer owns it
    if (asset.owner.toString() !== kp.publicKey.toString()) {
      console.log(`  ⏭️  Skipping — not owned by deployer`);
      continue;
    }

    console.log(`  🔥 Burning...`);
    const tx = await coreBurnV1(umi, {
      asset: publicKey(mint),
      collection: publicKey(BOA_COLLECTION),
    }).sendAndConfirm(umi);
    console.log(`  ✅ Burned! Sig: ${Buffer.from(tx.signature).toString('base64').slice(0,30)}...`);
  } catch (e) {
    console.error(`  ❌ Error: ${e.message}`);
  }
}
console.log('Done.');
