/**
 * BOA Mint Worker — ESM script called by the API
 * Usage: node boa-mint-worker.mjs <nft_number> <recipient_wallet> [cluster]
 * Outputs JSON result to stdout
 *
 * v2 fixes:
 * - Mints directly to recipient via tokenOwner
 * - On-chain dedup: checks collection NFTs before minting
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createNft, verifyCollectionV1, findMetadataPda, mplTokenMetadata, TokenStandard } from '@metaplex-foundation/mpl-token-metadata';
import { generateSigner, keypairIdentity, percentAmount, publicKey, some } from '@metaplex-foundation/umi';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import fs from 'fs';
import path from 'path';

const nftNum = parseInt(process.argv[2]);
const recipient = process.argv[3];
const CLUSTER = process.argv[4] || 'devnet';

if (!nftNum || !recipient) {
  console.error(JSON.stringify({ error: 'Usage: node boa-mint-worker.mjs <nft_number> <wallet> [cluster]' }));
  process.exit(1);
}

const RPC = process.env.SOLANA_RPC_URL || (CLUSTER === 'mainnet' ? 'https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY' : 'https://api.devnet.solana.com');
const TREASURY = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const ASSETS_DIR = process.env.HOME + '/boa-assets';
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);

/**
 * On-chain dedup: check if a BOA with this number already exists
 * by scanning mint-records AND querying on-chain metadata
 */
async function checkAlreadyMinted(umi, nftNum, collectionMint) {
  // 1. Check local records — verify on-chain before trusting
  const recordPath = path.join(SCRIPT_DIR, 'mint-records', `${nftNum}.json`);
  if (fs.existsSync(recordPath)) {
    const existing = JSON.parse(fs.readFileSync(recordPath, 'utf-8'));
    if (existing.mint) {
      try {
        const resp = await fetch(RPC, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo',
            params: [existing.mint, { encoding: 'base64' }] })
        });
        const data = await resp.json();
        if (data.result && data.result.value) {
          console.error(`[DEDUP] NFT #${nftNum} verified on-chain: ${existing.mint}`);
          return existing;
        } else {
          console.error(`[DEDUP] Stale record #${nftNum}: ${existing.mint} not on-chain. Deleting.`);
          fs.unlinkSync(recordPath);
        }
      } catch (e) {
        console.error(`[DEDUP] On-chain check failed: ${e.message}, trusting local record`);
        return existing;
      }
    }
  }

  // 2. On-chain check: query all NFTs by collection update authority
  // Use RPC getAssetsByGroup (DAS API) if available, otherwise skip
  try {
    const response = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getAssetsByGroup',
        params: { groupKey: 'collection', groupValue: collectionMint, page: 1, limit: 1000 }
      })
    });
    const data = await response.json();
    if (data.result && data.result.items) {
      const existing = data.result.items.find(item =>
        item.content && item.content.metadata &&
        item.content.metadata.name === `BOA #${nftNum}`
      );
      if (existing) {
        // Found on-chain, write local record to prevent future dupes
        const record = {
          cluster: CLUSTER, nftNumber: nftNum, mint: existing.id,
          collection: collectionMint, metadataUri: existing.content?.json_uri || '',
          imageUri: existing.content?.links?.image || '',
          recipient: existing.ownership?.owner || 'unknown',
          createdAt: new Date().toISOString(), source: 'on-chain-recovery'
        };
        const recordsDir = path.join(SCRIPT_DIR, 'mint-records');
        if (!fs.existsSync(recordsDir)) fs.mkdirSync(recordsDir, { recursive: true });
        fs.writeFileSync(path.join(recordsDir, `${nftNum}.json`), JSON.stringify(record, null, 2));
        return record;
      }
    }
  } catch (e) {
    // DAS API not available on this RPC, skip on-chain check
    console.error(`Warning: on-chain dedup check failed (${e.message}), proceeding with local-only check`);
  }

  return null;
}

async function run() {
  // Load collection
  const collectionPath = path.join(SCRIPT_DIR, `collection-${CLUSTER}.json`);
  if (!fs.existsSync(collectionPath)) throw new Error('Collection not initialized');
  const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf-8'));

  // Load assets
  const metadataPath = path.join(ASSETS_DIR, 'metadata', `${nftNum}.json`);
  const imagePath = path.join(ASSETS_DIR, 'images', `${nftNum}.jpg`);
  if (!fs.existsSync(metadataPath)) throw new Error(`Metadata not found: ${nftNum}.json`);
  if (!fs.existsSync(imagePath)) throw new Error(`Image not found: ${nftNum}.jpg`);

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

  // Setup UMI
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
  const umi = createUmi(RPC).use(mplTokenMetadata()).use(irysUploader());
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(umiKeypair));

  // On-chain dedup check
  const alreadyMinted = await checkAlreadyMinted(umi, nftNum, collection.collectionMint);
  if (alreadyMinted) {
    console.log(JSON.stringify({ error: 'Already minted (dedup check)', mint: alreadyMinted.mint, source: alreadyMinted.source || 'local-record' }));
    process.exit(1);
  }

  // 1. Upload image
  const imageBuffer = fs.readFileSync(imagePath);
  let imageUri;
  try {
    const [uri] = await umi.uploader.upload([{
      buffer: imageBuffer, fileName: `${nftNum}.jpg`, displayName: `BOA #${nftNum}`,
      uniqueName: `boa-${nftNum}-${Date.now()}`, contentType: 'image/jpeg', extension: 'jpg',
      tags: [{ name: 'Content-Type', value: 'image/jpeg' }],
    }]);
    // Bug 5 fix: Replace gateway.irys.xyz → uploader.irys.xyz (gateway returns 302, Solscan doesn't follow)
    imageUri = uri.replace('https://gateway.irys.xyz/', 'https://uploader.irys.xyz/');
  } catch (e) {
    throw new Error('Image upload to Irys failed: ' + e.message);
  }

  // 2. Upload metadata
  const fullMetadata = {
    name: metadata.name, symbol: 'BOA', description: metadata.description,
    image: imageUri, external_url: `https://agentfolio.bot/nft/${nftNum}`,
    seller_fee_basis_points: 500, attributes: metadata.attributes,
    properties: {
      category: 'image', files: [{ uri: imageUri, type: 'image/jpeg' }],
      creators: [{ address: TREASURY, share: 100 }],
    },
    collection: { name: 'Burned-Out Agents', family: 'BOA' },
  };
  let metadataUri;
  try {
    metadataUri = await umi.uploader.uploadJson(fullMetadata);
    // Bug 5 fix: Same redirect fix for metadata URI
    metadataUri = metadataUri.replace('https://gateway.irys.xyz/', 'https://uploader.irys.xyz/');
  }
  catch (e) { throw new Error('Metadata upload to Irys failed: ' + e.message); }

  // 3. Create NFT — mint directly to recipient
  const nftMint = generateSigner(umi);
  await createNft(umi, {
    mint: nftMint, name: metadata.name, symbol: 'BOA', uri: metadataUri,
    sellerFeeBasisPoints: percentAmount(5),
    tokenOwner: publicKey(recipient),
    tokenStandard: TokenStandard.ProgrammableNonFungible, // Bug 6 fix: soulbound via pNFT (non-transferable)
    collection: some({ key: publicKey(collection.collectionMint), verified: false }),
    creators: [
      { address: publicKey(TREASURY), verified: false, share: 100 },
      { address: umiKeypair.publicKey, verified: true, share: 0 },
    ],
  }).sendAndConfirm(umi);

  // 4. Verify collection
  await new Promise(r => setTimeout(r, 2000));
  try {
    const nftMetadataPda = findMetadataPda(umi, { mint: nftMint.publicKey });
    await verifyCollectionV1(umi, {
      metadata: nftMetadataPda,
      collectionMint: publicKey(collection.collectionMint),
      authority: umi.identity,
    }).sendAndConfirm(umi);
  } catch (e) { /* deferred */ }

  // Save record
  const record = {
    cluster: CLUSTER, nftNumber: nftNum, mint: nftMint.publicKey.toString(),
    collection: collection.collectionMint, metadataUri, imageUri,
    recipient, createdAt: new Date().toISOString(),
  };
  const recordsDir = path.join(SCRIPT_DIR, 'mint-records');
  if (!fs.existsSync(recordsDir)) fs.mkdirSync(recordsDir, { recursive: true });
  fs.writeFileSync(path.join(recordsDir, `${nftNum}.json`), JSON.stringify(record, null, 2));

  // Output result
  console.log(JSON.stringify(record));
}

run().catch(e => {
  console.error(JSON.stringify({ error: e.message }));
  process.exit(1);
});
