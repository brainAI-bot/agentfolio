/**
 * Burn old test mints from the old CM (Metaplex Core assets)
 */
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { mplCore, burnV1, fetchAssetV1 } from "@metaplex-foundation/mpl-core";
import { keypairIdentity, publicKey } from "@metaplex-foundation/umi";
import fs from "fs";

const RPC = 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
const umi = createUmi(RPC).use(mplCore());
const raw = JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/mainnet-deployer.json"));
const kp = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(raw));
umi.use(keypairIdentity(kp));

const collectionPk = publicKey("CCw8NjAS3QpfDU4fBYkJ2kD4znNy468e3wqAJQKoJCFk");

// Old CM test mints to burn
const oldMints = [
  "7qX3BrvXi2mLkbRpNM9p9F7XujK826gYchBfikiqEbJD",
  "6yAFhmLed7opBxkoLi6DBEE1aXE9xZzBvcBao4UcKJ4T",
  "UHjeyUxTGjKM4nGHKxFvP8iAf6vR4hUecN9VkkoYhfg",
];

for (const mint of oldMints) {
  try {
    console.log(`Checking ${mint}...`);
    const asset = await fetchAssetV1(umi, publicKey(mint));
    console.log(`  Name: ${asset.name}, Owner: ${asset.owner.toString().slice(0,12)}...`);
    
    if (asset.owner.toString() !== kp.publicKey.toString()) {
      console.log(`  ⏭️ Not owned by deployer, skipping`);
      continue;
    }
    
    console.log(`  🔥 Burning...`);
    const tx = await burnV1(umi, {
      asset: publicKey(mint),
      collection: collectionPk,
    }).sendAndConfirm(umi);
    console.log(`  ✅ Burned! Sig: ${Buffer.from(tx.signature).toString("base64").slice(0,40)}...`);
  } catch (e) {
    console.error(`  ❌ Error: ${e.message?.slice(0,200) || e}`);
  }
}
console.log("Done!");
