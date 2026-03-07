"use client";

interface ActivityItem {
  type: string;
  createdAt: string;
}

interface Props {
  activity: ActivityItem[];
  createdAt: string;
}

export function ActivityHeatmap({ activity, createdAt }: Props) {
  // Build a map of date -> activity count
  const activityMap = new Map<string, number>();
  for (const a of activity) {
    if (!a.createdAt) continue;
    const date = a.createdAt.slice(0, 10); // YYYY-MM-DD
    activityMap.set(date, (activityMap.get(date) || 0) + 1);
  }

  // Also count the registration date
  if (createdAt) {
    const regDate = createdAt.slice(0, 10);
    activityMap.set(regDate, (activityMap.get(regDate) || 0) + 1);
  }

  // Generate 52 weeks × 7 days grid ending today
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

  const maxCount = Math.max(1, ...Array.from(activityMap.values()));

  function getColor(count: number): string {
    if (count === 0) return "var(--bg-primary)";
    const ratio = count / maxCount;
    if (ratio > 0.75) return "var(--accent)";
    if (ratio > 0.5) return "var(--accent-bright)";
    if (ratio > 0.25) return "var(--bg-elevated)";
    return "var(--bg-tertiary)";
  }

  const totalActivities = activity.length;

  return (
    <div>
      <div className="flex gap-0.5 overflow-hidden">
        {weeks.map((week, i) => (
          <div key={i} className="flex flex-col gap-0.5">
            {week.map((day, j) => (
              <div
                key={j}
                className="w-2 h-2 rounded-sm"
                style={{ background: getColor(day.count) }}
                title={`${day.date}: ${day.count} ${day.count === 1 ? "action" : "actions"}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 text-[10px] uppercase tracking-widest" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
        {totalActivities} actions in the last year
      </div>
    </div>
  );
}
