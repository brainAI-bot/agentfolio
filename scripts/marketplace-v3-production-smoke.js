'use strict';

const FLAG = 'AGENTFOLIO_RUN_PRODUCTION_MARKETPLACE_SMOKE';

async function runMarketplaceProductionSmoke({
  baseUrl = process.env.AGENTFOLIO_PRODUCTION_BASE_URL || 'https://agentfolio.bot',
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  if (env[FLAG] !== '1') {
    const error = new Error(`${FLAG}=1 is required; the smoke is disabled by default`);
    error.code = 'PRODUCTION_SMOKE_FLAG_REQUIRED';
    throw error;
  }
  const url = new URL('/api/marketplace/v3/smoke', baseUrl);
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
  });
  const body = await response.json();
  if (!response.ok || body.ok !== true) throw new Error(`Marketplace production smoke failed with HTTP ${response.status}`);
  if (body.liveEscrowWritesAllowed !== false || body.moneyMoved !== false || body.customerStateChanged !== false) {
    throw new Error('Marketplace production smoke did not prove read-only staged effects');
  }
  return { url: url.toString(), status: response.status, ...body };
}

if (require.main === module) {
  runMarketplaceProductionSmoke()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.code || 'PRODUCTION_SMOKE_FAILED'}: ${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = { FLAG, runMarketplaceProductionSmoke };
