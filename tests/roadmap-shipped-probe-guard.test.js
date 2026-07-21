const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { lintRoadmap } = require('../scripts/lint-roadmap');

function lintFixture(markdown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-roadmap-'));
  const file = path.join(dir, 'ROADMAP.md');
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
