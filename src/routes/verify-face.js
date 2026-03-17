/**
 * Public Face Verification API
 * 
 * Anyone can verify an AI agent's permanent face:
 * GET /api/verify/face/:agentId
 * 
 * Returns on-chain proof that the agent's face is:
 * - Permanently stored on Arweave
 * - Soulbound (non-transferable) on Solana
 * - Attested by the platform authority via signed Memo TX
 * - Linked to a burned original NFT
 */

const express = require("express");
const router = express.Router();

let faceRegistry;
try {
  faceRegistry = require("../lib/satp-face-registry");
} catch (e) {
  console.warn("[VerifyFace] Could not load face registry:", e.message);
}

/**
 * GET /api/verify/face/:agentId
 * Public: Verify an agent's permanent face on-chain
 * 
 * Response:
 * {
 *   verified: true/false,
 *   hasPermanentFace: true/false,
 *   onChainAttested: true/false,
 *   face: { image, permanent, soulboundMint, burnTx },
 *   onChain: { attestationTx, blockTime, memoData, soulboundExists, explorerUrl }
 * }
 */
router.get("/verify/face/:agentId", async (req, res) => {
  try {
    if (!faceRegistry) {
      return res.status(503).json({ error: "Face verification service unavailable" });
    }

    const result = await faceRegistry.verifyAgentFace(req.params.agentId);
    
    // Add helpful links
    if (result.face) {
      result.face.arweaveUrl = result.face.image;
    }
    
    res.json(result);
  } catch (e) {
    console.error("[VerifyFace] Error:", e.message);
    res.status(500).json({ error: "Verification failed", details: e.message });
  }
});

/**
 * GET /api/verify/face/tx/:signature
 * Public: Verify a specific face attestation transaction
 */
router.get("/verify/face/tx/:signature", async (req, res) => {
  try {
    if (!faceRegistry) {
      return res.status(503).json({ error: "Face verification service unavailable" });
    }

    const result = await faceRegistry.verifyFaceOnChain(req.params.signature);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: "Verification failed", details: e.message });
  }
});

module.exports = router;
