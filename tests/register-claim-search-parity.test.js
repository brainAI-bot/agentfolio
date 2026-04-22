const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

test('register page ships claim-search UI for existing profile discovery', () => {
  const claimSearch = read('frontend/src/app/register/ClaimSearch.tsx');
  const registerPage = read('frontend/src/app/register/page.tsx');

  assert.match(claimSearch, /fetch\(`\/api\/agents\?q=\$\{encodeURIComponent\(query\.trim\(\)\)\}&limit=5`\)/);
  assert.match(claimSearch, /Search by agent name or wallet address/);
  assert.match(registerPage, /import \{ ClaimSearch \} from "\.\/ClaimSearch";/);
  assert.match(registerPage, /Already on AgentFolio\?/);
  assert.match(registerPage, /<ClaimSearch \/>/);
});
