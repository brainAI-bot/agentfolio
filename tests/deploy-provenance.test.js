const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { execFileSync, spawn } = childProcess;

const repoRoot = path.resolve(__dirname, '..');

afterEach(() => {
  delete process.env.AGENTFOLIO_COMMIT_SHA;
  delete process.env.AGENTFOLIO_BUILD_TIME;
  childProcess.execFileSync = execFileSync;
});

function loadFreshProvenance() {
  const modulePath = path.resolve(repoRoot, 'src/lib/deploy-provenance.js');
  delete require.cache[modulePath];
  return require(modulePath);
}

function listenWithVersion(version) {
  const server = http.createServer((req, res) => {
    if (req.url !== '/api/version') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(version));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/api/version`,
      });
    });
  });
}

function runDriftCheck(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      'tools/deploy-drift-check.js',
      ...args,
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...options.env,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

describe('deploy provenance', () => {
  it('prefers explicit deployment env for /api/version payloads', () => {
    process.env.AGENTFOLIO_COMMIT_SHA = '0123456789abcdef0123456789abcdef01234567';
    process.env.AGENTFOLIO_BUILD_TIME = '2026-07-06T18:26:00.000Z';

    const { getDeployProvenance } = loadFreshProvenance();
    const payload = getDeployProvenance();

    assert.strictEqual(payload.service, 'agentfolio');
    assert.strictEqual(payload.commitSha, process.env.AGENTFOLIO_COMMIT_SHA);
    assert.strictEqual(payload.commit, process.env.AGENTFOLIO_COMMIT_SHA);
    assert.strictEqual(payload.runningCommitSha, process.env.AGENTFOLIO_COMMIT_SHA);
    assert.strictEqual(payload.buildCommitSha, process.env.AGENTFOLIO_COMMIT_SHA);
    assert.strictEqual(payload.shortCommit, '0123456789ab');
    assert.strictEqual(payload.buildTime, process.env.AGENTFOLIO_BUILD_TIME);
    assert.ok(payload.startedAt);
    assert.strictEqual(payload.source, 'build');
    assert.ok(payload.checkoutHead);
  });

  it('captures checkout fallback once at process start instead of per request', () => {
    let calls = 0;
    childProcess.execFileSync = () => {
      calls += 1;
      return calls === 1
        ? '1111111111111111111111111111111111111111\n'
        : '2222222222222222222222222222222222222222\n';
    };

    const { getDeployProvenance } = loadFreshProvenance();
    const first = getDeployProvenance();
    const second = getDeployProvenance();

    assert.strictEqual(first.commitSha, '1111111111111111111111111111111111111111');
    assert.strictEqual(second.commitSha, '1111111111111111111111111111111111111111');
    assert.strictEqual(first.checkoutHead, '1111111111111111111111111111111111111111');
    assert.strictEqual(first.source, 'checkout');
    assert.strictEqual(calls, 1);
  });

  it('registers the public /api/version route in the server source', () => {
    const source = fs.readFileSync(path.resolve(repoRoot, 'src/server.js'), 'utf8');

    assert.ok(source.includes("app.get('/api/version'"));
    assert.ok(source.includes('getDeployProvenance()'));
  });

  it('reports in_sync when the running production SHA and checkout match origin/main', async () => {
    const originSha = execFileSync('git', ['rev-parse', 'origin/main'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    const { server, url } = await listenWithVersion({
      runningCommitSha: originSha,
      commitSha: originSha,
      buildCommitSha: originSha,
      source: 'build',
      checkoutHead: originSha,
      buildTime: '2026-07-06T18:26:00.000Z',
    });

    try {
      const result = await runDriftCheck([
        `--prod-url=${url}`,
        `--repo=${repoRoot}`,
        `--origin-ref=${originSha}`,
        '--json',
      ]);

      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.status, 'in_sync');
      assert.strictEqual(payload.stampMismatch, false);
      assert.strictEqual(payload.production.commitSha, originSha);
      assert.strictEqual(payload.production.buildCommitSha, originSha);
      assert.strictEqual(payload.production.source, 'build');
      assert.strictEqual(payload.production.checkoutHead, originSha);
      assert.strictEqual(payload.origin.commitSha, originSha);
    } finally {
      server.close();
    }
  });

  it('reports stamp_mismatch when the stamped running SHA matches origin but checkout differs', async () => {
    const originSha = execFileSync('git', ['rev-parse', 'origin/main'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    const checkoutSha = '3333333333333333333333333333333333333333';
    const { server, url } = await listenWithVersion({
      runningCommitSha: originSha,
      commitSha: originSha,
      buildCommitSha: originSha,
      source: 'build',
      checkoutHead: checkoutSha,
      buildTime: '2026-07-06T18:26:00.000Z',
    });

    try {
      const result = await runDriftCheck([
        `--prod-url=${url}`,
        `--repo=${repoRoot}`,
        `--origin-ref=${originSha}`,
        '--json',
      ]);

      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.status, 'stamp_mismatch');
      assert.strictEqual(payload.stampMismatch, true);
      assert.strictEqual(payload.production.commitSha, originSha);
      assert.strictEqual(payload.production.buildCommitSha, originSha);
      assert.strictEqual(payload.production.checkoutHead, checkoutSha);
      assert.strictEqual(payload.origin.commitSha, originSha);
    } finally {
      server.close();
    }
  });

  it('reports checkout_unverifiable when stamped production provenance omits checkoutHead', async () => {
    const originSha = execFileSync('git', ['rev-parse', 'origin/main'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    const { server, url } = await listenWithVersion({
      runningCommitSha: originSha,
      commitSha: originSha,
      buildCommitSha: originSha,
      source: 'build',
      buildTime: '2026-07-06T18:26:00.000Z',
    });

    try {
      const result = await runDriftCheck([
        `--prod-url=${url}`,
        `--repo=${repoRoot}`,
        `--origin-ref=${originSha}`,
        '--fail-on-drift',
        '--json',
      ]);

      assert.strictEqual(result.status, 1, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.status, 'checkout_unverifiable');
      assert.strictEqual(payload.stampMismatch, false);
      assert.strictEqual(payload.checkoutUnverifiable, true);
      assert.strictEqual(payload.production.commitSha, originSha);
      assert.strictEqual(payload.production.buildCommitSha, originSha);
      assert.strictEqual(payload.production.source, 'build');
      assert.strictEqual(payload.production.checkoutHead, null);
      assert.strictEqual(payload.origin.commitSha, originSha);
    } finally {
      server.close();
    }
  });

  it('writes evidence when production /api/version drifts from origin/main', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-drift-'));
    const evidenceFile = path.join(tempDir, 'deploy-drift.json');
    const driftSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const { server, url } = await listenWithVersion({
      commitSha: driftSha,
      buildTime: '2026-07-06T18:26:00.000Z',
    });

    try {
      const result = await runDriftCheck([
        `--prod-url=${url}`,
        `--repo=${repoRoot}`,
        `--write-evidence=${evidenceFile}`,
        '--json',
      ]);

      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      const written = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
      assert.strictEqual(payload.status, 'drift');
      assert.strictEqual(written.status, 'drift');
      assert.strictEqual(written.production.commitSha, driftSha);
      assert.ok(written.origin.commitSha);
    } finally {
      server.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('maps the committed PM2 drift cron to HQ task creation on drift', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-hq-drift-'));
    const mockHqCli = path.join(tempDir, 'mock-hq.sh');
    const hqArgsLog = path.join(tempDir, 'hq-args.log');
    const evidenceFile = path.join(tempDir, 'deploy-drift.json');
    const driftSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const pm2Config = JSON.parse(fs.readFileSync(
      path.resolve(repoRoot, 'tools/deploy-drift-cron-pm2.json'),
      'utf8'
    ));
    const app = pm2Config.apps.find((entry) => entry.name === 'agentfolio-deploy-drift-check');
    const { server, url } = await listenWithVersion({
      commitSha: driftSha,
      buildTime: '2026-07-06T18:26:00.000Z',
    });

    fs.writeFileSync(mockHqCli, [
      '#!/bin/sh',
      'printf "%s\\n" "$*" >> "$HQ_ARGS_LOG"',
      'echo "MOCK-HQ-TASK-ID"',
      '',
    ].join('\n'), { mode: 0o700 });

    try {
      assert.ok(app, 'PM2 drift-check app is committed');
      assert.strictEqual(app.env.AGENTFOLIO_CREATE_DRIFT_TASK, 'true');
      assert.strictEqual(app.env.HQ_CLI, '~/clawd/scripts/hq-env.zsh hq');

      const result = await runDriftCheck([
        `--prod-url=${url}`,
        `--repo=${repoRoot}`,
        '--json',
      ], {
        env: {
          ...app.env,
          AGENTFOLIO_DRIFT_EVIDENCE_FILE: evidenceFile,
          HQ_CLI: mockHqCli,
          HQ_ARGS_LOG: hqArgsLog,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      const hqArgs = fs.readFileSync(hqArgsLog, 'utf8');
      assert.strictEqual(payload.status, 'drift');
      assert.deepStrictEqual(payload.hqWrite, {
        enabled: true,
        mode: 'create',
        route: 'task create --project=agentfolio --agent=brainforge --priority=p1',
        cli: mockHqCli,
        env: {
          HQ_CLI: 'set',
          HQ_TASK_ID: 'unset',
          AGENTFOLIO_DRIFT_HQ_TASK_ID: 'unset',
          AGENTFOLIO_CREATE_DRIFT_TASK: 'true',
        },
      });
      assert.strictEqual(payload.hq.write.route, 'POST /tasks');
      assert.strictEqual(payload.hq.readback.route, 'GET /tasks/TASK-ID');
      assert.strictEqual(payload.hq.readback.result.ok, true);
      assert.strictEqual(payload.hqUpdate.ok, true);
      assert.match(hqArgs, /^task create /);
      assert.match(hqArgs, /task show TASK-ID/);
      assert.match(hqArgs, /--project=agentfolio/);
      assert.match(hqArgs, /--agent=brainforge/);
      assert.match(hqArgs, /--priority=p1/);
      assert.match(hqArgs, /AgentFolio deploy drift check: drift/);
    } finally {
      server.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('writes drift to HQ and performs a safety readback when a task id is configured', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentfolio-hq-drift-'));
    const hqLog = path.join(tempDir, 'hq-commands.log');
    const hqCli = path.join(tempDir, 'mock-hq.sh');
    const evidenceFile = path.join(tempDir, 'deploy-drift.json');
    const driftSha = 'cccccccccccccccccccccccccccccccccccccccc';
    const hqTaskId = 'TASK-DRIFT-READBACK';

    fs.writeFileSync(hqCli, [
      '#!/bin/sh',
      'printf "%s\\n" "$*" >> "$HQ_LOG"',
      'if [ "$1" = "task" ] && [ "$2" = "deliver" ]; then echo "Task $3 delivered"; exit 0; fi',
      'if [ "$1" = "task" ] && [ "$2" = "show" ]; then echo "Status: delivered"; echo "Task: $3"; exit 0; fi',
      'echo "unexpected command: $*" >&2',
      'exit 2',
      '',
    ].join('\n'), { mode: 0o700 });

    const { server, url } = await listenWithVersion({
      commitSha: driftSha,
      buildTime: '2026-07-06T18:26:00.000Z',
    });

    try {
      const result = await runDriftCheck([
        `--prod-url=${url}`,
        `--repo=${repoRoot}`,
        `--hq-task-id=${hqTaskId}`,
        `--hq-cli=${hqCli}`,
        '--json',
      ], {
        env: {
          AGENTFOLIO_DRIFT_EVIDENCE_FILE: evidenceFile,
          HQ_LOG: hqLog,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      const hqCommands = fs.readFileSync(hqLog, 'utf8');
      assert.strictEqual(payload.status, 'drift');
      assert.strictEqual(payload.hq.write.route, `PUT /tasks/${hqTaskId}/deliver`);
      assert.strictEqual(payload.hq.cli.value, hqCli);
      assert.strictEqual(payload.hq.env.taskId.source, 'argv:--hq-task-id');
      assert.strictEqual(payload.hq.readback.route, `GET /tasks/${hqTaskId}`);
      assert.strictEqual(payload.hq.readback.result.ok, true);
      assert.match(hqCommands, new RegExp(`task deliver ${hqTaskId} .*hqRoute=PUT /tasks/${hqTaskId}/deliver`));
      assert.match(hqCommands, new RegExp(`task deliver ${hqTaskId} .*hqCli=${hqCli}`));
      assert.match(hqCommands, new RegExp(`task show ${hqTaskId}`));
    } finally {
      server.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
