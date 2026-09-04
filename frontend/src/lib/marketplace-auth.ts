import { PublicKey } from "@solana/web3.js";

const SATP_IDENTITY_PROGRAM = new PublicKey("97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq");

export interface MarketplaceWalletChallenge {
  walletAddress: string;
  identityPDA: string;
  message: string;
  signature: string;
}

export async function fetchMarketplaceApplyResourceId(apiBase: string, jobId: string, actorId: string): Promise<string> {
  const response = await fetch(`${apiBase}/api/marketplace/jobs/${jobId}`);
  if (!response.ok) throw new Error("Unable to load the current application authorization state");

  const job = await response.json();
  const actorRevisions = job.applyChallengeRevisions;
  const actorRevision = actorRevisions && typeof actorRevisions === "object"
    && Object.prototype.hasOwnProperty.call(actorRevisions, actorId)
    ? actorRevisions[actorId]
    : undefined;
  const revision = Number(actorRevision ?? job.applyChallengeRevision ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("Invalid application authorization state");
  }
  return `${jobId}#${revision}`;
}

export function buildMarketplaceWalletChallenge(params: {
  action: string;
  resourceId: string;
  actorId: string;
  walletAddress: string;
  identityPDA: string;
}): string {
  return [
    "AgentFolio Marketplace Wallet Challenge",
    `action:${params.action}`,
    `resource:${params.resourceId}`,
    `actor:${params.actorId}`,
    `wallet:${params.walletAddress}`,
    `satpIdentityPDA:${params.identityPDA}`,
  ].join("\n");
}

export async function signMarketplaceAction(params: {
  action: string;
  resourceId: string;
  actorId: string;
  walletAddress: string;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
}): Promise<MarketplaceWalletChallenge> {
  if (!params.signMessage) throw new Error("Your wallet does not support message signing");
  const wallet = new PublicKey(params.walletAddress);
  const [identityPDA] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("identity"), wallet.toBytes()],
    SATP_IDENTITY_PROGRAM,
  );
  const message = buildMarketplaceWalletChallenge({
    ...params,
    identityPDA: identityPDA.toBase58(),
  });
  const signature = await params.signMessage(new TextEncoder().encode(message));
  const signatureBase64 = btoa(Array.from(signature, (byte) => String.fromCharCode(byte)).join(""));

  return {
    walletAddress: params.walletAddress,
    identityPDA: identityPDA.toBase58(),
    message,
    signature: signatureBase64,
  };
}
