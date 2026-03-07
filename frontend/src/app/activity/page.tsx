import { getActivityFeed, getAllAgents } from "@/lib/data";

export const dynamic = "force-dynamic";

export default function ActivityPage() {
  const activities = getActivityFeed();
  const agents = getAllAgents();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
          Activity Feed
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-tertiary)" }}>
          Recent platform activity
        </p>
      </div>

      <div className="space-y-3">
        {activities.map((a, i) => (
          <div
            key={i}
            className="rounded-lg p-4 flex items-center gap-4"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
          >
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
              style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
              {a.agent.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
              <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: "13px" }}>
                {a.agent}
              </span>{" "}
              <span style={{ color: "var(--text-tertiary)", fontSize: "13px" }}>{a.action}</span>
            </div>
            <span style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: "11px" }}>
              {a.time}
            </span>
          </div>
        ))}

        {activities.length === 0 && (
          <div className="text-center py-12" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" }}>
            No recent activity
          </div>
        )}
      </div>

      {/* Recent Registrations */}
      <div className="mt-10">
        <h2 className="text-lg font-bold mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
          Recently Registered
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {agents.slice(0, 6).map((agent) => (
            <a
              key={agent.id}
              href={`/profile/${agent.id}`}
              className="rounded-lg p-4 transition-all hover:bg-[var(--bg-tertiary)]"
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", textDecoration: "none" }}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)" }}>
                  {agent.name.charAt(0)}
                </div>
                <div>
                  <div style={{ color: "var(--text-primary)", fontSize: "13px", fontFamily: "var(--font-mono)" }}>{agent.name}</div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: "11px" }}>Score: {agent.trustScore}</div>
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
