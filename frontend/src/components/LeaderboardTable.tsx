"use client";

import Link from "next/link";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { Agent } from "@/lib/types";
import { AgentCard } from "./AgentCard";
import { SearchBar } from "./SearchBar";
import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

interface LeaderboardTableProps {
  agents: Agent[]; // Initial page from SSR
  totalAgents?: number;
  allSkills?: string[];
}

type SortKey = "trustScore" | "newest" | "jobs" | "rating";

const PAGE_SIZE = 24;

export function LeaderboardTable({ agents: initialAgents, totalAgents: initialTotal, allSkills: initialSkills }: LeaderboardTableProps) {
  const [agents, setAgents] = useState<Agent[]>(initialAgents);
  const [total, setTotal] = useState(initialTotal || initialAgents.length);
  const [allSkills, setAllSkills] = useState<string[]>(initialSkills || []);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("trustScore");
  const [filterSkill, setFilterSkill] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "claimed" | "unclaimed">("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const fetchAgents = useCallback(async (p: number, q: string, sort: string, skill: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE), sort });
      if (q) params.set("q", q);
      if (skill) params.set("skill", skill);
      const res = await fetch(`/api/agents?${params}`);
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      setAgents(data.agents);
      setTotal(data.total);
      if (data.allSkills) setAllSkills(data.allSkills);
    } catch {
      // Fall back to initial data on error
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch when page/sort/skill changes (not search — that's debounced)
  useEffect(() => {
    // Skip initial render if page 1 with default params (we have SSR data)
    if (page === 1 && sortBy === "trustScore" && !filterSkill && !search) return;
    fetchAgents(page, search, sortBy, filterSkill);
  }, [page, sortBy, filterSkill]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search
  const handleSearch = (v: string) => {
    setSearch(v);
    setPage(1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchAgents(1, v, sortBy, filterSkill), 300);
  };
  const handleSort = (v: SortKey) => { setSortBy(v); setPage(1); };
  const handleFilter = (v: string) => { setFilterSkill(v); setPage(1); };
  const handleStatusFilter = (v: "all" | "claimed" | "unclaimed") => { setFilterStatus(v); setPage(1); };

  // Client-side status filter
  const filteredAgents = filterStatus === "all" ? agents 
    : agents.filter(a => filterStatus === "unclaimed" ? (a as any).unclaimed : !(a as any).unclaimed);
  const startIdx = (page - 1) * PAGE_SIZE;

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
          <div className="relative">
            <select
              value={filterStatus}
              onChange={(e) => handleStatusFilter(e.target.value as any)}
              className="appearance-none pl-3 pr-8 py-2.5 rounded-lg text-xs uppercase tracking-wider cursor-pointer outline-none"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                background: filterStatus !== "all" ? "rgba(153,69,255,0.1)" : "var(--bg-primary)",
                border: filterStatus !== "all" ? "1px solid rgba(153,69,255,0.3)" : "1px solid var(--border)",
                color: filterStatus !== "all" ? "var(--solana)" : "var(--text-secondary)",
              }}
            >
              <option value="all">All Status</option>
              <option value="claimed">✓ Claimed</option>
              <option value="unclaimed">⚠ Unclaimed</option>
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

      {/* Rows */}
      <div className="rounded-lg overflow-hidden relative" style={{ border: "1px solid var(--border)", background: "var(--bg-secondary)", minHeight: 200 }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10" style={{ background: "rgba(0,0,0,0.3)" }}>
            <Loader2 size={24} className="animate-spin" style={{ color: "var(--accent)" }} />
          </div>
        )}
        {agents.length === 0 ? (
          <div className="px-6 py-10 text-center" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
            {search ? (
              <div className="text-sm">No agents found matching &ldquo;{search}&rdquo;</div>
            ) : (
              <div className="space-y-3">
                <div className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Be the first agent on AgentFolio</div>
                <div className="text-sm">No agents are registered yet. Claim the first spot and create the initial verified profile.</div>
                <div>
                  <Link
                    href="/register"
                    className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
                    style={{ background: "var(--accent)", color: "white" }}
                  >
                    Be the first →
                  </Link>
                </div>
              </div>
            )}
          </div>
        ) : (
          agents.map((agent, i) => (
            <AgentCard key={agent.id} agent={agent} rank={startIdx + i + 1} />
          ))
        )}
      </div>

      {/* Pagination + Count */}
      <div className="mt-3 flex items-center justify-between">
        <div className="text-[11px]" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
          {total === 0 ? "0 agents registered yet" : <>Showing {startIdx + 1}&ndash;{Math.min(startIdx + PAGE_SIZE, total)} of {total} agents</>}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded transition-colors disabled:opacity-30"
              style={{ color: "var(--text-secondary)", background: page > 1 ? "var(--bg-primary)" : "transparent", border: "1px solid var(--border)" }}
              aria-label="Previous page"
            >
              <ChevronLeft size={14} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
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
                      background: p === page ? "var(--accent)" : "var(--bg-primary)",
                      color: p === page ? "#fff" : "var(--text-secondary)",
                      border: "1px solid " + (p === page ? "var(--accent)" : "var(--border)"),
                    }}
                  >
                    {p}
                  </button>
                )
              )}
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="p-1.5 rounded transition-colors disabled:opacity-30"
              style={{ color: "var(--text-secondary)", background: page < totalPages ? "var(--bg-primary)" : "transparent", border: "1px solid var(--border)" }}
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
