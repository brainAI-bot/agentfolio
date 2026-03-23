"use client";

import { useState, useMemo } from "react";
import type { Agent } from "@/lib/types";
import { AgentCard } from "./AgentCard";
import { SearchBar } from "./SearchBar";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

interface LeaderboardTableProps {
  agents: Agent[];
}

type SortKey = "trustScore" | "newest" | "jobs" | "rating";

const PAGE_SIZE = 24;

export function LeaderboardTable({ agents }: LeaderboardTableProps) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("trustScore");
  const [filterSkill, setFilterSkill] = useState<string>("");
  const [page, setPage] = useState(1);

  const allSkills = useMemo(() => {
    const s = new Set<string>();
    agents.forEach((a) => a.skills.forEach((sk) => s.add(sk)));
    return Array.from(s).sort();
  }, [agents]);

  const filtered = useMemo(() => {
    let result = [...agents];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.skills.some((s) => s.toLowerCase().includes(q)) ||
          a.handle.toLowerCase().includes(q)
      );
    }

    if (filterSkill) {
      result = result.filter((a) => a.skills.includes(filterSkill));
    }

    switch (sortBy) {
      case "trustScore":
        result.sort((a, b) => b.trustScore - a.trustScore);
        break;
      case "newest":
        result.sort((a, b) => new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime());
        break;
      case "jobs":
        result.sort((a, b) => b.jobsCompleted - a.jobsCompleted);
        break;
      case "rating":
        result.sort((a, b) => b.rating - a.rating);
        break;
    }

    return result;
  }, [agents, search, sortBy, filterSkill]);

  // Reset page when filters change
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const paged = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  // Reset to page 1 when search/filter/sort changes
  const handleSearch = (v: string) => { setSearch(v); setPage(1); };
  const handleSort = (v: SortKey) => { setSortBy(v); setPage(1); };
  const handleFilter = (v: string) => { setFilterSkill(v); setPage(1); };

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex-1">
          <SearchBar value={search} onChange={handleSearch} />
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => handleSort(e.target.value as SortKey)}
              className="appearance-none pl-3 pr-8 py-2.5 rounded-lg text-xs uppercase tracking-wider cursor-pointer outline-none"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
              }}
            >
              <option value="trustScore">Trust Score</option>
              <option value="newest">Newest</option>
              <option value="jobs">Most Jobs</option>
              <option value="rating">Top Rated</option>
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-tertiary)" }} />
          </div>
          <div className="relative">
            <select
              value={filterSkill}
              onChange={(e) => handleFilter(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2.5 rounded-lg text-xs uppercase tracking-wider cursor-pointer outline-none"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
              }}
            >
              <option value="">All Skills</option>
              {allSkills.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-tertiary)" }} />
          </div>
        </div>
      </div>

      {/* Header */}
      <div
        className="hidden sm:flex items-center gap-4 px-4 py-2 text-[10px] uppercase tracking-widest border-b"
        style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)", borderColor: "var(--border)" }}
      >
        <span className="w-8 text-center">Rank</span>
        <span className="w-10" />
        <span className="flex-1">Agent</span>
        <span className="w-[120px]">Verified</span>
        <span className="hidden md:block w-[120px]">Stats</span>
      </div>

      {/* Rows — paginated */}
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
        {paged.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
            No agents found matching &ldquo;{search}&rdquo;
          </div>
        ) : (
          paged.map((agent, i) => (
            <AgentCard key={agent.id} agent={agent} rank={startIdx + i + 1} />
          ))
        )}
      </div>

      {/* Pagination + Count */}
      <div className="mt-3 flex items-center justify-between">
        <div className="text-[11px]" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
          Showing {startIdx + 1}–{Math.min(startIdx + PAGE_SIZE, filtered.length)} of {filtered.length} agents
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              className="p-1.5 rounded transition-colors disabled:opacity-30"
              style={{ color: "var(--text-secondary)", background: currentPage > 1 ? "var(--bg-primary)" : "transparent", border: "1px solid var(--border)" }}
              aria-label="Previous page"
            >
              <ChevronLeft size={14} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
              .reduce<(number | string)[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("...");
                acc.push(p);
                return acc;
              }, [])
              .map((p, idx) =>
                typeof p === "string" ? (
                  <span key={`ellipsis-${idx}`} className="px-1 text-[11px]" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className="px-2.5 py-1 rounded text-[11px] transition-colors"
                    style={{
                      fontFamily: "var(--font-mono)",
                      background: p === currentPage ? "var(--accent)" : "var(--bg-primary)",
                      color: p === currentPage ? "#fff" : "var(--text-secondary)",
                      border: "1px solid " + (p === currentPage ? "var(--accent)" : "var(--border)"),
                    }}
                  >
                    {p}
                  </button>
                )
              )}
            <button
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
              className="p-1.5 rounded transition-colors disabled:opacity-30"
              style={{ color: "var(--text-secondary)", background: currentPage < totalPages ? "var(--bg-primary)" : "transparent", border: "1px solid var(--border)" }}
              aria-label="Next page"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
