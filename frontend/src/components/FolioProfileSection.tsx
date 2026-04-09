"use client";

import { useState, useEffect } from "react";
import { Coins, Flame, TrendingUp, ExternalLink } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "";

function formatNumber(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

export function FolioProfileSection({ agentId, walletAddress, tokenLaunch }: { agentId: string; walletAddress?: string; tokenLaunch?: any }) {
  const [stakeInfo, setStakeInfo] = useState<any>(null);
  const [feeTier, setFeeTier] = useState<any>(null);

  useEffect(() => {
    fetch(`${API}/api/staking/${agentId}`).then(r => r.json()).then(setStakeInfo).catch(() => {});
    if (walletAddress) {
      fetch(`${API}/api/tokens/fee-tier/${walletAddress}`).then(r => r.json()).then(setFeeTier).catch(() => {});
    }
  }, [agentId, walletAddress]);

  const hasStake = stakeInfo && stakeInfo.stakedAmount > 0;
  const hasToken = tokenLaunch && tokenLaunch.symbol;
  const hasFee = feeTier && feeTier.feePercent < 5;

  if (!hasStake && !hasToken && !hasFee) return null;

  return (
    <div className="rounded-lg p-4 border mb-4" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
      <div className="text-xs uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: "var(--text-tertiary)" }}>
        <Coins size={12} /> $FOLIO Integration
      </div>
      <div className="flex flex-wrap gap-3">
        {hasStake && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs" style={{ background: "rgba(34, 197, 94, 0.1)", border: "1px solid rgba(34, 197, 94, 0.2)" }}>
            <TrendingUp size={12} style={{ color: "#22c55e" }} />
            <span style={{ color: "#22c55e", fontFamily: "var(--font-mono)" }}>
              {stakeInfo.tier?.badge} {formatNumber(stakeInfo.stakedAmount)} staked — {stakeInfo.tier?.name}
            </span>
          </div>
        )}
        {hasFee && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs" style={{ background: "rgba(153, 69, 255, 0.1)", border: "1px solid rgba(153, 69, 255, 0.2)" }}>
            <span style={{ color: "var(--solana)", fontFamily: "var(--font-mono)" }}>
              {feeTier.tierEmoji} {feeTier.tierName} — {feeTier.feePercent}% fee
            </span>
          </div>
        )}
        {hasToken && (
          <a
            href={tokenLaunch.dexUrl || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs hover:opacity-80"
            style={{ background: "rgba(249, 115, 22, 0.1)", border: "1px solid rgba(249, 115, 22, 0.2)", textDecoration: "none" }}
          >
            <Flame size={12} style={{ color: "#f97316" }} />
            <span style={{ color: "#f97316", fontFamily: "var(--font-mono)" }}>
              ${tokenLaunch.symbol}
            </span>
            <ExternalLink size={10} style={{ color: "#f97316" }} />
          </a>
        )}
      </div>
    </div>
  );
}
