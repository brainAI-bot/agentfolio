import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateChangedPaths } from './boundary.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const collect = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);
const changed = [...new Set([
  ...collect(['diff', '--name-only', 'origin/main...HEAD']),
  ...collect(['diff', '--name-only']),
  ...collect(['ls-files', '--others', '--exclude-standard']),
])].sort();
const violations = validateChangedPaths(changed);

for (const retired of ['frontend/src/app/launch/page.tsx', 'public/v2/launch.html']) {
  if (existsSync(resolve(root, retired))) violations.push(`${retired}: retired public route still exists`);
}
for (const nav of ['public/v2/index.html', 'public/v2/rankings.html']) {
  const body = readFileSync(resolve(root, nav), 'utf8');
  if (/\/v2\/launch|Launch Token/i.test(body)) violations.push(`${nav}: token launch remains in public navigation`);
}
const stats = readFileSync(resolve(root, 'frontend/src/app/stats/page.tsx'), 'utf8');
if (/TokenStatsSection|Token Launches|api\/tokens\/stats/.test(stats)) violations.push('frontend stats still advertises token launches');

if (violations.length) {
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log(`Shops boundary passed (${changed.length} changed paths checked); retired token routes are absent.`);
