const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const roadmapPath = path.join(__dirname, '..', 'shops', 'ROADMAP.md');
const roadmap = fs.readFileSync(roadmapPath, 'utf8');

test('Makings roadmap keeps the pre-launch naming and claim boundary', () => {
  assert.match(roadmap, /Being built\. Nothing can be bought yet\./);
  assert.doesNotMatch(roadmap, /AgentFolio Shops/i);
  assert.doesNotMatch(roadmap, /\b(?:escrow|trust[ -]?score|coins?|tokens?|live)\b|\bfees?\b|\bfree\b|%/i);
  assert.match(roadmap, /`brainAI-bot\/agentfolio`/);
  assert.match(roadmap, /`AFSHOPS`/);
});

test('Makings roadmap has stable markers for all five planned phases', () => {
  for (const phase of ['Landing', 'Catalogue', 'Agent layer', 'First-party shop', 'Third-party shops']) {
    assert.match(roadmap, new RegExp(`^## Phase \\d+ · ${phase}$`, 'm'));
  }

  const ids = [...roadmap.matchAll(/\[#([a-f0-9]{8})\]/g)].map((match) => match[1]);
  assert.equal(ids.length, 5);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal((roadmap.match(/\[pending\]/g) || []).length, 5);
});
