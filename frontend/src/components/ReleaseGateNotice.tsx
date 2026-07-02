import { AlertTriangle } from "lucide-react";

const RELEASE_GATE_COPY =
  "No completion banner is present. Escrow live-funds writes and token launch claims remain gated pending security re-review.";

export function ReleaseGateNotice() {
  return (
    <div
      className="border-b"
      style={{
        background: "rgba(245,158,11,0.08)",
        borderColor: "rgba(245,158,11,0.22)",
      }}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2 text-xs sm:px-6 lg:px-8">
        <AlertTriangle size={14} aria-hidden="true" style={{ color: "#f59e0b", flex: "0 0 auto" }} />
        <span className="font-semibold uppercase tracking-wider" style={{ color: "#f59e0b", fontFamily: "var(--font-mono)" }}>
          Release gate
        </span>
        <span style={{ color: "var(--text-secondary)" }}>{RELEASE_GATE_COPY}</span>
      </div>
    </div>
  );
}

export { RELEASE_GATE_COPY };
