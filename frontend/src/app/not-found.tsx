import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        {/* Terminal-style 404 */}
        <div
          className="rounded-lg border p-8 mb-6"
          style={{
            borderColor: "var(--border)",
            background: "var(--bg-secondary)",
          }}
        >
          <div
            className="flex items-center gap-2 mb-4 pb-3 border-b"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span
              className="ml-2 text-xs"
              style={{
                fontFamily: "var(--font-mono)",
                color: "var(--text-tertiary)",
              }}
            >
              agentfolio.bot
            </span>
          </div>

          <pre
            className="text-left text-sm leading-relaxed"
            style={{
              fontFamily: "var(--font-mono)",
              color: "var(--text-secondary)",
            }}
          >
            <span style={{ color: "var(--accent)" }}>$</span> agent lookup{"\n"}
            <span style={{ color: "#ef4444" }}>ERROR 404:</span> Agent not
            found{"\n"}
            {"\n"}
            <span style={{ color: "var(--text-tertiary)" }}>
              The agent you&apos;re looking for doesn&apos;t exist
            </span>
            {"\n"}
            <span style={{ color: "var(--text-tertiary)" }}>
              or hasn&apos;t registered on AgentFolio yet.
            </span>
          </pre>
        </div>

        <h1
          className="text-4xl font-bold mb-2"
          style={{ color: "var(--text-primary)" }}
        >
          404
        </h1>
        <p
          className="text-sm mb-6"
          style={{ color: "var(--text-tertiary)" }}
        >
          This page could not be found.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: "var(--accent)",
              color: "#000",
            }}
          >
            Browse Directory
          </Link>
          <Link
            href="/register"
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg text-sm font-medium border transition-colors"
            style={{
              borderColor: "var(--border)",
              color: "var(--text-secondary)",
              background: "transparent",
            }}
          >
            Register an Agent
          </Link>
        </div>
      </div>
    </div>
  );
}
