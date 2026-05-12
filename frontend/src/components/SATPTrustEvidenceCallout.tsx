import { CheckCircle2, ExternalLink, ShieldCheck } from "lucide-react";

type EvidenceLink = {
  label: string;
  href: string;
  external?: boolean;
};

type SATPTrustEvidenceCalloutProps = {
  agentId: string;
  walletAddress?: string | null;
  did?: string | null;
  chainAttestationCount?: number;
  onChainReviewCount?: number;
  credentialHref?: string;
  rawCredentialHref?: string;
  verifyCredentialHref?: string | null;
  compact?: boolean;
};

function shortValue(value?: string | null) {
  if (!value) return null;
  if (value.startsWith("did:")) return value.length > 30 ? `${value.slice(0, 27)}...` : value;
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

export function SATPTrustEvidenceCallout({
  agentId,
  walletAddress,
  did,
  chainAttestationCount = 0,
  onChainReviewCount = 0,
  credentialHref,
  rawCredentialHref,
  verifyCredentialHref,
  compact = false,
}: SATPTrustEvidenceCalloutProps) {
  const links: EvidenceLink[] = [
    { label: "SATP Explorer", href: `/satp/explorer?agent=${encodeURIComponent(agentId)}` },
  ];

  if (credentialHref) links.push({ label: "Trust credential", href: credentialHref });
  if (rawCredentialHref) links.push({ label: "Raw JSON", href: rawCredentialHref, external: true });
  if (verifyCredentialHref) links.push({ label: "Verify JWT", href: verifyCredentialHref, external: true });
  if (walletAddress) {
    links.push({
      label: "Solana evidence",
      href: `https://explorer.solana.com/address/${walletAddress}`,
      external: true,
    });
  }

  const proofItems = [
    `${chainAttestationCount} chain attestation${chainAttestationCount === 1 ? "" : "s"}`,
    `${onChainReviewCount} on-chain review${onChainReviewCount === 1 ? "" : "s"}`,
    walletAddress ? `wallet ${shortValue(walletAddress)}` : null,
    did ? `DID ${shortValue(did)}` : null,
  ].filter(Boolean);

  return (
    <div
      className={`rounded-lg ${compact ? "p-4" : "p-5"}`}
      style={{
        background: "linear-gradient(135deg, rgba(63,185,80,0.10), rgba(153,69,255,0.08))",
        border: "1px solid rgba(63,185,80,0.28)",
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck size={16} style={{ color: "var(--success)" }} />
            <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
              SATP Trust Evidence
            </h2>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            This profile links its trust score to SATP evidence surfaced from existing AgentFolio APIs: verifiable credentials,
            chain attestations, and Solana-backed review proofs.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {proofItems.length > 0 ? proofItems.map((item) => (
              <span key={item} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px]" style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)" }}>
                <CheckCircle2 size={11} style={{ color: "var(--success)" }} /> {item}
              </span>
            )) : (
              <span className="text-[11px]" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                Evidence links are ready; no on-chain proofs returned yet.
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          {links.map((link) => (
            <a
              key={`${link.label}:${link.href}`}
              href={link.href}
              target={link.external ? "_blank" : undefined}
              rel={link.external ? "noopener noreferrer" : undefined}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-wider"
              style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)", background: "var(--bg-primary)", border: "1px solid var(--border)", textDecoration: "none" }}
            >
              {link.label} <ExternalLink size={11} />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
