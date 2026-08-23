const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  fetchPublicVerificationText,
  resolvePublicAddresses,
} = require('../src/lib/public-verification-fetch');

test('rejects a hostname when any resolved address is private', async () => {
  await assert.rejects(
    resolvePublicAddresses('127.0.0.1.nip.io', async () => [
      { address: '127.0.0.1', family: 4 },
    ]),
    /non-public address/
  );
});

test('rejects non-global IPv6 records before they can be pinned', async () => {
  for (const address of ['fec0::1', '64:ff9b:1::1']) {
    await assert.rejects(
      resolvePublicAddresses('verification.example', async () => [
        { address, family: 6 },
      ]),
      /non-public address/,
      address
    );
  }
});

test('rejects non-web ports before DNS resolution or request dispatch', async () => {
  let lookupCalled = false;
  let requestCalled = false;

  await assert.rejects(
    fetchPublicVerificationText('https://example.com:22/proof', {
      lookup: async () => {
        lookupCalled = true;
        return [{ address: '93.184.216.34', family: 4 }];
      },
      request: () => {
        requestCalled = true;
      },
    }),
    /standard web port/
  );

  assert.equal(lookupCalled, false);
  assert.equal(requestCalled, false);
});

test('pins the validated DNS result into the request lookup', async () => {
  let resolverCalls = 0;
  const lookup = async () => {
    resolverCalls += 1;
    return resolverCalls === 1
      ? [{ address: '93.184.216.34', family: 4 }]
      : [{ address: '127.0.0.1', family: 4 }];
  };

  const request = (_url, options, onResponse) => {
    const req = new EventEmitter();
    req.end = () => {
      options.lookup('rebind.example', { family: 4 }, (error, address, family) => {
        assert.ifError(error);
        assert.equal(address, '93.184.216.34');
        assert.equal(family, 4);
        const response = new EventEmitter();
        response.statusCode = 200;
        onResponse(response);
        response.emit('data', Buffer.from('token'));
        response.emit('end');
      });
    };
    req.destroy = (error) => req.emit('error', error);
    return req;
  };

  const response = await fetchPublicVerificationText('https://rebind.example/proof', { lookup, request });
  assert.equal(await response.text(), 'token');
  assert.equal(resolverCalls, 1);
});
