import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { burnV1, mplTokenMetadata, TokenStandard } from "@metaplex-foundation/mpl-token-metadata";
import { keypairIdentity, publicKey } from "@metaplex-foundation/umi";
import fs from "fs";

const umi = createUmi("https://api.mainnet-beta.solana.com").use(mplTokenMetadata());
const raw = JSON.parse(fs.readFileSync("/home/ubuntu/.config/solana/mainnet-deployer.json"));
const kp = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(raw));
umi.use(keypairIdentity(kp));

const mint = publicKey("HPvn9i2wJhbGJ44shmDaRysqp8eDaRZuiPjtqEzdqnEd");

console.log("Burning HPvn9i... with FungibleAsset standard...");
try {
  const tx = await burnV1(umi, {
    mint,
    authority: umi.identity,
    tokenOwner: umi.identity.publicKey,
    tokenStandard: TokenStandard.FungibleAsset,
    amount: 1,
  }).sendAndConfirm(umi);
  console.log("✅ Burned! sig:", Buffer.from(tx.signature).toString("base64"));
} catch(e) {
  console.error("❌ Failed:", e.message?.slice(0,500));
}
