const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packetPath = path.join(
  root,
  'docs/operational/AGENTFOLIO-FEE-ROUTING-MAINNET-CHANGE-CONTROL-011685D4-20260825.md',
);
const sourcePath = path.join(root, 'onchain/escrow_v3/programs/escrow_v3/src/lib.rs');
const candidateIdlPath = path.join(root, 'onchain/escrow_v3/target/idl/escrow_v3.json');
const certifiedIdlPath = path.join(
  root,
  'third_party/satp/93fc6c0d/idls/v3/escrow_v3.json',
);

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function instructionMap(idl) {
  return new Map(idl.instructions.map((instruction) => [instruction.name, instruction]));
}

test('packet pins the audited candidate and certified IDL hashes', () => {
  assert.equal(
    sha256(sourcePath),
    'a713fb25815f724bde8bc0ed9eec0c104826fc0fb26bd3f608a6ed46096efd4c',
  );
  assert.equal(
    sha256(candidateIdlPath),
    '19ab1ae26b274499d1d014b69b318a49467189085c35cd51ef52b10dbece1262',
  );
  assert.equal(
    sha256(certifiedIdlPath),
    'e8c142f27e225d8edc2f8f41e6fb698ebbb73f69d2fc078d5bf963234ebc8fa9',
  );
});

test('packet fails closed because the tracked candidate removes live USDC surfaces', () => {
  const certified = require(certifiedIdlPath);
  const candidate = require(candidateIdlPath);
  const certifiedNames = certified.instructions.map(({ name }) => name);
  const candidateNames = candidate.instructions.map(({ name }) => name);
  const missing = certifiedNames.filter((name) => !candidateNames.includes(name));

  assert.equal(certifiedNames.length, 14);
  assert.equal(candidateNames.length, 9);
  assert.deepEqual(missing.sort(), [
    'cancel_usdc',
    'create_usdc_escrow',
    'partial_release_usdc',
    'release_usdc',
    'resolve_dispute_usdc',
  ]);

  const packet = fs.readFileSync(packetPath, 'utf8');
  assert.match(packet, /Status: \*\*NO-GO for execution; audited preparation only\.\*\*/);
  assert.match(packet, /current-agentfolio-candidate: NO-GO/);
  assert.match(packet, /must start at SATP commit\s+`93fc6c0d86302cfe8b0d8c798ba2817d7eeace44`/);
});

test('tracked fee reference binds both SOL routes to the immutable treasury', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const candidate = instructionMap(require(candidateIdlPath));
  const certified = instructionMap(require(certifiedIdlPath));

  assert.match(source, /const PLATFORM_FEE_BPS: u64 = 500;/);
  assert.match(
    source,
    /const PLATFORM_TREASURY: Pubkey = pubkey!\("FriU1FEpWbdgVrTcS49YV5mVv2oqN6poaVQjzq2BS5be"\);/,
  );
  assert.equal(source.match(/require_keys_eq!\(ctx\.accounts\.treasury\.key\(\), PLATFORM_TREASURY/g).length, 2);

  for (const route of ['release', 'partial_release']) {
    assert.deepEqual(
      certified.get(route).accounts.map(({ name }) => name),
      ['escrow', 'client', 'agent'],
    );
    assert.deepEqual(
      candidate.get(route).accounts.map(({ name }) => name),
      ['escrow', 'client', 'agent', 'treasury'],
    );
    assert.equal(candidate.get(route).accounts.find(({ name }) => name === 'treasury').writable, true);
  }
});

test('packet requires preservation, approval, rollback, and bounded proof gates', () => {
  const packet = fs.readFileSync(packetPath, 'utf8');

  for (const required of [
    'Preserve all five USDC instructions',
    '--no-auto-extend',
    'independent brainShield verdict',
    'rollback dump is `346841` bytes',
    'treasury_delta = floor(gross * 500 / 10000)',
    'program-upgrade: not performed',
    'roadmap-change: not performed',
  ]) {
    assert.ok(packet.includes(required), `packet is missing required gate: ${required}`);
  }
});
