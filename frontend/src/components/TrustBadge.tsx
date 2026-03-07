interface TrustBadgeProps {
  tier: number;
  score: number;
}

const tierConfig: Record<number, { label: string; bg: string; color: string }> = {
  0: { label: "IRON", bg: "#1E293B", color: "#6b7280" },
  1: { label: "BRONZE", bg: "#2D1B0E", color: "#cd7f32" },
  2: { label: "SILVER", bg: "#1E293B", color: "#c0c0c0" },
  3: { label: "GOLD", bg: "#2D2500", color: "#ffd700" },
};

export function TrustBadge({ tier, score }: TrustBadgeProps) {
  const config = tierConfig[tier] || tierConfig[0];

  return (
    <div className="flex items-center gap-2">
      <span
        className="px-2 py-0.5 rounded text-[10px] font-bold tracking-widest"
        style={{
          fontFamily: "var(--font-mono)",
          background: config.bg,
          color: config.color,
        }}
      >
        TIER {tier} · {config.label}
      </span>
      <span
        className="text-sm font-semibold"
        style={{ fontFamily: "var(--font-mono)", color: config.color }}
      >
        {score}
      </span>
    </div>
  );
}
