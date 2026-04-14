export interface MarketplaceWalletAuthParams {
  action: string;
  walletAddress: string;
  actorId: string;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
  jobId?: string;
  applicationId?: string;
  escrowId?: string;
  deliverableId?: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function buildMarketplaceAuthMessage({
  action,
  walletAddress,
  actorId,
  jobId,
  applicationId,
  escrowId,
  deliverableId,
  timestamp,
}: {
  action: string;
  walletAddress: string;
  actorId: string;
  jobId?: string;
  applicationId?: string;
  escrowId?: string;
  deliverableId?: string;
  timestamp: string;
}) {
  return [
    "agentfolio-marketplace",
    action,
    jobId || "-",
    applicationId || "-",
    escrowId || "-",
    deliverableId || "-",
    actorId || "-",
    walletAddress || "-",
    timestamp,
  ].join(":");
}

export async function createMarketplaceWalletAuth({
  action,
  walletAddress,
  actorId,
  signMessage,
  jobId,
  applicationId,
  escrowId,
  deliverableId,
}: MarketplaceWalletAuthParams) {
  if (!walletAddress || !actorId) {
    throw new Error("Connect the correct wallet first.");
  }
  if (!signMessage) {
    throw new Error("This wallet does not support message signing.");
  }

  const walletTimestamp = Date.now().toString();
  const walletMessage = buildMarketplaceAuthMessage({
    action,
    walletAddress,
    actorId,
    jobId,
    applicationId,
    escrowId,
    deliverableId,
    timestamp: walletTimestamp,
  });
  const signatureBytes = await signMessage(new TextEncoder().encode(walletMessage));
  const walletSignature = bytesToBase64(signatureBytes);

  return {
    "x-wallet-address": walletAddress,
    "x-wallet-message": walletMessage,
    "x-wallet-signature": walletSignature,
    "x-wallet-timestamp": walletTimestamp,
  };
}
