const DEFAULT_PUBLIC_HOST = "agentfolio.bot";

const PUBLIC_FRONTEND_HOSTS = new Set([
  "agentfolio.bot",
  "www.agentfolio.bot",
  "staging.agentfolio.bot",
  "satp.bot",
  "www.satp.bot",
]);

function normalizeHost(value) {
  if (!value || typeof value !== "string") return null;
  const first = value.split(",", 1)[0].trim().toLowerCase();
  if (!first) return null;
  if (first.startsWith("[")) {
    const closingBracket = first.indexOf("]");
    return closingBracket === -1 ? null : first.slice(0, closingBracket + 1);
  }
  return first.split(":", 1)[0];
}

export function resolveSiteHost(forwardedHost, host) {
  const candidate = normalizeHost(forwardedHost) || normalizeHost(host);
  return candidate && PUBLIC_FRONTEND_HOSTS.has(candidate)
    ? candidate
    : DEFAULT_PUBLIC_HOST;
}

export function resolveSiteOrigin(forwardedHost, host) {
  return `https://${resolveSiteHost(forwardedHost, host)}`;
}
