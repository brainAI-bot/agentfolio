"use client";

import { useEffect, useState } from "react";
import { Shield, Zap } from "lucide-react";

interface GenesisData {
  pda: string;
  agentName: string;
  verificationLevel: number;
  verificationLabel: string;
  reputationScore: number;
  reputationPct: string;
  isBorn: boolean;
  bornAt: string | null;
  faceImage: string;
  faceMint: string;
}

export function V3OnChainBadge({ agentId }: { agentId: string }) {
  const [genesis, setGenesis] = useState<GenesisData | null>(null);

  useEffect(() => {
    fetch(`/api/profile/${agentId}/genesis`)
      .then(r => r.json())
      .then(d => { if (d.genesis && !d.genesis.error) setGenesis(d.genesis); })
      .catch(() => {});
  }, [agentId]);

  if (!genesis) return null;

  const levelColors = ["#64748B", "#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444"];
  const levelColor = levelColors[genesis.verificationLevel] || "#64748B";

  return (
    <div className="rounded-lg p-4 mt-4" style={{ background: "var(--bg-secondary)", border: `1px solid ${levelColor}40` }}>
      <div className="flex items-center gap-2 mb-3">
        <Shield size={16} style={{ color: levelColor }} />
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: levelColor, fontFamily: "var(--font-mono)" }}>
          On-Chain Identity (V3)
        </span>
        {genesis.isBorn && (
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#10B98120", color: "#10B981" }}>
            ✦ BORN
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs" style={{ fontFamily: "var(--font-mono)" }}>
        <div>
          <div style={{ color: "var(--text-tertiary)" }}>Verification</div>
          <div style={{ color: levelColor, fontWeight: 600 }}>
            Level {genesis.verificationLevel} — {genesis.verificationLabel}
          </div>
        </div>
        <div>
          <div style={{ color: "var(--text-tertiary)" }}>Trust</div>
          <div style={{ color: "var(--text-primary)", fontWeight: 600 }}>
            {genesis.reputationPct}%
          </div>
        </div>
        <div className="col-span-2">
          <div style={{ color: "var(--text-tertiary)" }}>PDA</div>
          <a
            href={`https://explorer.solana.com/address/${genesis.pda}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
            style={{ color: "var(--accent)", fontSize: "10px" }}
          >
            {genesis.pda}
          </a>
        </div>
      </div>
    </div>
  );
}
