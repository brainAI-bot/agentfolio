const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function readSource(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

describe('P1-F1 verification provider contract', () => {
  it('keeps /api/health limited to real surfaced providers', () => {
    const source = readSource('src/server.js');
    const routeStart = source.indexOf("app.get('/api/health'");
    const routeEnd = source.indexOf('// Discord verification endpoints', routeStart);
    const route = source.slice(routeStart, routeEnd);

    assert.notStrictEqual(routeStart, -1, 'expected /api/health route');
    assert.match(route, /const providers = \['solana', 'github'\]/);
    assert.match(route, /if \(domainVerifyLoaded\) providers\.push\('domain'\)/);
    assert.match(route, /if \(websiteVerifyLoaded\) providers\.push\('website'\)/);

    for (const provider of ['agentmail', 'telegram', 'discord', 'ens', 'farcaster']) {
      assert.ok(!route.includes(provider), `/api/health must not advertise ${provider}`);
    }
  });

  it('does not surface disabled verification providers on the verify page', () => {
    const source = readSource('frontend/src/app/verify/page.tsx');
    const arrayStart = source.indexOf('const verificationTypes = [');
    const arrayEnd = source.indexOf('return (', arrayStart);
    const verifyPageConfig = source.slice(arrayStart, arrayEnd);

    assert.match(
      verifyPageConfig,
      /\.filter\(\(\{ type \}\) => \["solana", "github", "domain", "website"\]\.includes\(type\)\)/,
    );
  });

  it('keeps ETH signature verification persisted through profileStore.addVerification', () => {
    const source = readSource('src/server.js');
    const ethSource = readSource('src/lib/eth-verify-hardened.js');
    const handlerStart = source.indexOf('function handleEthVerificationVerify');
    const handlerEnd = source.indexOf("app.post('/api/verification/eth/initiate'", handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);

    assert.notStrictEqual(handlerStart, -1, 'expected ETH verification handler');
    assert.match(handler, /const result = await ethVerify\.verifySignature\(challengeId, signature\)/);
    assert.match(handler, /if \(result\?\.verified\)/);
    assert.match(handler, /profileStore\.addVerification\(result\.profileId, 'ethereum', result\.walletAddress/);
    assert.match(source, /const ethVerificationLimiter = rateLimit\(/);
    assert.match(source, /app\.post\('\/api\/verify\/eth\/verify', ethVerificationLimiter, handleEthVerificationVerify\)/);
    assert.match(ethSource, /recoverSignedAddress\(challenge\.message, signature\)/);
    assert.match(ethSource, /recoveredAddress\.toLowerCase\(\) !== walletAddress\.toLowerCase\(\)/);
    assert.doesNotMatch(ethSource, /For MVP: accept the signature/);
  });
});
