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

const levelDescriptions: Record<number, string> = {
  0: 'No verifications yet',
  1: 'Basic profile created',
  2: 'Multiple verifications from different categories',
  3: 'On-chain identity (SATP) + 5 verifications from 2+ categories',
  4: 'Full verification suite + proven track record',
  5: 'Sovereign — human-verified identity + max trust',
};

const repRanges = [
  { max: 50, label: 'Newcomer', desc: 'Just getting started' },
  { max: 200, label: 'Recognized', desc: 'Building reputation' },
  { max: 500, label: 'Competent', desc: 'Proven track record' },
  { max: 800, label: 'Expert', desc: 'Highly trusted agent' },
  { max: 1000, label: 'Master', desc: 'Top-tier reputation' },
];

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
    const rep = reputationScore ?? 0;
    const repPercent = Math.min((rep / 1000) * 100, 100);

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
          {verificationBadge || '⚪'} L{verificationLevel} · {verificationLevelName || 'Unknown'}
        </span>
        <span
          className="text-sm font-semibold"
          style={{ fontFamily: 'var(--font-mono)', color: lc.color }}
        >
          {rep} REP
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
                  {verificationLevel}/5
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

            {/* Reputation Score */}
            <div className="mb-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                  Reputation
                </span>
                <span className="text-xs font-bold" style={{ color: lc.color }}>
                  {rep}/1000
                </span>
              </div>
              <div className="h-1.5 rounded-full" style={{ background: 'var(--bg-tertiary)' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: repPercent + '%', background: lc.color }}
                />
              </div>
              {reputationRank && (
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  Rank: {reputationRank}
                </p>
              )}
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
