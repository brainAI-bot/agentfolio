const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { lintRoadmap } = require('../scripts/lint-roadmap');

function lintFixture(markdown, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-roadmap-'));
  const file = path.join(dir, 'ROADMAP.md');
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  fs.writeFileSync(file, markdown);
  return lintRoadmap(file);
}

function roadmapWith(item) {
  return [
    '# Test Roadmap',
    '',
    '## Status taxonomy',
    '',
    '- shipped: implemented and available in the repository; production-facing shipped claims also require explicit live probe, proof marker, or evidence wording.',
    '',
    '## Current state snapshot',
    '',
    '- Snapshot text.',
    '',
    '## Phase 1',
    '',
    item,
    '',
  ].join('\n');
}

test('production-facing shipped roadmap claims require probe evidence', () => {
  const errors = lintFixture(roadmapWith('- Production marketplace route is live at https://agentfolio.bot/marketplace. [shipped]'));

  assert.ok(errors.some((error) => error.includes('production-facing shipped item requires live probe')));
});

test('proof markers satisfy production-facing shipped roadmap claims', () => {
  const errors = lintFixture(roadmapWith('- Production marketplace route is live at https://agentfolio.bot/marketplace. [#3580dd75] [shipped]'));

  assert.deepEqual(errors, []);
});

test('repo-only shipped roadmap claims remain valid', () => {
  const errors = lintFixture(roadmapWith('- Repo-local roadmap lint is available through npm run lint:roadmap. [shipped]'));

  assert.deepEqual(errors, []);
});

test('roadmap items may carry parser-supported display annotations', () => {
  const errors = lintFixture(roadmapWith('- Escrow provenance requires canonical-mainnet readback. [#49e40f78] [blocked] · escrow provenance not certified'));

  assert.deepEqual(errors, []);
});

test('deploy provenance deflation annotations remain valid', () => {
  const errors = lintFixture(roadmapWith('- Deploy provenance preserves milestone identity. [#0be32a7b] [pending] · deflated until production readback is verified.'));

  assert.deepEqual(errors, []);
});

test('treasury money-path shipped claims require source deployed IDL certification', () => {
  const errors = lintFixture(roadmapWith('- On-chain fee collection inside release/partial_release routes the platform percentage to the treasury (FriU1FEp...) - GitHub/HQ-visible executed transfer evidence proves both live routes move the platform percentage to treasury. [#011685d4] [shipped]'));

  assert.ok(errors.some((error) => error.includes('treasury money-path shipped item requires executed transfer evidence')));
});

test('treasury money-path shipped claims require a resolvable evidence document', () => {
  const errors = lintFixture(roadmapWith('- On-chain fee collection inside release/partial_release routes the platform percentage to the treasury (FriU1FEp...) - GitHub/HQ-visible executed transfer evidence proves both live routes move the platform percentage to treasury and source/deployed/IDL alignment is certified. [#011685d4] [shipped]'));

  assert.ok(errors.some((error) => error.includes('resolvable evidence document path')));
});

test('treasury money-path shipped claims accept executed transfer, source certification, and evidence document', () => {
  const errors = lintFixture(
    roadmapWith('- On-chain fee collection inside release/partial_release routes the platform percentage to the treasury (FriU1FEp...) - GitHub/HQ-visible executed transfer evidence proves both live routes move the platform percentage to treasury and source/deployed/IDL alignment is certified in docs/operational/treasury-evidence.md. [#011685d4] [shipped]'),
    { 'docs/operational/treasury-evidence.md': '# Treasury evidence\n' },
  );

  assert.deepEqual(errors, []);
});

test('literal final fee roadmap line cannot be flipped to shipped without proof', () => {
  const roadmap = fs.readFileSync(path.join(__dirname, '..', 'ROADMAP.md'), 'utf8');
  const feeLine = roadmap.split(/\r?\n/).find((line) => line.includes('[#011685d4]'));

  assert.ok(feeLine.includes('[pending]'));

  const errors = lintFixture(roadmapWith(feeLine.replace('[pending]', '[shipped]')));

  assert.ok(errors.some((error) => error.includes('treasury money-path shipped item requires executed transfer evidence')));
});
