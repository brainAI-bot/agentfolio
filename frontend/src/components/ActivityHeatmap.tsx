"use client";

import { useEffect, useState, useCallback } from "react";

interface EventDetail {
  type: string;
  label: string;
  icon: string;
  count: number;
}

interface HeatmapData {
  heatmap: Record<string, number>;
  totalEvents: number;
  activeDays: number;
  streak: number;
  details?: Record<string, EventDetail[]>;
}

interface Props {
  profileId: string;
  activity?: { type: string; createdAt: string }[];
  createdAt?: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function ActivityHeatmap({ profileId, activity, createdAt }: Props) {
  const [data, setData] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<{ date: string; x: number; y: number } | null>(null);

  useEffect(() => {
    fetch(`/api/profile/${profileId}/heatmap`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && d.heatmap) setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [profileId]);

  const activityMap = new Map<string, number>();
  if (data?.heatmap) {
    for (const [date, count] of Object.entries(data.heatmap)) {
      activityMap.set(date, count);
    }
  } else if (!loading) {
    for (const a of (activity || [])) {
      if (!a.createdAt) continue;
      const date = a.createdAt.slice(0, 10);
      activityMap.set(date, (activityMap.get(date) || 0) + 1);
    }
    if (createdAt) {
      const regDate = createdAt.slice(0, 10);
      activityMap.set(regDate, (activityMap.get(regDate) || 0) + 1);
    }
  }

  // Generate grid — last 26 weeks on mobile, 52 on desktop (handled via overflow)
  const today = new Date();
  const weeks: Array<Array<{ date: string; count: number }>> = [];
  for (let w = 51; w >= 0; w--) {
    const week: Array<{ date: string; count: number }> = [];
    for (let d = 0; d < 7; d++) {
      const daysAgo = w * 7 + (6 - d);
      const date = new Date(today);
      date.setDate(date.getDate() - daysAgo);
      const key = date.toISOString().slice(0, 10);
      week.push({ date: key, count: activityMap.get(key) || 0 });
    }
    weeks.push(week);
  }

  // Month labels — only place at first week of each month
  const monthLabels: Array<{ label: string; col: number }> = [];
  let lastMonth = -1;
  weeks.forEach((week, i) => {
    const monthNum = new Date(week[0].date).getMonth();
    if (monthNum !== lastMonth) {
      monthLabels.push({ label: MONTHS[monthNum], col: i });
      lastMonth = monthNum;
    }
  });

  const maxCount = Math.max(1, ...Array.from(activityMap.values()));
  const totalActivities = data?.totalEvents ?? (loading ? null : (activity?.length || 0));
  const activeDays = data?.activeDays ?? (loading ? null : activityMap.size);
  const streak = data?.streak ?? 0;

  function getColor(count: number): string {
    if (count === 0) return "rgba(255,255,255,0.15)";
    const ratio = count / maxCount;
    if (ratio > 0.75) return "#39d353";
    if (ratio > 0.5) return "#26a641";
    if (ratio > 0.25) return "#006d32";
    return "#0e4429";
  }

  const handleMouseEnter = useCallback((e: React.MouseEvent, date: string, count: number) => {
    if (count === 0) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const parentRect = (e.target as HTMLElement).closest('[data-heatmap-root]')?.getBoundingClientRect();
    if (parentRect) {
      setTooltip({
        date,
        x: Math.min(rect.left - parentRect.left + rect.width / 2, parentRect.width - 80),
        y: rect.top - parentRect.top - 4
      });
    }
  }, []);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };

  const tooltipDetails = tooltip && data?.details?.[tooltip.date];

  // Cell size
  const cellSize = 10;
  const gap = 2;
  const dayLabelWidth = 22;
  const gridWidth = weeks.length * (cellSize + gap);
  const svgWidth = dayLabelWidth + gridWidth;
  const svgHeight = 7 * (cellSize + gap) + 20; // +20 for month labels

  return (
    <div data-heatmap-root="" className="relative" style={{ width: '100%', maxWidth: '100%', overflowX: 'auto', overflowY: 'visible', WebkitOverflowScrolling: 'touch' }}>
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        style={{ maxWidth: 'none', display: 'block' }}
      >
        {/* Month labels */}
        {monthLabels.map((ml, i) => (
          <text
            key={i}
            x={dayLabelWidth + ml.col * (cellSize + gap)}
            y={10}
            fontSize="9"
            fill="var(--text-tertiary, #6b7280)"
            fontFamily="var(--font-mono, monospace)"
          >
            {ml.label}
          </text>
        ))}

        {/* Day labels */}
        {["Mo", "We", "Fr"].map((day, i) => (
          <text
            key={day}
            x={0}
            y={20 + (i * 2 + 1) * (cellSize + gap) + cellSize - 2}
            fontSize="9"
            fill="var(--text-tertiary, #6b7280)"
            fontFamily="var(--font-mono, monospace)"
          >
            {day}
          </text>
        ))}

        {/* Grid cells */}
        {weeks.map((week, wi) =>
          week.map((day, di) => (
            <rect
              key={`${wi}-${di}`}
              x={dayLabelWidth + wi * (cellSize + gap)}
              y={18 + di * (cellSize + gap)}
              width={cellSize}
              height={cellSize}
              rx={2}
              fill={loading ? "var(--bg-tertiary, #1e293b)" : getColor(day.count)}
              style={{ cursor: day.count > 0 ? 'pointer' : 'default' }}
              onMouseEnter={(e) => handleMouseEnter(e as any, day.date, day.count)}
              onMouseLeave={() => setTooltip(null)}
            >
              <title>{`${formatDate(day.date)}: ${day.count} action${day.count !== 1 ? 's' : ''}`}</title>
            </rect>
          ))
        )}
      </svg>

      {/* Rich tooltip */}
      {tooltip && (
        <div
          className="absolute z-50 pointer-events-none"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div
            className="rounded-lg px-3 py-2 shadow-lg text-[11px] whitespace-nowrap"
            style={{
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border-bright, var(--border))",
              fontFamily: "var(--font-mono)",
              color: "var(--text-primary)",
            }}
          >
            <div className="font-semibold">{formatDate(tooltip.date)}</div>
            <div className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
              {activityMap.get(tooltip.date) || 0} actions
            </div>
            {tooltipDetails && tooltipDetails.length > 0 && (
              <div className="mt-1 pt-1 space-y-0.5" style={{ borderTop: "1px solid var(--border)" }}>
                {tooltipDetails.slice(0, 5).map((d, i) => (
                  <div key={i} className="text-[10px] flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                    <span>{d.icon}</span> <span>{d.label}</span>
                    {d.count > 1 && <span style={{ color: "var(--text-tertiary)" }}>×{d.count}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats footer */}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-widest" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
        {loading ? (
          <span>Loading...</span>
        ) : (
          <>
            <span>{totalActivities} actions</span>
            <span>{activeDays} active days</span>
            {streak > 0 && <span>🔥 {streak} day streak</span>}
          </>
        )}
        <span className="ml-auto flex items-center gap-1">
          Less
          {[0, 0.25, 0.5, 0.75, 1].map((r, i) => (
            <span key={i} className="inline-block w-2 h-2 rounded-sm" style={{ background: getColor(r * maxCount) }} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}
