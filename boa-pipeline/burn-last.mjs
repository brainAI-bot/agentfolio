import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { burnV1, mplTokenMetadata, TokenStandard, findMetadataPda } from "@metaplex-foundation/mpl-token-metadata";
import { keypairIdentity, publicKey } from "@metaplex-foundation/umi";
import { findAssociatedTokenPda } from "@metaplex-foundation/mpl-toolbox";
import fs from "fs";

const umi = createUmi("https://api.mainnet-beta.solana.com").use(mplTokenMetadata());
const raw = JSON.parse(fs.readFileSync("/home/ubuntu/.config/solana/mainnet-deployer.json"));
const kp = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(raw));
umi.use(keypairIdentity(kp));

const mint = publicKey("HPvn9i2wJhbGJ44shmDaRysqp8eDaRZuiPjtqEzdqnEd");
const collectionMint = publicKey("xNQmPj1Tcx3PyNNN1RLPeNkaMsZMRthAgWZ7Tbn6RHY");

// Check metadata
const metadataPda = findMetadataPda(umi, { mint });
const metaAcct = await umi.rpc.getAccount(metadataPda[0]);
console.log("Metadata exists:", metaAcct.exists, "owner:", metaAcct.exists ? metaAcct.owner : "N/A");

// Try burn without collectionMetadata
try {
  console.log("Burning HPvn9i... (without collectionMetadata)...");
  const tx = await burnV1(umi, {
    mint,
    authority: umi.identity,
    tokenOwner: umi.identity.publicKey,
    tokenStandard: TokenStandard.NonFungible,
  }).sendAndConfirm(umi);
  console.log("✅ Burned! sig:", Buffer.from(tx.signature).toString("base64"));
} catch(e) {
  console.error("❌ Failed:", e.message?.slice(0,500));
}
