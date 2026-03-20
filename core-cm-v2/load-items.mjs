/**
 * Load remaining items into existing Candy Machine (resume-safe)
 */
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { mplCandyMachine, addConfigLines, fetchCandyMachine } from "@metaplex-foundation/mpl-core-candy-machine";
import { keypairIdentity, publicKey, transactionBuilder } from "@metaplex-foundation/umi";
import { setComputeUnitLimit } from "@metaplex-foundation/mpl-toolbox";
import fs from "fs";
import path from "path";

const CM_ADDRESS = "BVso8ZjrV2G16eKZnVVhrfk8hPBgD7wgLKyxVbu489Gz";
const RPC = "https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY";
const DEPLOYER_PATH = process.env.HOME + "/.config/solana/mainnet-deployer.json";
const UPLOADED_PATH = process.env.HOME + "/agentfolio/boa-pipeline/candy-machine-data/uploaded-assets.json";
const MAX_SUPPLY = 5000;
const BATCH_SIZE = 8;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const uploaded = JSON.parse(fs.readFileSync(UPLOADED_PATH, "utf-8"));
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, "utf-8"));
  const umi = createUmi(RPC).use(mplCandyMachine());
  const keypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(keypair));

  // Check current state
  const cm = await fetchCandyMachine(umi, publicKey(CM_ADDRESS));
  const loadedItems = cm.items?.filter(i => i.name && i.name.trim()).length || 0;
  console.log("CM:", CM_ADDRESS);
  console.log("Currently loaded:", loadedItems, "/", MAX_SUPPLY);

  // Find the first unloaded batch
  let startIdx = 0;
  for (let i = 0; i < cm.items?.length; i++) {
    if (cm.items[i].name && cm.items[i].name.trim() && cm.items[i].uri && cm.items[i].uri.trim()) {
      startIdx = i + 1;
    } else {
      break;
    }
  }
  console.log("Starting from index:", startIdx);

  let loaded = startIdx;
  let failures = 0;

  for (let batchStart = startIdx; batchStart < MAX_SUPPLY; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, MAX_SUPPLY);
    const configLines = [];
    for (let i = batchStart; i < batchEnd; i++) {
      const nftNum = i + 1;
      const entry = uploaded[String(nftNum)];
      if (!entry?.metadataUri) { console.error("Missing #" + nftNum); continue; }
      configLines.push({ name: String(nftNum).padStart(4, " "), uri: entry.metadataUri });
    }
    if (configLines.length === 0) continue;

    let success = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await transactionBuilder()
          .add(setComputeUnitLimit(umi, { units: 400_000 }))
          .add(addConfigLines(umi, { candyMachine: publicKey(CM_ADDRESS), index: batchStart, configLines }))
          .sendAndConfirm(umi, { send: { skipPreflight: true }, confirm: { commitment: "confirmed" } });
        loaded += configLines.length;
        success = true;
        break;
      } catch (e) {
        const delay = Math.min(2000 * Math.pow(2, attempt), 30000);
        console.log("  Retry", attempt + 1, "for batch", batchStart, "in", delay, "ms:", e.message?.slice(0, 80));
        await sleep(delay);
      }
    }
    if (!success) { failures++; console.error("FAILED batch", batchStart); }
    if (loaded % 100 === 0 || loaded <= 30) console.log("  Loaded:", loaded, "/", MAX_SUPPLY);
    // Small delay between batches to avoid rate limits
    await sleep(500);
  }

  console.log("\nDone! Loaded:", loaded, "Failures:", failures);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
