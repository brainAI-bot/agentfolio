/**
 * Batch Upload BOA Assets (4,900 remaining) to Arweave via Irys
 * 
 * Uploads images + metadata JSON for indices 101-5000
 * Saves progress to uploaded-assets.json (appends to existing 100)
 * 
 * Usage: node upload-boa-batch.mjs [--start 101] [--end 5000] [--batch 10] [--dry-run]
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import { keypairIdentity } from '@metaplex-foundation/umi';
import fs from 'fs';
import path from 'path';

const RPC = 'https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const ASSETS_DIR = process.env.HOME + '/boa-assets';
const UPLOADED_PATH = process.env.HOME + '/agentfolio/boa-pipeline/candy-machine-data/uploaded-assets.json';

// Parse args
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : def;
};
const START = parseInt(getArg('--start', '101'));
const END = parseInt(getArg('--end', '5000'));
const BATCH_SIZE = parseInt(getArg('--batch', '10'));
const DRY_RUN = args.includes('--dry-run');

async function main() {
  console.log(`📤 BOA Batch Upload: #${START}-#${END} (batch size: ${BATCH_SIZE})${DRY_RUN ? ' [DRY RUN]' : ''}\n`);

  // Load existing uploads
  const uploaded = JSON.parse(fs.readFileSync(UPLOADED_PATH, 'utf-8'));
  console.log(`📊 Already uploaded: ${Object.keys(uploaded).length} assets\n`);

  if (DRY_RUN) {
    let toUpload = 0;
    for (let i = START; i <= END; i++) {
      if (!uploaded[String(i)]) toUpload++;
    }
    console.log(`Would upload ${toUpload} assets`);
    const avgImageSize = 150; // ~150KB average JPG
    console.log(`Estimated total size: ~${(toUpload * avgImageSize / 1024).toFixed(0)} MB images + metadata`);
    console.log(`Estimated cost: ~${(toUpload * avgImageSize / 1024 / 1024 * 0.05).toFixed(3)} SOL (at ~$0.05/MB on Irys)`);
    return;
  }

  // Setup UMI with Irys uploader
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
  const umi = createUmi(RPC)
    .use(mplTokenMetadata())
    .use(irysUploader());

  const keypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(keypair));
  console.log(`Authority: ${keypair.publicKey}\n`);

  let totalUploaded = 0;
  let totalFailed = 0;

  // Process in batches
  for (let batchStart = START; batchStart <= END; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, END);
    const batchItems = [];

    for (let i = batchStart; i <= batchEnd; i++) {
      if (uploaded[String(i)]) continue; // Skip already uploaded

      const imagePath = path.join(ASSETS_DIR, 'images', `${i}.jpg`);
      const metadataPath = path.join(ASSETS_DIR, 'metadata', `${i}.json`);

      if (!fs.existsSync(imagePath) || !fs.existsSync(metadataPath)) {
        console.warn(`⚠️  Missing files for #${i}`);
        continue;
      }

      batchItems.push({ index: i, imagePath, metadataPath });
    }

    if (batchItems.length === 0) continue;

    console.log(`\n📦 Batch ${batchStart}-${batchEnd}: ${batchItems.length} items`);

    for (const item of batchItems) {
      try {
        // Upload image
        const imageBuffer = fs.readFileSync(item.imagePath);
        const uploadResult = await umi.uploader.upload([{
          buffer: imageBuffer,
          fileName: `${item.index}.jpg`,
          displayName: `BOA #${item.index}`,
          uniqueName: `boa-${item.index}-${Date.now()}`,
          contentType: 'image/jpeg',
          extension: 'jpg',
          tags: [{ name: 'Content-Type', value: 'image/jpeg' }],
        }]);
        const imageUri = uploadResult?.[0];
        if (!imageUri) throw new Error('Image upload returned no URI');

        // Build full metadata
        const rawMeta = JSON.parse(fs.readFileSync(item.metadataPath, 'utf-8'));
        const fullMetadata = {
          name: rawMeta.name,
          symbol: 'BOA',
          description: rawMeta.description,
          image: imageUri,
          external_url: `https://agentfolio.bot/boa/${item.index}`,
          attributes: rawMeta.attributes,
          properties: {
            files: [{ uri: imageUri, type: 'image/jpeg' }],
            category: 'image',
            creators: [{ address: keypair.publicKey.toString(), share: 100 }],
          },
          collection: {
            name: 'Burned-Out Agents',
            family: 'AgentFolio',
          },
        };

        // Upload metadata JSON
        const metadataUri = await umi.uploader.uploadJson(fullMetadata);

        // Save to uploaded-assets
        uploaded[String(item.index)] = {
          imageUri,
          metadataUri,
          name: rawMeta.name,
        };

        totalUploaded++;
        if (totalUploaded % 10 === 0 || totalUploaded <= 3) {
          console.log(`  ✅ #${item.index}: ${imageUri.slice(-20)} → ${metadataUri.slice(-20)} (${totalUploaded} total)`);
        }

        // Save progress every 10 uploads
        if (totalUploaded % 10 === 0) {
          fs.writeFileSync(UPLOADED_PATH, JSON.stringify(uploaded, null, 2));
        }
      } catch (e) {
        console.error(`  ❌ #${item.index}: ${e.message}`);
        totalFailed++;
        // Wait longer on error (rate limit)
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Save after each batch
    fs.writeFileSync(UPLOADED_PATH, JSON.stringify(uploaded, null, 2));
    console.log(`  💾 Progress saved (${Object.keys(uploaded).length} total)`);
  }

  // Final save
  fs.writeFileSync(UPLOADED_PATH, JSON.stringify(uploaded, null, 2));

  console.log('\n' + '='.repeat(60));
  console.log(`📊 Upload Complete:`);
  console.log(`   ✅ Uploaded: ${totalUploaded}`);
  console.log(`   ❌ Failed: ${totalFailed}`);
  console.log(`   📁 Total in file: ${Object.keys(uploaded).length}`);
}

main().catch(console.error);
