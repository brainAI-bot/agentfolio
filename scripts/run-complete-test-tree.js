#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const QUARANTINE_PATH = path.join(ROOT, 'config', 'ci-test-quarantine.json');

function discoverTestFiles(root = ROOT) {
  return fs.readdirSync(path.join(root, 'tests'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
    .map((entry) => `tests/${entry.name}`)
    .sort();
}

function validateQuarantine(raw, testFiles, today = new Date().toISOString().slice(0, 10)) {
  if (!raw || raw.schemaVersion !== 1 || !raw.entries || Array.isArray(raw.entries)) {
    throw new Error('quarantine inventory must have schemaVersion=1 and an entries object');
  }

  const discovered = new Set(testFiles);
  for (const [file, entry] of Object.entries(raw.entries)) {
    if (!discovered.has(file)) throw new Error(`quarantine references missing test file: ${file}`);
    if (!entry || typeof entry.reason !== 'string' || entry.reason.trim().length < 20) {
      throw new Error(`quarantine reason is missing or too short: ${file}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expiresOn || '')) {
      throw new Error(`quarantine expiry must be YYYY-MM-DD: ${file}`);
    }
    if (entry.expiresOn < today) throw new Error(`quarantine expired on ${entry.expiresOn}: ${file}`);
  }
  return raw.entries;
}

function parseCounts(output) {
  const count = (name) => {
    const matches = [...output.matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gm'))];
    return matches.length ? Number(matches.at(-1)[1]) : 0;
  };
  return { tests: count('tests'), pass: count('pass'), fail: count('fail'), skipped: count('skipped') };
}

function classifyResults(results, quarantine) {
  const unexpectedFailures = results.filter((result) => result.status !== 0 && !quarantine[result.file]);
  const passingQuarantines = results.filter((result) => result.status === 0 && quarantine[result.file]);
  return { unexpectedFailures, passingQuarantines };
}

function main() {
  const testFiles = discoverTestFiles();
  const inventory = JSON.parse(fs.readFileSync(QUARANTINE_PATH, 'utf8'));
  const quarantine = validateQuarantine(inventory, testFiles);
  const results = [];

  for (const file of testFiles) {
    const child = spawnSync(process.execPath, ['--test', file], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      maxBuffer: 16 * 1024 * 1024,
    });
    const output = `${child.stdout || ''}${child.stderr || ''}`;
    const result = { file, status: child.status === null ? 1 : child.status, output, counts: parseCounts(output) };
    results.push(result);
    const state = result.status === 0 ? 'PASS' : (quarantine[file] ? 'QUARANTINED' : 'FAIL');
    console.log(`${state} ${file} tests=${result.counts.tests} pass=${result.counts.pass} fail=${result.counts.fail}`);
    if (result.status !== 0) process.stdout.write(output);
  }

  const totals = results.reduce((sum, result) => ({
    tests: sum.tests + result.counts.tests,
    pass: sum.pass + result.counts.pass,
    fail: sum.fail + result.counts.fail,
  }), { tests: 0, pass: 0, fail: 0 });
  const { unexpectedFailures, passingQuarantines } = classifyResults(results, quarantine);
  const quarantinedFailures = results.filter((result) => result.status !== 0 && quarantine[result.file]);

  console.log(`COMPLETE_TEST_TREE files=${results.length} tests=${totals.tests} pass=${totals.pass} fail=${totals.fail} quarantined_files=${quarantinedFailures.length} unexpected_files=${unexpectedFailures.length} stale_quarantines=${passingQuarantines.length}`);

  if (unexpectedFailures.length || passingQuarantines.length) {
    for (const result of unexpectedFailures) console.error(`Unexpected failing file: ${result.file}`);
    for (const result of passingQuarantines) console.error(`Passing test still quarantined: ${result.file}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { classifyResults, discoverTestFiles, parseCounts, validateQuarantine };