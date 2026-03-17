import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { verifyCollectionV1, findMetadataPda, mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { keypairIdentity, publicKey } from '@metaplex-foundation/umi';
import fs from 'fs';

const RPC = 'https://api.mainnet-beta.solana.com';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
const umi = createUmi(RPC).use(mplTokenMetadata());
const umiKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
umi.use(keypairIdentity(umiKeypair));

const collectionMint = 'xNQmPj1Tcx3PyNNN1RLPeNkaMsZMRthAgWZ7Tbn6RHY';
const mints = [
  'CrkBtRp1f7yrKEkxiJoPuUExr7FCGnENNCGoWdSzApc',   // BOA #1
  '7pcKKEEuJ8km8cwSbcCPdPdQPNzMdPhDaWX8zw1ySktE',   // BOA #2
  '66tsFU675DN2a98C8tRiid8QJWuq3DsLBm8c9tUpCGNg',   // BOA #3
  '685c195JYDn3pvCjV95nP9ftQ4ni55FZdSZuC6NGi7pg',   // BOA #4
  'HNAhLmnoRgMSUEiQuRexZbP5iBSzRSDpQkCWKJt46DfZ',   // BOA #5
  '6NeMLKadhjCZNpjCmyRhMcTBPjuLZnmALDXdQPfaqCDE',   // BOA #6
  'HwFJmshzEJvroQmAZdYPSB9afrN8H1jKHveVwJVzkDJK',   // BOA #7
];

for (const mint of mints) {
  try {
    const metadataPda = findMetadataPda(umi, { mint: publicKey(mint) });
    await verifyCollectionV1(umi, {
      metadata: metadataPda,
      collectionMint: publicKey(collectionMint),
      authority: umi.identity,
    }).sendAndConfirm(umi);
    console.log('✅ Verified:', mint);
    await new Promise(r => setTimeout(r, 1000));
  } catch (e) {
    console.log('⚠️', mint, '-', e.message?.slice(0, 100));
  }
}
console.log('Done');
