BEGIN;

INSERT INTO shops.catalogue_versions (
  product_id, product_version, title, summary, availability,
  artifact_id, artifact_version, artifact_sha256, artifact_bytes, artifact_media_type,
  price_scheme, payment_network, payment_asset, amount_minor,
  licence_id, licence_version, licence_reference
) VALUES (
  'fixture-observer-product', '2026.09.1', 'Inert contract fixture', 'Synthetic non-sale fixture', 'AVAILABLE_FOR_QUOTE',
  'fixture-artifact-2026-09-1', '2026.09.1', repeat('a', 64), 29, 'application/octet-stream',
  'exact', 'eip155:84532', 'fixture-base-sepolia-asset', 1000,
  'fixture-evaluation-licence', '1.0.0', 'urn:makings:shops:licence:fixture-evaluation:1.0.0'
);

INSERT INTO shops.quotes (
  quote_id, quote_hash, product_id, product_version, quote_body, licence_body, issued_at, expires_at
) VALUES (
  'quote_fixture', repeat('b', 64), 'fixture-observer-product', '2026.09.1',
  '{"schemaVersion":1}'::jsonb, '{"licenceId":"fixture-evaluation-licence"}'::jsonb,
  '2026-09-27T12:00:00Z', '2026-09-27T12:10:00Z'
);

INSERT INTO shops.orders (
  order_id, quote_id, idempotency_key, request_hash, created_at, updated_at
) VALUES (
  'order_fixture', 'quote_fixture', 'order-request-001', repeat('c', 64),
  '2026-09-27T12:01:00Z', '2026-09-27T12:01:00Z'
);

DO $$
BEGIN
  BEGIN
    UPDATE shops.catalogue_versions SET title = 'mutated' WHERE product_id = 'fixture-observer-product';
    RAISE EXCEPTION 'expected pinned catalogue mutation to fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO shops.orders (
      order_id, quote_id, idempotency_key, request_hash, created_at, updated_at
    ) VALUES (
      'order_duplicate_quote', 'quote_fixture', 'order-request-002', repeat('d', 64),
      '2026-09-27T12:01:00Z', '2026-09-27T12:01:00Z'
    );
    RAISE EXCEPTION 'expected one-order-per-quote constraint to fail';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END;
$$;

INSERT INTO shops.payment_dispatches (
  dispatch_id, order_id, leg, state, authorization_id, payment_fingerprint,
  dispatched_at, settlement_id, transaction_hash, receipt_at
) VALUES
  (
    'dispatch_fee', 'order_fixture', 'fee', 'AWAITING_FINALITY',
    'authorization-fee', 'fingerprint-fee', '2026-09-27T12:02:00Z',
    'settlement-fee', '0xtx-fee', '2026-09-27T12:02:01Z'
  ),
  (
    'dispatch_product', 'order_fixture', 'product', 'AWAITING_FINALITY',
    'authorization-product', 'fingerprint-product', '2026-09-27T12:02:02Z',
    'settlement-product', '0xtx-product', '2026-09-27T12:02:03Z'
  );

DO $$
BEGIN
  BEGIN
    INSERT INTO shops.finality_receipts (
      finality_receipt_id, dispatch_id, safe_at, finalized_at, observed_at
    ) VALUES (
      'finality_invalid', 'dispatch_fee',
      '2026-09-27T12:01:59Z', '2026-09-27T12:03:00Z', '2026-09-27T12:03:01Z'
    );
    RAISE EXCEPTION 'expected finality before receipt to fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO shops.delivery_receipts (
      receipt_id, order_id, entitlement_id, artifact_id, artifact_version,
      artifact_sha256, artifact_bytes, receipt_hash, issued_at, receipt_body
    ) VALUES (
      'receipt_too_early', 'order_fixture', 'entitlement-too-early',
      'fixture-artifact-2026-09-1', '2026.09.1', repeat('a', 64), 29,
      repeat('e', 64), '2026-09-27T12:04:00Z', '{}'::jsonb
    );
    RAISE EXCEPTION 'expected delivery without state/finality to fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

INSERT INTO shops.finality_receipts (
  finality_receipt_id, dispatch_id, safe_at, finalized_at, observed_at, evidence
) VALUES
  (
    'finality_fee', 'dispatch_fee',
    '2026-09-27T12:03:00Z', '2026-09-27T12:04:00Z', '2026-09-27T12:04:01Z',
    '{"confirmations":"safe-and-finalized"}'::jsonb
  ),
  (
    'finality_product', 'dispatch_product',
    '2026-09-27T12:03:01Z', '2026-09-27T12:04:01Z', '2026-09-27T12:04:02Z',
    '{"confirmations":"safe-and-finalized"}'::jsonb
  );

UPDATE shops.orders
SET state = 'READY_FOR_DELIVERY', updated_at = '2026-09-27T12:04:03Z'
WHERE order_id = 'order_fixture';

INSERT INTO shops.delivery_receipts (
  receipt_id, order_id, entitlement_id, artifact_id, artifact_version,
  artifact_sha256, artifact_bytes, receipt_hash, issued_at, delivered_at, receipt_body
) VALUES (
  'receipt_fixture', 'order_fixture', 'entitlement-fixture',
  'fixture-artifact-2026-09-1', '2026.09.1', repeat('a', 64), 29,
  repeat('f', 64), '2026-09-27T12:05:00Z', '2026-09-27T12:05:01Z',
  '{"schemaVersion":1,"orderId":"order_fixture"}'::jsonb
);

DO $$
DECLARE
  catalogue_count integer;
  quote_count integer;
  order_count integer;
  dispatch_count integer;
  finality_count integer;
  delivery_count integer;
BEGIN
  SELECT count(*) INTO catalogue_count FROM shops.catalogue_versions;
  SELECT count(*) INTO quote_count FROM shops.quotes;
  SELECT count(*) INTO order_count FROM shops.orders;
  SELECT count(*) INTO dispatch_count FROM shops.payment_dispatches;
  SELECT count(*) INTO finality_count FROM shops.finality_receipts;
  SELECT count(*) INTO delivery_count FROM shops.delivery_receipts;

  IF (catalogue_count, quote_count, order_count, dispatch_count, finality_count, delivery_count)
     <> (1, 1, 1, 2, 2, 1) THEN
    RAISE EXCEPTION 'unexpected durable row counts: %, %, %, %, %, %',
      catalogue_count, quote_count, order_count, dispatch_count, finality_count, delivery_count;
  END IF;
END;
$$;

ROLLBACK;
