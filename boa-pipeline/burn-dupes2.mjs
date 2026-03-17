import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { burnV1, mplTokenMetadata, TokenStandard, findMetadataPda } from "@metaplex-foundation/mpl-token-metadata";
import { keypairIdentity, publicKey } from "@metaplex-foundation/umi";
import { findAssociatedTokenPda } from "@metaplex-foundation/mpl-toolbox";
import fs from "fs";

const umi = createUmi("https://api.mainnet-beta.solana.com").use(mplTokenMetadata());
const raw = JSON.parse(fs.readFileSync("/home/ubuntu/.config/solana/mainnet-deployer.json"));
const kp = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(raw));
umi.use(keypairIdentity(kp));

const dupes = [
  "9itGtT4KC1qUejQu5KkWqgWxC9i82Ge67Q8BUWpJt7CP",
  "Gjrbxvx32LJcsLhC652r6XKUk8njhiWPUTDnndqMgC8C",
  "HPvn9i2wJhbGJ44shmDaRysqp8eDaRZuiPjtqEzdqnEd",
  "6T4e87DC7CsiKHcdJ5rDeKQ1vrp91fxBbqpJxKZNFDsG"
];

const collectionMint = publicKey("xNQmPj1Tcx3PyNNN1RLPeNkaMsZMRthAgWZ7Tbn6RHY");

for (const mint of dupes) {
  try {
    // Check if deployer owns the token
    const ata = findAssociatedTokenPda(umi, { mint: publicKey(mint), owner: umi.identity.publicKey });
    const ataAcct = await umi.rpc.getAccount(ata[0]);
    if (!ataAcct.exists) {
      console.log("⏭️ Skipping", mint, "— deployer does not hold token (already transferred?)");
      continue;
    }
    console.log("Burning", mint, "...");
    const tx = await burnV1(umi, {
      mint: publicKey(mint),
      authority: umi.identity,
      tokenOwner: umi.identity.publicKey,
      tokenStandard: TokenStandard.NonFungible,
    }).sendAndConfirm(umi);
    console.log("✅ Burned", mint, "sig:", Buffer.from(tx.signature).toString("base64"));
  } catch (e) {
    console.error("❌ Failed", mint, e.message?.slice(0,200) || e);
  }
}
