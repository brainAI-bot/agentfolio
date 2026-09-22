import { signMarketplaceChallenge, type MarketplaceWalletChallenge } from "@/lib/marketplace-auth";
import { createMarketplaceMutationHeaders, createMarketplaceMutationKeyStore } from "@/lib/marketplace-request-headers";

// Empty means the browser's current origin. Next.js proxies /api through the
// server-only INTERNAL_API_URL; no backend hostname is shipped to visitors.
export const MARKETPLACE_API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
const REQUEST_TIMEOUT_MS = 15_000;
const retryableMutationKeys = createMarketplaceMutationKeyStore();

export class MarketplaceApiError extends Error {
  code: string;
  status: number;
  kind: "unauthorized" | "illegal-transition" | "timeout" | "request";

  constructor(message: string, code = "MARKETPLACE_REQUEST_FAILED", status = 0) {
    super(message);
    this.name = "MarketplaceApiError";
    this.code = code;
    this.status = status;
    this.kind = status === 401 || status === 403
      ? "unauthorized"
      : status === 409
        ? "illegal-transition"
        : "request";
  }
}

async function withTimeout(input: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal, cache: "no-store" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      const timeout = new MarketplaceApiError("The marketplace request timed out. The action was not confirmed; refresh before retrying.", "MARKETPLACE_TIMEOUT", 0);
      timeout.kind = "timeout";
      throw timeout;
    }
    throw new MarketplaceApiError(error instanceof Error ? error.message : "Marketplace request failed");
  } finally {
    window.clearTimeout(timer);
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new MarketplaceApiError(payload.error || `Marketplace request failed (${response.status})`, payload.code, response.status);
  return payload as T;
}

export async function marketplaceRead<T>(path: string): Promise<T> {
  return responseJson<T>(await withTimeout(`${MARKETPLACE_API_BASE}${path}`));
}

export async function signedMarketplaceRequest<T>({
  path,
  action,
  resourceId,
  actorId,
  walletAddress,
  signMessage,
  body = {},
  method = "POST",
  idempotencyKey,
}: {
  path: string;
  action: string;
  resourceId: string;
  actorId: string;
  walletAddress: string;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
  body?: Record<string, unknown>;
  method?: "GET" | "POST";
  idempotencyKey?: string;
}): Promise<T> {
  const requestBody = method === "GET" ? {} : { ...body, actorId };
  const mutationFingerprint = method === "POST"
    ? JSON.stringify([path, action, resourceId, actorId, requestBody])
    : null;
  const headers: Record<string, string> = method === "GET"
    ? { "Content-Type": "application/json", "X-Marketplace-Actor": actorId }
    : createMarketplaceMutationHeaders(
      actorId,
      retryableMutationKeys.keyFor(mutationFingerprint!, idempotencyKey),
    );
  const issuedChallenge = await responseJson<MarketplaceWalletChallenge>(await withTimeout(
    `${MARKETPLACE_API_BASE}/api/marketplace/auth/challenge`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, resourceId, actorId, method, path, body: requestBody }),
    },
  ));
  const walletChallenge = await signMarketplaceChallenge(issuedChallenge, walletAddress, signMessage);
  const init: RequestInit = { method, headers };
  if (method === "GET") {
    headers["X-Marketplace-Wallet-Challenge"] = btoa(JSON.stringify(walletChallenge));
  } else {
    init.body = JSON.stringify({ ...requestBody, walletChallenge });
  }
  const response = await withTimeout(`${MARKETPLACE_API_BASE}${path}`, init);
  // A definitive response settles this attempt. A 5xx may have been emitted
  // after the server committed, so retain the key just as for network errors.
  if (mutationFingerprint) retryableMutationKeys.settle(mutationFingerprint, response.status);
  return responseJson<T>(response);
}

export function marketplaceErrorMessage(error: unknown): string {
  if (!(error instanceof MarketplaceApiError)) return error instanceof Error ? error.message : "Marketplace request failed";
  if (error.kind === "unauthorized") return `Unauthorized: ${error.message}`;
  if (error.kind === "illegal-transition") return `Action unavailable for the current job state: ${error.message}`;
  if (error.kind === "timeout") return error.message;
  return error.message;
}
