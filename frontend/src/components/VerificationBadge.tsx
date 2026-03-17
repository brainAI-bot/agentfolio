import { Github, Wallet, X, Shield, Globe, Mail } from "lucide-react";

type VerificationType = "github" | "solana" | "hyperliquid" | "x" | "satp" | "ethereum" | "agentmail";

interface VerificationBadgeProps {
  type: VerificationType;
  verified: boolean;
  compact?: boolean;
}

const config: Record<VerificationType, { icon: React.ElementType; label: string; color: string; bg: string }> = {
  github: { icon: Github, label: "GitHub", color: "#E2E8F0", bg: "#1E293B" },
  solana: { icon: Wallet, label: "Solana", color: "#9945FF", bg: "rgba(153, 69, 255, 0.2)" },
  hyperliquid: { icon: Globe, label: "HL", color: "#3B82F6", bg: "rgba(59, 130, 246, 0.2)" },
  x: { icon: X, label: "X", color: "#1DA1F2", bg: "rgba(29, 161, 242, 0.2)" },
  satp: { icon: Shield, label: "SATP", color: "#10B981", bg: "rgba(16, 185, 129, 0.2)" },
  ethereum: { icon: Wallet, label: "ETH", color: "#627EEA", bg: "rgba(98, 126, 234, 0.2)" },
  agentmail: { icon: Mail, label: "Mail", color: "#10B981", bg: "rgba(16, 185, 129, 0.2)" },
};

export function VerificationBadge({ type, verified, compact }: VerificationBadgeProps) {
  const c = config[type];
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
