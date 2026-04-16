/**
 * SATP v2 Identity Registry Client (Frontend)
 * Used to auto-create SATP identity after wallet verification
 */

import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

// SATP v2 Identity Registry — Mainnet
export const SATP_V2_IDENTITY_PROGRAM = new PublicKey(
  "97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq"
);

export type SatpWalletTransaction = Transaction | VersionedTransaction;

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

function isVersionedSerializedTransaction(raw: Uint8Array): boolean {
  let offset = 0;
  let sigCount = 0;
  let shift = 0;
  while (offset < raw.length) {
    const byte = raw[offset];
    sigCount |= (byte & 0x7f) << shift;
    offset += 1;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  const messageOffset = offset + sigCount * 64;
  return messageOffset < raw.length && (raw[messageOffset] & 0x80) !== 0;
}

function deserializeSatpIdentityTransaction(base64Tx: string): SatpWalletTransaction {
  const raw = Uint8Array.from(Buffer.from(base64Tx, "base64"));
  return isVersionedSerializedTransaction(raw) ? VersionedTransaction.deserialize(raw) : Transaction.from(Buffer.from(raw));
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
 * Submit a wallet-signed SATP identity transaction via backend RPC.
 */
export async function submitSatpIdentityTx(
  signedTransaction: string,
): Promise<string> {
  const res = await fetch("/api/satp-auto/identity/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signedTransaction }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    throw new Error(json.error || json.detail || "Failed to submit SATP identity TX");
  }
  return json.data?.signature;
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
 * Full auto-create flow: build TX → sign → backend submit → confirm
 * Returns the TX signature or null if already exists
 */
export async function autoCreateSatpIdentity(
  walletAddress: string,
  profileId: string,
  signTransaction: (tx: SatpWalletTransaction) => Promise<SatpWalletTransaction>,
): Promise<{ txSignature: string | null; identityPDA: string; alreadyExists: boolean }> {
  const wallet = new PublicKey(walletAddress);
  const [pda] = getSatpIdentityPDA(wallet);

  const result = await requestSatpIdentityTx(walletAddress, profileId);

  if (result.alreadyExists || !result.transaction) {
    try {
      await confirmSatpIdentity(walletAddress, profileId, "existing");
    } catch {}
    return {
      txSignature: null,
      identityPDA: result.identityPDA || pda.toBase58(),
      alreadyExists: true,
    };
  }

  try {
    const tx = deserializeSatpIdentityTransaction(result.transaction);
    const signed = await signTransaction(tx as SatpWalletTransaction);
    const sig = await submitSatpIdentityTx(
      Buffer.from(signed.serialize()).toString("base64")
    );

    await confirmSatpIdentity(walletAddress, profileId, sig);

    return {
      txSignature: sig,
      identityPDA: result.identityPDA,
      alreadyExists: false,
    };
  } catch (txErr: any) {
    const errMsg = (txErr.message || "").toLowerCase();
    if (
      errMsg.includes("already in use") ||
      errMsg.includes("already initialized") ||
      errMsg.includes("account already exists") ||
      errMsg.includes("custom program error") ||
      errMsg.includes("simulation failed")
    ) {
      try {
        await confirmSatpIdentity(walletAddress, profileId, "race-resolved");
        return { txSignature: null, identityPDA: result.identityPDA || pda.toBase58(), alreadyExists: true };
      } catch {
        // fall through to surface original error
      }
    }
    throw txErr;
  }
}
