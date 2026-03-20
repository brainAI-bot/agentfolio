/**
 * SATP v2 Identity Registry Client (Frontend)
 * Used to auto-create SATP identity after wallet verification
 */

import {
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";

// SATP v2 Identity Registry — Mainnet
export const SATP_V2_IDENTITY_PROGRAM = new PublicKey(
  "97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq"
);

/**
 * Derive SATP Identity PDA: ["identity", wallet_pubkey]
 */
export function getSatpIdentityPDA(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("identity"), owner.toBuffer()],
    SATP_V2_IDENTITY_PROGRAM
  );
}

/**
 * Check if wallet has an SATP identity on-chain
 */
export async function hasSatpIdentity(
  connection: Connection,
  wallet: PublicKey
): Promise<boolean> {
  const [pda] = getSatpIdentityPDA(wallet);
  try {
    const info = await connection.getAccountInfo(pda);
    return info !== null && info.data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Request unsigned SATP identity creation TX from backend
 * Returns base64 serialized TX for wallet to sign
 */
export async function requestSatpIdentityTx(
  walletAddress: string,
  profileId: string,
): Promise<{
  transaction: string | null;
  identityPDA: string;
  alreadyExists: boolean;
}> {
  const res = await fetch("/api/satp-auto/identity/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, profileId }),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(json.error || json.detail || "Failed to build SATP identity TX");
  }
  return json.data;
}

/**
 * Confirm SATP identity creation (after TX is signed and sent)
 */
export async function confirmSatpIdentity(
  walletAddress: string,
  profileId: string,
  txSignature: string
): Promise<void> {
  const res = await fetch("/api/satp-auto/identity/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, profileId, txSignature }),
  });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(json.error || "Failed to confirm SATP identity");
  }
}

/**
 * Full auto-create flow: build TX → sign → send → confirm
 * Returns the TX signature or null if already exists
 */
export async function autoCreateSatpIdentity(
  connection: Connection,
  walletAddress: string,
  profileId: string,
  sendTransaction: (tx: Transaction, conn: Connection) => Promise<string>,
): Promise<{ txSignature: string | null; identityPDA: string; alreadyExists: boolean }> {
  // 1. Request unsigned TX from backend
  const result = await requestSatpIdentityTx(walletAddress, profileId);

  if (result.alreadyExists || !result.transaction) {
    return {
      txSignature: null,
      identityPDA: result.identityPDA,
      alreadyExists: true,
    };
  }

  // 2. Deserialize and send via wallet adapter
  const tx = Transaction.from(Buffer.from(result.transaction, "base64"));
  const sig = await sendTransaction(tx, connection);
  
  // Use blockhash-based confirmation with 60s timeout (handles Solana congestion)
  try {
    const latestBlockhash = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction({
      signature: sig,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    }, "confirmed");
  } catch (confirmErr: any) {
    // If timeout but TX was sent, still try to confirm it
    console.warn("[SATP] Confirmation slow, checking TX status...", confirmErr.message);
    const status = await connection.getSignatureStatus(sig);
    if (status?.value?.confirmationStatus === "confirmed" || status?.value?.confirmationStatus === "finalized") {
      console.log("[SATP] TX confirmed despite timeout");
    } else {
      throw new Error("Transaction sent but not confirmed. Signature: " + sig + ". Check Solscan and retry if needed.");
    }
  }

  // 3. Confirm to backend
  await confirmSatpIdentity(walletAddress, profileId, sig);

  return {
    txSignature: sig,
    identityPDA: result.identityPDA,
    alreadyExists: false,
  };
}
