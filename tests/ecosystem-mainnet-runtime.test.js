const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('production PM2 config overrides stale host network selectors with mainnet', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-runtime-'));
  const envFile = path.join(dir, 'production.env');
  fs.writeFileSync(envFile, [
    'SATP_NETWORK=devnet',
    'SOLANA_NETWORK=devnet',
    'SATP_PLATFORM_KEYPAIR=/non-secret/test-path.json',
  ].join('\n'));

  const previous = process.env.AGENTFOLIO_ENV_FILE;
  process.env.AGENTFOLIO_ENV_FILE = envFile;
  const configPath = require.resolve('../ecosystem.config.js');
  delete require.cache[configPath];
  try {
    const config = require(configPath);
    assert.equal(config.apps[0].env.SATP_NETWORK, 'mainnet');
    assert.equal(config.apps[0].env.SOLANA_NETWORK, 'mainnet');
  } finally {
    delete require.cache[configPath];
    if (previous === undefined) delete process.env.AGENTFOLIO_ENV_FILE;
    else process.env.AGENTFOLIO_ENV_FILE = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});