const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

afterEach(() => {
  delete process.env.AGENTFOLIO_COMMIT_SHA;
  delete process.env.AGENTFOLIO_BUILD_TIME;
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

function runDriftCheck(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      'tools/deploy-drift-check.js',
      ...args,
    ], {
      cwd: repoRoot,
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
    assert.strictEqual(payload.shortCommit, '0123456789ab');
    assert.strictEqual(payload.buildTime, process.env.AGENTFOLIO_BUILD_TIME);
    assert.ok(payload.startedAt);
  });

  it('registers the public /api/version route in the server source', () => {
    const source = fs.readFileSync(path.resolve(repoRoot, 'src/server.js'), 'utf8');

    assert.ok(source.includes("app.get('/api/version'"));
    assert.ok(source.includes('getDeployProvenance()'));
  });

  it('reports in_sync when production /api/version matches origin/main', async () => {
    const originSha = execFileSync('git', ['rev-parse', 'origin/main'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    const { server, url } = await listenWithVersion({
      commitSha: originSha,
      buildTime: '2026-07-06T18:26:00.000Z',
    });

    try {
      const result = await runDriftCheck([
        `--prod-url=${url}`,
        `--repo=${repoRoot}`,
        '--json',
      ]);

      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.status, 'in_sync');
      assert.strictEqual(payload.production.commitSha, originSha);
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
});
