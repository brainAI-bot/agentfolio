import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const HELIUS_MAINNET_RPC_URL = "https://mainnet.helius-rpc.com/";
const HELIUS_RPC_HOST = "helius-rpc.com";

function cleanEnv(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function buildHeliusRpcUrlFromKey(apiKey: string | undefined) {
  const trimmed = cleanEnv(apiKey);
  if (!trimmed) return undefined;
  return `${HELIUS_MAINNET_RPC_URL}?api-key=${encodeURIComponent(trimmed)}`;
}

function getSolanaRpcUpstreamUrl() {
  return (
    cleanEnv(process.env.HELIUS_RPC_URL) ||
    buildHeliusRpcUrlFromKey(process.env.HELIUS_API_KEY) ||
    cleanEnv(process.env.SOLANA_RPC_URL) ||
    cleanEnv(process.env.NEXT_PUBLIC_SOLANA_RPC_URL) ||
    DEFAULT_SOLANA_RPC_URL
  );
}

function isHeliusRpcHost(hostname: string) {
  const normalizedHostname = hostname.toLowerCase();
  return (
    normalizedHostname === HELIUS_RPC_HOST ||
    normalizedHostname.endsWith(`.${HELIUS_RPC_HOST}`)
  );
}

function getRpcProviderLabel(parsedUpstream: URL) {
  return isHeliusRpcHost(parsedUpstream.hostname) ? "helius" : "solana-rpc";
}

export async function POST(req: NextRequest) {
  try {
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
