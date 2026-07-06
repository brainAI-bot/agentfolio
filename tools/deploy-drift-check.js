#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const DEFAULT_PROD_URL = 'https://agentfolio.bot/api/version';
const DEFAULT_EVIDENCE_FILE = 'reports/deploy-drift-latest.json';

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--fail-on-drift') args.failOnDrift = true;
    else if (arg.startsWith('--prod-url=')) args.prodUrl = arg.slice('--prod-url='.length);
    else if (arg.startsWith('--origin-ref=')) args.originRef = arg.slice('--origin-ref='.length);
    else if (arg.startsWith('--repo=')) args.repo = arg.slice('--repo='.length);
    else if (arg.startsWith('--write-evidence=')) args.writeEvidence = arg.slice('--write-evidence='.length);
    else if (arg === '--write-evidence') args.writeEvidence = DEFAULT_EVIDENCE_FILE;
    else if (arg.startsWith('--hq-task-id=')) args.hqTaskId = arg.slice('--hq-task-id='.length);
    else if (arg.startsWith('--hq-cli=')) args.hqCli = arg.slice('--hq-cli='.length);
    else if (arg === '--create-hq-task') args.createHqTask = true;
  }
  return args;
}

function runGit(repo, args) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15000,
  }).trim();
}

async function fetchJson(url) {
  if (typeof fetch !== 'function') {
    throw new Error('global fetch is unavailable; run with Node 18+');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    return JSON.parse(body);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSha(value) {
  const text = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(text) ? text : null;
}

function commitsMatch(prodSha, originSha) {
  if (!prodSha || !originSha) return false;
  return prodSha === originSha || originSha.startsWith(prodSha) || prodSha.startsWith(originSha);
}

function commandParts(command) {
  const raw = String(command || '').trim();
  if (!raw) return null;
  return raw.split(/\s+/).map((part) => (
    part.startsWith('~/') ? path.join(process.env.HOME || '', part.slice(2)) : part
  ));
}

function runHq(command, args) {
  const parts = commandParts(command);
  if (!parts) return { ok: false, error: 'HQ command is empty' };

  const result = spawnSync(parts[0], [...parts.slice(1), ...args], {
    encoding: 'utf8',
    timeout: 15000,
  });
  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) {
    return {
      ok: false,
      error: (result.stderr || result.stdout || `exit ${result.status}`).trim(),
    };
  }
  return { ok: true, output: (result.stdout || '').trim() };
}

function writeEvidence(repo, evidenceFile, evidence) {
  const target = path.resolve(repo, evidenceFile || DEFAULT_EVIDENCE_FILE);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`);
  return target;
}

function summarize(evidence) {
  return [
    `AgentFolio deploy drift check: ${evidence.status}`,
    `prod=${evidence.production.commitSha || 'unknown'}`,
    `origin=${evidence.origin.commitSha || 'unknown'}`,
    `versionUrl=${evidence.production.url}`,
    `checkedAt=${evidence.checkedAt}`,
  ].join(' ');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = path.resolve(args.repo || process.cwd());
  const prodUrl = args.prodUrl || process.env.AGENTFOLIO_PROD_VERSION_URL || DEFAULT_PROD_URL;
  const originRef = args.originRef || process.env.AGENTFOLIO_ORIGIN_REF || 'origin/main';
  const hqCli = args.hqCli || process.env.HQ_CLI || '~/clawd/scripts/hq-env.zsh hq';
  const hqTaskId = args.hqTaskId || process.env.HQ_TASK_ID || process.env.AGENTFOLIO_DRIFT_HQ_TASK_ID;

  runGit(repo, ['fetch', '--quiet', 'origin', 'main']);
  const originSha = normalizeSha(runGit(repo, ['rev-parse', originRef]));
  const version = await fetchJson(prodUrl);
  const prodSha = normalizeSha(version.commitSha || version.commit || version.sha);

  const checkedAt = new Date().toISOString();
  const status = commitsMatch(prodSha, originSha) ? 'in_sync' : 'drift';
  const evidence = {
    service: 'agentfolio',
    status,
    checkedAt,
    production: {
      url: prodUrl,
      commitSha: prodSha,
      buildTime: version.buildTime || null,
      startedAt: version.startedAt || null,
      raw: version,
    },
    origin: {
      ref: originRef,
      commitSha: originSha,
    },
    command: `node tools/deploy-drift-check.js --prod-url=${prodUrl} --origin-ref=${originRef}`,
  };

  if (status === 'drift' || args.writeEvidence || process.env.AGENTFOLIO_DRIFT_EVIDENCE_FILE) {
    evidence.evidenceFile = writeEvidence(
      repo,
      args.writeEvidence || process.env.AGENTFOLIO_DRIFT_EVIDENCE_FILE || DEFAULT_EVIDENCE_FILE,
      evidence
    );
  }

  if (status === 'drift' && hqTaskId) {
    evidence.hqUpdate = runHq(hqCli, ['task', 'deliver', hqTaskId, summarize(evidence)]);
  } else if (status === 'drift' && (args.createHqTask || process.env.AGENTFOLIO_CREATE_DRIFT_TASK === 'true')) {
    evidence.hqUpdate = runHq(hqCli, [
      'task',
      'create',
      `--title=AgentFolio production deploy drift ${checkedAt.slice(0, 10)}`,
      '--project=agentfolio',
      '--agent=brainforge',
      '--priority=p1',
      `--criteria=${summarize(evidence)}`,
    ]);
  }

  if (args.json) {
    console.log(JSON.stringify(evidence, null, 2));
  } else {
    console.log(summarize(evidence));
    if (evidence.evidenceFile) console.log(`evidenceFile=${evidence.evidenceFile}`);
    if (evidence.hqUpdate) console.log(`hqUpdate=${evidence.hqUpdate.ok ? 'ok' : `failed: ${evidence.hqUpdate.error}`}`);
  }

  if (status === 'drift' && args.failOnDrift) process.exitCode = 1;
}

main().catch((err) => {
  const error = {
    service: 'agentfolio',
    status: 'error',
    checkedAt: new Date().toISOString(),
    error: err.message,
  };
  console.error(JSON.stringify(error, null, 2));
  process.exitCode = 2;
});
