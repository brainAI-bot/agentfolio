const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(ROOT, 'src');
const SERVER_ENTRY = path.join(SRC_ROOT, 'server.js');
const RETIRED_MODULES = [
  'src/routes/claim-routes.js',
  'src/routes/restored-verify-routes.js',
  'src/lib/api-keys.js',
];

function walkFiles(dir, predicate, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(fullPath, predicate, files);
    if (entry.isFile() && predicate(fullPath)) files.push(fullPath);
  }
  return files;
}

function resolveLocalRequire(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function staticRequireWalk(entryFile) {
  const reachable = new Set();
  const pending = [entryFile];
  const literalRequire = /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

  while (pending.length > 0) {
    const file = pending.pop();
    if (reachable.has(file)) continue;
    reachable.add(file);

    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(literalRequire)) {
      const resolved = resolveLocalRequire(file, match[1]);
      if (resolved && resolved.startsWith(SRC_ROOT)) pending.push(resolved);
    }
  }

  return reachable;
}

test('retired claim and admin-key modules are absent and unreachable from server.js', () => {
  const reachable = staticRequireWalk(SERVER_ENTRY);

  for (const retiredModule of RETIRED_MODULES) {
    const absolutePath = path.join(ROOT, retiredModule);
    assert.equal(fs.existsSync(absolutePath), false, `${retiredModule} must stay deleted`);
    assert.equal(reachable.has(absolutePath), false, `${retiredModule} must stay unreachable from src/server.js`);
  }
});

test('source cannot fall back to or directly compare authorization credentials with string literals', () => {
  const forbiddenPatterns = [
    /process\.env\.(?:ADMIN|INTERNAL|AUTH|API)[A-Z0-9_]*(?:KEY|SECRET|TOKEN)[A-Z0-9_]*\s*\|\|\s*(['"]).+?\1/,
    /\b(?:auth|api|admin|internal)[A-Za-z0-9_]*(?:key|secret|token)\b\s*(?:===|!==|==|!=)\s*(['"]).+?\1/i,
    /(['"]).+?\1\s*(?:===|!==|==|!=)\s*\b(?:auth|api|admin|internal)[A-Za-z0-9_]*(?:key|secret|token)\b/i,
  ];
  const violations = [];

  for (const file of walkFiles(SRC_ROOT, (candidate) => candidate.endsWith('.js')).sort()) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (forbiddenPatterns.some((pattern) => pattern.test(line))) {
        violations.push(`${path.relative(ROOT, file)}:${index + 1}`);
      }
    });
  }

  assert.deepEqual(violations, [], `authorization literal violations: ${violations.join(', ')}`);
});