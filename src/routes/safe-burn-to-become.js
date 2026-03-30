/**
 * safe-burn-to-become.js
 * 
 * Safe wrapper for server-side burnToBecome that checks authority before signing.
 * Uses @brainai/satp-v3 SDK directly — no client.getGenesisRecord dependency.
 */

const { Connection, Keypair } = require("@solana/web3.js");
const fs = require("fs");

const DEPLOYER_KEY_PATH = "/home/ubuntu/.config/solana/mainnet-deployer.json";
const RPC_URL = process.env.SOLANA_RPC_URL || "https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb";

let _deployerPubkey = null;
function getDeployerPubkey() {
  if (!_deployerPubkey) {
    try {
      const keyData = JSON.parse(fs.readFileSync(DEPLOYER_KEY_PATH));
      const kp = Keypair.fromSecretKey(Uint8Array.from(keyData));
      _deployerPubkey = kp.publicKey.toBase58();
    } catch (e) {
      console.warn("[SafeBurn] Cannot load deployer key:", e.message);
    }
  }
  return _deployerPubkey;
}

async function safeBurnToBecome(agentId, faceImageUri, soulboundMint, burnTx) {
  try {
    const v3 = require("@brainai/satp-v3");
    const conn = new Connection(RPC_URL, "confirmed");

    // Derive genesis PDA and fetch account directly (no client.getGenesisRecord)
    const [genesisPda] = v3.deriveGenesisPda(agentId);
    const accountInfo = await conn.getAccountInfo(genesisPda);
    if (!accountInfo) {
      return { success: false, skipped: true, reason: "No genesis record for " + agentId };
    }

    const record = v3.deserializeGenesis(accountInfo.data);
    if (!record) {
      return { success: false, skipped: true, reason: "Failed to deserialize genesis for " + agentId };
    }
    if (record.isBorn || v3.isBorn(record)) {
      return { success: false, skipped: true, reason: "Agent already born: " + agentId };
    }

    // Check if deployer is the authority
    const deployerPubkey = getDeployerPubkey();
    if (!deployerPubkey) {
      return { success: false, skipped: true, reason: "Deployer key not available" };
    }

    const recordAuthority = record.authority?.toBase58?.() || record.authority?.toString?.() || record.authority;
    if (recordAuthority !== deployerPubkey) {
      return {
        success: false, skipped: true,
        reason: "Authority rotated to " + recordAuthority + ". Agent must sign client-side.",
        authority: recordAuthority, needsClientSign: true,
      };
    }

    // Build + send burnToBecome TX using V3 builders
    const signerKey = JSON.parse(fs.readFileSync(DEPLOYER_KEY_PATH, "utf-8"));
    const signer = Keypair.fromSecretKey(Uint8Array.from(signerKey));

    const builders = new v3.SatpV3Builders(RPC_URL);
    const tx = await builders.buildBurnToBecome({
      authority: signer.publicKey,
      agentId: agentId,
      faceImage: faceImageUri || "",
      faceMint: soulboundMint || "",
      faceBurnTx: burnTx || "",
    });
    tx.sign(signer);

    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction(sig, "confirmed");

    console.log("[SafeBurn] burnToBecome completed for " + agentId + ": tx=" + sig);
    return { success: true, txSignature: sig };

  } catch (e) {
    console.error("[SafeBurn] burnToBecome failed for " + agentId + ":", e.message);
    return { success: false, skipped: false, reason: e.message };
  }
}

module.exports = { safeBurnToBecome };
