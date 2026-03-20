/**
 * Parallel BOA Upload to Arweave via Irys
 * Runs CONCURRENCY parallel uploads for speed
 * 
 * Usage: node upload-boa-parallel.mjs [--start 101] [--end 5000] [--concurrency 5]
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import { keypairIdentity } from '@metaplex-foundation/umi';
import fs from 'fs';
import path from 'path';

const RPC = 'https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED';
const DEPLOYER_PATH = process.env.HOME + '/.config/solana/mainnet-deployer.json';
const ASSETS_DIR = process.env.HOME + '/boa-assets';
const UPLOADED_PATH = process.env.HOME + '/agentfolio/boa-pipeline/candy-machine-data/uploaded-assets.json';

const args = process.argv.slice(2);
const getArg = (name, def) => { const idx = args.indexOf(name); return idx !== -1 ? args[idx + 1] : def; };
const START = parseInt(getArg('--start', '101'));
const END = parseInt(getArg('--end', '5000'));
const CONCURRENCY = parseInt(getArg('--concurrency', '5'));

// Shared state
let uploaded = {};
let totalUploaded = 0;
let totalFailed = 0;
let saveTimer = null;

function saveProgress() {
  fs.writeFileSync(UPLOADED_PATH, JSON.stringify(uploaded, null, 2));
}

async function uploadOne(umi, index, keypairPub) {
  const imagePath = path.join(ASSETS_DIR, 'images', `${index}.jpg`);
  const metadataPath = path.join(ASSETS_DIR, 'metadata', `${index}.json`);

  if (!fs.existsSync(imagePath) || !fs.existsSync(metadataPath)) {
    return { index, error: 'missing files' };
  }

  // Retry up to 3 times
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const imageBuffer = fs.readFileSync(imagePath);
      const uploadResult = await umi.uploader.upload([{
        buffer: imageBuffer,
        fileName: `${index}.jpg`,
        displayName: `BOA #${index}`,
        uniqueName: `boa-${index}-${Date.now()}`,
        contentType: 'image/jpeg',
        extension: 'jpg',
        tags: [{ name: 'Content-Type', value: 'image/jpeg' }],
      }]);
      const imageUri = uploadResult?.[0];
      if (!imageUri) throw new Error('No URI returned');

      const rawMeta = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      const fullMetadata = {
        name: rawMeta.name,
        symbol: 'BOA',
        description: rawMeta.description,
        image: imageUri,
        external_url: `https://agentfolio.bot/boa/${index}`,
        attributes: rawMeta.attributes,
        properties: {
          files: [{ uri: imageUri, type: 'image/jpeg' }],
          category: 'image',
          creators: [{ address: keypairPub, share: 100 }],
        },
        collection: { name: 'Burned-Out Agents', family: 'AgentFolio' },
      };

      const metadataUri = await umi.uploader.uploadJson(fullMetadata);

      return { index, imageUri, metadataUri, name: rawMeta.name };
    } catch (e) {
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
        continue;
      }
      return { index, error: e.message };
    }
  }
}

async function main() {
  console.log(`📤 Parallel BOA Upload: #${START}-#${END} (concurrency: ${CONCURRENCY})\n`);

  uploaded = JSON.parse(fs.readFileSync(UPLOADED_PATH, 'utf-8'));
  console.log(`📊 Already uploaded: ${Object.keys(uploaded).length}\n`);

  // Build work queue
  const queue = [];
  for (let i = START; i <= END; i++) {
    if (!uploaded[String(i)]) queue.push(i);
  }
  console.log(`📋 To upload: ${queue.length} items\n`);

  if (queue.length === 0) {
    console.log('Nothing to upload!');
    return;
  }

  // Setup UMI
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, 'utf-8'));
  const umi = createUmi(RPC).use(mplTokenMetadata()).use(irysUploader());
  const keypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(keypair));
  const keypairPub = keypair.publicKey.toString();
  console.log(`Authority: ${keypairPub}\n`);

  // Auto-save every 30 seconds
  saveTimer = setInterval(() => {
    saveProgress();
    const pct = ((totalUploaded / queue.length) * 100).toFixed(1);
    console.log(`  💾 Auto-save: ${Object.keys(uploaded).length} total, ${totalUploaded}/${queue.length} (${pct}%), ${totalFailed} failed`);
  }, 30000);

  // Process queue with concurrency limiter
  let queueIdx = 0;

  async function worker(workerId) {
    while (queueIdx < queue.length) {
      const idx = queueIdx++;
      const itemIndex = queue[idx];

      const result = await uploadOne(umi, itemIndex, keypairPub);

      if (result.error) {
        totalFailed++;
        console.log(`  ❌ #${result.index}: ${result.error}`);
      } else {
        uploaded[String(result.index)] = {
          imageUri: result.imageUri,
          metadataUri: result.metadataUri,
          name: result.name,
        };
        totalUploaded++;
        if (totalUploaded % 50 === 0 || totalUploaded <= 5) {
          const pct = ((totalUploaded / queue.length) * 100).toFixed(1);
          console.log(`  ✅ #${result.index} [${totalUploaded}/${queue.length} = ${pct}%]`);
        }
      }
    }
  }

  // Launch workers
  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker(i));
  }
  await Promise.all(workers);

  clearInterval(saveTimer);
  saveProgress();

  console.log('\n' + '='.repeat(60));
  console.log(`📊 Upload Complete:`);
  console.log(`   ✅ Uploaded: ${totalUploaded}`);
  console.log(`   ❌ Failed: ${totalFailed}`);
  console.log(`   📁 Total in file: ${Object.keys(uploaded).length}`);
}

main().catch(e => {
  console.error('Fatal:', e);
  clearInterval(saveTimer);
  saveProgress();
  process.exit(1);
});
