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

test('/solana-rpc requires explicit Helius opt-in before using Helius credentials', () => {
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
  assert.match(routeSource, /const HELIUS_PROXY_OPT_IN_ENV = "SOLANA_RPC_PROXY_HELIUS_OPT_IN";/);
  assert.match(routeSource, /process\.env\[HELIUS_PROXY_OPT_IN_ENV\]/);
  assert.match(routeSource, /isHeliusProxyOptedIn\(\) \? buildHeliusRpcUrlFromKey\(process\.env\.HELIUS_API_KEY\) : undefined/);
  assert.match(routeSource, /useConfiguredRpcUrl\(cleanEnv\(process\.env\.SOLANA_RPC_URL\)\)/);
  assert.match(routeSource, /mainnet\.helius-rpc\.com/);
  assert.match(routeSource, /encodeURIComponent\(trimmed\)/);
  assert.match(routeSource, /X-AgentFolio-RPC-Provider/);
});

test('/solana-rpc does not expose configured upstream URLs in error responses', () => {
  assert.doesNotMatch(routeSource, /NextResponse\.json\(\{\s*error:\s*e\?\.message/);
  assert.match(routeSource, /Invalid Solana RPC upstream URL/);
  assert.match(routeSource, /RPC proxy failed/);
});

test('/solana-rpc labels Helius only after parsed hostname validation', () => {
  assert.doesNotMatch(routeSource, /upstreamUrl\.includes\(["']helius-rpc\.com["']\)/);
  assert.match(routeSource, /parsedUpstream\.hostname/);

  const hostConstMatch = routeSource.match(/const HELIUS_RPC_HOST = "helius-rpc\.com";/);
  const hostHelperMatch = routeSource.match(/function isHeliusRpcHost[\s\S]+?\n}/);
  const labelHelperMatch = routeSource.match(/function getRpcProviderLabel[\s\S]+?\n}/);
  assert.ok(hostConstMatch, 'Helius host constant should be present');
  assert.ok(hostHelperMatch, 'Helius host helper should be present');
  assert.ok(labelHelperMatch, 'provider label helper should be present');

  const helperSource = `${hostConstMatch[0]}\n${hostHelperMatch[0]}\n${labelHelperMatch[0]}`
    .replace(/: string/g, '')
    .replace(/: URL/g, '');
  const { getRpcProviderLabel } = new Function(`${helperSource}; return { getRpcProviderLabel };`)();

  assert.equal(getRpcProviderLabel(new URL('https://mainnet.helius-rpc.com/')), 'helius');
  assert.equal(getRpcProviderLabel(new URL('https://helius-rpc.com/')), 'helius');
  assert.equal(
    getRpcProviderLabel(new URL('https://helius-rpc.com.evil.example/rpc')),
    'solana-rpc'
  );
  assert.equal(
    getRpcProviderLabel(new URL('https://evil.example/helius-rpc.com')),
    'solana-rpc'
  );
});

test('/solana-rpc has public proxy abuse controls', () => {
  assert.match(routeSource, /const MAX_RPC_BODY_BYTES = 64 \* 1024;/);
  assert.match(routeSource, /const MAX_RPC_BATCH_SIZE = 10;/);
  assert.match(routeSource, /const RPC_RATE_LIMIT_WINDOW_MS = 60_000;/);
  assert.match(routeSource, /const RPC_RATE_LIMIT_MAX_REQUESTS = 60;/);
  assert.match(routeSource, /const ALLOWED_SOLANA_RPC_METHODS = new Set\(\[/);
  assert.match(routeSource, /function validateRpcBody/);
  assert.match(routeSource, /ALLOWED_SOLANA_RPC_METHODS\.has\(request\.method\)/);
  assert.match(routeSource, /function enforceRateLimit/);
  assert.match(routeSource, /status: 429/);
  assert.match(routeSource, /"Retry-After"/);

  const allowListMatch = routeSource.match(/const ALLOWED_SOLANA_RPC_METHODS = new Set\(\[([\s\S]+?)\]\);/);
  assert.ok(allowListMatch, 'allow-list should be declared as a static set');
  const allowedMethods = [...allowListMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);

  assert.ok(allowedMethods.includes('getLatestBlockhash'), 'frontend blockhash reads should work');
  assert.ok(allowedMethods.includes('simulateTransaction'), 'wallet preflight simulation should remain wired');
  assert.ok(!allowedMethods.includes('sendTransaction'), 'public proxy should not relay writes');
  assert.ok(!allowedMethods.includes('getAsset'), 'DAS reads should not be exposed by default');
  assert.ok(!allowedMethods.includes('searchAssets'), 'DAS search should not be exposed by default');
});

test('stats Solana reads use the application RPC proxy', () => {
  assert.match(statsSource, /const SOLANA_RPC_URL = `\$\{API_BASE \|\| SITE_URL\}\/solana-rpc`/);
  assert.doesNotMatch(statsSource, /fetch\('https:\/\/api\.mainnet-beta\.solana\.com'/);
  assert.match(statsSource, /fetch\(SOLANA_RPC_URL,/);
});

test('env example documents Helius URL and key options without hardcoded credentials', () => {
  assert.match(envExampleSource, /^SOLANA_RPC_PROXY_HELIUS_OPT_IN=false$/m);
  assert.match(envExampleSource, /^HELIUS_RPC_URL=$/m);
  assert.match(envExampleSource, /^HELIUS_API_KEY=$/m);
  assert.doesNotMatch(envExampleSource, /api-key=[A-Za-z0-9_-]+/);
});
