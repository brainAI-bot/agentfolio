#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

const trackedSecretPathPatterns = [
  { label: 'keys-dir-json', pattern: /(^|\/)keys\/.*\.json$/ },
  { label: 'keypair-json', pattern: /(^|\/)[^/]*keypair[^/]*\.json$/i },
  { label: 'config-key-json', pattern: /(^|\/)config\/[^/]*key[^/]*\.json$/i },
  { label: 'deployer-json', pattern: /(^|\/)[^/]*deployer[^/]*\.json$/i },
  { label: 'satp-platform-json', pattern: /(^|\/)satp-platform[^/]*\.json$/i },
  { label: 'satp-mainnet-platform-json', pattern: /(^|\/)satp-mainnet-platform\.json$/i },
  { label: 'brainforge-personal-json', pattern: /(^|\/)brainforge-personal\.json$/i },
];

const referencePatterns = [
  {
    label: 'env-configured-signer',
    pattern: /\b(SATP_PLATFORM_KEYPAIR|SATP_KEYPAIR_PATH|DEPLOYER_KEY_PATH|REVIEWS_WALLET_PATH|BOA_AUTHORITY_KEYPAIR)\b/,
  },
  {
    label: 'hardcoded-mainnet-deployer-path',
    pattern: /\/home\/ubuntu\/\.config\/solana\/mainnet-deployer\.json/,
  },
  {
    label: 'hardcoded-devnet-deployer-path',
    pattern: /\/home\/ubuntu\/\.config\/solana\/devnet-deployer\.json/,
  },
  {
    label: 'platform-key-filename',
    pattern: /\b(brainforge-personal\.json|satp-mainnet-platform\.json|satp-platform[^'"\s]*\.json)\b/,
  },
  {
    label: 'legacy-authority-pubkey',
    pattern: /\b(Bq1niVKyTECn4HDxAJWiHZvRMCZndZtC113yj3Rkbroc|4St74qSyzuGyV2TA9gxej9GvXG2TgVSTvp1HEpzJbwcP)\b/,
  },
  {
    label: 'secret-key-loader',
    pattern: /\b(Keypair\.fromSecretKey|keypairIdentity)\b/,
  },
];

function gitLsFiles() {
  return execFileSync('git', ['ls-files'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split('\n')
    .filter(Boolean);
}

function readText(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const stat = fs.statSync(absolutePath);
  if (stat.size > 1024 * 1024) return null;
  const text = fs.readFileSync(absolutePath, 'utf8');
  return text.includes('\0') ? null : text;
}

function buildInventory() {
  const files = gitLsFiles();
  const trackedSecretPaths = [];
  const categoryFiles = Object.fromEntries(referencePatterns.map(({ label }) => [label, []]));

  for (const file of files) {
    const secretMatch = trackedSecretPathPatterns.find(({ pattern }) => pattern.test(file));
    if (secretMatch) {
      trackedSecretPaths.push({ path: file, category: secretMatch.label });
    }

    let text;
    try {
      text = readText(file);
    } catch {
      continue;
    }
    if (text === null) continue;

    for (const { label, pattern } of referencePatterns) {
      if (pattern.test(text)) {
        categoryFiles[label].push(file);
      }
    }
  }

  return {
    trackedFileCount: files.length,
    trackedSecretPaths,
    categories: Object.fromEntries(
      Object.entries(categoryFiles).map(([label, paths]) => [
        label,
        { count: paths.length, paths: paths.sort() },
      ])
    ),
  };
}

function printHuman(inventory) {
  console.log(`tracked_files=${inventory.trackedFileCount}`);
  console.log(`tracked_secret_paths=${inventory.trackedSecretPaths.length}`);
  for (const [label, entry] of Object.entries(inventory.categories)) {
    console.log(`${label}=${entry.count}`);
  }
}

const inventory = buildInventory();
const asJson = process.argv.includes('--json');
if (asJson) {
  console.log(JSON.stringify(inventory, null, 2));
} else {
  printHuman(inventory);
}

if (process.argv.includes('--fail-on-tracked-secret') && inventory.trackedSecretPaths.length > 0) {
  process.exitCode = 1;
}
