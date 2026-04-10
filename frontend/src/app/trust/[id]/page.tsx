import Link from "next/link";
import { notFound } from "next/navigation";

const API_BASE =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.PUBLIC_SITE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "http://127.0.0.1:3333";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

async function fetchCredential(id: string) {
  const [jsonRes, jwtRes] = await Promise.all([
    fetch(`${API_BASE}/api/trust-credential/${encodeURIComponent(id)}?format=json`, {
      next: { revalidate: 30 },
    }),
    fetch(`${API_BASE}/api/trust-credential/${encodeURIComponent(id)}`, {
      next: { revalidate: 30 },
    }),
  ]);

  if (!jsonRes.ok) return null;
  const jsonData = await jsonRes.json();
  let jwtData = null;
  try {
    if (jwtRes.ok) jwtData = await jwtRes.json();
  } catch {}
  return {
    ...jsonData,
    jwt: typeof jwtData?.credential === "string" ? jwtData.credential : null,
  };
}

function scoreColor(level: number) {
  if (level >= 4) return "#F59E0B";
  if (level >= 3) return "#10B981";
  if (level >= 2) return "#3B82F6";
  if (level >= 1) return "#EAB308";
  return "#94A3B8";
}

function prettyLabel(key: string) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^./, (s) => s.toUpperCase());
}

export default async function TrustCredentialPage({ params }: PageProps) {
  const { id } = await params;
  const data = await fetchCredential(id);
  if (!data) notFound();

  const decoded = data?.decoded || {};
  const subject = decoded?.credentialSubject || {};
  const breakdown = subject?.breakdown || {};
  const verificationLevel = Number(subject?.verificationLevel || 0);
  const trustScore = Number(subject?.trustScore || 0);
  const tier = subject?.tier || "UNVERIFIED";
  const proofColor = scoreColor(verificationLevel);
  const rawJson = JSON.stringify(decoded, null, 2);
  const rawEndpoint = `/api/trust-credential/${encodeURIComponent(id)}?format=json`;
  const verifyEndpoint = data?.jwt
    ? `/api/trust-credential/verify?token=${encodeURIComponent(data.jwt)}`
    : `/api/trust-credential/${encodeURIComponent(id)}`;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="rounded-lg p-6 mb-6" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-widest mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
              Verifiable Trust Credential
            </div>
            <h1 className="text-2xl font-bold mb-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              {subject?.name || id}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="px-2 py-1 rounded text-[11px] font-bold tracking-widest" style={{ fontFamily: "var(--font-mono)", background: `${proofColor}20`, color: proofColor, border: `1px solid ${proofColor}40` }}>
                L{verificationLevel} · {tier}
              </span>
              <span className="font-semibold" style={{ fontFamily: "var(--font-mono)", color: proofColor }}>
                {trustScore} Trust
              </span>
              <Link href={`/profile/${id}`} className="text-sm hover:underline" style={{ color: "var(--accent)" }}>
                View profile →
              </Link>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <a href={rawEndpoint} target="_blank" rel="noopener noreferrer" className="px-3 py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wider" style={{ fontFamily: "var(--font-mono)", background: "var(--accent)", color: "#fff" }}>
              Raw JSON ↗
            </a>
            <a href={verifyEndpoint} target="_blank" rel="noopener noreferrer" className="px-3 py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wider" style={{ fontFamily: "var(--font-mono)", background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
              Verify JWT ↗
            </a>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="rounded-lg p-5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              Credential Summary
            </h2>
            <div className="space-y-3 text-sm" style={{ fontFamily: "var(--font-mono)" }}>
              <div className="flex justify-between gap-3"><span style={{ color: "var(--text-tertiary)" }}>Agent ID</span><span style={{ color: "var(--text-primary)" }}>{subject?.agentId || id}</span></div>
              <div className="flex justify-between gap-3"><span style={{ color: "var(--text-tertiary)" }}>Issuer</span><span style={{ color: "var(--text-primary)" }}>{decoded?.issuer?.name || data?.issuer || "AgentFolio"}</span></div>
              <div className="flex justify-between gap-3"><span style={{ color: "var(--text-tertiary)" }}>Issued</span><span style={{ color: "var(--text-primary)" }}>{decoded?.issuanceDate ? new Date(decoded.issuanceDate).toLocaleString("en-GB") : "-"}</span></div>
              <div className="flex justify-between gap-3"><span style={{ color: "var(--text-tertiary)" }}>Expires</span><span style={{ color: "var(--text-primary)" }}>{decoded?.expirationDate ? new Date(decoded.expirationDate).toLocaleString("en-GB") : "-"}</span></div>
              <div className="flex justify-between gap-3"><span style={{ color: "var(--text-tertiary)" }}>Score version</span><span style={{ color: "var(--text-primary)" }}>{subject?.scoreVersion || "-"}</span></div>
              <div className="flex justify-between gap-3"><span style={{ color: "var(--text-tertiary)" }}>Verification count</span><span style={{ color: "var(--text-primary)" }}>{subject?.verificationCount ?? 0}</span></div>
            </div>
          </div>

          <div className="rounded-lg p-5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              Trust Breakdown
            </h2>
            <div className="space-y-3">
              {Object.keys(breakdown).length > 0 ? Object.entries(breakdown).map(([key, value]) => {
                const numeric = Number(value || 0);
                const width = Math.max(0, Math.min(100, trustScore > 0 ? (numeric / trustScore) * 100 : 0));
                return (
                  <div key={key}>
                    <div className="flex justify-between text-[11px] mb-1" style={{ fontFamily: "var(--font-mono)" }}>
                      <span style={{ color: "var(--text-secondary)" }}>{prettyLabel(key)}</span>
                      <span style={{ color: "var(--text-primary)" }}>{numeric}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-tertiary)" }}>
                      <div className="h-full rounded-full" style={{ width: `${width}%`, background: proofColor }} />
                    </div>
                  </div>
                );
              }) : <div className="text-sm" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>No breakdown available</div>}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="rounded-lg p-5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                Decoded Credential Payload
              </h2>
              <span className="text-[10px] uppercase tracking-widest" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                W3C VC JWT
              </span>
            </div>
            <pre className="text-xs leading-relaxed overflow-x-auto p-4 rounded-lg" style={{ fontFamily: "var(--font-mono)", background: "var(--bg-primary)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
              {rawJson}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
