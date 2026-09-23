const FORBIDDEN_PRODUCTION_PATHS = [
  /^ecosystem(?:\.|$)/,
  /^ops\//,
  /^deploy\//,
  /^infra\//,
  /^src\/server\.js$/,
];

const ALLOWED_LEGACY_CHANGES = new Set([
  'frontend/src/app/launch/page.tsx',
  'frontend/src/app/stats/page.tsx',
  'public/v2/launch.html',
  'public/v2/index.html',
  'public/v2/rankings.html',
  'scripts/check-public-routes.mjs',
  'package.json',
]);

export function validateChangedPaths(paths) {
  const violations = [];
  for (const path of paths) {
    if (path.startsWith('shops/') || path === '.github/workflows/shops-ci.yml' || ALLOWED_LEGACY_CHANGES.has(path)) continue;
    if (FORBIDDEN_PRODUCTION_PATHS.some((pattern) => pattern.test(path))) {
      violations.push(`${path}: production runtime/deploy paths are outside Wave 0`);
    } else {
      violations.push(`${path}: outside the Shops boundary and approved token-page retirement set`);
    }
  }
  return violations;
}
