const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('badge fallback production drift guard', () => {
  it('keeps badge routes on the unified trust-score generator', () => {
    const serverPath = path.resolve(__dirname, '../src/server.js');
    const source = fs.readFileSync(serverPath, 'utf8');

    assert.ok(source.includes("const { generateBadgeSVG } = require('./lib/badge-svg');"));
    assert.ok(source.includes('async function renderBadge(req, res)'));
    assert.ok(source.includes('const v3Score = await getV3Score(id).catch(() => null);'));
    assert.ok(source.includes('const unified = computeUnifiedTrustScore(db, row, { v3Score });'));
    assert.ok(source.includes('const svg = generateBadgeSVG(row.name, unified.level, unified.score);'));
    assert.ok(source.includes('const publicBadgeLimiter = rateLimit({'));
    assert.ok(source.includes("app.get('/api/badge/:id.svg', publicBadgeLimiter, renderBadge);"));
    assert.ok(source.includes("app.get('/api/badge/:id', publicBadgeLimiter, renderBadge);"));
    assert.ok(!source.includes('chainCache.getVerifications(id)'));
    assert.ok(!source.includes('<text x="155" y="19"'));
  });

  it('escapes badge SVG text fields', () => {
    const { generateBadgeSVG } = require('../src/lib/badge-svg');
    const svg = generateBadgeSVG('A&B <Agent>', 1, 100);

    assert.match(svg, /A&amp;B &lt;Agent&gt;/);
    assert.doesNotMatch(svg, /A&B <Agent>/);
  });
});
