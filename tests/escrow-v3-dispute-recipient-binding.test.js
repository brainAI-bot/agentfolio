const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_PATH = path.resolve(__dirname, '..', 'onchain/escrow_v3/programs/escrow_v3/src/lib.rs');

function indexOfRequiredPattern(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `${label} guard missing`);
  return match.index;
}

test('resolve_dispute binds agent and client recipients before escrow transfers', () => {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const resolveStart = source.indexOf('pub fn resolve_dispute');
  const resolveEnd = source.indexOf('pub fn extend_deadline');

  assert.notEqual(resolveStart, -1);
  assert.notEqual(resolveEnd, -1);

  const resolveDispute = source.slice(resolveStart, resolveEnd);
  const firstTransfer = resolveDispute.indexOf('transfer_from_escrow(');
  const agentBindingIndex = indexOfRequiredPattern(
    resolveDispute,
    /require_keys_eq!\(\s*escrow\.agent,\s*ctx\.accounts\.agent\.key\(\),\s*EscrowError::WrongAgent\s*\)/,
    'agent recipient',
  );
  const clientBindingIndex = indexOfRequiredPattern(
    resolveDispute,
    /require_keys_eq!\(\s*escrow\.client,\s*ctx\.accounts\.client\.key\(\),\s*EscrowError::Unauthorized\s*\)/,
    'client recipient',
  );

  assert.notEqual(firstTransfer, -1);
  assert.ok(agentBindingIndex < firstTransfer);
  assert.ok(clientBindingIndex < firstTransfer);
});
