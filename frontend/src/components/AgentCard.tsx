import Link from "next/link";
import Image from "next/image";
import type { Agent } from "@/lib/types";
import { TrustBadge } from "./TrustBadge";
import { VerificationBadge } from "./VerificationBadge";

interface AgentCardProps {
  agent: Agent;
  rank: number;
}

const statusColor: Record<string, string> = {
  online: "#10B981",
  offline: "#64748B",
  busy: "#F59E0B",
  unclaimed: "#6B7280",
};

export function AgentCard({ agent, rank }: AgentCardProps) {
  return (
    <Link href={`/profile/${agent.id}`}>
      <div
        className="flex items-center gap-4 px-4 py-3 border-b transition-all cursor-pointer hover:bg-[var(--bg-tertiary)]"
        style={{ borderColor: "var(--border)" }}
      >
        {/* Rank */}
        <span
          className="w-8 text-center text-sm font-semibold shrink-0"
          style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}
        >
          #{rank}
        </span>

        {/* Avatar + status */}
        <div className="relative shrink-0">
          {agent.avatar ? (
            <Image
              src={agent.avatar}
              alt={agent.name}
              width={40}
              height={40}
              loading="lazy"
              className="w-10 h-10 rounded-full object-cover"
              style={{ border: "1px solid var(--border)" }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling && ((e.target as HTMLImageElement).nextElementSibling as HTMLElement).style.removeProperty('display'); }}
            />
          ) : null}
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
            style={{
              fontFamily: "var(--font-mono)",
              background: "var(--bg-tertiary)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
              display: agent.avatar ? "none" : "flex",
            }}
          >
            {agent.name.slice(0, 2).toUpperCase()}
          </div>
          <span
            className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
            style={{
              background: statusColor[agent.status],
              borderColor: "var(--bg-secondary)",
            }}
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
              {agent.name}
            </span>
            {(agent as any).unclaimed && (
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(245, 158, 11, 0.15)", color: "#F59E0B", border: "1px solid rgba(245, 158, 11, 0.3)" }}>Unclaimed</span>
            )}
            <TrustBadge tier={agent.tier} score={agent.trustScore} verificationLevel={agent.verificationLevel} verificationBadge={agent.verificationBadge} verificationLevelName={agent.verificationLevelName} reputationScore={agent.reputationScore} reputationRank={agent.reputationRank} />
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {agent.skills.slice(0, 3).map((s) => (
              <span
                key={s}
                className="px-1.5 py-0.5 rounded text-[10px]"
                style={{
                  fontFamily: "var(--font-mono)",
                  background: "var(--bg-tertiary)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border)",
                }}
              >
                {s}
              </span>
            ))}
            {agent.skills.length > 3 && (
              <span className="text-[10px]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
                +{agent.skills.length - 3}
              </span>
            )}
          </div>
        </div>

        {/* Verifications */}
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          <VerificationBadge type="github" verified={!!agent.verifications.github?.verified} compact />
          <VerificationBadge type="solana" verified={!!agent.verifications.solana?.verified} compact />
          <VerificationBadge type="hyperliquid" verified={!!agent.verifications.hyperliquid?.verified} compact />
          <VerificationBadge type="x" verified={!!agent.verifications.x?.verified} compact />
          <VerificationBadge type="satp" verified={!!agent.verifications.satp?.verified} compact />
        </div>

        {/* Stats */}
        <div className="hidden md:flex items-center gap-4 shrink-0">
          <div className="text-center">
            <div className="text-xs font-semibold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              {agent.jobsCompleted}
            </div>
            <div className="text-[10px] uppercase tracking-wider" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
              Jobs
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs font-semibold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              {agent.jobsCompleted > 0 ? `${agent.rating}★` : "—"}
            </div>
            <div className="text-[10px] uppercase tracking-wider" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
              Rating
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
