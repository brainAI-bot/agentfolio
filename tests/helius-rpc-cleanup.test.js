const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const routeSource = fs.readFileSync(
  path.join(ROOT, 'frontend', 'src', 'app', 'solana-rpc', 'route.ts'),
  'utf8'
);
const statsSource = fs.readFileSync(
  path.join(ROOT, 'frontend', 'src', 'app', 'stats', 'page.tsx'),
  'utf8'
);
const envExampleSource = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');

test('/solana-rpc prefers Helius server-side config before public Solana fallback', () => {
  const precedence = [
    'process.env.HELIUS_RPC_URL',
    'process.env.HELIUS_API_KEY',
    'process.env.SOLANA_RPC_URL',
    'process.env.NEXT_PUBLIC_SOLANA_RPC_URL',
    'DEFAULT_SOLANA_RPC_URL',
  ];
  const resolverBody = routeSource.slice(routeSource.indexOf('function getSolanaRpcUpstreamUrl()'));

  for (const marker of precedence) {
    assert.notEqual(resolverBody.indexOf(marker), -1, `${marker} should be wired in route`);
  }

  const indexes = precedence.map((marker) => resolverBody.indexOf(marker));
  assert.deepEqual([...indexes].sort((a, b) => a - b), indexes, 'RPC env precedence changed');
  assert.match(routeSource, /mainnet\.helius-rpc\.com/);
  assert.match(routeSource, /encodeURIComponent\(trimmed\)/);
  assert.match(routeSource, /X-AgentFolio-RPC-Provider/);
});

test('/solana-rpc does not expose configured upstream URLs in error responses', () => {
  assert.doesNotMatch(routeSource, /NextResponse\.json\(\{\s*error:\s*e\?\.message/);
  assert.match(routeSource, /Invalid Solana RPC upstream URL/);
  assert.match(routeSource, /RPC proxy failed/);
});

test('stats Solana reads use the application RPC proxy', () => {
  assert.match(statsSource, /const SOLANA_RPC_URL = `\$\{API_BASE \|\| SITE_URL\}\/solana-rpc`/);
  assert.doesNotMatch(statsSource, /fetch\('https:\/\/api\.mainnet-beta\.solana\.com'/);
  assert.match(statsSource, /fetch\(SOLANA_RPC_URL,/);
});

test('env example documents Helius URL and key options without hardcoded credentials', () => {
  assert.match(envExampleSource, /^HELIUS_RPC_URL=$/m);
  assert.match(envExampleSource, /^HELIUS_API_KEY=$/m);
  assert.doesNotMatch(envExampleSource, /api-key=[A-Za-z0-9_-]+/);
});
