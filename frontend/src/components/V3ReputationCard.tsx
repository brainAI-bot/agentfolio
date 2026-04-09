"use client";

import { Shield, Zap, ExternalLink } from "lucide-react";

const SOLANA_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "mainnet-beta";

function solanaExplorerUrl(path: string) {
  const clusterQuery = SOLANA_CLUSTER && SOLANA_CLUSTER !== "mainnet-beta" ? `?cluster=${encodeURIComponent(SOLANA_CLUSTER)}` : "";
  return `https://explorer.solana.com/${path}${clusterQuery}`;
}

function normalizeScore(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return value > 10000 ? Math.round(value / 10000) : value;
}

interface V3ReputationData {
  agentId: string;
  pda: string;
  reputationScore: number;
  verificationLevel: number;
  tier: string | null;
  tierLabel: string | null;
  authority: string;
  isBorn: boolean;
  network: string;
}

const LEVEL_LABELS = ["Unverified", "Registered", "Verified", "Established", "Trusted", "Sovereign"];
const LEVEL_COLORS = ["#64748B", "#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444"];
const MAX_SCORE = 800;

export function V3ReputationCard({ data }: { data: V3ReputationData }) {
  const level = data.verificationLevel ?? 0;
  const rawScore = normalizeScore(data.reputationScore ?? 0);
  const score = rawScore > 10000 ? Math.round(rawScore / 10000) : rawScore;
  const levelLabel = LEVEL_LABELS[level] || "Unknown";
  const levelColor = LEVEL_COLORS[level] || "#64748B";
  const scorePct = Math.min(100, Math.round((score / MAX_SCORE) * 100));
  const explorerUrl = solanaExplorerUrl(`address/${data.pda}`);

  return (
    <div
      className="rounded-lg p-5 relative overflow-hidden"
      style={{
        background: "var(--bg-secondary)",
        border: `1px solid ${levelColor}40`,
      }}
    >
      {/* Subtle glow effect */}
      <div
        className="absolute top-0 left-0 w-full h-1"
        style={{ background: `linear-gradient(90deg, ${levelColor}00, ${levelColor}, ${levelColor}00)` }}
      />

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield size={18} style={{ color: levelColor }} />
          <h2
            className="text-sm font-semibold uppercase tracking-wider"
            style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}
          >
            V3 On-Chain Reputation
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {data.isBorn && (
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: "#10B98120", color: "#10B981", border: "1px solid #10B98140" }}
            >
              🔥 BORN
            </span>
          )}
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded"
            style={{ background: `${levelColor}20`, color: levelColor, border: `1px solid ${levelColor}40` }}
          >
            ⛓️ {data.network?.toUpperCase()}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Reputation Score */}
        <div>
          <div
            className="text-[11px] uppercase tracking-wider mb-1"
            style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}
          >
            Reputation Score
          </div>
          <div className="flex items-baseline gap-1.5">
            <span
              className="text-2xl font-bold"
              style={{ fontFamily: "var(--font-mono)", color: levelColor }}
            >
              {score}
            </span>
            <span
              className="text-xs"
              style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}
            >
              / {MAX_SCORE}
            </span>
          </div>
          <div
            className="h-1.5 rounded-full mt-2 overflow-hidden"
            style={{ background: "var(--bg-tertiary)" }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${scorePct}%`, background: levelColor }}
            />
          </div>
        </div>

        {/* Verification Level */}
        <div>
          <div
            className="text-[11px] uppercase tracking-wider mb-1"
            style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}
          >
            Verification Level
          </div>
          <div className="flex items-baseline gap-1.5">
            <span
              className="text-2xl font-bold"
              style={{ fontFamily: "var(--font-mono)", color: levelColor }}
            >
              L{level}
            </span>
            <span
              className="text-xs font-semibold"
              style={{ fontFamily: "var(--font-mono)", color: levelColor }}
            >
              {levelLabel}
            </span>
          </div>
          {/* Level dots */}
          <div className="flex gap-1 mt-2">
            {[0, 1, 2, 3, 4, 5].map((l) => (
              <div
                key={l}
                className="h-1.5 flex-1 rounded-full"
                style={{
                  background: l <= level ? levelColor : "var(--bg-tertiary)",
                  opacity: l <= level ? 1 : 0.3,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* PDA Link */}
      <div
        className="flex items-center justify-between pt-3"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div>
          <div
            className="text-[10px] uppercase tracking-wider mb-0.5"
            style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}
          >
            On-Chain PDA
          </div>
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] hover:underline inline-flex items-center gap-1"
            style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}
          >
            {data?.pda?.slice(0, 16)}...{data?.pda?.slice(-8)}
            <ExternalLink size={10} />
          </a>
        </div>
        {data.authority && (
          <div className="text-right">
            <div
              className="text-[10px] uppercase tracking-wider mb-0.5"
              style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}
            >
              Authority
            </div>
            <span
              className="text-[11px]"
              style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}
            >
              {data?.authority?.slice(0, 8)}...{data?.authority?.slice(-4)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
