export const CANONICAL_TRUST_PROVIDERS = ["solana", "github", "domain", "website"] as const;
export const CANONICAL_TRUST_PROVIDER_SET = new Set<string>(CANONICAL_TRUST_PROVIDERS);
export const RETIRED_NON_VERIFYING_PROVIDERS = new Set<string>([
  "agentmail",
  "ens",
  "farcaster",
  "telegram",
]);

export function normalizeTrustProvider(platform: string | null | undefined): string {
  const normalized = String(platform || "").trim().toLowerCase();
  return normalized === "solana_wallet" ? "solana" : normalized;
}

export function isCanonicalTrustProvider(platform: string | null | undefined): boolean {
  return CANONICAL_TRUST_PROVIDER_SET.has(normalizeTrustProvider(platform));
}

export function isRetiredNonVerifyingProvider(platform: string | null | undefined): boolean {
  return RETIRED_NON_VERIFYING_PROVIDERS.has(normalizeTrustProvider(platform));
}
