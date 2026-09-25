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
  return /(key|token|secret)/i.test(String(name));
}

function credentialHeaderName(name) {
  const normalized = String(name).replace(/[^a-z0-9]/gi, '').toLowerCase();
  return normalized === 'authorization' || normalized === 'xapikey' || normalized === 'xadminkey';
}

function unwrapChain(node) {
  return node && node.type === 'ChainExpression' ? node.expression : node;
}

function staticPropertyName(node) {
  node = unwrapChain(node);
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map((part) => part.value.cooked).join('');
  }
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

function walkAst(node, visit, shouldDescend = () => true) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  if (!shouldDescend(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) value.forEach((child) => walkAst(child, visit, shouldDescend));
    else if (value && typeof value.type === 'string') walkAst(value, visit, shouldDescend);
  }
}

function isFunctionNode(node) {
  return node?.type === 'FunctionDeclaration'
    || node?.type === 'FunctionExpression'
    || node?.type === 'ArrowFunctionExpression';
}

function findAuthorizationLiteralViolations(source, relativePath) {
  const acorn = require('acorn');
  let ast;
  try {
    ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true });
  } catch {
    ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true });
  }

  function isHeadersObject(node) {
    node = unwrapChain(node);
    const object = unwrapChain(node?.object);
    return node?.type === 'MemberExpression'
      && object?.type === 'Identifier'
      && object.name === 'req'
      && String(memberPropertyName(node)).toLowerCase() === 'headers';
  }

  function isProcessEnvObject(node) {
    node = unwrapChain(node);
    return node?.type === 'MemberExpression'
      && node.object?.type === 'Identifier'
      && node.object.name === 'process'
      && String(memberPropertyName(node)).toLowerCase() === 'env';
  }

  function isProcessEnvCredential(node) {
    node = unwrapChain(node);
    if (node?.type !== 'MemberExpression' || !credentialEnvName(memberPropertyName(node))) return false;
    return isProcessEnvObject(node.object);
  }

  function directHeaderSource(node) {
    node = unwrapChain(node);
    if (node?.type === 'MemberExpression') {
      return isHeadersObject(node.object) && credentialHeaderName(memberPropertyName(node));
    }
    if (node?.type !== 'CallExpression') return false;
    const callee = unwrapChain(node.callee);
    const method = callee?.type === 'MemberExpression' && String(memberPropertyName(callee)).toLowerCase();
    const receiver = unwrapChain(callee?.object);
    return (method === 'get' || method === 'header')
      && receiver?.type === 'Identifier'
      && receiver.name === 'req'
      && credentialHeaderName(staticPropertyName(node.arguments[0]));
  }

  function addPatternBindings(pattern, sourceKind, headerTaint, envTaint) {
    if (!pattern) return false;
    let changed = false;
    if (pattern.type === 'AssignmentPattern') {
      return addPatternBindings(pattern.left, sourceKind, headerTaint, envTaint);
    }
    if (pattern.type !== 'ObjectPattern') return false;
    for (const property of pattern.properties) {
      if (property.type !== 'Property') continue;
      const key = staticPropertyName(property.key);
      const value = property.value?.type === 'AssignmentPattern' ? property.value.left : property.value;
      if (sourceKind === 'request' && String(key).toLowerCase() === 'headers') {
        changed = addPatternBindings(value, 'headers', headerTaint, envTaint) || changed;
      } else if (sourceKind === 'headers' && credentialHeaderName(key) && value?.type === 'Identifier') {
        if (!headerTaint.has(value.name)) {
          headerTaint.add(value.name);
          changed = true;
        }
      } else if (sourceKind === 'env' && credentialEnvName(key) && value?.type === 'Identifier') {
        if (!envTaint.has(value.name)) {
          envTaint.add(value.name);
          changed = true;
        }
      }
    }
    return changed;
  }

  const violations = [];

  function scanScope(scopeNode, params = []) {
    const nodes = [];
    const root = scopeNode.type === 'Program' ? scopeNode : scopeNode.body;
    walkAst(root, (node) => nodes.push(node), (node) => node === root || !isFunctionNode(node));

    const headerTaint = new Set();
    const envTaint = new Set();
    for (const parameter of params) addPatternBindings(parameter, 'request', headerTaint, envTaint);

    function isHeaderSource(node) {
      node = unwrapChain(node);
      return directHeaderSource(node) || (node?.type === 'Identifier' && headerTaint.has(node.name));
    }

    function isEnvSource(node) {
      node = unwrapChain(node);
      return isProcessEnvCredential(node) || (node?.type === 'Identifier' && envTaint.has(node.name));
    }

    function containsEnvSource(node) {
      node = unwrapChain(node);
      if (isEnvSource(node)) return true;
      return node?.type === 'LogicalExpression'
        && ['||', '??'].includes(node.operator)
        && (containsEnvSource(node.left) || containsEnvSource(node.right));
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const node of nodes) {
        if (node.type !== 'VariableDeclarator' && node.type !== 'AssignmentExpression') continue;
        const target = node.type === 'VariableDeclarator' ? node.id : node.left;
        const value = node.type === 'VariableDeclarator' ? node.init : node.right;
        if (target?.type === 'Identifier' && isHeaderSource(value) && !headerTaint.has(target.name)) {
          headerTaint.add(target.name);
          changed = true;
        }
        if (target?.type === 'Identifier' && isEnvSource(value) && !envTaint.has(target.name)) {
          envTaint.add(target.name);
          changed = true;
        }
        if (target?.type === 'ObjectPattern' && isHeadersObject(value)) {
          changed = addPatternBindings(target, 'headers', headerTaint, envTaint) || changed;
        }
        if (target?.type === 'ObjectPattern' && isProcessEnvObject(value)) {
          changed = addPatternBindings(target, 'env', headerTaint, envTaint) || changed;
        }
      }
    }

    for (const node of nodes) {
      if (node.type === 'LogicalExpression' && ['||', '??'].includes(node.operator)
          && containsEnvSource(node.left) && isStringLiteral(node.right)) {
        violations.push(`${relativePath}:${node.loc.start.line}`);
      }
      if ((node.type === 'VariableDeclarator' || node.type === 'AssignmentExpression')) {
        const target = node.type === 'VariableDeclarator' ? node.id : node.left;
        const value = node.type === 'VariableDeclarator' ? node.init : node.right;
        if (target?.type === 'ObjectPattern' && isProcessEnvObject(value)) {
          for (const property of target.properties) {
            if (property.type === 'Property' && credentialEnvName(staticPropertyName(property.key))
                && property.value?.type === 'AssignmentPattern' && isStringLiteral(property.value.right)) {
              violations.push(`${relativePath}:${property.loc.start.line}`);
            }
          }
        }
      }
      if (node.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(node.operator)) {
        const credentialSide = isStringLiteral(node.left) ? node.right : isStringLiteral(node.right) ? node.left : null;
        if (credentialSide && isHeaderSource(credentialSide)) violations.push(`${relativePath}:${node.loc.start.line}`);
      }
      if (node.type === 'SwitchStatement' && isHeaderSource(node.discriminant)) {
        for (const switchCase of node.cases) {
          if (switchCase.test && isStringLiteral(switchCase.test)) {
            violations.push(`${relativePath}:${switchCase.loc.start.line}`);
          }
        }
      }
      if (node.type === 'CallExpression') {
        const calleeName = node.callee?.type === 'Identifier'
          ? node.callee.name
          : memberPropertyName(node.callee);
        if (calleeName === 'timingSafeEqual') {
          const hasLiteralBuffer = node.arguments.some((argument) => {
            argument = unwrapChain(argument);
            if (argument?.type !== 'CallExpression') return false;
            const object = unwrapChain(argument.callee?.object);
            return argument.callee?.type === 'MemberExpression'
              && object?.type === 'Identifier'
              && object.name === 'Buffer'
              && memberPropertyName(argument.callee) === 'from'
              && isStringLiteral(argument.arguments[0]);
          });
          if (hasLiteralBuffer) violations.push(`${relativePath}:${node.loc.start.line}`);
        }
      }
    }
  }

  scanScope(ast);
  walkAst(ast, (node) => {
    if (isFunctionNode(node)) scanScope(node, node.params);
  });

  return [...new Set(violations)];
}

function assertUnsafeFixtures(fixtures) {
  fixtures.forEach(([name, fixture]) => {
    assert.notDeepEqual(
      findAuthorizationLiteralViolations(fixture, `${name}.js`),
      [],
      `${name} must be rejected`,
    );
  });
}

test('authorization-literal scanner rejects the finite supervisor fixture list', () => {
  assertUnsafeFixtures([
    ['direct-dot', "if (req.headers.authorization === 'fixture-only') deny();"],
    ['direct-bracket', "if (req.headers['x-api-key'] !== 'fixture-only') deny();"],
    ['direct-static-template', "if (`fixture-only` === req.headers[`x-admin-key`]) deny();"],
    ['direct-optional', "if (req.headers?.authorization === 'fixture-only') deny();"],
    ['get-authorization', "if (req.get('authorization') === 'fixture-only') deny();"],
    ['get-x-api-key', "if (req.get(`x-api-key`) === 'fixture-only') deny();"],
    ['get-x-admin-key', "if (req.get('x-admin-key') === 'fixture-only') deny();"],
    ['header-authorization', "if (req.header(`authorization`) === 'fixture-only') deny();"],
    ['header-x-api-key', "if (req.header('x-api-key') !== 'fixture-only') deny();"],
    ['header-x-admin-key', "if (req.header(`x-admin-key`) == 'fixture-only') deny();"],
    ['assignment-alias', "let supplied; supplied = req.get('authorization'); if (supplied === 'fixture-only') deny();"],
    ['transitive-alias', "const key = req.headers['x-api-key']; const alias = key; if (alias == 'fixture-only') deny();"],
    ['ordinary-destructuring', "const { authorization } = req.headers; if (authorization === 'fixture-only') deny();"],
    ['renamed-destructuring', "const { 'x-admin-key': suppliedKey } = req.headers; if (suppliedKey === 'fixture-only') deny();"],
    ['parameter-destructuring', "function check({ headers: { 'x-api-key': supplied } }) { if (supplied === 'fixture-only') deny(); }"],
    ['switch-case', "switch (req.headers.authorization) { case 'fixture-only': deny(); }"],
    ['switch-alias', "const supplied = req.get('x-admin-key'); switch (supplied) { case `fixture-only`: deny(); }"],
    ['timing-safe-left', "timingSafeEqual(Buffer.from('fixture-only'), Buffer.from(candidate));"],
    ['timing-safe-right', "crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(`fixture-only`));"],
    ['env-or', "const candidate = process.env.SERVICE_API_KEY || 'fixture-only';"],
    ['env-nullish', "const candidate = process.env.AUTH_TOKEN ?? `fixture-only`;"],
    ['env-bracket-embedded', "const candidate = process.env['PREFIX_SECRET_SUFFIX'] || 'fixture-only';"],
    ['env-alias', "const key = process.env.API_KEY; const candidate = key ?? 'fixture-only';"],
    ['env-chained-fallback', "const candidate = process.env.PRIMARY_KEY || process.env.SECONDARY_KEY || 'fixture-only';"],
    ['env-destructuring-default', "const { SERVICE_TOKEN = 'fixture-only' } = process.env;"],
  ]);

  const safeFixtures = [
    "const key = req.headers.authorization; if (!key) deny();",
    "if (req.headers.authorization === process.env.AUTH_TOKEN) allow();",
    "const candidate = process.env.SERVICE_SECRET;",
    "const { SERVICE_KEY } = process.env;",
    "timingSafeEqual(Buffer.from(process.env.SERVICE_KEY), Buffer.from(candidate));",
    "if (config.headers.authorization === 'public-label') allow();",
    "if (cache.get('authorization') === 'public-label') allow();",
  ];
  safeFixtures.forEach((fixture, index) => {
    assert.deepEqual(findAuthorizationLiteralViolations(fixture, `safe-${index}.js`), []);
  });
});

test('source cannot fall back to or compare authorization credentials with string literals', () => {
  const violations = [];

  for (const file of walkFiles(SRC_ROOT, (candidate) => candidate.endsWith('.js')).sort()) {
    const source = fs.readFileSync(file, 'utf8');
    violations.push(...findAuthorizationLiteralViolations(source, path.relative(ROOT, file)));
  }

  assert.deepEqual(violations, [], `authorization literal violations: ${violations.join(', ')}`);
});