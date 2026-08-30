import { PublicKey } from "@solana/web3.js";

const SATP_IDENTITY_PROGRAM = new PublicKey("97yL33fcu6iWT2TdERS5HeqrMSGiUnxuy6nUcTrKieSq");

export interface MarketplaceWalletChallenge {
  walletAddress: string;
  identityPDA: string;
  message: string;
  signature: string;
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
