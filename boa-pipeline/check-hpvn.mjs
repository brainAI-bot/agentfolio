import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { publicKey } from "@metaplex-foundation/umi";
import { findAssociatedTokenPda, SPL_TOKEN_PROGRAM_ID } from "@metaplex-foundation/mpl-toolbox";
import { mplTokenMetadata, fetchDigitalAsset } from "@metaplex-foundation/mpl-token-metadata";

const umi = createUmi("https://api.mainnet-beta.solana.com").use(mplTokenMetadata());
const mint = publicKey("HPvn9i2wJhbGJ44shmDaRysqp8eDaRZuiPjtqEzdqnEd");
const deployer = publicKey("Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc");

// Check the mint account owner (Token Program vs Token-2022)
const mintAcct = await umi.rpc.getAccount(mint);
console.log("Mint owner program:", mintAcct.owner);
console.log("SPL_TOKEN:", SPL_TOKEN_PROGRAM_ID);

// Check ATA
const ata = findAssociatedTokenPda(umi, { mint, owner: deployer });
const ataAcct = await umi.rpc.getAccount(ata[0]);
console.log("ATA exists:", ataAcct.exists, "ATA owner:", ataAcct.exists ? ataAcct.owner : "N/A");

try {
  const asset = await fetchDigitalAsset(umi, mint);
  console.log("Name:", asset.metadata.name);
  console.log("Token Standard:", asset.metadata.tokenStandard);
} catch(e) {
  console.log("fetchDigitalAsset error:", e.message?.slice(0,200));
}
