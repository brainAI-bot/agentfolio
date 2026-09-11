import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nextBin = path.join(frontendRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const port = Number(process.env.MARKETPLACE_SSR_TEST_PORT || 3199);
assert.ok(Number.isInteger(port) && port > 0 && port < 65536, 'MARKETPLACE_SSR_TEST_PORT must be a valid port');

const server = spawn(process.execPath, [nextBin, 'start', '-p', String(port)], {
  cwd: frontendRoot,
  env: { ...process.env, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', (chunk) => {
    serverLog = `${serverLog}${chunk}`.slice(-8000);
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function fetchMarketplace() {
  const deadline = Date.now() + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Next.js exited before serving /marketplace\n${serverLog}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/marketplace`);
      if (response.ok) return { response, html: await response.text() };
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for /marketplace: ${lastError?.message || 'unknown error'}\n${serverLog}`);
}

async function stopServer() {
  if (server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    delay(3000).then(() => {
      if (server.exitCode === null) server.kill('SIGKILL');
    }),
  ]);
}

try {
  const { response, html } = await fetchMarketplace();
  const postJobCount = html.split('Post a Job').length - 1;
  const fixedPriceCount = html.split('fixed-price SOL only').length - 1;
  assert.ok(postJobCount > 0, 'server-rendered /marketplace HTML must contain Post a Job');
  assert.ok(fixedPriceCount > 0, 'server-rendered /marketplace HTML must preserve fixed-price SOL only truth');
  console.log(`marketplace-ssr: status=${response.status}; bytes=${Buffer.byteLength(html)}; post_a_job=${postJobCount}; fixed_price_sol_only=${fixedPriceCount}`);
} finally {
  await stopServer();
}
