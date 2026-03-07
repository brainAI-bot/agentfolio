"use client";

import { useState, useMemo } from "react";
import { Search } from "lucide-react";

interface Job {
  id: string;
  title: string;
  poster: string;
  assignee?: string;
  budget: string;
  status: "open" | "in_progress" | "completed" | "disputed";
  createdAt: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: "OPEN", color: "#a78bfa", bg: "rgba(167,139,250,0.15)" },
  in_progress: { label: "IN PROGRESS", color: "#fbbf24", bg: "rgba(251,191,36,0.15)" },
  completed: { label: "COMPLETED", color: "#34d399", bg: "rgba(52,211,153,0.15)" },
  disputed: { label: "DISPUTED", color: "#f87171", bg: "rgba(248,113,113,0.15)" },
  quoted: { label: "QUOTED", color: "#9ca3af", bg: "rgba(156,163,175,0.15)" },
};

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function parseBudget(budget: string): number {
  const m = budget.match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

type SortKey = "newest" | "oldest" | "highest";
type FilterKey = "all" | "open" | "in_progress" | "completed";

export default function ProtocolActivity({ jobs }: { jobs: Job[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("newest");

  const counts = useMemo(() => ({
    total: jobs.length,
    open: jobs.filter(j => j.status === "open").length,
    active: jobs.filter(j => j.status === "in_progress").length,
    completed: jobs.filter(j => j.status === "completed").length,
  }), [jobs]);

  const filtered = useMemo(() => {
    let result = jobs;
    if (filter !== "all") result = result.filter(j => j.status === filter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(j => j.title.toLowerCase().includes(q) || j.poster.toLowerCase().includes(q) || (j.assignee?.toLowerCase().includes(q)));
    }
    result = [...result].sort((a, b) => {
      if (sort === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return parseBudget(b.budget) - parseBudget(a.budget);
    });
    return result;
  }, [jobs, filter, search, sort]);

  const filterTabs: { key: FilterKey; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.total },
    { key: "open", label: "Open", count: counts.open },
    { key: "in_progress", label: "Active", count: counts.active },
    { key: "completed", label: "Completed", count: counts.completed },
  ];

  const cardStyle = {
    background: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    fontFamily: "var(--font-mono)",
  };

  return (
    <div className="rounded-lg p-5" style={cardStyle}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <h2 className="text-xs uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>
          Protocol Activity
        </h2>
        <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
          {counts.total} total · {counts.active} active · {counts.completed} completed
        </div>
      </div>

      {/* Search + Filters + Sort */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-tertiary)" }} />
          <input
            type="text"
            placeholder="Search tasks..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full text-xs rounded px-7 py-1.5 outline-none"
            style={{
              background: "var(--bg-primary)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
            }}
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {filterTabs.map(t => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className="text-[10px] px-2.5 py-1 rounded transition-colors"
              style={{
                background: filter === t.key ? "var(--accent)" : "var(--bg-primary)",
                color: filter === t.key ? "#000" : "var(--text-tertiary)",
                border: "1px solid var(--border)",
              }}
            >
              {t.label} {t.count}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as SortKey)}
          className="text-[10px] px-2 py-1 rounded outline-none"
          style={{
            background: "var(--bg-primary)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
          }}
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="highest">Highest Value</option>
        </select>
      </div>

      {/* Job List */}
      {filtered.length === 0 ? (
        <p className="text-xs py-4 text-center" style={{ color: "var(--text-tertiary)" }}>No jobs found</p>
      ) : (
        <div className="space-y-0">
          {filtered.map(job => {
            const sc = STATUS_CONFIG[job.status] || STATUS_CONFIG.open;
            const budgetNum = parseBudget(job.budget);
            const agent = job.assignee || job.poster;
            return (
              <a
                key={job.id}
                href={`/marketplace`}
                className="flex items-center gap-3 py-2.5 px-2 -mx-2 rounded hover:bg-[var(--bg-primary)] transition-colors"
                style={{ borderBottom: "1px solid var(--border)", textDecoration: "none" }}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-xs truncate block" style={{ color: "var(--text-primary)" }}>
                    {job.title.length > 80 ? job.title.slice(0, 80) + "…" : job.title}
                  </span>
                </div>
                <span className="text-[10px] shrink-0 hidden sm:block" style={{ color: "var(--accent)" }}>
                  {agent}
                </span>
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded shrink-0 font-semibold"
                  style={{ color: sc.color, background: sc.bg }}
                >
                  {sc.label}
                </span>
                <span className="text-[10px] shrink-0 w-12 text-right" style={{ color: "var(--text-secondary)" }}>
                  {budgetNum > 0 ? `$${budgetNum}` : "—"}
                </span>
                <span className="text-[10px] shrink-0 w-14 text-right" style={{ color: "var(--text-tertiary)" }}>
                  {relativeTime(job.createdAt)}
                </span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
