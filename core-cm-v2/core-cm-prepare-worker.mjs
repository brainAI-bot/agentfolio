/**
 * Core CM Prepare Worker — Client-side signing, MINT ONLY (no burn)
 * 
 * Builds a single unsigned TX that mints a BOA from the Core Candy Machine.
 * NFT goes to user wallet and stays there (no atomic burn).
 * 
 * Server partially signs (asset keypair + deployer for free flow).
 * User signs in Phantom to finalize.
 * 
 * Usage: node core-cm-prepare-worker.mjs <wallet> <flow>
 * flow: "free" (thirdPartySigner, deployer co-signs) or "paid" (solPayment)
 * 
 * Returns JSON: { transaction: base64, asset: pubkey, boaId, ... }
 */
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  mplCandyMachine,
  fetchCandyMachine,
  mintV1 as cmMintV1,
} from "@metaplex-foundation/mpl-core-candy-machine";
import { setComputeUnitLimit, setComputeUnitPrice } from "@metaplex-foundation/mpl-toolbox";
import {
  generateSigner,
  keypairIdentity,
  publicKey,
  transactionBuilder,
  createNoopSigner,
  some,
} from "@metaplex-foundation/umi";
import { toWeb3JsLegacyTransaction } from "@metaplex-foundation/umi-web3js-adapters";
import { Keypair } from "@solana/web3.js";
import fs from "fs";
import path from "path";

const recipient = process.argv[2];
const flow = process.argv[3] || "free";

if (!recipient) {
  console.log(JSON.stringify({ error: "Usage: node core-cm-prepare-worker.mjs <wallet> <flow>" }));
  process.exit(1);
}

const RPC = process.env.SOLANA_RPC_URL || "https://mainnet.helius-rpc.com/?api-key=REDACTED_HELIUS_API_KEY";
const DEPLOYER_PATH = process.env.HOME + "/.config/solana/mainnet-deployer.json";
const DATA_DIR = process.env.HOME + "/agentfolio/boa-pipeline/candy-machine-data";
const CM_STATE_PATH = path.join(DATA_DIR, "core-cm-state.json");
const UPLOADED_PATH = path.join(DATA_DIR, "uploaded-assets.json");

async function run() {
  const cmState = JSON.parse(fs.readFileSync(CM_STATE_PATH, "utf-8"));
  const uploaded = JSON.parse(fs.readFileSync(UPLOADED_PATH, "utf-8"));
  const secretKey = JSON.parse(fs.readFileSync(DEPLOYER_PATH, "utf-8"));

  const umi = createUmi(RPC).use(mplCandyMachine());
  const deployerKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(secretKey));
  umi.use(keypairIdentity(deployerKeypair));

  const cmPk = publicKey(cmState.candyMachine);
  const collPk = publicKey(cmState.collection);
  const recipientPk = publicKey(recipient);

  const cm = await fetchCandyMachine(umi, cmPk);
  const nextIndex = Number(cm.itemsRedeemed);

  if (nextIndex >= Number(cm.data.itemsAvailable)) {
    console.log(JSON.stringify({ error: "Collection sold out." }));
    process.exit(1);
  }

  const item = cm.items[nextIndex];
  if (!item) {
    console.log(JSON.stringify({ error: "No item at index " + nextIndex }));
    process.exit(1);
  }

  const nameMatch = item.name.match(/(\d+)/);
  const boaId = nameMatch ? parseInt(nameMatch[1]) : nextIndex + 1;
  const assetData = uploaded[boaId] || {};

  console.error("[CM Prepare] BOA #" + boaId + " -> " + recipient + " (" + flow + ")");

  const asset = generateSigner(umi);
  const ownerSigner = createNoopSigner(recipientPk);

  // Build MINT-ONLY TX (no burn)
  let builder = transactionBuilder()
    .add(setComputeUnitLimit(umi, { units: 800_000 }))
    .add(setComputeUnitPrice(umi, { microLamports: 200_000 }));

  if (flow === "free") {
    builder = builder.add(cmMintV1(umi, {
      candyMachine: cmPk,
      asset,
      collection: collPk,
      owner: recipientPk,
      group: some("free"),
      mintArgs: {
        thirdPartySigner: some({ signer: umi.identity }),
      },
    }));
  } else {
    builder = builder.add(cmMintV1(umi, {
      candyMachine: cmPk,
      asset,
      collection: collPk,
      owner: recipientPk,
      group: some("paid"),
      mintArgs: {
        solPayment: some({ destination: publicKey("FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be") }),
        mintLimit: some({ id: 1 }),
      },
    }));
  }

  // Build with recipient as fee payer
  const tx = await builder.setFeePayer(ownerSigner).buildWithLatestBlockhash(umi);
  const web3Tx = toWeb3JsLegacyTransaction(tx);

  // Server-side partial signing
  const assetWeb3Kp = Keypair.fromSecretKey(Uint8Array.from(asset.secretKey));
  web3Tx.partialSign(assetWeb3Kp);

  if (flow === "free") {
    const deployerWeb3Kp = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    web3Tx.partialSign(deployerWeb3Kp);
    console.error("[CM Prepare] Deployer co-signed for free flow");
  }

  const serialized = web3Tx.serialize({ requireAllSignatures: false });
  const base64Tx = Buffer.from(serialized).toString("base64");

  console.log(JSON.stringify({
    success: true,
    transaction: base64Tx,
    asset: asset.publicKey.toString(),
    boaId,
    boaName: "Burned-Out Agent #" + boaId,
    metadataUri: item.uri,
    imageUri: assetData.imageUri || "",
    collection: cmState.collection,
    cmIndex: nextIndex,
    flow,
    atomic: false,
    message: flow === "free"
      ? "Sign to mint your BOA (free, deployer co-signed). NFT goes to your wallet."
      : "Sign to mint your BOA (1 SOL). NFT goes to your wallet.",
  }));
}

run().catch(e => {
  console.error("[CM Prepare] Fatal:", e.message);
  console.log(JSON.stringify({ error: e.message }));
  process.exit(1);
});
