import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { publicKey } from "@metaplex-foundation/umi";
import { mplTokenMetadata, fetchDigitalAsset } from "@metaplex-foundation/mpl-token-metadata";

const umi = createUmi("https://api.mainnet-beta.solana.com").use(mplTokenMetadata());
const mints = [
  "GALDyRPwwBN72UacHgWBC5n6mLmzJ76K7B1rLfANPY1o",
  "9itGtT4KC1qUejQu5KkWqgWxC9i82Ge67Q8BUWpJt7CP",
  "Gjrbxvx32LJcsLhC652r6XKUk8njhiWPUTDnndqMgC8C",
  "HPvn9i2wJhbGJ44shmDaRysqp8eDaRZuiPjtqEzdqnEd",
  "6T4e87DC7CsiKHcdJ5rDeKQ1vrp91fxBbqpJxKZNFDsG"
];
for (const m of mints) {
  try {
    const a = await fetchDigitalAsset(umi, publicKey(m));
    const supply = Number(a.mint.supply);
    console.log(supply === 0 ? "🔥 BURNED" : `⚠️ SUPPLY=${supply}`, m, a.metadata.name);
  } catch(e) { console.log("❌ ERROR", m, e.message?.slice(0,100)); }
}
