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

function lineNumberAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function credentialEnvName(name) {
  const normalized = String(name).replace(/[^a-z0-9]/gi, '').toLowerCase();
  const authority = /(admin|internal|auth|authorization|api)/.test(normalized);
  const credential = /(key|secret|token|credential)/.test(normalized);
  return authority && credential;
}

function credentialIdentifier(name) {
  const normalized = String(name).replace(/[^a-z0-9]/gi, '').toLowerCase();
  return /(admin|internal|auth|authorization|api)/.test(normalized)
    && /(key|secret|token|credential)/.test(normalized);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function authorizationSource(expression, tainted) {
  const compact = expression.replace(/\s+/g, ' ');
  if (/\b[A-Za-z_$][\w$]*\.headers(?:\.authorization|\[\s*['"](?:authorization|x-api-key)['"]\s*\])/i.test(compact)) return true;
  if (/\b[A-Za-z_$][\w$]*\.(?:get|header)\(\s*['"]authorization['"]\s*\)/i.test(compact)) return true;

  const env = compact.match(/\bprocess\.env(?:\.([A-Za-z0-9_]+)|\[\s*['"]([^'"]+)['"]\s*\])/);
  if (env && credentialEnvName(env[1] || env[2])) return true;

  return [...tainted].some((name) => new RegExp(`\\b${escapeRegExp(name)}\\b`).test(compact));
}

function directAuthorizationExpression(expression) {
  return /^(?:[A-Za-z_$][\w$]*\.headers(?:\.authorization|\[\s*['"](?:authorization|x-api-key)['"]\s*\])|[A-Za-z_$][\w$]*\.(?:get|header)\(\s*['"]authorization['"]\s*\))$/i.test(expression);
}

function findAuthorizationLiteralViolations(source, relativePath) {
  const violations = [];
  const tainted = new Set();
  const assignments = [...source.matchAll(/(?:\b(?:const|let|var)\s+)?\b([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)];

  let changed = true;
  while (changed) {
    changed = false;
    for (const assignment of assignments) {
      if (!tainted.has(assignment[1]) && authorizationSource(assignment[2], tainted)) {
        tainted.add(assignment[1]);
        changed = true;
      }
    }
  }

  const envFallback = /\bprocess\.env(?:\.([A-Za-z0-9_]+)|\[\s*['"]([^'"]+)['"]\s*\])\s*\|\|\s*(['"])(?:\\.|(?!\3).)+\3/g;
  for (const match of source.matchAll(envFallback)) {
    if (credentialEnvName(match[1] || match[2])) {
      violations.push(`${relativePath}:${lineNumberAt(source, match.index)}`);
    }
  }

  const comparisonPatterns = [
    /([^;\n]+?)\s*(===|!==|==|!=)\s*(['"])(?:\\.|(?!\3).)*\3/g,
    /(['"])(?:\\.|(?!\1).)*\1\s*(===|!==|==|!=)\s*([^;\n]+)/g,
  ];
  for (const [patternIndex, pattern] of comparisonPatterns.entries()) {
    for (const match of source.matchAll(pattern)) {
      const expression = (patternIndex === 0 ? match[1] : match[3]).trim()
        .replace(/^.*(?:\bif|\bwhile)\s*\(/, '')
        .replace(/[),}\s]+$/, '');
      const directPrefix = expression.match(/^(?:[A-Za-z_$][\w$]*\.headers(?:\.authorization|\[\s*['"](?:authorization|x-api-key)['"]\s*\])|[A-Za-z_$][\w$]*\.(?:get|header)\(\s*['"]authorization['"]\s*\))/i);
      const sinkExpression = directPrefix ? directPrefix[0] : expression;
      const identifier = sinkExpression.match(/^([A-Za-z_$][\w$]*)$/);
      const credentialSink = directAuthorizationExpression(sinkExpression)
        || (identifier && (tainted.has(identifier[1]) || credentialIdentifier(identifier[1])));
      if (credentialSink) violations.push(`${relativePath}:${lineNumberAt(source, match.index)}`);
    }
  }

  return [...new Set(violations)];
}

test('authorization-literal scanner rejects direct, aliased, generic-key, and embedded-prefix fallbacks', () => {
  const unsafeFixtures = [
    "if (req.headers.authorization === 'fixture-only') deny();",
    "if (req.headers['authorization'] !== 'fixture-only') deny();",
    "if ('fixture-only' === req.headers.Authorization) deny();",
    "const supplied = req.get('authorization'); if (supplied === 'fixture-only') deny();",
    "const key = req.headers['x-api-key']; if (key == 'fixture-only') deny();",
    "const candidate = process.env.SERVICE_ADMIN_API_KEY || 'fixture-only';",
  ];

  unsafeFixtures.forEach((fixture, index) => {
    assert.notDeepEqual(
      findAuthorizationLiteralViolations(fixture, `unsafe-${index}.js`),
      [],
      `unsafe fixture ${index} must be rejected`,
    );
  });
  assert.deepEqual(
    findAuthorizationLiteralViolations("const key = req.headers.authorization; if (!key) deny();", 'safe.js'),
    [],
  );
});

test('source cannot fall back to or compare authorization credentials with string literals', () => {
  const violations = [];

  for (const file of walkFiles(SRC_ROOT, (candidate) => candidate.endsWith('.js')).sort()) {
    const source = fs.readFileSync(file, 'utf8');
    violations.push(...findAuthorizationLiteralViolations(source, path.relative(ROOT, file)));
  }

  assert.deepEqual(violations, [], `authorization literal violations: ${violations.join(', ')}`);
});