"use client";

import { useEffect, useState } from "react";
import { Shield, ExternalLink, Flame } from "lucide-react";

function normalizeScore(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value > 10000 ? Math.round(value / 10000) : value;
}

interface GenesisData {
  pda: string;
  agentName: string;
  description: string;
  category: string;
  verificationLevel: number;
  verificationLabel: string;
  reputationScore: number;
  reputationPct: string;
  isBorn: boolean;
  bornAt: number | null;
  faceImage: string;
  faceMint: string;
  faceBurnTx: string;
  createdAt: number;
  authority: string;
}

interface NftAvatar {
  image?: string;
  arweaveUrl?: string;
  permanent?: boolean;
  burnTxSignature?: string;
  verifiedAt?: string;
  name?: string;
}

export function GenesisRecordCard({ agentId, nftAvatar }: { agentId: string; nftAvatar?: NftAvatar }) {
  const [genesis, setGenesis] = useState<GenesisData | null>(null);

  useEffect(() => {
    Promise.all([
        fetch(`/api/profile/${agentId}/genesis`).then(r => r.json()).catch(() => ({})),
        fetch(`/api/profile/${agentId}/trust-score`).then(r => r.json()).catch(() => ({})),
      ]).then(([gRes, tsRes]) => {
        const g = gRes.genesis;
        if (!g || g.error) return;
        // Merge trust-score DB-enriched data for face/born
        if (tsRes.data) {
          g.isBorn = tsRes.data.isBorn ?? g.isBorn;
          g.bornAt = tsRes.data.bornAt ?? g.bornAt;
          g.faceImage = tsRes.data.faceImage || g.faceImage || "";
          g.faceMint = tsRes.data.faceMint || g.faceMint || "";
          g.verificationLevel = tsRes.data.verificationLevel ?? g.verificationLevel;
          g.verificationLabel = tsRes.data.verificationLabel || g.verificationLabel;
          g.reputationScore = normalizeScore(tsRes.data.reputationScore ?? g.reputationScore);
        }
        setGenesis(g);
      }).catch(() => {});
  }, [agentId]);

  if (!genesis) return null;

  // Get face image: prefer nft_avatar (DB has burn data), fallback to on-chain faceImage
  const faceUrl = nftAvatar?.arweaveUrl || nftAvatar?.image || genesis.faceImage || null;
  const isBorn = genesis.isBorn || nftAvatar?.permanent;
  const burnTx = genesis.faceBurnTx || nftAvatar?.burnTxSignature || null;
  const burnDate = genesis.bornAt
    ? (typeof genesis.bornAt === 'string' ? new Date(genesis.bornAt) : new Date(genesis.bornAt * 1000))
    : nftAvatar?.verifiedAt
    ? new Date(nftAvatar.verifiedAt)
    : null;

  // Level color coding
  genesis.reputationScore = normalizeScore(genesis.reputationScore);

  const levelColor = genesis.verificationLevel >= 5 ? "#A855F7" :
                     genesis.verificationLevel >= 4 ? "#3B82F6" :
                     genesis.verificationLevel >= 3 ? "#10B981" :
                     genesis.verificationLevel >= 2 ? "#F59E0B" : "var(--text-secondary)";

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid var(--border)", background: "rgba(153,69,255,0.04)" }}>
        <Shield size={14} style={{ color: "var(--accent)" }} />
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
          Genesis Record
        </span>
        {isBorn && (
          <span className="ml-auto flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "rgba(249,115,22,0.15)", color: "#F97316" }}>
            <Flame size={10} /> BORN
          </span>
        )}
      </div>

      {/* ID Card Body */}
      <div className="p-4">
        <div className="flex gap-4">
          {/* Left: Face / Soulbound NFT */}
          <div className="shrink-0">
            {faceUrl ? (
              <div className="relative">
                <img
                  src={faceUrl}
                  alt={`${genesis.agentName} face`}
                  className="w-20 h-20 rounded-lg object-cover"
                  style={{ border: isBorn ? "2px solid #F97316" : "2px solid var(--border)" }}
                />
                {isBorn && (
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px]" style={{ background: "#F97316", color: "#fff" }}>
                    🔥
                  </div>
                )}
              </div>
            ) : (
              <div className="w-20 h-20 rounded-lg flex items-center justify-center" style={{ background: "var(--bg-tertiary)", border: "2px dashed var(--border)" }}>
                <span className="text-[10px] text-center px-1" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                  Not yet born
                </span>
              </div>
            )}
          </div>

          {/* Right: Identity Info */}
          <div className="flex-1 space-y-2 text-xs" style={{ fontFamily: "var(--font-mono)" }}>
            <div>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Agent</div>
              <div className="font-semibold" style={{ color: "var(--text-primary)" }}>{genesis.agentName}</div>
            </div>

            {genesis.description && (
              <div>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Description</div>
                <div style={{ color: "var(--text-secondary)" }}>{genesis.description}</div>
              </div>
            )}

            {/* Level + Trust Score row */}
            <div className="flex gap-4">
              {genesis.verificationLevel > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Level</div>
                  <div className="font-semibold" style={{ color: levelColor }}>
                    L{genesis.verificationLevel}{genesis.verificationLabel ? ` · ${genesis.verificationLabel}` : ""}
                  </div>
                </div>
              )}
              {genesis.reputationScore > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Trust</div>
                  <div className="font-semibold" style={{ color: levelColor }}>
                    {genesis.reputationScore}
                  </div>
                </div>
              )}
            </div>

            {isBorn && burnDate && (
              <div>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Burn Date</div>
                <div style={{ color: "#F97316" }}>
                  {burnDate.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Footer: PDA + Authority + Burn TX links */}
        <div className="mt-3 pt-3 space-y-1" style={{ borderTop: "1px solid var(--border)" }}>
          {genesis.authority && (
            <div className="flex items-center justify-between text-[10px]" style={{ fontFamily: "var(--font-mono)" }}>
              <span style={{ color: "var(--text-tertiary)" }}>Authority</span>
              <a
                href={`https://explorer.solana.com/address/${genesis.authority}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:underline"
                style={{ color: "var(--text-secondary)" }}
              >
                {genesis?.authority?.slice(0, 12)}...{genesis?.authority?.slice(-6)} <ExternalLink size={9} />
              </a>
            </div>
          )}
          <div className="flex items-center justify-between text-[10px]" style={{ fontFamily: "var(--font-mono)" }}>
            <span style={{ color: "var(--text-tertiary)" }}>PDA</span>
            <a
              href={`https://explorer.solana.com/address/${genesis.pda}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:underline"
              style={{ color: "var(--accent)" }}
            >
              {genesis?.pda?.slice(0, 16)}...{genesis?.pda?.slice(-8)} <ExternalLink size={9} />
            </a>
          </div>
          {burnTx && (
            <div className="flex items-center justify-between text-[10px]" style={{ fontFamily: "var(--font-mono)" }}>
              <span style={{ color: "var(--text-tertiary)" }}>Burn TX</span>
              <a
                href={`https://solscan.io/tx/${burnTx}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:underline"
                style={{ color: "#F97316" }}
              >
                {burnTx?.slice(0, 16)}...{burnTx?.slice(-8)} <ExternalLink size={9} />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
