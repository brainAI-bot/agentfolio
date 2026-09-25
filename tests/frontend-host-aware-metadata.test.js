const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const helperUrl = pathToFileURL(
  path.resolve(__dirname, '../frontend/src/lib/site-origin.mjs')
).href;

describe('shared frontend request origin', () => {
  it('keeps AgentFolio metadata on the AgentFolio host', async () => {
    const { resolveSiteOrigin } = await import(helperUrl);
    assert.equal(resolveSiteOrigin('agentfolio.bot', null), 'https://agentfolio.bot');
  });

  it('keeps SATP metadata and og.png on the SATP host', async () => {
    const { resolveSiteOrigin } = await import(helperUrl);
    assert.equal(resolveSiteOrigin('satp.bot', 'agentfolio.bot'), 'https://satp.bot');
  });

  it('fails closed to AgentFolio for an untrusted Host header', async () => {
    const { resolveSiteOrigin } = await import(helperUrl);
    assert.equal(resolveSiteOrigin('attacker.example', 'attacker.example'), 'https://agentfolio.bot');
  });

  it('normalizes proxy lists and ports before allowlisting', async () => {
    const { resolveSiteOrigin } = await import(helperUrl);
    assert.equal(resolveSiteOrigin('SATP.BOT:443, proxy.internal', null), 'https://satp.bot');
  });
});
