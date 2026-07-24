import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const HELIUS_MAINNET_RPC_URL = "https://mainnet.helius-rpc.com/";
const HELIUS_RPC_HOST = "helius-rpc.com";
const MAX_RPC_BODY_BYTES = 64 * 1024;
const MAX_RPC_BATCH_SIZE = 10;
const RPC_RATE_LIMIT_WINDOW_MS = 60_000;
const RPC_RATE_LIMIT_MAX_REQUESTS = 60;
const HELIUS_PROXY_OPT_IN_ENV = "SOLANA_RPC_PROXY_HELIUS_OPT_IN";

const ALLOWED_SOLANA_RPC_METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getEpochInfo",
  "getFeeForMessage",
  "getGenesisHash",
  "getHealth",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getSlot",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getTokenLargestAccounts",
  "getTokenSupply",
  "getTransaction",
  "getVersion",
  "simulateTransaction",
]);

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function cleanEnv(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function buildHeliusRpcUrlFromKey(apiKey: string | undefined) {
  const trimmed = cleanEnv(apiKey);
  if (!trimmed) return undefined;
  return `${HELIUS_MAINNET_RPC_URL}?api-key=${encodeURIComponent(trimmed)}`;
}

function isHeliusProxyOptedIn() {
  return cleanEnv(process.env[HELIUS_PROXY_OPT_IN_ENV])?.toLowerCase() === "true";
}

function isHeliusRpcHost(hostname: string) {
  const normalizedHostname = hostname.toLowerCase();
  return (
    normalizedHostname === HELIUS_RPC_HOST ||
    normalizedHostname.endsWith(`.${HELIUS_RPC_HOST}`)
  );
}

function isHeliusRpcUrl(upstreamUrl: string) {
  try {
    return isHeliusRpcHost(new URL(upstreamUrl).hostname);
  } catch {
    return false;
  }
}

function useConfiguredRpcUrl(upstreamUrl: string | undefined) {
  if (!upstreamUrl) return undefined;
  return !isHeliusRpcUrl(upstreamUrl) || isHeliusProxyOptedIn() ? upstreamUrl : undefined;
}

function getSolanaRpcUpstreamUrl() {
  return (
    useConfiguredRpcUrl(cleanEnv(process.env.HELIUS_RPC_URL)) ||
    (isHeliusProxyOptedIn() ? buildHeliusRpcUrlFromKey(process.env.HELIUS_API_KEY) : undefined) ||
    useConfiguredRpcUrl(cleanEnv(process.env.SOLANA_RPC_URL)) ||
    useConfiguredRpcUrl(cleanEnv(process.env.NEXT_PUBLIC_SOLANA_RPC_URL)) ||
    DEFAULT_SOLANA_RPC_URL
  );
}

function getRpcProviderLabel(parsedUpstream: URL) {
  return isHeliusRpcHost(parsedUpstream.hostname) ? "helius" : "solana-rpc";
}

function getClientRateLimitKey(req: NextRequest) {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "anonymous"
  );
}

function enforceRateLimit(req: NextRequest) {
  const now = Date.now();
  const key = getClientRateLimitKey(req);
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RPC_RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  if (bucket.count <= RPC_RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
  };
}

function getJsonRpcRequests(payload: unknown) {
  if (Array.isArray(payload)) return payload;
  return [payload];
}

function isJsonRpcObject(value: unknown): value is { method: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { method?: unknown }).method === "string"
  );
}

function validateRpcBody(body: string) {
  if (new TextEncoder().encode(body).length > MAX_RPC_BODY_BYTES) {
    return { error: "RPC request body too large", status: 413 };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return { error: "Invalid JSON-RPC request", status: 400 };
  }

  const requests = getJsonRpcRequests(payload);
  if (requests.length === 0 || requests.length > MAX_RPC_BATCH_SIZE) {
    return { error: "JSON-RPC batch size is not allowed", status: 400 };
  }

  for (const request of requests) {
    if (!isJsonRpcObject(request)) {
      return { error: "Invalid JSON-RPC request", status: 400 };
    }
    if (!ALLOWED_SOLANA_RPC_METHODS.has(request.method)) {
      return { error: "Solana RPC method is not allowed", status: 403 };
    }
  }

  return { error: undefined, status: 200 };
}

export async function POST(req: NextRequest) {
  try {
    const rateLimit = enforceRateLimit(req);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Solana RPC rate limit exceeded" },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        }
      );
    }

    const upstreamUrl = getSolanaRpcUpstreamUrl();
    let parsedUpstream: URL;
    try {
      parsedUpstream = new URL(upstreamUrl);
    } catch {
      return NextResponse.json({ error: "Invalid Solana RPC upstream URL" }, { status: 500 });
    }

    if (parsedUpstream.protocol !== "https:" && parsedUpstream.protocol !== "http:") {
      return NextResponse.json({ error: "Invalid Solana RPC upstream URL" }, { status: 500 });
    }

    const body = await req.text();
    const validation = validateRpcBody(body);
    if (validation.error) {
      return NextResponse.json({ error: validation.error }, { status: validation.status });
    }

    const upstream = await fetch(parsedUpstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
    });

    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
        "X-AgentFolio-RPC-Provider": getRpcProviderLabel(parsedUpstream),
      },
    });
  } catch {
    return NextResponse.json({ error: "RPC proxy failed" }, { status: 500 });
  }
}
