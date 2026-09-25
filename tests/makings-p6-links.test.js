const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function collectTextFiles(relativeDir) {
  const root = path.join(repoRoot, relativeDir);
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.(?:js|mjs|ts|tsx|html|md)$/.test(entry.name)) files.push(absolute);
    }
  };
  visit(root);
  return files;
}

describe('Makings P6 legacy link migration', () => {
  it('removes the dead AgentFolio X handle from executable and documented surfaces', () => {
    for (const relativeDir of ['frontend', 'src', 'public', 'docs', 'scripts']) {
      for (const file of collectTextFiles(relativeDir)) {
        const source = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(source, /agentfolioHQ/i, path.relative(repoRoot, file));
      }
    }
  });

  it('keeps the logo at root and one leaderboard navigation entry', () => {
    const navbar = read('frontend/src/components/Navbar.tsx');
    assert.doesNotMatch(navbar, /\{ href: "\/leaderboard", label: "Directory" \}/);
    assert.match(navbar, /\{ href: "\/leaderboard", label: "Leaderboard" \}/);
    assert.match(navbar, /<Link href="\/" className="flex items-center gap-2">/);

    for (const relativePath of [
      'src/server.js',
      'src/lib/badges-page.js',
      'src/api/docs.js',
      'src/spotlight-page.js',
    ]) {
      assert.doesNotMatch(read(relativePath), /href=["']\/["']/, relativePath);
    }
  });

  it('does not resurrect the retired Discord verification route', () => {
    assert.equal(
      fs.existsSync(path.join(repoRoot, 'src/routes/restored-verify-routes.js')),
      false,
    );
  });
});
