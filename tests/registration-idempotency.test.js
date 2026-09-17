const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeRegistrationHandle,
  findExistingWalletHandleProfile,
} = require('../src/lib/registration-idempotency');

test('same verified wallet and normalized handle resolves to one active profile', () => {
  let capturedSql = '';
  let capturedParams = [];
  const db = {
    prepare(sql) {
      capturedSql = sql;
      return {
        get(...params) {
          capturedParams = params;
          return params[0] === 'wallet-a' && params[1] === 'liberty_agent_settlement'
            ? { id: 'agent_original' }
            : undefined;
        },
      };
    },
  };

  assert.equal(normalizeRegistrationHandle(' @Liberty_Agent_Settlement '), 'liberty_agent_settlement');
  assert.deepEqual(
    findExistingWalletHandleProfile(db, 'wallet-a', 'liberty_agent_settlement'),
    { id: 'agent_original' },
  );
  assert.deepEqual(capturedParams, ['wallet-a', 'liberty_agent_settlement']);
  assert.match(capturedSql, /WHERE wallet = \?/);
  assert.match(capturedSql, /LOWER\(LTRIM\(TRIM\(handle\), '@'\)\) = \?/);
  assert.match(capturedSql, /status IS NULL OR LOWER\(status\) = 'active'/);
  assert.equal(findExistingWalletHandleProfile(db, 'wallet-a', 'legitimate_second_agent'), null);
  assert.equal(findExistingWalletHandleProfile(db, 'wallet-b', 'liberty_agent_settlement'), null);
  assert.equal(findExistingWalletHandleProfile(db, '', 'liberty_agent_settlement'), null);
  assert.equal(findExistingWalletHandleProfile(db, 'wallet-a', ''), null);
});

test('registration route exits idempotently before inserting or emitting side effects', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'profile-store.js'), 'utf8');
  const lookup = source.indexOf('const existingRegistration = findExistingWalletHandleProfile');
  const insert = source.indexOf('d.prepare(`INSERT INTO profiles');
  const jsonWrite = source.indexOf('writeJsonAtomicSync(path.join(profilesDir');

  assert.ok(lookup > 0);
  assert.ok(lookup < insert);
  assert.ok(insert < jsonWrite);
  assert.match(source, /app\.post\('\/api\/register', registrationWriteLimiter,/);
  assert.match(source.slice(lookup, insert), /alreadyRegistered: true/);
  assert.match(source.slice(lookup, insert), /return res\.status\(200\)/);
});