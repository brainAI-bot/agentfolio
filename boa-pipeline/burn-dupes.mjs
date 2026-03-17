import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { burnV1, mplTokenMetadata, TokenStandard } from "@metaplex-foundation/mpl-token-metadata";
import { keypairIdentity, publicKey } from "@metaplex-foundation/umi";
import fs from "fs";

const umi = createUmi("https://api.mainnet-beta.solana.com").use(mplTokenMetadata());
const raw = JSON.parse(fs.readFileSync("/home/ubuntu/.config/solana/mainnet-deployer.json"));
const kp = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(raw));
umi.use(keypairIdentity(kp));

const dupes = [
  "GALDyRPwwBN72UacHgWBC5n6mLmzJ76K7B1rLfANPY1o",
  "9itGtT4KC1qUejQu5KkWqgWxC9i82Ge67Q8BUWpJt7CP",
  "Gjrbxvx32LJcsLhC652r6XKUk8njhiWPUTDnndqMgC8C",
  "HPvn9i2wJhbGJ44shmDaRysqp8eDaRZuiPjtqEzdqnEd",
  "6T4e87DC7CsiKHcdJ5rDeKQ1vrp91fxBbqpJxKZNFDsG"
];

const collectionMint = publicKey("xNQmPj1Tcx3PyNNN1RLPeNkaMsZMRthAgWZ7Tbn6RHY");

for (const mint of dupes) {
  try {
    console.log("Burning", mint, "...");
    const tx = await burnV1(umi, {
      mint: publicKey(mint),
      authority: umi.identity,
      tokenOwner: umi.identity.publicKey,
      tokenStandard: TokenStandard.NonFungible,
      collectionMetadata: collectionMint,
    }).sendAndConfirm(umi);
    console.log("✅ Burned", mint, "sig:", Buffer.from(tx.signature).toString("base64"));
  } catch (e) {
    console.error("❌ Failed to burn", mint, e.message || e);
  }
}
