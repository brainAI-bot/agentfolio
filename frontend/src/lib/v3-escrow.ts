/**
 * V3 Escrow Helpers — Frontend integration for SATP V3 Escrow
 * 
 * These functions integrate with the /api/v3/escrow/* endpoints to:
 * 1. Create identity-verified escrows (unsigned TX → wallet sign)
 * 2. Submit work
 * 3. Release funds (full or partial)
 * 4. Dispute handling
 * 
 * All functions return unsigned transactions for wallet signing.
 */

import { Transaction, Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';

const API_BASE = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || '';

interface V3EscrowCreateParams {
  clientWallet: string;
  agentWallet: string;
  agentId: string;
  amountLamports: number;
  description: string;
  deadlineUnix: number;
  nonce?: number;
  arbiter?: string;
  minVerificationLevel?: number;
  requireBorn?: boolean;
}

interface V3EscrowResult {
  transaction: string; // base64
  escrowPDA: string;
  descriptionHash?: string;
  network: string;
  message: string;
}

export type WalletTransaction = Transaction | VersionedTransaction;

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

function deserializeWalletTransaction(base64Tx: string): WalletTransaction {
  const raw = Uint8Array.from(Buffer.from(base64Tx, 'base64'));
  return isVersionedSerializedTransaction(raw) ? VersionedTransaction.deserialize(raw) : Transaction.from(Buffer.from(raw));
}

/**
 * Build an unsigned create-escrow transaction via V3 API.
 * Returns a Transaction object ready for wallet signing.
 */
export async function buildV3EscrowCreate(params: V3EscrowCreateParams): Promise<{ tx: WalletTransaction; escrowPDA: string }> {
  const res = await fetch(`${API_BASE}/api/v3/escrow/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data: V3EscrowResult = await res.json();
  if ((data as any).error) throw new Error((data as any).error);
  if (!data.transaction) throw new Error('V3 API did not return a transaction');

  const tx = deserializeWalletTransaction(data.transaction);
  return { tx, escrowPDA: data.escrowPDA };
}

/**
 * Build an unsigned submit-work transaction via V3 API.
 */
export async function buildV3SubmitWork(params: {
  escrowPDA: string;
  agentWallet: string;
  workProof: string;
}): Promise<WalletTransaction> {
  const res = await fetch(`${API_BASE}/api/v3/escrow/submit-work`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return deserializeWalletTransaction(data.transaction);
}

/**
 * Build an unsigned release transaction via V3 API.
 */
export async function buildV3Release(params: {
  escrowPDA: string;
  clientWallet: string;
  agentWallet: string;
}): Promise<WalletTransaction> {
  const res = await fetch(`${API_BASE}/api/v3/escrow/release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return deserializeWalletTransaction(data.transaction);
}

/**
 * Build an unsigned partial-release transaction via V3 API.
 */
export async function buildV3PartialRelease(params: {
  escrowPDA: string;
  clientWallet: string;
  agentWallet: string;
  amountLamports: number;
}): Promise<WalletTransaction> {
  const res = await fetch(`${API_BASE}/api/v3/escrow/partial-release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return deserializeWalletTransaction(data.transaction);
}

/**
 * Build an unsigned dispute transaction via V3 API.
 */
export async function buildV3Dispute(params: {
  escrowPDA: string;
  signerWallet: string;
  reason: string;
}): Promise<WalletTransaction> {
  const res = await fetch(`${API_BASE}/api/v3/escrow/dispute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return deserializeWalletTransaction(data.transaction);
}

/**
 * Fetch escrow state from chain via V3 API.
 */
export async function getV3EscrowState(escrowPDA: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/v3/escrow/${escrowPDA}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

/**
 * Derive an escrow PDA from client + description.
 */
export async function deriveV3EscrowPDA(client: string, description: string, nonce?: number): Promise<string> {
  const params = new URLSearchParams({ client, description });
  if (nonce) params.set('nonce', String(nonce));
  const res = await fetch(`${API_BASE}/api/v3/escrow/pda/derive?${params}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.pda;
}

/**
 * Resolve an agent profile ID to their Solana wallet address.
 */
export async function resolveAgentWallet(agentId: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/profile/${agentId}`);
    if (!res.ok) return null;
    const data = await res.json();
    // Try wallets.solana first, then wallet field, then verifications.solana.address
    return data?.wallets?.solana || data?.wallet || data?.verifications?.solana?.address || null;
  } catch {
    return null;
  }
}

/**
 * Sign and send a V3 transaction using wallet adapter.
 */
export async function signAndSendV3Tx(
  tx: WalletTransaction,
  connection: Connection,
  publicKey: PublicKey,
  sendTransaction: ((tx: Transaction, connection: Connection) => Promise<string>) | undefined,
  signTransaction?: ((tx: WalletTransaction) => Promise<WalletTransaction>) | null,
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  if (tx instanceof VersionedTransaction) {
    if (!signTransaction) {
      throw new Error('Connected wallet does not support versioned transaction signing');
    }
    tx.message.recentBlockhash = blockhash;
    const signedTx = await signTransaction(tx);
    const raw = signedTx.serialize();
    const sig = await connection.sendRawTransaction(raw);
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    return sig;
  }

  tx.recentBlockhash = blockhash;
  tx.feePayer = publicKey;
  if (signTransaction) {
    const signedTx = await signTransaction(tx);
    const raw = signedTx.serialize();
    const sig = await connection.sendRawTransaction(raw);
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    return sig;
  }
  if (!sendTransaction) {
    throw new Error('Connected wallet does not support legacy transaction sending');
  }
  const sig = await sendTransaction(tx, connection);
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return sig;
}
