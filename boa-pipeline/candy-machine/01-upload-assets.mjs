/**
 * Step 1: Batch upload BOA assets (images + metadata) to Irys
 * Usage: node 01-upload-assets.mjs [startId] [endId]
 * Default: uploads IDs 1-100 (soft cap)
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import { mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { keypairIdentity } from '@metaplex-foundation/umi';
import fs from 'fs';
import path from 'path';

const START = parseInt(process.argv[2]) || 1;
const END = parseInt(process.argv[3]) || 100;
const BATCH_SIZE = 3; // Upload 3 at a time (Irys rate limits)

const RPC = process.env.SOLANA_RPC_URL || process.env.SOLANA_RPC || 'https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const ASSETS_DIR = process.env.HOME + '/boa-assets';
const OUTPUT_DIR = process.env.HOME + '/agentfolio/boa-pipeline/candy-machine-data';
const TREASURY = 'FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be';

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Resume support: load existing uploads
const uploadedPath = path.join(OUTPUT_DIR, 'uploaded-assets.json');
let uploaded = {};
if (fs.existsSync(uploadedPath)) {
  uploaded = JSON.parse(fs.readFileSync(uploadedPath, 'utf-8'));
  console.log(`Resuming: ${Object.keys(uploaded).length} assets already uploaded`);
}

async function run() {
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
  const umi = createUmi(RPC).use(mplTokenMetadata()).use(irysUploader());
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(umiKeypair));

  const ids = [];
  for (let i = START; i <= END; i++) {
    if (uploaded[i]?.metadataUri) continue; // Already uploaded
    const imgPath = path.join(ASSETS_DIR, 'images', `${i}.jpg`);
    const metaPath = path.join(ASSETS_DIR, 'metadata', `${i}.json`);
    if (fs.existsSync(imgPath) && fs.existsSync(metaPath)) {
      ids.push(i);
    }
  }

  console.log(`Uploading ${ids.length} assets (IDs ${START}-${END})...`);

  for (let batch = 0; batch < ids.length; batch += BATCH_SIZE) {
    const batchIds = ids.slice(batch, batch + BATCH_SIZE);
    console.log(`\nBatch ${Math.floor(batch/BATCH_SIZE) + 1}: uploading IDs ${batchIds.join(', ')}...`);

    for (const id of batchIds) {
      try {
        // Upload image
        let imageUri = uploaded[id]?.imageUri;
        if (!imageUri) {
          const imageBuffer = fs.readFileSync(path.join(ASSETS_DIR, 'images', `${id}.jpg`));
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const [uri] = await umi.uploader.upload([{
                buffer: imageBuffer,
                fileName: `${id}.jpg`,
                displayName: `BOA #${id}`,
                uniqueName: `boa-cm-${id}-${Date.now()}`,
                contentType: 'image/jpeg',
                extension: 'jpg',
                tags: [{ name: 'Content-Type', value: 'image/jpeg' }],
              }]);
              if (!uri) throw new Error('Upload returned undefined URI');
              imageUri = uri.replace('https://gateway.irys.xyz/', 'https://uploader.irys.xyz/');
              break;
            } catch (retryErr) {
              if (attempt < 2) {
                console.log(`  ⚠️ Image #${id} attempt ${attempt+1} failed: ${retryErr.message}. Waiting 15s...`);
                await new Promise(r => setTimeout(r, 15000));
              } else throw retryErr;
            }
          }
          console.log(`  ✅ Image #${id}: ${imageUri}`);
        }

        // Upload metadata
        const metadata = JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, 'metadata', `${id}.json`), 'utf-8'));
        const fullMetadata = {
          name: metadata.name,
          symbol: 'BOA',
          description: metadata.description,
          image: imageUri,
          external_url: `https://agentfolio.bot/nft/${id}`,
          seller_fee_basis_points: 500,
          attributes: metadata.attributes,
          properties: {
            category: 'image',
            files: [{ uri: imageUri, type: 'image/jpeg' }],
            creators: [{ address: TREASURY, share: 100 }],
          },
          collection: { name: 'Burned-Out Agents', family: 'BOA' },
        };

        let metadataUri;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            metadataUri = await umi.uploader.uploadJson(fullMetadata);
            if (!metadataUri) throw new Error('Metadata upload returned undefined URI');
            metadataUri = metadataUri.replace('https://gateway.irys.xyz/', 'https://uploader.irys.xyz/');
            break;
          } catch (retryErr) {
            if (attempt < 2) {
              console.log(`  ⚠️ Metadata #${id} attempt ${attempt+1} failed: ${retryErr.message}. Waiting 15s...`);
              await new Promise(r => setTimeout(r, 15000));
            } else throw retryErr;
          }
        }
        console.log(`  ✅ Metadata #${id}: ${metadataUri}`);

        uploaded[id] = { imageUri, metadataUri, name: metadata.name };

        // Save progress after each upload
        fs.writeFileSync(uploadedPath, JSON.stringify(uploaded, null, 2));
        // Per-item delay to avoid rate limits
        await new Promise(r => setTimeout(r, 5000));
      } catch (e) {
        console.error(`  ❌ Failed #${id}: ${e.message}`);
      }
    }

    // Longer delay between batches to avoid Irys 429 rate limiting
    console.log('  Waiting 15s before next batch...');
    await new Promise(r => setTimeout(r, 15000));
  }

  console.log(`\n✅ Upload complete: ${Object.keys(uploaded).length} assets uploaded`);
  console.log(`Data saved to ${uploadedPath}`);
}

run().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
