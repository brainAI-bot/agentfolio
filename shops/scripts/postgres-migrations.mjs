import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrations = [
  {
    id: '0001_durable_commerce',
    up: resolve(root, 'db/migrations/0001_durable_commerce.up.sql'),
    down: resolve(root, 'db/migrations/0001_durable_commerce.down.sql'),
    test: resolve(root, 'db/tests/0001_durable_commerce.test.sql'),
  },
  {
    id: '0002_durable_orders_dispatch',
    up: resolve(root, 'db/migrations/0002_durable_orders_dispatch.up.sql'),
    down: resolve(root, 'db/migrations/0002_durable_orders_dispatch.down.sql'),
    test: resolve(root, 'db/tests/0002_durable_orders_dispatch.test.sql'),
  },
];
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

function relationExists(name, expected, label) {
  const actualPresent = relationIsPresent(name, label);
  if (actualPresent !== expected) {
    throw new Error(`${label}: expected ${expected ? 't' : 'f'}, received ${actualPresent ? 't' : 'f'}`);
  }
}

function relationIsPresent(name, label) {
  const escaped = name.replaceAll("'", "''");
  const actual = psql(`SELECT to_regclass('${escaped}') IS NOT NULL;`, label, { tuplesOnly: true });
  if (actual !== 't' && actual !== 'f') {
    throw new Error(`${label}: expected PostgreSQL boolean, received ${actual || '<empty>'}`);
  }
  return actual === 't';
}

function runUp(selected = migrations) {
  for (const migration of selected) runFile(migration.up, `${migration.id} up`);
}

function runDown(selected = migrations.toReversed()) {
  for (const migration of selected) runFile(migration.down, `${migration.id} down`);
}

function applyPendingMigrations() {
  const [base, durable] = migrations;
  const basePresent = relationIsPresent('shops.orders', 'migration state base readback');
  const durablePresent = relationIsPresent('shops.order_payment_legs', 'migration state durable readback');

  if (!basePresent) runFile(base.up, `${base.id} up`);
  if (!durablePresent) runFile(durable.up, `${durable.id} up`);
}

function rollbackLatestMigration() {
  const [, durable] = migrations;
  if (relationIsPresent('shops.order_payment_legs', 'rollback state durable readback')) {
    runFile(durable.down, `${durable.id} down`);
  }
}

function durablePacketExists(expected, label) {
  relationExists('shops.order_payment_legs', expected, `${label} order_payment_legs`);
  relationExists('shops.payment_dispatch_results', expected, `${label} payment_dispatch_results`);
  relationExists('shops.order_dispatch_readback', expected, `${label} order_dispatch_readback`);
}

function createRollbackSentinel() {
  psql(`
    INSERT INTO shops.catalogue_versions (
      product_id, product_version, title, summary, availability,
      artifact_id, artifact_version, artifact_sha256, artifact_bytes, artifact_media_type,
      price_scheme, payment_network, payment_asset, amount_minor,
      licence_id, licence_version, licence_reference
    ) VALUES (
      'rollback-sentinel-product', '2026.09.2', 'Rollback sentinel', 'Synthetic fixture', 'AVAILABLE_FOR_QUOTE',
      'rollback-sentinel-artifact', '2026.09.2', repeat('a', 64), 17, 'application/octet-stream',
      'exact', 'eip155:84532', 'fixture-base-sepolia-asset', 1000,
      'fixture-evaluation-licence', '1.0.0', 'urn:makings:shops:licence:fixture-evaluation:1.0.0'
    );
    INSERT INTO shops.quotes (
      quote_id, quote_hash, pair_hash, product_id, product_version,
      quote_body, licence_body, issued_at, expires_at
    ) VALUES (
      'rollback_sentinel_quote', repeat('0', 64), repeat('a', 64),
      'rollback-sentinel-product', '2026.09.2', '{}'::jsonb, '{}'::jsonb,
      '2026-09-28T06:00:00Z', '2026-09-28T06:30:00Z'
    );
    INSERT INTO shops.payment_leg_quotes (
      leg_quote_id, quote_id, leg, leg_quote_hash, payment_network, price_scheme,
      payment_asset, amount_minor, pay_to, facilitator_id, valid_before, quote_body
    ) VALUES
      ('rollback_sentinel_fee', 'rollback_sentinel_quote', 'fee', repeat('d', 64),
       'eip155:84532', 'exact', 'fixture-base-sepolia-asset', 100,
       '0xfee-payee', 'fixture-facilitator', '2026-09-28T06:30:00Z', '{}'::jsonb),
      ('rollback_sentinel_product', 'rollback_sentinel_quote', 'product', repeat('e', 64),
       'eip155:84532', 'exact', 'fixture-base-sepolia-asset', 1000,
       '0xproduct-payee', 'fixture-facilitator', '2026-09-28T06:30:00Z', '{}'::jsonb);
    INSERT INTO shops.orders (
      order_id, quote_id, idempotency_key, request_hash, created_at, updated_at
    ) VALUES (
      'rollback_sentinel_order', 'rollback_sentinel_quote', 'rollback-sentinel-key', repeat('f', 64),
      '2026-09-28T06:01:00Z', '2026-09-28T06:01:00Z'
    );
    INSERT INTO shops.payment_dispatches (
      dispatch_id, order_id, quote_id, leg, leg_quote_id, state,
      authorization_id, payment_fingerprint, payment_network, price_scheme,
      payment_asset, amount_minor, pay_to, facilitator_id, valid_before,
      dispatched_at, settlement_id, transaction_hash, receipt_at
    ) VALUES (
      'rollback_sentinel_dispatch', 'rollback_sentinel_order', 'rollback_sentinel_quote',
      'fee', 'rollback_sentinel_fee', 'AWAITING_FINALITY',
      'rollback-sentinel-authorization', 'rollback-sentinel-fingerprint',
      'eip155:84532', 'exact', 'fixture-base-sepolia-asset', 100,
      '0xfee-payee', 'fixture-facilitator', '2026-09-28T06:30:00Z',
      '2026-09-28T06:02:00Z', 'rollback-sentinel-settlement',
      '0xrollback-sentinel-tx', '2026-09-28T06:02:01Z'
    );
  `, 'create rollback sentinel');
}

function rollbackSentinelSnapshot(label) {
  return psql(`
    SELECT concat_ws('|',
      catalogue.product_id,
      quote.quote_hash,
      orders.idempotency_key,
      dispatch.state::text,
      dispatch.settlement_id,
      dispatch.transaction_hash,
      dispatch.receipt_at::text
    )
    FROM shops.catalogue_versions AS catalogue
    JOIN shops.quotes AS quote
      ON quote.product_id = catalogue.product_id
     AND quote.product_version = catalogue.product_version
    JOIN shops.orders AS orders ON orders.quote_id = quote.quote_id
    JOIN shops.payment_dispatches AS dispatch ON dispatch.order_id = orders.order_id
    WHERE orders.order_id = 'rollback_sentinel_order';
  `, label, { tuplesOnly: true });
}

if (command === 'up') {
  applyPendingMigrations();
  schemaExists(true, 'migration up schema readback');
  durablePacketExists(true, 'migration up durable readback');
  console.log('shops pending migrations up: PASS');
} else if (command === 'down') {
  rollbackLatestMigration();
  schemaExists(true, 'latest rollback preserves base schema');
  durablePacketExists(false, 'latest rollback durable readback');
  relationExists('shops.orders', true, 'latest rollback preserves base orders');
  console.log('shops latest migration rollback: PASS');
} else if (command === 'test') {
  const [base, durable] = migrations;
  runFile(base.down, 'pre-test reset');

  runFile(base.up, `${base.id} up`);
  schemaExists(true, 'base up readback');
  runFile(base.test, `${base.id} constraint harness`);

  applyPendingMigrations();
  durablePacketExists(true, 'durable up readback');
  applyPendingMigrations();
  durablePacketExists(true, 'repeated up no-op readback');
  runFile(base.test, `${base.id} compatibility harness with durable migration active`);
  runFile(durable.test, `${durable.id} constraint harness`);

  rollbackLatestMigration();
  durablePacketExists(false, 'durable rollback readback');
  rollbackLatestMigration();
  durablePacketExists(false, 'repeated rollback no-op readback');
  relationExists('shops.orders', true, 'durable rollback preserves base orders');
  relationExists('shops.payment_dispatches', true, 'durable rollback preserves base dispatches');
  runFile(base.test, 'base harness after durable rollback');
  createRollbackSentinel();
  const sentinelBefore = rollbackSentinelSnapshot('rollback sentinel before durable reapply');
  if (!sentinelBefore) throw new Error('rollback sentinel was not created');

  applyPendingMigrations();
  durablePacketExists(true, 'durable reapply readback');
  runFile(durable.test, `${durable.id} reapply constraint harness`);

  rollbackLatestMigration();
  durablePacketExists(false, 'durable final rollback readback');
  const sentinelAfter = rollbackSentinelSnapshot('rollback sentinel after durable final rollback');
  if (sentinelAfter !== sentinelBefore) {
    throw new Error(`durable rollback changed base sentinel: before=${sentinelBefore} after=${sentinelAfter || '<empty>'}`);
  }
  runFile(base.down, `${base.id} post-test cleanup`);
  schemaExists(false, 'cleanup readback');
  console.log('shops PostgreSQL migrations + constraints + rollback/reapply: PASS');
} else {
  throw new Error('usage: node scripts/postgres-migrations.mjs <up|down|test>');
}
