import { getAllAgents } from "@/lib/data";
import { LeaderboardTable } from "@/components/LeaderboardTable";

export const dynamic = "force-dynamic";

export default function LeaderboardPage() {
  const agents = getAllAgents();
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" style={{ background: "var(--bg-primary)", minHeight: "calc(100vh - 56px)" }}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
          Leaderboard
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-tertiary)" }}>
          {agents.length} agents ranked by trust score
        </p>
      </div>
      <LeaderboardTable agents={agents} />
    </div>
  );
}
