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

function credentialEnvName(name) {
  const normalized = String(name).replace(/[^a-z0-9]/gi, '').toLowerCase();
  const authority = /(admin|internal|auth|authorization|api)/.test(normalized);
  const credential = /(key|secret|token|credential)/.test(normalized);
  return authority && credential;
}

function credentialHeaderName(name) {
  const normalized = String(name).replace(/[^a-z0-9]/gi, '').toLowerCase();
  return normalized === 'authorization' || normalized === 'xapikey';
}

function unwrapChain(node) {
  return node && node.type === 'ChainExpression' ? node.expression : node;
}

function staticPropertyName(node) {
  node = unwrapChain(node);
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  return null;
}

function memberPropertyName(node) {
  node = unwrapChain(node);
  if (!node || node.type !== 'MemberExpression') return null;
  return node.computed ? staticPropertyName(node.property) : node.property.name;
}

function stringLiteralValue(node) {
  node = unwrapChain(node);
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map((part) => part.value.cooked).join('');
  }
  return null;
}

function isStringLiteral(node) {
  return stringLiteralValue(node) !== null;
}

function walkAst(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) value.forEach((child) => walkAst(child, visit));
    else if (value && typeof value.type === 'string') walkAst(value, visit);
  }
}

function findAuthorizationLiteralViolations(source, relativePath) {
  const acorn = require('acorn');
  let ast;
  try {
    ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true });
  } catch {
    ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true });
  }

  const tainted = new Set();
  const nodes = [];
  walkAst(ast, (node) => nodes.push(node));

  function isHeadersObject(node) {
    node = unwrapChain(node);
    return node?.type === 'MemberExpression' && String(memberPropertyName(node)).toLowerCase() === 'headers';
  }

  function isProcessEnvCredential(node) {
    node = unwrapChain(node);
    if (node?.type !== 'MemberExpression' || !credentialEnvName(memberPropertyName(node))) return false;
    const object = unwrapChain(node.object);
    return object?.type === 'MemberExpression'
      && object.object?.type === 'Identifier'
      && object.object.name === 'process'
      && String(memberPropertyName(object)).toLowerCase() === 'env';
  }

  function isCredentialSource(node) {
    node = unwrapChain(node);
    if (!node) return false;
    if (node.type === 'Identifier') return tainted.has(node.name);
    if (isProcessEnvCredential(node)) return true;
    if (node.type === 'MemberExpression') {
      return isHeadersObject(node.object) && credentialHeaderName(memberPropertyName(node));
    }
    if (node.type === 'CallExpression') {
      const callee = unwrapChain(node.callee);
      const method = callee?.type === 'MemberExpression' && String(memberPropertyName(callee)).toLowerCase();
      return (method === 'get' || method === 'header')
        && credentialHeaderName(staticPropertyName(node.arguments[0]));
    }
    return false;
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.type === 'VariableDeclarator' || node.type === 'AssignmentExpression') {
        const target = node.type === 'VariableDeclarator' ? node.id : node.left;
        const value = node.type === 'VariableDeclarator' ? node.init : node.right;
        if (target?.type === 'Identifier' && isCredentialSource(value) && !tainted.has(target.name)) {
          tainted.add(target.name);
          changed = true;
        }
        if (target?.type === 'ObjectPattern' && isHeadersObject(value)) {
          for (const property of target.properties) {
            if (property.type !== 'Property' || !credentialHeaderName(staticPropertyName(property.key))) continue;
            const local = property.value?.type === 'AssignmentPattern' ? property.value.left : property.value;
            if (local?.type === 'Identifier' && !tainted.has(local.name)) {
              tainted.add(local.name);
              changed = true;
            }
          }
        }
      }
    }
  }

  const violations = [];
  for (const node of nodes) {
    if (node.type === 'LogicalExpression' && node.operator === '||'
        && isProcessEnvCredential(node.left) && stringLiteralValue(node.right)) {
      violations.push(`${relativePath}:${node.loc.start.line}`);
    }
    if (node.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(node.operator)) {
      const credentialSide = isStringLiteral(node.left) ? node.right : isStringLiteral(node.right) ? node.left : null;
      if (credentialSide && isCredentialSource(credentialSide)) {
        violations.push(`${relativePath}:${node.loc.start.line}`);
      }
    }
  }

  return [...new Set(violations)];
}

test('authorization-literal scanner rejects direct, aliased, generic-key, and embedded-prefix fallbacks', () => {
  const unsafeFixtures = [
    "if (req.headers.authorization === 'fixture-only') deny();",
    "if (req.headers['authorization'] !== 'fixture-only') deny();",
    "if ('fixture-only' === req.headers.Authorization) deny();",
    "if (req.headers?.authorization === 'fixture-only') deny();",
    "if (req.get('x-api-key') === 'fixture-only') deny();",
    "if (req.header('x-api-key') !== 'fixture-only') deny();",
    "const supplied = req.get('authorization'); if (supplied === 'fixture-only') deny();",
    "const key = req.headers['x-api-key']; const alias = key; if (alias == 'fixture-only') deny();",
    "const { authorization } = req.headers; if (authorization === 'fixture-only') deny();",
    "const { 'x-api-key': suppliedKey } = req.headers; if (suppliedKey === 'fixture-only') deny();",
    "const candidate = process.env.SERVICE_ADMIN_API_KEY || 'fixture-only';",
    "const candidate = process.env['PREFIX_AUTH_TOKEN_SUFFIX'] || 'fixture-only';",
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