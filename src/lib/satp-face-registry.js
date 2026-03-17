/**
 * SATP Face Registry — Permanent On-Chain Face Attestation
 * 
 * After Burn to Become:
 * 1. Soulbound NFT minted (Token-2022, NonTransferable) in agent wallet
 * 2. Face attestation TX sent via Memo program — permanent on-chain record
 * 3. DB updated with attestation TX for quick lookup
 * 
 * Anyone can verify:
 * - Read the memo TX → get soulbound mint + Arweave URL
 * - Check soulbound NFT on-chain → non-transferable, correct metadata
 * - Check burn TX → original NFT was destroyed
 * - All verifiable without touching our servers
 */

const {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
} = require("@solana/web3.js");
const fs = require("fs");

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

let _deployerKeypair = null;

function getDeployer() {
  if (!_deployerKeypair) {
    const keyPath = process.env.DEPLOYER_KEY_PATH || "/home/ubuntu/.config/solana/devnet-deployer.json";
    const keyData = JSON.parse(fs.readFileSync(keyPath));
    _deployerKeypair = Keypair.fromSecretKey(Uint8Array.from(keyData));
  }
  return _deployerKeypair;
}

function getConnection() {
  return new Connection(RPC_URL, "confirmed");
}

/**
 * Register a permanent face attestation on-chain via Memo TX.
 * Signed by the deployer (platform authority).
 * 
 * @returns {{ signature: string, memoData: object }}
 */
async function registerFaceOnChain({
  agentId,
  agentName,
  agentWallet,
  soulboundMint,
  arweaveImage,
  burnTx,
  originalMint,
}) {
  const deployer = getDeployer();
  const connection = getConnection();

  const memoData = {
    protocol: "SATP-FACE-v1",
    action: "register_permanent_face",
    agentId,
    agentName,
    agentWallet,
    soulboundMint,
    arweaveImage,
    burnTx: burnTx || null,
    originalMint: originalMint || null,
    timestamp: Math.floor(Date.now() / 1000),
    permanent: true,
    authority: deployer.publicKey.toBase58(),
  };

  const memoStr = JSON.stringify(memoData);
  
  const { ComputeBudgetProgram } = require('@solana/web3.js');

  const memoIx = new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: deployer.publicKey, isSigner: true, isWritable: false }],
    data: Buffer.from(memoStr, "utf8"),
  });

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 }));
  tx.add(memoIx);
  tx.feePayer = deployer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const sig = await connection.sendTransaction(tx, [deployer]);
  await connection.confirmTransaction(sig, "confirmed");

  console.log("[FaceRegistry] Attestation TX:", sig);
  return { signature: sig, memoData };
}

/**
 * Verify a permanent face on-chain by reading the memo TX.
 * 
 * @param {string} attestationTx - The memo TX signature
 * @returns {object} Verification result
 */
async function verifyFaceOnChain(attestationTx) {
  const connection = getConnection();

  try {
    const txInfo = await connection.getTransaction(attestationTx, {
      maxSupportedTransactionVersion: 0,
    });

    if (!txInfo) {
      return { verified: false, error: "Transaction not found" };
    }

    // Extract memo data from transaction logs
    const logs = txInfo.meta?.logMessages || [];
    let memoData = null;

    // Parse memo from log messages
    for (const log of logs) {
      if (log.includes("SATP-FACE-v1")) {
        try {
          const jsonStart = log.indexOf("{");
          if (jsonStart >= 0) {
            memoData = JSON.parse(log.slice(jsonStart));
          }
        } catch {}
      }
    }

    // Fallback: try to parse from compiled instructions
    if (!memoData && txInfo.transaction?.message) {
      const msg = txInfo.transaction.message;
      const keys = msg.staticAccountKeys || msg.accountKeys || [];
      const ixs = msg.compiledInstructions || msg.instructions || [];
      for (const ix of ixs) {
        const pid = keys[ix.programIdIndex];
        if (pid && pid.toBase58() === MEMO_PROGRAM_ID.toBase58()) {
          try {
            const raw = ix.data instanceof Uint8Array ? ix.data : Buffer.from(ix.data, "base64");
            const decoded = Buffer.from(raw).toString("utf8");
            memoData = JSON.parse(decoded);
          } catch {}
        }
      }
    }

    if (!memoData || memoData.protocol !== "SATP-FACE-v1") {
      return { verified: false, error: "Not a valid SATP Face attestation" };
    }

    // Verify soulbound NFT exists on-chain
    let soulboundVerified = false;
    if (memoData.soulboundMint) {
      try {
        const mintInfo = await connection.getAccountInfo(new PublicKey(memoData.soulboundMint));
        soulboundVerified = !!mintInfo;
      } catch {}
    }

    // Verify authority signed
    const signers = (txInfo.transaction?.message?.staticAccountKeys || 
                     txInfo.transaction?.message?.accountKeys || []);
    const authoritySigned = signers.some(k => k.toBase58() === memoData.authority);

    return {
      verified: true,
      onChain: true,
      attestationTx,
      blockTime: txInfo.blockTime,
      slot: txInfo.slot,
      memoData,
      soulboundExists: soulboundVerified,
      authoritySigned,
      permanent: memoData.permanent === true,
      explorerUrl: "https://solscan.io/tx/" + attestationTx,
    };
  } catch (e) {
    return { verified: false, error: e.message };
  }
}

/**
 * Verify an agent's permanent face — combines DB lookup + on-chain verification.
 * This is the public-facing function anyone can call.
 * 
 * @param {string} agentId - AgentFolio profile ID
 * @returns {object} Full verification result
 */
async function verifyAgentFace(agentId) {
  const Database = require("better-sqlite3");
  const path = require("path");
  const db = new Database(path.join(__dirname, "../../data/agentfolio.db"), { readonly: true });

  const profile = db.prepare("SELECT nft_avatar, avatar FROM profiles WHERE id = ?").get(agentId);
  db.close();

  if (!profile || !profile.nft_avatar) {
    return {
      verified: false,
      hasPermanentFace: false,
      error: "Agent does not have a permanent face",
    };
  }

  const nftAvatar = JSON.parse(profile.nft_avatar);

  if (!nftAvatar.attestationTx) {
    return {
      verified: false,
      hasPermanentFace: true,
      onChainAttested: false,
      error: "Permanent face exists but has no on-chain attestation yet",
      face: {
        image: nftAvatar.image || nftAvatar.arweaveUrl,
        permanent: nftAvatar.permanent,
        soulboundMint: nftAvatar.soulboundMint,
      },
    };
  }

  // Full on-chain verification
  const onChainResult = await verifyFaceOnChain(nftAvatar.attestationTx);

  return {
    verified: onChainResult.verified,
    hasPermanentFace: true,
    onChainAttested: true,
    face: {
      image: nftAvatar.image || nftAvatar.arweaveUrl,
      permanent: nftAvatar.permanent,
      soulboundMint: nftAvatar.soulboundMint,
      burnTx: nftAvatar.burnTx,
    },
    onChain: onChainResult,
  };
}

module.exports = {
  registerFaceOnChain,
  verifyFaceOnChain,
  verifyAgentFace,
};
