BEGIN;

INSERT INTO shops.catalogue_versions (
  product_id, product_version, title, summary, availability,
  artifact_id, artifact_version, artifact_sha256, artifact_bytes, artifact_media_type,
  price_scheme, payment_network, payment_asset, amount_minor,
  licence_id, licence_version, licence_reference
) VALUES (
  'fixture-durable-product', '2026.09.2', 'Inert durable fixture', 'Synthetic non-sale fixture', 'AVAILABLE_FOR_QUOTE',
  'fixture-durable-artifact', '2026.09.2', repeat('a', 64), 31, 'application/octet-stream',
  'exact', 'eip155:84532', 'fixture-base-sepolia-asset', 1000,
  'fixture-evaluation-licence', '1.0.0', 'urn:makings:shops:licence:fixture-evaluation:1.0.0'
);

INSERT INTO shops.quotes (
  quote_id, quote_hash, pair_hash, product_id, product_version,
  quote_body, licence_body, issued_at, expires_at
) VALUES
  ('quote_flow', repeat('b', 64), repeat('1', 64), 'fixture-durable-product', '2026.09.2',
   '{"schemaVersion":1}'::jsonb, '{"licenceId":"fixture-evaluation-licence"}'::jsonb,
   '2026-09-28T06:00:00Z', '2026-09-28T06:30:00Z'),
  ('quote_gate', repeat('c', 64), repeat('2', 64), 'fixture-durable-product', '2026.09.2',
   '{"schemaVersion":1}'::jsonb, '{"licenceId":"fixture-evaluation-licence"}'::jsonb,
   '2026-09-28T06:00:00Z', '2026-09-28T06:30:00Z'),
  ('quote_retry', repeat('d', 64), repeat('3', 64), 'fixture-durable-product', '2026.09.2',
   '{"schemaVersion":1}'::jsonb, '{"licenceId":"fixture-evaluation-licence"}'::jsonb,
   '2026-09-28T06:00:00Z', '2026-09-28T06:30:00Z');

INSERT INTO shops.payment_leg_quotes (
  leg_quote_id, quote_id, leg, leg_quote_hash,
  payment_network, price_scheme, payment_asset, amount_minor,
  pay_to, facilitator_id, valid_before, quote_body
)
SELECT
  'leg_' || quote_id || '_' || leg,
  quote_id,
  leg::shops.dispatch_leg,
  CASE quote_id || ':' || leg
    WHEN 'quote_flow:fee' THEN repeat('4', 64)
    WHEN 'quote_flow:product' THEN repeat('5', 64)
    WHEN 'quote_gate:fee' THEN repeat('6', 64)
    WHEN 'quote_gate:product' THEN repeat('7', 64)
    WHEN 'quote_retry:fee' THEN repeat('8', 64)
    ELSE repeat('9', 64)
  END,
  'eip155:84532', 'exact', 'fixture-base-sepolia-asset',
  CASE WHEN leg = 'fee' THEN 100 ELSE 1000 END,
  CASE WHEN leg = 'fee' THEN '0xfee-payee' ELSE '0xproduct-payee' END,
  'fixture-facilitator', '2026-09-28T06:30:00Z',
  jsonb_build_object('leg', leg)
FROM (VALUES
  ('quote_flow', 'fee'), ('quote_flow', 'product'),
  ('quote_gate', 'fee'), ('quote_gate', 'product'),
  ('quote_retry', 'fee'), ('quote_retry', 'product')
) AS fixtures(quote_id, leg);

INSERT INTO shops.orders (
  order_id, quote_id, idempotency_key, request_hash, created_at, updated_at
) VALUES
  ('order_flow', 'quote_flow', 'durable-order-flow', repeat('e', 64),
   '2026-09-28T06:01:00Z', '2026-09-28T06:01:00Z'),
  ('order_gate', 'quote_gate', 'durable-order-gate', repeat('f', 64),
   '2026-09-28T06:01:00Z', '2026-09-28T06:01:00Z'),
  ('order_retry', 'quote_retry', 'durable-order-retry', repeat('0', 64),
   '2026-09-28T06:01:00Z', '2026-09-28T06:01:00Z');

DO $$
DECLARE
  leg_count integer;
  version_before bigint;
BEGIN
  SELECT count(*) INTO leg_count FROM shops.order_payment_legs WHERE order_id = 'order_flow';
  IF leg_count <> 2 THEN
    RAISE EXCEPTION 'expected two durable order payment-leg rows, received %', leg_count;
  END IF;

  SELECT state_version INTO version_before FROM shops.orders WHERE order_id = 'order_flow';
  UPDATE shops.orders SET updated_at = '2026-09-28T06:01:01Z' WHERE order_id = 'order_flow';
  IF (SELECT state_version FROM shops.orders WHERE order_id = 'order_flow') <> version_before THEN
    RAISE EXCEPTION 'idempotent order update advanced state version';
  END IF;

  BEGIN
    UPDATE shops.orders
    SET state = 'PAID_AWAITING_FINALITY', updated_at = '2026-09-28T06:01:02Z'
    WHERE order_id = 'order_flow';
    RAISE EXCEPTION 'expected paid order without committed payment legs to fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE shops.order_payment_legs
    SET current_state = 'AWAITING_FINALITY', updated_at = '2026-09-28T06:01:03Z'
    WHERE order_id = 'order_gate' AND leg = 'fee';
    RAISE EXCEPTION 'expected direct payment-leg gate bypass to fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  IF shops.is_public_settlement_evidence(
    '{"error":{"code":"TIMEOUT","signature":"must-not-persist"}}'::jsonb
  ) THEN
    RAISE EXCEPTION 'nested non-allowlisted settlement evidence was accepted';
  END IF;

  IF NOT shops.is_public_settlement_evidence(
    '{"authorizer":"0x1111111111111111111111111111111111111111","payer":"0x1111111111111111111111111111111111111111","authorizationNonce":"fixture-nonce","paymentFingerprint":"fixture-fingerprint","quoteHash":"fixture-quote-hash","network":"eip155:84532","asset":"0x2222222222222222222222222222222222222222","payTo":"0x3333333333333333333333333333333333333333","amountMinor":"1000","facilitatorResponse":{"status":"settled","settlementId":"fixture-settlement","transactionHash":"0xfixture"},"errorReason":null}'::jsonb
  ) THEN
    RAISE EXCEPTION 'canonical P13 settlement evidence shape was rejected';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO shops.payment_dispatches (
      dispatch_id, order_id, quote_id, leg, leg_quote_id, state,
      authorization_id, payment_fingerprint,
      payment_network, price_scheme, payment_asset, amount_minor,
      pay_to, facilitator_id, valid_before, dispatched_at
    ) VALUES (
      'dispatch_gate_product_early', 'order_gate', 'quote_gate', 'product', 'leg_quote_gate_product', 'DISPATCHED',
      'authorization-gate-product-early', 'fingerprint-gate-product-early',
      'eip155:84532', 'exact', 'fixture-base-sepolia-asset', 1000,
      '0xproduct-payee', 'fixture-facilitator', '2026-09-28T06:30:00Z', '2026-09-28T06:02:00Z'
    );
    RAISE EXCEPTION 'expected product dispatch before committed fee to fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO shops.payment_dispatches (
      dispatch_id, order_id, quote_id, leg, leg_quote_id, attempt_no, state,
      authorization_id, payment_fingerprint,
      payment_network, price_scheme, payment_asset, amount_minor,
      pay_to, facilitator_id, valid_before, dispatched_at, failure_code
    ) VALUES (
      'dispatch_gate_fee_attempt_2', 'order_gate', 'quote_gate', 'fee', 'leg_quote_gate_fee', 2, 'FAILED',
      'authorization-gate-fee-attempt-2', 'fingerprint-gate-fee-attempt-2',
      'eip155:84532', 'exact', 'fixture-base-sepolia-asset', 100,
      '0xfee-payee', 'fixture-facilitator', '2026-09-28T06:30:00Z', '2026-09-28T06:02:00Z',
      'INVALID_ATTEMPT_NUMBER'
    );
    RAISE EXCEPTION 'expected first dispatch attempt number two to fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

INSERT INTO shops.payment_dispatches (
  dispatch_id, order_id, quote_id, leg, leg_quote_id, state,
  authorization_id, payment_fingerprint,
  payment_network, price_scheme, payment_asset, amount_minor,
  pay_to, facilitator_id, valid_before, dispatched_at,
  observed_settlement_id, observed_transaction_hash,
  settlement_evidence, error_reason, updated_at
) VALUES (
  'dispatch_gate_fee_unknown', 'order_gate', 'quote_gate', 'fee', 'leg_quote_gate_fee', 'SETTLEMENT_UNKNOWN',
  'authorization-gate-fee-unknown', 'fingerprint-gate-fee-unknown',
  'eip155:84532', 'exact', 'fixture-base-sepolia-asset', 100,
  '0xfee-payee', 'fixture-facilitator', '2026-09-28T06:30:00Z', '2026-09-28T06:02:01Z',
  'settlement-gate-fee-unknown', '0xtx-gate-fee-unknown',
  '{"status":"unknown","error":{"code":"TIMEOUT","message":"synthetic ambiguous fixture"}}'::jsonb,
  'synthetic ambiguous fixture', '2026-09-28T06:02:02Z'
);

UPDATE shops.payment_dispatches
SET state = 'FAILED',
    failure_code = 'AMBIGUOUS_TIMEOUT',
    settlement_evidence = '{"status":"failed","failureCode":"AMBIGUOUS_TIMEOUT","errorReason":"synthetic ambiguous terminal marker"}'::jsonb,
    error_reason = 'synthetic ambiguous terminal marker',
    updated_at = '2026-09-28T06:02:03Z'
WHERE dispatch_id = 'dispatch_gate_fee_unknown';

DO $$
BEGIN
  BEGIN
    INSERT INTO shops.payment_dispatches (
      dispatch_id, order_id, quote_id, leg, leg_quote_id, attempt_no, state,
      authorization_id, payment_fingerprint,
      payment_network, price_scheme, payment_asset, amount_minor,
      pay_to, facilitator_id, valid_before, dispatched_at
    ) VALUES (
      'dispatch_gate_fee_after_unknown', 'order_gate', 'quote_gate', 'fee', 'leg_quote_gate_fee', 2, 'DISPATCHED',
      'authorization-gate-fee-after-unknown', 'fingerprint-gate-fee-after-unknown',
      'eip155:84532', 'exact', 'fixture-base-sepolia-asset', 100,
      '0xfee-payee', 'fixture-facilitator', '2026-09-28T06:30:00Z', '2026-09-28T06:02:04Z'
    );
    RAISE EXCEPTION 'expected retry after an unknown result to fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

INSERT INTO shops.payment_dispatches (
  dispatch_id, order_id, quote_id, leg, leg_quote_id, state,
  authorization_id, payment_fingerprint,
  payment_network, price_scheme, payment_asset, amount_minor,
  pay_to, facilitator_id, valid_before, dispatched_at,
  settlement_id, transaction_hash, receipt_at, settlement_evidence, updated_at
) VALUES (
  'dispatch_flow_fee', 'order_flow', 'quote_flow', 'fee', 'leg_quote_flow_fee', 'AWAITING_FINALITY',
  'authorization-flow-fee', 'fingerprint-flow-fee',
  'eip155:84532', 'exact', 'fixture-base-sepolia-asset', 100,
  '0xfee-payee', 'fixture-facilitator', '2026-09-28T06:30:00Z', '2026-09-28T06:03:00Z',
  'settlement-flow-fee', '0xtx-flow-fee', '2026-09-28T06:03:01Z',
  jsonb_build_object(
    'authorizer', '0x1111111111111111111111111111111111111111',
    'payer', '0x1111111111111111111111111111111111111111',
    'authorizationNonce', 'fixture-fee-nonce',
    'paymentFingerprint', 'fingerprint-flow-fee',
    'quoteHash', repeat('4', 64),
    'network', 'eip155:84532',
    'asset', 'fixture-base-sepolia-asset',
    'payTo', '0xfee-payee',
    'amountMinor', '100',
    'facilitatorResponse', jsonb_build_object(
      'status', 'success',
      'transactionHash', '0xtx-flow-fee',
      'settlementId', 'settlement-flow-fee',
      'receiptAt', '2026-09-28T06:03:01Z'
    ),
    'errorReason', NULL
  ),
  '2026-09-28T06:03:01Z'
);

INSERT INTO shops.payment_dispatches (
  dispatch_id, order_id, quote_id, leg, leg_quote_id, state,
  authorization_id, payment_fingerprint,
  payment_network, price_scheme, payment_asset, amount_minor,
  pay_to, facilitator_id, valid_before, dispatched_at,
  observed_settlement_id, observed_transaction_hash,
  settlement_evidence, error_reason, updated_at
) VALUES (
  'dispatch_flow_product', 'order_flow', 'quote_flow', 'product', 'leg_quote_flow_product', 'SETTLEMENT_UNKNOWN',
  'authorization-flow-product', 'fingerprint-flow-product',
  'eip155:84532', 'exact', 'fixture-base-sepolia-asset', 1000,
  '0xproduct-payee', 'fixture-facilitator', '2026-09-28T06:30:00Z', '2026-09-28T06:03:02Z',
  'settlement-flow-product', '0xtx-flow-product',
  '{"status":"unknown","error":{"code":"TIMEOUT","message":"synthetic fixture timeout"}}'::jsonb,
  'synthetic fixture timeout', '2026-09-28T06:03:03Z'
);

UPDATE shops.orders
SET state = 'PAYMENT_UNKNOWN', updated_at = '2026-09-28T06:03:03Z'
WHERE order_id = 'order_flow';

DO $$
BEGIN
  BEGIN
    UPDATE shops.payment_dispatches
    SET state = 'AWAITING_FINALITY',
        settlement_id = 'settlement-flow-product',
        transaction_hash = '0xtx-flow-product',
        receipt_at = '2026-09-28T06:03:04Z',
        settlement_evidence = '{"error":{"code":"TIMEOUT","signature":"must-not-persist"}}'::jsonb,
        updated_at = '2026-09-28T06:03:04Z'
    WHERE dispatch_id = 'dispatch_flow_product';
    RAISE EXCEPTION 'expected nested non-allowlisted reconciliation evidence to fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO shops.payment_dispatch_results (
      result_id, dispatch_id, observation_no, observation_kind, outcome,
      observed_settlement_id, observed_transaction_hash, observed_receipt_at,
      evidence, observed_at
    ) VALUES (
      'dispatch_flow_product:forged-result', 'dispatch_flow_product', 2, 'RECONCILIATION', 'COMMITTED',
      'settlement-flow-product', '0xtx-flow-product', '2026-09-28T06:03:04Z',
      jsonb_build_object(
        'authorizer', '0x1111111111111111111111111111111111111111',
        'payer', '0x1111111111111111111111111111111111111111',
        'authorizationNonce', 'fixture-product-nonce',
        'paymentFingerprint', 'fingerprint-flow-product',
        'quoteHash', repeat('f', 64),
        'network', 'eip155:84532',
        'asset', 'fixture-base-sepolia-asset',
        'payTo', '0xproduct-payee',
        'amountMinor', '1000',
        'facilitatorResponse', jsonb_build_object(
          'status', 'success',
          'settlementId', 'settlement-flow-product',
          'transactionHash', '0xtx-flow-product'
        ),
        'errorReason', NULL
      ),
      '2026-09-28T06:03:04Z'
    );
    RAISE EXCEPTION 'expected forged append-only result evidence to fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO shops.payment_dispatch_results (
      result_id, dispatch_id, observation_no, observation_kind, outcome,
      observed_settlement_id, observed_transaction_hash, evidence, observed_at
    ) VALUES (
      'dispatch_flow_product:contradictory-result', 'dispatch_flow_product', 2, 'RECONCILIATION', 'UNKNOWN',
      'settlement-flow-product', '0xtx-flow-product',
      '{"status":"success","settlementId":"settlement-flow-product","transactionHash":"0xtx-flow-product"}'::jsonb,
      '2026-09-28T06:03:04Z'
    );
    RAISE EXCEPTION 'expected contradictory bare result evidence to fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

UPDATE shops.payment_dispatches
SET state = 'AWAITING_FINALITY',
    settlement_id = 'settlement-flow-product',
    transaction_hash = '0xtx-flow-product',
    receipt_at = '2026-09-28T06:03:04Z',
    settlement_evidence = '{"status":"success","transactionHash":"0xtx-flow-product","settlementId":"settlement-flow-product","receiptAt":"2026-09-28T06:03:04Z"}'::jsonb,
    error_reason = NULL,
    updated_at = '2026-09-28T06:03:04Z'
WHERE dispatch_id = 'dispatch_flow_product';

UPDATE shops.orders
SET state = 'PAID_AWAITING_FINALITY', updated_at = '2026-09-28T06:03:05Z'
WHERE order_id = 'order_flow';

INSERT INTO shops.payment_dispatches (
  dispatch_id, order_id, quote_id, leg, leg_quote_id, attempt_no, state,
  authorization_id, payment_fingerprint,
  payment_network, price_scheme, payment_asset, amount_minor,
  pay_to, facilitator_id, valid_before, dispatched_at, failure_code,
  settlement_evidence, error_reason, updated_at
) VALUES (
  'dispatch_retry_fee_1', 'order_retry', 'quote_retry', 'fee', 'leg_quote_retry_fee', 1, 'FAILED',
  'authorization-retry-fee-1', 'fingerprint-retry-fee-1',
  'eip155:84532', 'exact', 'fixture-base-sepolia-asset', 100,
  '0xfee-payee', 'fixture-facilitator', '2026-09-28T06:30:00Z', '2026-09-28T06:04:00Z', 'FACILITATOR_REJECTED',
  '{"failureCode":"FACILITATOR_REJECTED","errorReason":"synthetic fixture rejection"}'::jsonb,
  'synthetic fixture rejection', '2026-09-28T06:04:01Z'
);

INSERT INTO shops.payment_dispatches (
  dispatch_id, order_id, quote_id, leg, leg_quote_id, attempt_no, state,
  authorization_id, payment_fingerprint,
  payment_network, price_scheme, payment_asset, amount_minor,
  pay_to, facilitator_id, valid_before, dispatched_at,
  settlement_id, transaction_hash, receipt_at, settlement_evidence, updated_at
) VALUES (
  'dispatch_retry_fee_2', 'order_retry', 'quote_retry', 'fee', 'leg_quote_retry_fee', 2, 'AWAITING_FINALITY',
  'authorization-retry-fee-2', 'fingerprint-retry-fee-2',
  'eip155:84532', 'exact', 'fixture-base-sepolia-asset', 100,
  '0xfee-payee', 'fixture-facilitator', '2026-09-28T06:30:00Z', '2026-09-28T06:04:02Z',
  'settlement-retry-fee-2', '0xtx-retry-fee-2', '2026-09-28T06:04:03Z',
  '{"status":"success","settlementId":"settlement-retry-fee-2","transactionHash":"0xtx-retry-fee-2"}'::jsonb,
  '2026-09-28T06:04:03Z'
);

UPDATE shops.payment_dispatches
SET state = 'FAILED',
    failure_code = 'FINALITY_REJECTED',
    settlement_evidence = '{"failureCode":"FINALITY_REJECTED","errorReason":"synthetic terminal rejection"}'::jsonb,
    error_reason = 'synthetic terminal rejection',
    updated_at = '2026-09-28T06:04:04Z'
WHERE dispatch_id = 'dispatch_retry_fee_2';

DO $$
BEGIN
  BEGIN
    INSERT INTO shops.payment_dispatches (
      dispatch_id, order_id, quote_id, leg, leg_quote_id, attempt_no, state,
      authorization_id, payment_fingerprint,
      payment_network, price_scheme, payment_asset, amount_minor,
      pay_to, facilitator_id, valid_before, dispatched_at
    ) VALUES (
      'dispatch_retry_fee_3', 'order_retry', 'quote_retry', 'fee', 'leg_quote_retry_fee', 3, 'DISPATCHED',
      'authorization-retry-fee-3', 'fingerprint-retry-fee-3',
      'eip155:84532', 'exact', 'fixture-base-sepolia-asset', 100,
      '0xfee-payee', 'fixture-facilitator', '2026-09-28T06:30:00Z', '2026-09-28T06:04:05Z'
    );
    RAISE EXCEPTION 'expected retry after a committed result to fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO shops.payment_dispatches (
      dispatch_id, order_id, quote_id, leg, leg_quote_id, state,
      authorization_id, payment_fingerprint,
      payment_network, price_scheme, payment_asset, amount_minor,
      pay_to, facilitator_id, valid_before, dispatched_at
    ) VALUES (
      'dispatch_retry_product_after_fee_failure', 'order_retry', 'quote_retry', 'product', 'leg_quote_retry_product', 'DISPATCHED',
      'authorization-retry-product', 'fingerprint-retry-product',
      'eip155:84532', 'exact', 'fixture-base-sepolia-asset', 1000,
      '0xproduct-payee', 'fixture-facilitator', '2026-09-28T06:30:00Z', '2026-09-28T06:04:05Z'
    );
    RAISE EXCEPTION 'expected product dispatch after latest fee failure to fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

DO $$
DECLARE
  pinned_version text;
  product_outcome text;
  product_observation integer;
  product_settlement text;
  product_resubmit boolean;
  retry_attempt integer;
  result_count integer;
BEGIN
  SELECT product_version, result_outcome, result_observation_no, observed_settlement_id, automatic_resubmit_allowed
  INTO pinned_version, product_outcome, product_observation, product_settlement, product_resubmit
  FROM shops.order_dispatch_readback
  WHERE order_id = 'order_flow' AND leg = 'product';

  IF pinned_version <> '2026.09.2'
     OR product_outcome <> 'COMMITTED'
     OR product_observation <> 2
     OR product_settlement <> 'settlement-flow-product'
     OR product_resubmit IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'durable product dispatch readback mismatch: %, %, %, %, %',
      pinned_version, product_outcome, product_observation, product_settlement, product_resubmit;
  END IF;

  SELECT count(*) INTO result_count
  FROM shops.payment_dispatch_results
  WHERE dispatch_id = 'dispatch_flow_product';
  IF result_count <> 2 OR NOT EXISTS (
    SELECT 1 FROM shops.payment_dispatch_results
    WHERE dispatch_id = 'dispatch_flow_product'
      AND observation_no = 1
      AND outcome = 'UNKNOWN'
      AND observed_settlement_id = 'settlement-flow-product'
      AND observed_transaction_hash = '0xtx-flow-product'
      AND evidence -> 'error' ->> 'code' = 'TIMEOUT'
  ) THEN
    RAISE EXCEPTION 'unknown settlement evidence was not preserved through reconciliation';
  END IF;

  SELECT current_attempt_no INTO retry_attempt
  FROM shops.order_payment_legs
  WHERE order_id = 'order_retry' AND leg = 'fee';
  IF retry_attempt <> 2 THEN
    RAISE EXCEPTION 'failed attempt successor was not recorded: %', retry_attempt;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM shops.payment_dispatch_results
    WHERE dispatch_id = 'dispatch_retry_fee_2'
      AND observation_no = 2
      AND observation_kind = 'TERMINAL'
      AND outcome = 'FAILED'
      AND failure_code = 'FINALITY_REJECTED'
  ) THEN
    RAISE EXCEPTION 'terminal failure after committed dispatch was not appended';
  END IF;

  BEGIN
    UPDATE shops.payment_dispatches
    SET failure_code = 'REWRITTEN_FAILURE'
    WHERE dispatch_id = 'dispatch_retry_fee_2';
    RAISE EXCEPTION 'expected same-state terminal failure-code rewrite to fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE shops.payment_dispatches
    SET settlement_evidence = '{"status":"changed"}'::jsonb,
        updated_at = '2026-09-28T06:05:00Z'
    WHERE dispatch_id = 'dispatch_flow_product';
    RAISE EXCEPTION 'expected same-state dispatch evidence replacement to fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE shops.payment_dispatch_results
    SET evidence = '{"status":"changed"}'::jsonb
    WHERE dispatch_id = 'dispatch_flow_product' AND observation_no = 1;
    RAISE EXCEPTION 'expected append-only dispatch result mutation to fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE shops.order_payment_legs
    SET current_state = 'AWAITING_FINALITY',
        current_dispatch_id = 'dispatch_flow_fee',
        current_attempt_no = 1,
        updated_at = '2026-09-28T06:05:00Z'
    WHERE order_id = 'order_gate' AND leg = 'fee';
    RAISE EXCEPTION 'expected cross-order dispatch pointer to fail';
  EXCEPTION WHEN foreign_key_violation OR check_violation THEN NULL;
  END;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'shops'
      AND table_name = 'order_dispatch_readback'
      AND column_name IN ('authorization_id', 'payment_fingerprint', 'settlement_evidence', 'evidence', 'error_reason')
  ) THEN
    RAISE EXCEPTION 'observer readback exposes authorization identity';
  END IF;
END;
$$;

ROLLBACK;
