/**
 * SATP V3 identity join client.
 * PDA: ["genesis", SHA256(profileId)] on GTppU4E44BqXTQgbqMZ68ozFzhP1TLty3EGnzzjtNZfG.
 * Client signs an unsigned TX from /api/satp-auto/v3/identity/create.
 * This is not an Irys/escrow/HXCU write.
 */

import {
  Connection,
  Transaction,
} from "@solana/web3.js";
import { SATP_MAINNET_PROGRAMS } from "./satp-mainnet-programs";

export const SATP_V3_IDENTITY_PROGRAM = SATP_MAINNET_PROGRAMS.IDENTITY;

export async function checkSatpV3Identity(profileId: string): Promise<any> {
  const res = await fetch(`/api/satp-auto/v3/identity/check/${encodeURIComponent(profileId)}`);
  return res.json();
}

export async function requestSatpIdentityV3Tx(
  walletAddress: string,
  profileId: string,
): Promise<{
  transaction: string | null;
  genesisPDA: string;
  alreadyExists: boolean;
  program?: string;
}> {
  const res = await fetch("/api/satp-auto/v3/identity/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, profileId }),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(json.error || json.detail || "Failed to build SATP V3 identity TX");
  }
  return json.data;
}

export async function confirmSatpIdentityV3(
  walletAddress: string,
  profileId: string,
  txSignature?: string,
): Promise<any> {
  const res = await fetch("/api/satp-auto/v3/identity/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, profileId, txSignature }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || "Failed to confirm SATP V3 identity");
  }
  return json;
}

export async function autoCreateSatpIdentityV3(
  connection: Connection,
  walletAddress: string,
  profileId: string,
  sendTransaction: (tx: Transaction, conn: Connection) => Promise<string>,
): Promise<{ txSignature: string | null; genesisPDA: string; alreadyExists: boolean; programVersion: string }> {
  const check = await checkSatpV3Identity(profileId);
  const existingPda = check?.v3?.genesisPDA || "";
  if (check?.v3?.accountExists || check?.v3?.exists) {
    try {
      await confirmSatpIdentityV3(walletAddress, profileId);
    } catch {}
    return {
      txSignature: null,
      genesisPDA: existingPda,
      alreadyExists: true,
      programVersion: "v3",
    };
  }

  const result = await requestSatpIdentityV3Tx(walletAddress, profileId);
  if (result.alreadyExists || !result.transaction) {
    try {
      await confirmSatpIdentityV3(walletAddress, profileId);
    } catch {}
    return {
      txSignature: null,
      genesisPDA: result.genesisPDA,
      alreadyExists: true,
      programVersion: "v3",
    };
  }

  const tx = Transaction.from(Buffer.from(result.transaction, "base64"));
  const sig = await sendTransaction(tx, connection);

  try {
    const latestBlockhash = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction({
      signature: sig,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    }, "confirmed");
  } catch (confirmErr: any) {
    const status = await connection.getSignatureStatus(sig);
    if (status?.value?.confirmationStatus !== "confirmed" && status?.value?.confirmationStatus !== "finalized") {
      throw new Error("Transaction sent but not confirmed. Signature: " + sig + ". Check Solscan and retry if needed.");
    }
  }

  await confirmSatpIdentityV3(walletAddress, profileId, sig);
  return {
    txSignature: sig,
    genesisPDA: result.genesisPDA,
    alreadyExists: false,
    programVersion: "v3",
  };
}
