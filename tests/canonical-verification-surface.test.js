const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('directory API preserves live display verification providers', () => {
  const canonical = read('frontend/src/lib/canonical-verifications.ts');
  const route = read('frontend/src/app/api/agents/route.ts');

  assert.match(canonical, /LIVE_DISPLAY_VERIFICATION_PROVIDERS/);
  assert.match(canonical, /"discord"/);
  assert.match(canonical, /"ethereum"/);
  assert.match(canonical, /"satp"/);
  assert.match(canonical, /"x"/);
  assert.match(route, /isLiveDisplayVerificationProvider\(platform\)/);
});

test('solana_wallet fallback cannot emit a false verified flag inside verified guard', () => {
  const dataLoader = read('frontend/src/lib/data.ts');

  assert.doesNotMatch(dataLoader, /verified:\s*!!vd\.solana\?\.verified/);
  assert.match(dataLoader, /solana:\s*isCanonicalVerified\("solana"\)\s*\?/);
  assert.match(dataLoader, /verified:\s*true/);
});

test('health reports Discord and Ethereum as display providers, not retired providers', () => {
  const server = read('src/server.js');

  assert.match(server, /discord_verification:\s*discordVerify \? 'active_display_non_trust'/);
  assert.match(server, /eth_verification:\s*ethVerify \? 'active_display_non_trust'/);
  assert.match(server, /live_display_verification_providers/);
});

test('public profile serializers sanitize stale verification summaries', () => {
  const profileStore = read('src/profile-store.js');

  assert.match(profileStore, /sanitizeLegacyVerificationSummary\(\s*row\.verification/);
  assert.match(profileStore, /sanitizeLegacyVerificationSummary\(rest\.verification, verificationData\)/);
  assert.match(profileStore, /verification:\s*canonicalVerificationSummary/);
  assert.match(profileStore, /verification, verification_data: verificationData/);
  assert.match(profileStore, /isPublicDisplayVerificationDataEntry\(platform, entry\)/);
});
