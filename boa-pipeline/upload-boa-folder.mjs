/**
 * Upload BOA images to Arweave using Irys uploadFolder (bulk)
 * Much faster than individual uploads — batches automatically
 * 
 * Step 1: Upload all images in one folder upload
 * Step 2: Upload all metadata JSONs (with updated image URIs) in another folder upload
 * 
 * Usage: node upload-boa-folder.mjs [--skip-uploaded] [--images-only] [--metadata-only]
 */
import Irys from '@irys/upload';
import Solana from '@irys/upload-solana';
import fs from 'fs';
import path from 'path';

const ASSETS_DIR = process.env.HOME + '/boa-assets';
const DATA_DIR = process.env.HOME + '/agentfolio/boa-pipeline/candy-machine-data';
const UPLOADED_PATH = path.join(DATA_DIR, 'uploaded-assets.json');
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';

const args = process.argv.slice(2);
const SKIP_UPLOADED = args.includes('--skip-uploaded');
const IMAGES_ONLY = args.includes('--images-only');
const METADATA_ONLY = args.includes('--metadata-only');

async function main() {
  console.log('🔗 BOA Folder Upload via Irys\n');

  const key = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
  const irys = await Irys(Solana).withWallet(Uint8Array.from(key));
  console.log(`Connected: ${irys.address}`);
  
  const balance = await irys.getBalance();
  console.log(`Irys balance: ${balance.toString()} lamports (${(Number(balance) / 1e9).toFixed(6)} SOL)\n`);

  // Load existing uploads
  const uploaded = JSON.parse(fs.readFileSync(UPLOADED_PATH, 'utf-8'));
  console.log(`Already uploaded: ${Object.keys(uploaded).length}\n`);

  // Prepare staging directory with only the images we need to upload
  const STAGING_DIR = '/tmp/boa-upload-staging';
  const STAGING_IMAGES = path.join(STAGING_DIR, 'images');
  const STAGING_METADATA = path.join(STAGING_DIR, 'metadata');

  if (!METADATA_ONLY) {
    console.log('📂 Step 1: Preparing image staging directory...');
    fs.rmSync(STAGING_IMAGES, { recursive: true, force: true });
    fs.mkdirSync(STAGING_IMAGES, { recursive: true });

    let imageCount = 0;
    for (let i = 1; i <= 5000; i++) {
      if (SKIP_UPLOADED && uploaded[String(i)]?.imageUri) continue;
      const src = path.join(ASSETS_DIR, 'images', `${i}.jpg`);
      if (!fs.existsSync(src)) continue;
      // Create symlink instead of copy to save disk space
      fs.symlinkSync(src, path.join(STAGING_IMAGES, `${i}.jpg`));
      imageCount++;
    }
    console.log(`  Staged ${imageCount} images\n`);

    // Fund Irys if needed
    const imageSize = imageCount * 210000; // ~210KB avg
    const price = await irys.getPrice(imageSize);
    console.log(`  Estimated cost: ${price.toString()} lamports (${(Number(price) / 1e9).toFixed(6)} SOL)`);
    
    if (Number(balance) < Number(price)) {
      console.log(`  ⚠️  Insufficient Irys balance. Funding...`);
      const fundTx = await irys.fund(price);
      console.log(`  ✅ Funded: ${fundTx.id}`);
    }

    console.log('\n📤 Step 2: Uploading images folder to Arweave...');
    console.log('  This may take a while for 5,000 images...\n');
    
    const imageResult = await irys.uploadFolder(STAGING_IMAGES, {
      batchSize: 50,
      keepDeleted: false,
    });
    
    console.log(`\n✅ Images uploaded!`);
    console.log(`  Manifest ID: ${imageResult.id}`);
    console.log(`  Manifest URL: https://gateway.irys.xyz/${imageResult.id}`);
    
    // Save manifest for metadata step
    fs.writeFileSync(path.join(DATA_DIR, 'image-manifest.json'), JSON.stringify({
      manifestId: imageResult.id,
      manifestUrl: `https://gateway.irys.xyz/${imageResult.id}`,
      timestamp: new Date().toISOString(),
    }, null, 2));

    // Parse manifest to get individual image URIs
    // With uploadFolder, images are accessible at: https://gateway.irys.xyz/<manifestId>/<filename>
    console.log('\n📋 Mapping image URIs...');
    for (let i = 1; i <= 5000; i++) {
      const imageUri = `https://gateway.irys.xyz/${imageResult.id}/${i}.jpg`;
      if (!uploaded[String(i)]) {
        uploaded[String(i)] = { imageUri, name: `Burned-Out Agent #${i}` };
      } else if (!uploaded[String(i)].imageUri) {
        uploaded[String(i)].imageUri = imageUri;
      }
    }
    fs.writeFileSync(UPLOADED_PATH, JSON.stringify(uploaded, null, 2));
    console.log(`  ✅ Saved ${Object.keys(uploaded).length} entries\n`);
  }

  if (!IMAGES_ONLY) {
    console.log('📂 Step 3: Preparing metadata staging directory...');
    fs.rmSync(STAGING_METADATA, { recursive: true, force: true });
    fs.mkdirSync(STAGING_METADATA, { recursive: true });

    // Reload uploaded in case images step updated it
    const freshUploaded = JSON.parse(fs.readFileSync(UPLOADED_PATH, 'utf-8'));

    let metaCount = 0;
    for (let i = 1; i <= 5000; i++) {
      if (SKIP_UPLOADED && freshUploaded[String(i)]?.metadataUri) continue;
      
      const rawMetaPath = path.join(ASSETS_DIR, 'metadata', `${i}.json`);
      if (!fs.existsSync(rawMetaPath)) continue;

      const rawMeta = JSON.parse(fs.readFileSync(rawMetaPath, 'utf-8'));
      const imageUri = freshUploaded[String(i)]?.imageUri;
      if (!imageUri) {
        console.warn(`  ⚠️  No image URI for #${i}, skipping metadata`);
        continue;
      }

      const fullMetadata = {
        name: rawMeta.name,
        symbol: 'BOA',
        description: rawMeta.description,
        image: imageUri,
        external_url: `https://agentfolio.bot/boa/${i}`,
        attributes: rawMeta.attributes,
        properties: {
          files: [{ uri: imageUri, type: 'image/jpeg' }],
          category: 'image',
        },
        collection: {
          name: 'Burned-Out Agents',
          family: 'AgentFolio',
        },
      };

      fs.writeFileSync(path.join(STAGING_METADATA, `${i}.json`), JSON.stringify(fullMetadata));
      metaCount++;
    }
    console.log(`  Staged ${metaCount} metadata files\n`);

    console.log('📤 Step 4: Uploading metadata folder to Arweave...');
    const metaResult = await irys.uploadFolder(STAGING_METADATA, {
      batchSize: 100,
      keepDeleted: false,
    });

    console.log(`\n✅ Metadata uploaded!`);
    console.log(`  Manifest ID: ${metaResult.id}`);
    console.log(`  Manifest URL: https://gateway.irys.xyz/${metaResult.id}`);

    fs.writeFileSync(path.join(DATA_DIR, 'metadata-manifest.json'), JSON.stringify({
      manifestId: metaResult.id,
      manifestUrl: `https://gateway.irys.xyz/${metaResult.id}`,
      timestamp: new Date().toISOString(),
    }, null, 2));

    // Update uploaded-assets with metadata URIs
    for (let i = 1; i <= 5000; i++) {
      const metadataUri = `https://gateway.irys.xyz/${metaResult.id}/${i}.json`;
      if (freshUploaded[String(i)]) {
        freshUploaded[String(i)].metadataUri = metadataUri;
      }
    }
    fs.writeFileSync(UPLOADED_PATH, JSON.stringify(freshUploaded, null, 2));
    console.log(`  ✅ Saved ${Object.keys(freshUploaded).length} entries with metadata URIs\n`);
  }

  // Cleanup staging
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });

  console.log('🎉 Done! All assets uploaded to Arweave.');
  console.log('Next: Load into Candy Machine with the metadata URIs.');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
