import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const up = resolve(root, 'db/migrations/0001_durable_commerce.up.sql');
const down = resolve(root, 'db/migrations/0001_durable_commerce.down.sql');
const test = resolve(root, 'db/tests/0001_durable_commerce.test.sql');
const postgresHost = process.env.SHOPS_POSTGRES_HOST || '127.0.0.1';
const command = process.argv[2];

function isLoopbackHost(host) {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (normalized === 'localhost' || normalized === '::1') return true;
  if (isIP(normalized) !== 4) return false;
  const [firstOctet] = normalized.split('.').map(Number);
  return firstOctet === 127;
}

if (command === 'test' && !isLoopbackHost(postgresHost)) {
  throw new Error(`refusing PostgreSQL migration against non-loopback host: ${postgresHost}`);
}

function psql(sql, label, { tuplesOnly = false } = {}) {
  const args = [
    '--host', postgresHost,
    '--port', process.env.SHOPS_POSTGRES_PORT || '55432',
    '--username', process.env.SHOPS_POSTGRES_USER || 'shops_ci',
    '--dbname', process.env.SHOPS_POSTGRES_DB || 'shops_ci',
    '--set', 'ON_ERROR_STOP=1',
    ...(tuplesOnly ? ['--tuples-only', '--no-align'] : []),
  ];
  const result = spawnSync(process.env.PSQL_BIN || 'psql', args, {
    input: sql,
    encoding: 'utf8',
    env: {
      ...process.env,
      PGPASSWORD: process.env.SHOPS_POSTGRES_PASSWORD || 'shops_ci_only',
    },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit ${result.status}`);
  return result.stdout.trim();
}

function runFile(path, label) {
  psql(readFileSync(path, 'utf8'), label);
}

function schemaExists(expected, label) {
  const actual = psql("SELECT to_regnamespace('shops') IS NOT NULL;", label, { tuplesOnly: true });
  const expectedPsqlBoolean = expected ? 't' : 'f';
  if (actual !== expectedPsqlBoolean) {
    throw new Error(`${label}: expected ${expectedPsqlBoolean}, received ${actual || '<empty>'}`);
  }
}

if (command === 'up') {
  runFile(up, 'migration up');
  schemaExists(true, 'migration up readback');
  console.log('shops migration up: PASS');
} else if (command === 'down') {
  runFile(down, 'migration down');
  schemaExists(false, 'migration down readback');
  console.log('shops migration down: PASS');
} else if (command === 'test') {
  runFile(down, 'pre-test reset');
  runFile(up, 'migration up');
  schemaExists(true, 'up readback');
  runFile(test, 'constraint harness');
  runFile(down, 'rollback migration');
  schemaExists(false, 'rollback readback');
  runFile(up, 'reapply after rollback');
  schemaExists(true, 'reapply readback');
  runFile(down, 'post-test cleanup');
  schemaExists(false, 'cleanup readback');
  console.log('shops PostgreSQL migration + constraints + rollback: PASS');
} else {
  throw new Error('usage: node scripts/postgres-migrations.mjs <up|down|test>');
}