import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FALLBACK_HELIUS_RPC_URL = "https://mainnet.helius-rpc.com/?api-key=HELIUS_API_KEY_REDACTED";
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || FALLBACK_HELIUS_RPC_URL;

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const upstream = await fetch(SOLANA_RPC_URL, {
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
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "RPC proxy failed" }, { status: 500 });
  }
}
