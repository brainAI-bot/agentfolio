"use client";

import { Search } from "lucide-react";

interface SearchBarProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder = "Search agents, skills, wallets..." }: SearchBarProps) {
  return (
    <div className="relative">
      <Search
        size={16}
        className="absolute left-3 top-1/2 -translate-y-1/2"
        style={{ color: "var(--text-tertiary)" }}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm outline-none transition-all"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "13px",
          background: "var(--bg-primary)",
          border: "1px solid var(--border)",
          color: "var(--text-primary)",
        }}
        onFocus={(e) => (e.target.style.borderColor = "var(--accent)")}
        onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
      />
      <kbd
        className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-block px-1.5 py-0.5 rounded text-[10px]"
        style={{
          fontFamily: "var(--font-mono)",
          background: "var(--bg-tertiary)",
          color: "var(--text-tertiary)",
          border: "1px solid var(--border)",
        }}
      >
        /
      </kbd>
    </div>
  );
}
