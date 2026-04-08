"use client";
import { useEffect, useState } from "react";
import { Shield, ExternalLink } from "lucide-react";

function normalizeScore(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value > 10000 ? Math.round(value / 10000) : value;
}

interface Props {
  walletAddress?: string | null;
  agentId?: string | null;
}

export function SATPOnChainSection({ walletAddress, agentId }: Props) {
  const [scores, setScores] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const targetId = agentId || walletAddress;

  useEffect(() => {
    if (!targetId) {
      setLoading(false);
      return;
    }
    fetch(`/api/satp/v3/reputation/${targetId}`)
      .then(r => r.json())
      .then(data => setScores(data.data || data))
      .catch(() => setScores(null))
      .finally(() => setLoading(false));
  }, [targetId]);

  if (loading) {
    return (
      <div className="card p-4">
        <div className="animate-pulse text-sm text-[var(--text-secondary)]">Loading on-chain SATP data...</div>
      </div>
    );
  }

  if (!scores) return null;

  const normalizedScore = normalizeScore(scores.reputationScore);

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-[var(--accent)]" />
        <h3 className="font-semibold text-sm">SATP On-Chain</h3>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        {scores?.verificationLevel !== undefined && (
          <div>
            <div className="text-[var(--text-secondary)] text-xs mb-1">Verification Level</div>
            <div className="font-medium">
              <span className="px-2 py-0.5 rounded" style={{ background: "var(--accent)", color: "#fff", fontSize: "10px" }}>
                Level {scores.verificationLevel}
              </span>
            </div>
          </div>
        )}

        {scores?.reputationScore !== undefined && (
          <div>
            <div className="text-[var(--text-secondary)] text-xs mb-1">Reputation Score</div>
            <div className="font-medium">
              <div className="flex items-center gap-2">
                <span style={{ color: "var(--text-primary)" }}>{normalizedScore}/800</span>
                <div className="flex-1 h-2 rounded-full" style={{ background: "var(--bg-tertiary)" }}>
                  <div className="h-full rounded-full" style={{ width: `${(normalizedScore / 800) * 100}%`, background: "var(--success)" }} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {scores?.txSignature && (
        <a
          href={`https://solscan.io/tx/${scores.txSignature}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
        >
          View latest transaction <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}
