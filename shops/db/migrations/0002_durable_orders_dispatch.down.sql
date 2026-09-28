BEGIN;

DROP VIEW IF EXISTS shops.order_dispatch_readback;

DROP TRIGGER IF EXISTS dispatch_appends_durable_result ON shops.payment_dispatches;
DROP FUNCTION IF EXISTS shops.append_dispatch_result_from_state();
DROP TRIGGER IF EXISTS dispatch_updates_durable_order_payment_leg ON shops.payment_dispatches;
DROP FUNCTION IF EXISTS shops.sync_order_payment_leg_from_dispatch();
DROP TRIGGER IF EXISTS product_dispatch_requires_committed_fee ON shops.payment_dispatches;
DROP FUNCTION IF EXISTS shops.validate_product_dispatch_gate();
DROP TRIGGER IF EXISTS order_payment_leg_state_is_bound_and_versioned ON shops.order_payment_legs;
DROP FUNCTION IF EXISTS shops.validate_order_payment_leg_transition();
DROP TRIGGER IF EXISTS order_state_is_monotonic_and_versioned ON shops.orders;
DROP FUNCTION IF EXISTS shops.validate_order_state_transition();
DROP TRIGGER IF EXISTS order_seeds_durable_payment_legs ON shops.orders;
DROP FUNCTION IF EXISTS shops.seed_order_payment_legs();

DROP TRIGGER IF EXISTS payment_dispatch_result_append_is_bound ON shops.payment_dispatch_results;
DROP FUNCTION IF EXISTS shops.validate_dispatch_result_append();
DROP TRIGGER IF EXISTS payment_dispatch_results_are_immutable ON shops.payment_dispatch_results;
DROP FUNCTION IF EXISTS shops.reject_dispatch_result_mutation();
DROP TABLE IF EXISTS shops.payment_dispatch_results;
DROP TABLE IF EXISTS shops.order_payment_legs;

ALTER TABLE shops.payment_dispatches
  DROP CONSTRAINT IF EXISTS dispatch_error_reason_is_bounded,
  DROP CONSTRAINT IF EXISTS dispatch_settlement_evidence_is_public,
  DROP CONSTRAINT IF EXISTS dispatch_observed_identifiers_are_paired,
  DROP CONSTRAINT IF EXISTS dispatch_full_identity_unique,
  DROP COLUMN IF EXISTS observed_transaction_hash,
  DROP COLUMN IF EXISTS observed_settlement_id,
  DROP COLUMN IF EXISTS error_reason,
  DROP COLUMN IF EXISTS settlement_evidence,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS state_version;

DROP FUNCTION IF EXISTS shops.is_public_settlement_evidence(jsonb);
DROP FUNCTION IF EXISTS shops.is_public_facilitator_response(jsonb);
DROP FUNCTION IF EXISTS shops.jsonb_object_has_only_public_scalars(jsonb, text[]);
DROP FUNCTION IF EXISTS shops.jsonb_public_scalar(jsonb);

ALTER TABLE shops.orders
  DROP COLUMN IF EXISTS state_changed_at,
  DROP COLUMN IF EXISTS state_version;

COMMIT;
