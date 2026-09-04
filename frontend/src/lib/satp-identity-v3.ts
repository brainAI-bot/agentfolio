/**
 * SATP V3 identity client.
 * Uses program GTppU4E... and mounted /api/satp-auto/v3/identity routes.
 * Client-signed genesis is not gated by AGENTFOLIO_ENABLE_SOLANA_IRYS_WRITES.
 */

import {
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { SATP_V3_IDENTITY_PROGRAM_ID } from "./satp-mainnet-programs";

export const SATP_V3_IDENTITY_PROGRAM = new PublicKey(SATP_V3_IDENTITY_PROGRAM_ID);

export type SatpV3IdentityResult = {
  transaction?: string | null;
  genesisPDA?: string;
  identityPDA?: string;
  alreadyExists?: boolean;
  program?: string;
  programVersion?: string;
  txSignature?: string | null;
};

export async function checkSatpV3Identity(agentId: string, wallet?: string) {
  const query = wallet ? `?wallet=${encodeURIComponent(wallet)}` : "";
  const res = await fetch(`/api/satp-auto/v3/identity/check/${encodeURIComponent(agentId)}${query}`);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || "Failed to check SATP V3 identity");
  }
  return json;
}

export async function requestSatpV3IdentityTx(
  walletAddress: string,
  profileId: string,
): Promise<SatpV3IdentityResult> {
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

export async function confirmSatpV3Identity(
  walletAddress: string,
  profileId: string,
  txSignature?: string | null,
): Promise<void> {
  const res = await fetch("/api/satp-auto/v3/identity/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, profileId, txSignature }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || "Failed to persist SATP V3 identity");
  }
}

export async function autoCreateSatpV3Identity(
  connection: Connection,
  walletAddress: string,
  profileId: string,
  sendTransaction: (tx: Transaction, conn: Connection) => Promise<string>,
): Promise<{ txSignature: string | null; genesisPDA: string; alreadyExists: boolean }> {
  const existing = await checkSatpV3Identity(profileId, walletAddress);
  if (existing?.v3?.accountExists || existing?.v3?.exists) {
    try {
      await confirmSatpV3Identity(walletAddress, profileId, "existing");
    } catch {}
    return {
      txSignature: null,
      genesisPDA: existing.v3.genesisPDA || SATP_V3_IDENTITY_PROGRAM.toBase58(),
      alreadyExists: true,
    };
  }

  const result = await requestSatpV3IdentityTx(walletAddress, profileId);
  const genesisPDA = result.genesisPDA || result.identityPDA || "";

  if (result.alreadyExists || !result.transaction) {
    try {
      await confirmSatpV3Identity(walletAddress, profileId, "existing");
    } catch {}
    return { txSignature: null, genesisPDA, alreadyExists: true };
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

  await confirmSatpV3Identity(walletAddress, profileId, sig);
  return { txSignature: sig, genesisPDA, alreadyExists: false };
}
