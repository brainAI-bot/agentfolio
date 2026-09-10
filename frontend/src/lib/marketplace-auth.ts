export interface MarketplaceWalletChallenge {
  challengeId: string;
  nonce: string;
  action: string;
  resourceId: string;
  method: string;
  path: string;
  actorId: string;
  walletAddress: string;
  identityPDA: string;
  bodyDigest: string;
  issuedAt: string;
  expiresAt: string;
  message: string;
  signature?: string;
}

export async function signMarketplaceChallenge(
  challenge: MarketplaceWalletChallenge,
  walletAddress: string,
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>,
): Promise<MarketplaceWalletChallenge> {
  if (!signMessage) throw new Error("Your wallet does not support message signing");
  if (challenge.walletAddress !== walletAddress) {
    throw new Error("The connected wallet is not the profile wallet selected by the server");
  }
  if (!challenge.message || !challenge.challengeId || !challenge.expiresAt) {
    throw new Error("The marketplace server returned an invalid wallet challenge");
  }
  if (Date.now() >= new Date(challenge.expiresAt).getTime()) {
    throw new Error("The marketplace wallet challenge expired before it could be signed");
  }
  const signature = await signMessage(new TextEncoder().encode(challenge.message));
  return {
    ...challenge,
    signature: btoa(Array.from(signature, (byte) => String.fromCharCode(byte)).join("")),
  };
}
