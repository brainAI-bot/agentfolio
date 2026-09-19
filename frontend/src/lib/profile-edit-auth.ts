import type { MarketplaceWalletChallenge } from "./marketplace-auth";

export interface ProfileEditBody {
  bio: string;
  handle: string;
  links: {
    website: string;
    x: string;
    github: string;
    moltbook: string;
  };
}

interface WalletProfileEditOptions {
  profileId: string;
  walletAddress: string;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
  body: ProfileEditBody;
  fetchImpl?: typeof fetch;
}

async function responseJson<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload && typeof payload === "object" && "error" in payload
      ? String(payload.error)
      : fallback;
    throw new Error(error);
  }
  return payload as T;
}

async function signProfileEditChallenge(
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

export async function walletAuthenticatedProfileEdit({
  profileId,
  walletAddress,
  signMessage,
  body,
  fetchImpl = fetch,
}: WalletProfileEditOptions): Promise<{ updated: boolean; profile: unknown }> {
  if (!profileId) throw new Error("Canonical profile id is required");

  const path = `/api/profile/${encodeURIComponent(profileId)}`;
  const requestBody = { ...body, actorId: profileId };
  const challenge = await responseJson<MarketplaceWalletChallenge>(
    await fetchImpl("/api/marketplace/auth/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "profile.edit",
        resourceId: profileId,
        actorId: profileId,
        method: "PATCH",
        path,
        body: requestBody,
      }),
    }),
    "Failed to request wallet challenge",
  );
  const walletChallenge = await signProfileEditChallenge(challenge, walletAddress, signMessage);

  return responseJson<{ updated: boolean; profile: unknown }>(
    await fetchImpl(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...requestBody, walletChallenge }),
    }),
    "Failed to save",
  );
}
