"use client";

import { useState } from "react";
import { Play, Loader2, X, Copy, Check } from "lucide-react";

interface TryItButtonProps {
  method: string;
  path: string;
  baseUrl: string;
}

export function TryItButton({ method, path, baseUrl }: TryItButtonProps) {
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [editedPath, setEditedPath] = useState("");

  // Only show for GET endpoints without auth requirements
  if (method !== "GET") return null;
  // Skip x402 paid endpoints
  if (path.includes("x402") || path.includes("trust-score")) return null;

  function resolvePath(p: string): string {
    // Replace common path params with example values
    return p
      .replace(":id", "agent_brainkid")
      .replace(":agentId", "agent_brainkid")
      .replace(":wallet", "Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc")
      .replace(":address", "Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc")
      .replace(":reviewer", "brainforge")
      .replace(":pda", "example")
      .replace(":name", "brainkid.sol");
  }

  async function handleTry() {
    setLoading(true);
    setError("");
    setResult(null);

    const finalPath = editedPath || resolvePath(path);

    try {
      const res = await fetch(finalPath, { signal: AbortSignal.timeout(8000) });
      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("json")) {
        const data = await res.json();
        setResult(JSON.stringify(data, null, 2));
      } else if (contentType.includes("svg") || contentType.includes("image")) {
        setResult(`[${contentType} response — ${res.status}]`);
      } else {
        const text = await res.text();
        setResult(text.slice(0, 2000));
      }
    } catch (e: any) {
      setError(e.message || "Request failed");
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (result) {
      navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        {/* Editable path */}
        <input
          type="text"
          value={editedPath || resolvePath(path)}
          onChange={(e) => setEditedPath(e.target.value)}
          className="flex-1 px-3 py-1.5 rounded text-xs outline-none"
          style={{
            fontFamily: "var(--font-mono)",
            background: "var(--bg-primary)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
          }}
        />
        <button
          onClick={handleTry}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold uppercase tracking-wider transition-all hover:shadow-md"
          style={{
            fontFamily: "var(--font-mono)",
            background: loading ? "var(--bg-tertiary)" : "rgba(16, 185, 129, 0.15)",
            color: "#10B981",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          Try it
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-2 text-xs px-3 py-2 rounded" style={{ background: "rgba(220, 38, 38, 0.1)", color: "#ef4444" }}>
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="mt-2 relative">
          <div className="absolute top-2 right-2 flex gap-1">
            <button
              onClick={handleCopy}
              className="p-1 rounded hover:bg-white/10"
              title="Copy"
            >
              {copied ? <Check size={12} style={{ color: "#10B981" }} /> : <Copy size={12} style={{ color: "var(--text-tertiary)" }} />}
            </button>
            <button
              onClick={() => { setResult(null); setError(""); }}
              className="p-1 rounded hover:bg-white/10"
              title="Close"
            >
              <X size={12} style={{ color: "var(--text-tertiary)" }} />
            </button>
          </div>
          <pre
            className="text-xs p-3 rounded-lg overflow-x-auto max-h-80 overflow-y-auto"
            style={{
              fontFamily: "var(--font-mono)",
              background: "#0d1117",
              color: "#58a6ff",
              border: "1px solid var(--border)",
            }}
          >
            {result.length > 5000 ? result.slice(0, 5000) + "\n\n... truncated" : result}
          </pre>
        </div>
      )}
    </div>
  );
}
