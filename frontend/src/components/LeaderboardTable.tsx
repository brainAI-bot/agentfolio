"use client";

import { useState, useMemo } from "react";
import type { Agent } from "@/lib/types";
import { AgentCard } from "./AgentCard";
import { SearchBar } from "./SearchBar";
import { ChevronDown } from "lucide-react";

interface LeaderboardTableProps {
  agents: Agent[];
}

type SortKey = "trustScore" | "newest" | "jobs" | "rating";

export function LeaderboardTable({ agents }: LeaderboardTableProps) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("trustScore");
  const [filterSkill, setFilterSkill] = useState<string>("");

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

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex-1">
          <SearchBar value={search} onChange={setSearch} />
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
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
              onChange={(e) => setFilterSkill(e.target.value)}
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

      {/* Rows */}
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
            No agents found matching &ldquo;{search}&rdquo;
          </div>
        ) : (
          filtered.map((agent, i) => (
            <AgentCard key={agent.id} agent={agent} rank={i + 1} />
          ))
        )}
      </div>

      {/* Count */}
      <div className="mt-3 text-right text-[11px]" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
        Showing {filtered.length} of {agents.length} agents
      </div>
    </div>
  );
}
