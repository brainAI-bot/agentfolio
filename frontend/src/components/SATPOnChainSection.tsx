"use client";
import { useEffect, useState } from "react";
import { Shield, ExternalLink, Zap } from "lucide-react";

interface SATPData {
  identity: any;
  scores: any;
  reputation: any;
  reviews: any[];
  reviewStats: any;
}

export function SATPOnChainSection({ walletAddress }: { walletAddress?: string }) {
  const [data, setData] = useState<SATPData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!walletAddress) { setLoading(false); return; }
    async function fetchSATP() {
      try {
        const [identityRes, scoresRes, reputationRes, reviewsRes] = await Promise.all([
          fetch(`/api/satp/identity/${walletAddress}`).catch(() => null),
          fetch(`/api/satp/scores/${walletAddress}`).catch(() => null),
          fetch(`/api/satp/reputation/${walletAddress}`).catch(() => null),
          fetch(`/api/satp/reviews/${walletAddress}`).catch(() => null),
        ]);
        const identity = identityRes?.ok ? (await identityRes.json()).data : null;
        const scores = scoresRes?.ok ? (await scoresRes.json()).data : null;
        const reputation = reputationRes?.ok ? (await reputationRes.json()).data : null;
        const reviewData = reviewsRes?.ok ? await reviewsRes.json() : null;
        if (identity || scores || reputation || reviewData?.data?.reviews?.length) {
          setData({ identity, scores, reputation, reviews: reviewData?.data?.reviews || [], reviewStats: reviewData?.data?.stats || null });
        }
      } catch {} finally { setLoading(false); }
    }
    fetchSATP();
  }, [walletAddress]);

  if (!walletAddress || loading || !data) return null;
  const { identity, scores, reputation, reviews, reviewStats } = data;

  return (
    <div className="rounded-lg p-5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
      <h2 className="text-sm font-semibold uppercase tracking-wider mb-4 flex items-center gap-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
        <Shield size={14} style={{ color: "var(--success)" }} />
        SATP On-Chain Data
        <span style={{ fontSize: "0.7em", background: "var(--success)", color: "#fff", padding: "2px 8px", borderRadius: "10px" }}>⛓️ Trustless</span>
      </h2>

      {identity && (
        <div className="mb-4 pb-3 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="text-[11px] uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>On-Chain Identity</div>
          <div className="space-y-1 text-xs" style={{ fontFamily: "var(--font-mono)" }}>
            {identity.name && <div className="flex justify-between"><span style={{ color: "var(--text-tertiary)" }}>Name</span><span style={{ color: "var(--text-primary)" }}>{identity.name}</span></div>}
            {identity.version !== undefined && <div className="flex justify-between"><span style={{ color: "var(--text-tertiary)" }}>Version</span><span style={{ color: "var(--text-primary)" }}>v{identity.version}</span></div>}
            {identity.authority && (
              <div className="flex justify-between"><span style={{ color: "var(--text-tertiary)" }}>Authority</span>
                <a href={`https://explorer.solana.com/address/${identity.authority}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:underline" style={{ color: "var(--accent)" }}>
                  {identity?.authority?.slice(0, 8)}...{identity?.authority?.slice(-4)} <ExternalLink size={10} />
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {(scores || reputation) && (
        <div className="mb-4 pb-3 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="text-[11px] uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>On-Chain Trust</div>
          <div className="space-y-2">
            {scores?.verificationLevel !== undefined && (
              <div className="flex justify-between items-center text-xs" style={{ fontFamily: "var(--font-mono)" }}>
                <span style={{ color: "var(--text-tertiary)" }}>Verification Level</span>
                <span className="px-2 py-0.5 rounded" style={{ background: "var(--accent)", color: "#fff", fontSize: "10px" }}>Level {scores.verificationLevel}</span>
              </div>
            )}
            {scores?.reputationScore !== undefined && (
              <div>
                <div className="flex justify-between text-xs mb-1" style={{ fontFamily: "var(--font-mono)" }}>
                  <span style={{ color: "var(--text-tertiary)" }}>Trust Score</span>
                  <span style={{ color: "var(--text-primary)" }}>{scores.reputationScore}/800</span>
                </div>
                <div className="h-1.5 rounded-full" style={{ background: "var(--bg-tertiary)" }}>
                  <div className="h-full rounded-full" style={{ width: `${(scores.reputationScore / 800) * 100}%`, background: "var(--success)" }} />
                </div>
              </div>
            )}
            {reputation?.totalReviews !== undefined && (
              <div className="flex justify-between text-xs" style={{ fontFamily: "var(--font-mono)" }}>
                <span style={{ color: "var(--text-tertiary)" }}>Total Reviews</span>
                <span style={{ color: "var(--text-primary)" }}>{reputation.totalReviews}</span>
              </div>
            )}
            {reputation?.weightedScore !== undefined && (
              <div className="flex justify-between text-xs" style={{ fontFamily: "var(--font-mono)" }}>
                <span style={{ color: "var(--text-tertiary)" }}>Weighted Score</span>
                <span style={{ color: "var(--warning)" }}>{"★".repeat(Math.round(reputation.weightedScore))}{"☆".repeat(5 - Math.round(reputation.weightedScore))} {reputation.weightedScore.toFixed(1)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {reviews.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wider mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>On-Chain Reviews ({reviews.length})</div>
          {reviewStats && (
            <div className="flex gap-4 mb-3 text-[10px]" style={{ fontFamily: "var(--font-mono)" }}>
              {reviewStats.avgQuality > 0 && <span style={{ color: "var(--text-tertiary)" }}>Quality: <span style={{ color: "var(--warning)" }}>{reviewStats.avgQuality.toFixed(1)}★</span></span>}
              {reviewStats.avgReliability > 0 && <span style={{ color: "var(--text-tertiary)" }}>Reliability: <span style={{ color: "var(--warning)" }}>{reviewStats.avgReliability.toFixed(1)}★</span></span>}
              {reviewStats.avgCommunication > 0 && <span style={{ color: "var(--text-tertiary)" }}>Comms: <span style={{ color: "var(--warning)" }}>{reviewStats.avgCommunication.toFixed(1)}★</span></span>}
            </div>
          )}
          <div className="space-y-2">
            {reviews.slice(0, 5).map((r: any, i: number) => (
              <div key={i} className="p-2 rounded" style={{ background: "var(--bg-primary)" }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px]" style={{ color: "var(--warning)" }}>{"★".repeat(r.rating || r.overall || 0)}{"☆".repeat(5 - (r.rating || r.overall || 0))}</span>
                  {r.reviewer && <span className="text-[10px]" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>{r.reviewer.slice(0, 8)}...</span>}
                  <Zap size={10} style={{ color: "var(--success)" }} />
                </div>
                {r.comment && <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{r.comment}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
        <a href={`https://explorer.solana.com/address/${walletAddress}`} target="_blank" rel="noopener noreferrer"
          className="text-[10px] flex items-center gap-1 hover:underline" style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
          View full on-chain data on Solana Explorer <ExternalLink size={10} />
        </a>
      </div>
    </div>
  );
}
