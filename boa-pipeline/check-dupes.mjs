import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { publicKey } from "@metaplex-foundation/umi";
import { findAssociatedTokenPda } from "@metaplex-foundation/mpl-toolbox";
import { mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";

const umi = createUmi("https://api.mainnet-beta.solana.com").use(mplTokenMetadata());
const deployer = publicKey("Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc");

const dupes = [
  "GALDyRPwwBN72UacHgWBC5n6mLmzJ76K7B1rLfANPY1o",
  "9itGtT4KC1qUejQu5KkWqgWxC9i82Ge67Q8BUWpJt7CP",
  "Gjrbxvx32LJcsLhC652r6XKUk8njhiWPUTDnndqMgC8C",
  "HPvn9i2wJhbGJ44shmDaRysqp8eDaRZuiPjtqEzdqnEd",
  "6T4e87DC7CsiKHcdJ5rDeKQ1vrp91fxBbqpJxKZNFDsG"
];

for (const mint of dupes) {
  const acct = await umi.rpc.getAccount(publicKey(mint));
  if (!acct.exists) { console.log("BURNED:", mint); continue; }
  const ata = findAssociatedTokenPda(umi, { mint: publicKey(mint), owner: deployer });
  const ataAcct = await umi.rpc.getAccount(ata[0]);
  console.log(ataAcct.exists ? "ON_DEPLOYER:" : "EXISTS_ELSEWHERE:", mint);
}
