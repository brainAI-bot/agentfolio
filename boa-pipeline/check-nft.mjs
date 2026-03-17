import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { fetchDigitalAsset, mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";
import { publicKey } from "@metaplex-foundation/umi";

const umi = createUmi("https://api.mainnet-beta.solana.com").use(mplTokenMetadata());
const asset = await fetchDigitalAsset(umi, publicKey("HPvn9i2wJhbGJ44shmDaRysqp8eDaRZuiPjtqEzdqnEd"));
console.log("Name:", asset.metadata.name);
console.log("Update Auth:", asset.metadata.updateAuthority);
console.log("Token Owner check needed via token account");
