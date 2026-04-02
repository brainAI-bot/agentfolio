"use client";

import { useState } from "react";
import { Search, ArrowRight, User } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

interface SearchResult {
  id: string;
  name: string;
  avatar?: string;
  trustScore: number;
  verificationLevelName: string;
  unclaimed?: boolean;
}

export function ClaimSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/agents?q=${encodeURIComponent(query.trim())}&limit=5`);
      const data = await res.json();
      setResults(data.agents || []);
      setSearched(true);
    } catch {
      setResults([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-tertiary)" }} />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="Search by agent name or wallet address..."
            className="w-full pl-9 pr-4 py-2.5 rounded-lg text-sm outline-none"
            style={{
              fontFamily: "var(--font-mono)",
              background: "var(--bg-primary)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
            }}
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="px-4 py-2.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all disabled:opacity-50"
          style={{
            fontFamily: "var(--font-mono)",
            background: "rgba(153, 69, 255, 0.15)",
            color: "var(--solana)",
            border: "1px solid rgba(153, 69, 255, 0.3)",
          }}
        >
          {loading ? "..." : "Search"}
        </button>
      </div>

      {searched && results.length === 0 && (
        <p className="text-xs mt-3" style={{ color: "var(--text-tertiary)" }}>
          No profiles found. Register a new one above!
        </p>
      )}

      {results.length > 0 && (
        <div className="mt-3 space-y-2">
          {results.map(agent => (
            <Link
              key={agent.id}
              href={`/profile/${agent.id}`}
              className="flex items-center gap-3 px-4 py-3 rounded-lg transition-all hover:border-[var(--accent)]"
              style={{ background: "var(--bg-primary)", border: "1px solid var(--border)" }}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 overflow-hidden"
                style={{ background: "rgba(153,69,255,0.1)", color: "var(--accent)" }}
              >
                {agent.avatar && agent.avatar !== "/default-avatar.png" ? (
                  <Image src={agent.avatar} alt={agent.name} width={32} height={32} className="w-full h-full object-cover" unoptimized />
                ) : (
                  agent.name.charAt(0).toUpperCase()
                )}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                  {agent.name}
                </span>
                <span className="text-[10px] ml-2 px-2 py-0.5 rounded-full" style={{ background: "rgba(153,69,255,0.1)", color: "var(--accent)" }}>
                  {agent.verificationLevelName}
                </span>
              </div>
              <ArrowRight size={14} style={{ color: "var(--text-tertiary)" }} className="shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
