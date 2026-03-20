import { Github, Wallet, X, Shield, Globe, Mail, MessageCircle, Send, Bookmark, BarChart3, Link2 } from "lucide-react";

type VerificationType = "github" | "solana" | "hyperliquid" | "x" | "satp" | "ethereum" | "agentmail" | "moltbook" | "website" | "domain" | "polymarket" | "discord" | "telegram";

interface VerificationBadgeProps {
  type: VerificationType;
  verified: boolean;
  compact?: boolean;
}

const config: Record<VerificationType, { icon: React.ElementType; label: string; color: string; bg: string; priority: number }> = {
  satp:        { icon: Shield,       label: "SATP",      color: "#10B981", bg: "rgba(16, 185, 129, 0.2)",  priority: 1 },
  github:      { icon: Github,       label: "GitHub",    color: "#E2E8F0", bg: "#1E293B",                  priority: 2 },
  x:           { icon: X,            label: "X",         color: "#E2E8F0", bg: "#1E293B",                  priority: 3 },
  solana:      { icon: Wallet,       label: "Solana",    color: "#9945FF", bg: "rgba(153, 69, 255, 0.2)",  priority: 4 },
  ethereum:    { icon: Wallet,       label: "ETH",       color: "#627EEA", bg: "rgba(98, 126, 234, 0.2)",  priority: 5 },
  agentmail:   { icon: Mail,         label: "Mail",      color: "#10B981", bg: "rgba(16, 185, 129, 0.2)",  priority: 6 },
  moltbook:    { icon: Bookmark,     label: "Moltbook",  color: "#EC4899", bg: "rgba(236, 72, 153, 0.2)",  priority: 7 },
  hyperliquid: { icon: BarChart3,    label: "HL",        color: "#3B82F6", bg: "rgba(59, 130, 246, 0.2)",  priority: 8 },
  polymarket:  { icon: BarChart3,    label: "PM",        color: "#F59E0B", bg: "rgba(245, 158, 11, 0.2)",  priority: 9 },
  discord:     { icon: MessageCircle,label: "Discord",   color: "#5865F2", bg: "rgba(88, 101, 242, 0.2)",  priority: 10 },
  telegram:    { icon: Send,         label: "Telegram",  color: "#26A5E4", bg: "rgba(38, 165, 228, 0.2)",  priority: 11 },
  website:     { icon: Globe,        label: "Website",   color: "#06B6D4", bg: "rgba(6, 182, 212, 0.2)",   priority: 12 },
  domain:      { icon: Link2,        label: "Domain",    color: "#06B6D4", bg: "rgba(6, 182, 212, 0.2)",   priority: 13 },
};

export function VerificationBadge({ type, verified, compact }: VerificationBadgeProps) {
  const c = config[type];
  if (!c) return null;
  const Icon = c.icon;

  if (compact) {
    return (
      <span
        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px]"
        style={{
          background: verified ? c.bg : "transparent",
          color: verified ? c.color : "var(--text-tertiary)",
          border: verified ? "none" : "1px solid var(--border)",
        }}
        title={`${c.label}: ${verified ? "Verified" : "Not verified"}`}
      >
        {verified ? "✓" : "○"}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium"
      style={{
        fontFamily: "var(--font-mono)",
        background: verified ? c.bg : "transparent",
        color: verified ? c.color : "var(--text-tertiary)",
        border: verified ? "none" : "1px solid var(--border)",
      }}
    >
      <Icon size={12} />
      {c.label}
      {verified && <span className="text-[10px]">✓</span>}
    </span>
  );
}

export const VERIFICATION_PRIORITY: VerificationType[] = [
  "satp", "github", "x", "solana", "ethereum",
  "agentmail", "moltbook", "hyperliquid", "polymarket",
  "discord", "telegram", "website", "domain"
];
