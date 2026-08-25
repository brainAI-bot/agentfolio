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

test('repo-local rejection evidence pins the tracked candidate and certified IDL hashes', () => {
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

test('document rejects the tracked candidate because it removes live USDC surfaces', () => {
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
  assert.match(packet, /current-agentfolio-candidate: REJECTED-NONAUTHORITATIVE/);
  assert.match(packet, /SATP PR \[#160\]/);
  assert.match(packet, /satp-pr-160-candidate: NO-GO-CAPACITY-EXTENSION-DRY-RUN-LITESVM-OWNER/);
});

test('document pins the current SATP PR head and blocked candidate fingerprints', () => {
  const packet = fs.readFileSync(packetPath, 'utf8');

  for (const fingerprint of [
    'fd654ce5a33c68fee5ff8120040b607684f22246',
    'a35568bc3926bd44d73680813bda0e8d5371705f',
    '380b20d36f18253a5c382ec1abc4a1147a08092a9a42cdae25e5d954f41acd0a',
    '27395415b6dc3d069d8a0a974613e647af1494590cbaff0a2658945a2bc4784a',
    '9bb7e2a441af653108b21360a8aa14daa9bd8d54eebbc5eef88e7f3de881ba10',
  ]) {
    assert.ok(packet.includes(fingerprint), `packet is missing fingerprint: ${fingerprint}`);
  }
  assert.match(packet, /candidate exceeds it by `3448` bytes/);
  assert.match(packet, /extension_required_before_buffer_write/);
  assert.match(packet, /Any new commit\s+invalidates the review request and approval packet/);
});

test('repo-local non-authoritative reference binds both SOL routes to the immutable treasury', () => {
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

test('document requires preservation, approval, rollback, and bounded proof gates', () => {
  const packet = fs.readFileSync(packetPath, 'utf8');

  for (const required of [
    'Preserve all five USDC instructions',
    'solana-cli 2.1.21',
    'No write window is admitted by this packet',
    'localnet dry-run receipt',
    'rollback allocated payload is `346856` bytes',
    'treasury_delta = floor(gross * 500 / 10000)',
    'grossMeetsNonZeroFeeMinimum',
    'escrowDeltaMatchesGross',
    'Neither canary transaction may call `close_escrow`',
    'raw balance',
    'program-upgrade: not performed',
    'roadmap-change: not performed',
  ]) {
    assert.ok(packet.includes(required), `packet is missing required gate: ${required}`);
  }
  assert.doesNotMatch(packet, /solana program deploy/);
  assert.doesNotMatch(packet, /anchor idl upgrade/);
});

test('document requires exact finalized runtime and IDL equality', () => {
  const packet = fs.readFileSync(packetPath, 'utf8');

  assert.match(packet, /finalized \*\*trimmed\*\* runtime must equal the approved candidate exactly/);
  assert.match(packet, /`350304` bytes and SHA-256/);
  assert.match(packet, /finalized allocated payload length and SHA-256 must equal the exact values/);
  assert.match(packet, /merely recording different values does\s+not pass/);
  assert.match(packet, /published IDL must equal SHA-256/);
});
