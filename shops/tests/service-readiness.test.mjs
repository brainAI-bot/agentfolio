import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { test } from 'node:test';

test('PostgreSQL-only readiness does not require MinIO', async (t) => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const { port } = server.address();
  const result = spawnSync(process.execPath, ['scripts/wait-for-services.mjs'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: {
      ...process.env,
      SHOPS_REQUIRED_SERVICES: 'postgres',
      SHOPS_POSTGRES_PORT: String(port),
      SHOPS_MINIO_PORT: '1',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PostgreSQL reachable/);
  assert.doesNotMatch(result.stdout, /MinIO/);
});

test('readiness rejects an unknown required service', () => {
  const result = spawnSync(process.execPath, ['scripts/wait-for-services.mjs'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, SHOPS_REQUIRED_SERVICES: 'redis' },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown required service: redis/);
});