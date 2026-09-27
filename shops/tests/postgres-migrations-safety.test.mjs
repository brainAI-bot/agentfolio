import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('../scripts/postgres-migrations.mjs', import.meta.url));

test('migration runner refuses a non-loopback host before invoking psql', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'shops-migration-safety-'));
  const marker = resolve(directory, 'psql-invoked');
  const stub = resolve(directory, 'psql-stub.mjs');
  writeFileSync(stub, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.PSQL_STUB_MARKER, 'invoked');\n`);
  chmodSync(stub, 0o755);

  const result = spawnSync(process.execPath, [runner, 'test'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SHOPS_POSTGRES_HOST: 'db.example.invalid',
      PSQL_BIN: stub,
      PSQL_STUB_MARKER: marker,
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /refusing PostgreSQL migration against non-loopback host/);
  assert.equal(existsSync(marker), false, existsSync(marker) ? readFileSync(marker, 'utf8') : 'psql stub was not invoked');
});
