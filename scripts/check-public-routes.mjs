const DEFAULT_BASE_URL = 'https://agentfolio.bot';

const routes = [
  { label: 'marketplace', path: '/marketplace' },
  { label: 'profile by handle', path: '/profile/braintest007' },
  { label: 'profile by agent id', path: '/profile/agent_braintest007' },
  { label: 'stats', path: '/stats' },
  { label: 'SATP overview', path: '/satp' },
  { label: 'SATP explorer', path: '/satp/explorer' },
  { label: 'verify', path: '/verify' },
  { label: 'launch', path: '/launch' },
  { label: 'leaderboard', path: '/leaderboard' },
];

const baseUrl = (process.env.AGENTFOLIO_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
const timestamp = new Date().toISOString();
const timeoutMs = Number(process.env.AGENTFOLIO_ROUTE_TIMEOUT_MS || 15000);

console.log(`AgentFolio public route sweep`);
console.log(`UTC timestamp: ${timestamp}`);
console.log(`Base URL: ${baseUrl}`);

const failures = [];

for (const route of routes) {
  const url = new URL(route.path, `${baseUrl}/`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'user-agent': 'agentfolio-public-route-sweep/1.0',
      },
      signal: controller.signal,
    });
    const body = await response.text();
    const finalUrl = response.url || url.toString();
    const statusLine = [
      response.status,
      response.statusText,
      route.label,
      url.toString(),
      finalUrl === url.toString() ? '' : `final=${finalUrl}`,
      `bytes=${body.length}`,
    ].filter(Boolean).join(' | ');
    console.log(statusLine);

    if (response.status >= 400) {
      failures.push(`${route.label}: HTTP ${response.status} at ${url.toString()}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`ERROR | ${route.label} | ${url.toString()} | ${message}`);
    failures.push(`${route.label}: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

if (failures.length) {
  console.error('Route sweep failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Route sweep passed: all checked public routes returned non-error responses.');
