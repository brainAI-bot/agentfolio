/**
 * safe-burn-to-become.js v2
 * 
 * After soulbound mints, writes faceImage + sets isBorn on SATP genesis record.
 * Creates genesis if it doesn't exist.
 * Uses @brainai/satp-v3 SDK builders directly.
 */

const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const fs = require("fs");

const DEPLOYER_KEY_PATH = "/home/ubuntu/.config/solana/mainnet-deployer.json";
const RPC_URL = process.env.SOLANA_RPC_URL || "https://mainnet.helius-rpc.com/?api-key=91c63e44-1c7a-4b98-830b-6135632565fb";

let _signer = null;
function getSigner() {
  if (!_signer) {
    const keyData = JSON.parse(fs.readFileSync(DEPLOYER_KEY_PATH));
    _signer = Keypair.fromSecretKey(Uint8Array.from(keyData));
  }
  return _signer;
}

/**
 * After soulbound is minted, write faceImage to SATP genesis and set isBorn=true.
 * Creates genesis record if it doesn't exist.
 */
async function safeBurnToBecome(agentId, faceImageUri, soulboundMintAddr, burnTxSig) {
  try {
    const v3 = require("@brainai/satp-v3");
    const conn = new Connection(RPC_URL, "confirmed");
    const signer = getSigner();
    const builders = new v3.SatpV3Builders(RPC_URL);

    const [genesisPda] = v3.deriveGenesisPda(agentId);
    const accountInfo = await conn.getAccountInfo(genesisPda);

    // STEP 1: Create genesis if it doesn't exist
    if (!accountInfo) {
      console.log("[SafeBurn] No genesis for", agentId, "— creating...");
      try {
        const createTx = await builders.createIdentity({
          agentId: agentId,
          name: agentId.replace("agent_", ""),
          description: "Created via burn-to-become",
          category: "ai-agent",
          capabilities: [],
          metadataUri: "",
          creator: signer.publicKey,
        });
        createTx.sign(signer);
        const createSig = await conn.sendRawTransaction(createTx.serialize());
        await conn.confirmTransaction(createSig, "confirmed");
        console.log("[SafeBurn] Genesis created for", agentId, "tx:", createSig);
      } catch (e) {
        // Account might already exist (race condition) — continue to burnToBecome
        console.warn("[SafeBurn] createIdentity failed (may already exist):", e.message);
      }
    } else {
      // Genesis exists — check if deployer is authority
      try {
        const record = v3.deserializeGenesis(accountInfo.data);
        if (record) {
          if (record.isBorn || v3.isBorn(record)) {
            return { success: false, skipped: true, reason: "Agent already born: " + agentId };
          }
          const recordAuth = record.authority?.toBase58?.() || record.authority?.toString?.() || String(record.authority);
          if (recordAuth !== signer.publicKey.toBase58()) {
            console.warn("[SafeBurn] Authority mismatch:", recordAuth, "!= deployer", signer.publicKey.toBase58());
            return {
              success: false, skipped: true,
              reason: "Authority is " + recordAuth + " (not deployer). Agent must sign client-side.",
              authority: recordAuth, needsClientSign: true,
            };
          }
        }
      } catch (e) {
        console.warn("[SafeBurn] Deser failed, attempting burnToBecome anyway:", e.message);
      }
    }

    // STEP 2: Call burnToBecome to set faceImage + isBorn
    const faceMintPk = soulboundMintAddr ? new PublicKey(soulboundMintAddr) : PublicKey.default;
    const tx = await builders.burnToBecome({
      agentId: agentId,
      authority: signer.publicKey,
      faceImage: faceImageUri || "",
      faceMint: faceMintPk,
      faceBurnTx: burnTxSig || "",
    });
    tx.sign(signer);
    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction(sig, "confirmed");

    console.log("[SafeBurn] burnToBecome completed for", agentId, "tx:", sig);
    return { success: true, txSignature: sig };

  } catch (e) {
    console.error("[SafeBurn] burnToBecome failed for", agentId, ":", e.message);
    return { success: false, skipped: false, reason: e.message };
  }
}

module.exports = { safeBurnToBecome };
