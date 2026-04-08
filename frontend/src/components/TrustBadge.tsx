"use client";
import { useState, useRef, useEffect } from "react";

interface TrustBadgeProps {
  tier: number;
  score: number;
  verificationLevel?: number;
  verificationBadge?: string;
  verificationLevelName?: string;
  reputationScore?: number;
  reputationRank?: string;
}

const levelColors: Record<number, { bg: string; color: string }> = {
  0: { bg: '#1E293B', color: '#6b7280' },
  1: { bg: '#2D2500', color: '#eab308' },
  2: { bg: '#0C1E3D', color: '#3b82f6' },
  3: { bg: '#0C2D1B', color: '#10b981' },
  4: { bg: '#2D1B0E', color: '#f97316' },
  5: { bg: '#1E0C2D', color: '#8b5cf6' },
};

const levelNames: Record<number, string> = {
  0: 'Unclaimed',
  1: 'Registered',
  2: 'Verified',
  3: 'Established',
  4: 'Trusted',
  5: 'Sovereign',
};

const levelDescriptions: Record<number, string> = {
  0: 'Placeholder profile — not yet claimed',
  1: 'Profile created, SATP identity on-chain',
  2: '2+ verifications from any category',
  3: '5+ verifications from 2+ categories + complete profile',
  4: 'Proven track record — escrow jobs + reviews',
  5: 'Sovereign — human-verified + soulbound avatar',
};

export function TrustBadge({ tier, score, verificationLevel, verificationBadge, verificationLevelName, reputationScore, reputationRank }: TrustBadgeProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<'bottom' | 'top'>('bottom');
  const badgeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showTooltip && badgeRef.current) {
      const rect = badgeRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setTooltipPos(spaceBelow < 200 ? 'top' : 'bottom');
    }
  }, [showTooltip]);

  if (verificationLevel !== undefined) {
    const lc = levelColors[verificationLevel] || levelColors[0];
    const rawTrustScore = reputationScore ?? 0;
    const trustScore = rawTrustScore > 10000 ? Math.round(rawTrustScore / 10000) : rawTrustScore;
    const trustPercent = Math.min((trustScore / 800) * 100, 100);
    const displayName = verificationLevelName || levelNames[verificationLevel] || 'Unknown';

    return (
      <div
        ref={badgeRef}
        className="relative flex items-center gap-2"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        style={{ cursor: 'help' }}
      >
        <span
          className="px-2 py-0.5 rounded text-[10px] font-bold tracking-widest"
          style={{ fontFamily: 'var(--font-mono)', background: lc.bg, color: lc.color }}
        >
          {verificationBadge || '⚪'} L{verificationLevel} · {displayName}
        </span>
        <span
          className="text-sm font-semibold"
          style={{ fontFamily: 'var(--font-mono)', color: lc.color }}
        >
          {trustScore} Trust
        </span>

        {showTooltip && (
          <div
            className="absolute z-50 w-64 p-3 rounded-lg shadow-xl border"
            style={{
              fontFamily: 'var(--font-mono)',
              background: 'var(--bg-primary)',
              borderColor: lc.color + '40',
              [tooltipPos === 'bottom' ? 'top' : 'bottom']: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              marginTop: tooltipPos === 'bottom' ? '8px' : undefined,
              marginBottom: tooltipPos === 'top' ? '8px' : undefined,
            }}
          >
            {/* Verification Level */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                  Verification Level
                </span>
                <span className="text-xs font-bold" style={{ color: lc.color }}>
                  L{verificationLevel} · {displayName}
                </span>
              </div>
              <div className="flex gap-1 mb-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-1.5 flex-1 rounded-full"
                    style={{
                      background: i < verificationLevel ? lc.color : 'var(--bg-tertiary)',
                    }}
                  />
                ))}
              </div>
              <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                {levelDescriptions[verificationLevel] || ''}
              </p>
            </div>

            {/* Trust Score */}
            <div className="mb-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                  Trust Score
                </span>
                <span className="text-xs font-bold" style={{ color: lc.color }}>
                  {trustScore}/800
                </span>
              </div>
              <div className="h-1.5 rounded-full" style={{ background: 'var(--bg-tertiary)' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: trustPercent + '%', background: lc.color }}
                />
              </div>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                Earned through platform engagement
              </p>
            </div>

            {/* How scores work link */}
            <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
              <a
                href="/how-it-works"
                className="text-[10px] hover:underline"
                style={{ color: lc.color }}
                onClick={(e) => e.stopPropagation()}
              >
                How scores work →
              </a>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Legacy fallback
  const tierConfig: Record<number, { label: string; bg: string; color: string }> = {
    0: { label: 'IRON', bg: '#1E293B', color: '#6b7280' },
    1: { label: 'BRONZE', bg: '#2D1B0E', color: '#cd7f32' },
    2: { label: 'SILVER', bg: '#1E293B', color: '#c0c0c0' },
    3: { label: 'GOLD', bg: '#2D2500', color: '#ffd700' },
  };
  const config = tierConfig[tier] || tierConfig[0];
  return (
    <div className="flex items-center gap-2">
      <span
        className="px-2 py-0.5 rounded text-[10px] font-bold tracking-widest"
        style={{ fontFamily: 'var(--font-mono)', background: config.bg, color: config.color }}
      >
        TIER {tier} · {config.label}
      </span>
      <span className="text-sm font-semibold" style={{ fontFamily: 'var(--font-mono)', color: config.color }}>
        {score}
      </span>
    </div>
  );
}
