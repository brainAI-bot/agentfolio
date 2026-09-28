BEGIN;

ALTER TABLE shops.orders
  ADD COLUMN state_version bigint NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  ADD COLUMN state_changed_at timestamptz NOT NULL DEFAULT transaction_timestamp();

UPDATE shops.orders SET state_changed_at = updated_at;

ALTER TABLE shops.payment_dispatches
  ADD COLUMN state_version bigint NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  ADD COLUMN settlement_evidence jsonb,
  ADD COLUMN error_reason text,
  ADD COLUMN observed_settlement_id text,
  ADD COLUMN observed_transaction_hash text,
  ADD CONSTRAINT dispatch_observed_identifiers_are_paired
    CHECK ((observed_settlement_id IS NULL) = (observed_transaction_hash IS NULL)),
  ADD CONSTRAINT dispatch_full_identity_unique
    UNIQUE (dispatch_id, order_id, quote_id, leg, leg_quote_id);

UPDATE shops.payment_dispatches
SET updated_at = GREATEST(created_at, dispatched_at, COALESCE(receipt_at, dispatched_at));

UPDATE shops.payment_dispatches
SET observed_settlement_id = settlement_id,
    observed_transaction_hash = transaction_hash
WHERE state = 'SETTLEMENT_UNKNOWN'
  AND settlement_id IS NOT NULL;

CREATE FUNCTION shops.jsonb_public_scalar(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value IS NOT NULL
    AND jsonb_typeof(value) IN ('null', 'string', 'number', 'boolean')
    AND octet_length(value::text) <= 2048;
$$;

CREATE FUNCTION shops.jsonb_object_has_only_public_scalars(value jsonb, allowed_keys text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_typeof(value) = 'object'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_each(value) AS item(key, nested_value)
      WHERE NOT (key = ANY (allowed_keys))
         OR NOT shops.jsonb_public_scalar(nested_value)
    );
$$;

CREATE FUNCTION shops.is_public_facilitator_response(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value IS NOT NULL
    AND jsonb_typeof(value) = 'object'
    AND pg_column_size(value) <= 8192
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_each(value) AS item(key, field_value)
      WHERE key NOT IN (
        'status', 'success', 'transaction', 'transactionHash', 'settlementId',
        'network', 'payer', 'errorReason', 'failureCode', 'reason', 'message',
        'receiptAt', 'safeAt', 'finalizedAt', 'diagnostic', 'result', 'error'
      )
      OR (
        key NOT IN ('diagnostic', 'result', 'error')
        AND NOT shops.jsonb_public_scalar(field_value)
      )
      OR (
        key IN ('diagnostic', 'result')
        AND NOT shops.jsonb_object_has_only_public_scalars(
          field_value, ARRAY['code', 'message', 'reason', 'status']::text[]
        )
      )
      OR (
        key = 'error'
        AND NOT shops.jsonb_object_has_only_public_scalars(
          field_value, ARRAY['code', 'message']::text[]
        )
      )
    );
$$;

CREATE FUNCTION shops.is_public_settlement_evidence(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value IS NOT NULL
    AND jsonb_typeof(value) = 'object'
    AND pg_column_size(value) <= 16384
    AND (
      (
        value ? 'facilitatorResponse'
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_object_keys(value) AS key
          WHERE key NOT IN (
            'authorizer', 'payer', 'authorizationNonce', 'paymentFingerprint',
            'quoteHash', 'network', 'asset', 'payTo', 'amountMinor',
            'facilitatorResponse', 'errorReason'
          )
        )
        AND shops.is_public_facilitator_response(value -> 'facilitatorResponse')
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_each(value) AS item(key, field_value)
          WHERE key <> 'facilitatorResponse'
            AND NOT shops.jsonb_public_scalar(field_value)
        )
      )
      OR shops.is_public_facilitator_response(value)
    );
$$;

ALTER TABLE shops.payment_dispatches
  ADD CONSTRAINT dispatch_settlement_evidence_is_public
    CHECK (settlement_evidence IS NULL OR shops.is_public_settlement_evidence(settlement_evidence)),
  ADD CONSTRAINT dispatch_error_reason_is_bounded
    CHECK (error_reason IS NULL OR (btrim(error_reason) <> '' AND length(error_reason) <= 500));

CREATE TABLE shops.order_payment_legs (
  order_id text NOT NULL,
  quote_id text NOT NULL,
  leg shops.dispatch_leg NOT NULL,
  leg_quote_id text NOT NULL,
  current_state text NOT NULL DEFAULT 'QUOTED'
    CHECK (current_state IN ('QUOTED', 'AUTHORIZED', 'DISPATCHED', 'SETTLEMENT_UNKNOWN', 'AWAITING_FINALITY', 'SETTLED', 'FAILED')),
  current_dispatch_id text,
  current_attempt_no integer CHECK (current_attempt_no IS NULL OR current_attempt_no > 0),
  state_version bigint NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (order_id, leg),
  UNIQUE (order_id, quote_id, leg, leg_quote_id),
  FOREIGN KEY (order_id, quote_id)
    REFERENCES shops.orders (order_id, quote_id),
  FOREIGN KEY (quote_id, leg, leg_quote_id)
    REFERENCES shops.payment_leg_quotes (quote_id, leg, leg_quote_id),
  FOREIGN KEY (current_dispatch_id, order_id, quote_id, leg, leg_quote_id)
    REFERENCES shops.payment_dispatches (dispatch_id, order_id, quote_id, leg, leg_quote_id),
  CHECK ((current_dispatch_id IS NULL) = (current_attempt_no IS NULL)),
  CHECK ((current_dispatch_id IS NULL) = (current_state = 'QUOTED')),
  CHECK (updated_at >= created_at)
);

CREATE TABLE shops.payment_dispatch_results (
  result_id text PRIMARY KEY,
  dispatch_id text NOT NULL REFERENCES shops.payment_dispatches (dispatch_id),
  observation_no integer NOT NULL CHECK (observation_no > 0),
  observation_kind text NOT NULL CHECK (observation_kind IN ('INITIAL', 'RECONCILIATION', 'TERMINAL', 'LEGACY_BACKFILL')),
  outcome text NOT NULL CHECK (outcome IN ('COMMITTED', 'UNKNOWN', 'FAILED')),
  observed_settlement_id text,
  observed_transaction_hash text,
  observed_receipt_at timestamptz,
  failure_code text,
  error_reason text CHECK (error_reason IS NULL OR (btrim(error_reason) <> '' AND length(error_reason) <= 500)),
  evidence jsonb NOT NULL CHECK (shops.is_public_settlement_evidence(evidence)),
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (dispatch_id, observation_no),
  CHECK ((observed_settlement_id IS NULL) = (observed_transaction_hash IS NULL)),
  CHECK ((observed_receipt_at IS NULL) OR observed_transaction_hash IS NOT NULL),
  CHECK (
    (outcome = 'COMMITTED' AND observed_settlement_id IS NOT NULL AND observed_receipt_at IS NOT NULL AND failure_code IS NULL)
    OR (outcome = 'UNKNOWN' AND failure_code IS NULL)
    OR (outcome = 'FAILED' AND failure_code IS NOT NULL AND error_reason IS NOT NULL)
  )
);

CREATE FUNCTION shops.reject_dispatch_result_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'payment dispatch result rows are append-only';
END;
$$;

CREATE TRIGGER payment_dispatch_results_are_immutable
BEFORE UPDATE OR DELETE ON shops.payment_dispatch_results
FOR EACH ROW EXECUTE FUNCTION shops.reject_dispatch_result_mutation();

CREATE FUNCTION shops.validate_dispatch_result_append()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  dispatch shops.payment_dispatches%ROWTYPE;
  prior shops.payment_dispatch_results%ROWTYPE;
  leg_quote shops.payment_leg_quotes%ROWTYPE;
  response jsonb;
BEGIN
  SELECT * INTO dispatch
  FROM shops.payment_dispatches
  WHERE dispatch_id = NEW.dispatch_id
  FOR KEY SHARE;

  SELECT * INTO prior
  FROM shops.payment_dispatch_results
  WHERE dispatch_id = NEW.dispatch_id
  ORDER BY observation_no DESC
  LIMIT 1;

  IF NOT FOUND THEN
    IF NEW.observation_no <> 1 OR NEW.observation_kind NOT IN ('INITIAL', 'LEGACY_BACKFILL') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'first dispatch result must be observation one';
    END IF;
  ELSE
    IF NEW.observation_no <> prior.observation_no + 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'dispatch result observation number is not contiguous';
    END IF;
    IF prior.outcome = 'UNKNOWN' AND NEW.observation_kind <> 'RECONCILIATION' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'unknown dispatch result successor must be a reconciliation';
    ELSIF prior.outcome = 'COMMITTED' AND NEW.outcome = 'FAILED' AND NEW.observation_kind <> 'TERMINAL' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'committed dispatch failure successor must be terminal';
    ELSIF prior.outcome NOT IN ('UNKNOWN', 'COMMITTED')
       OR (prior.outcome = 'COMMITTED' AND NEW.outcome <> 'FAILED') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'dispatch result successor is not monotonic';
    END IF;
  END IF;

  SELECT * INTO leg_quote
  FROM shops.payment_leg_quotes
  WHERE quote_id = dispatch.quote_id
    AND leg = dispatch.leg
    AND leg_quote_id = dispatch.leg_quote_id;

  IF NEW.evidence ? 'facilitatorResponse' THEN
    IF NEW.evidence ->> 'paymentFingerprint' IS DISTINCT FROM dispatch.payment_fingerprint
       OR NEW.evidence ->> 'quoteHash' IS DISTINCT FROM leg_quote.leg_quote_hash
       OR NEW.evidence ->> 'network' IS DISTINCT FROM dispatch.payment_network
       OR lower(NEW.evidence ->> 'asset') IS DISTINCT FROM lower(dispatch.payment_asset)
       OR lower(NEW.evidence ->> 'payTo') IS DISTINCT FROM lower(dispatch.pay_to)
       OR NEW.evidence ->> 'amountMinor' IS DISTINCT FROM dispatch.amount_minor::text THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'dispatch result evidence differs from the bound dispatch terms';
    END IF;
    response := NEW.evidence -> 'facilitatorResponse';
  ELSE
    response := NEW.evidence;
    IF response ? 'payer'
       OR (response ? 'network' AND response ->> 'network' IS DISTINCT FROM dispatch.payment_network) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'bare dispatch result evidence contains an unbound identity term';
    END IF;
  END IF;

  IF response ? 'status' AND (
    (NEW.outcome = 'COMMITTED' AND lower(response ->> 'status') NOT IN ('awaiting_finality', 'committed', 'settled', 'success'))
    OR (NEW.outcome = 'UNKNOWN' AND lower(response ->> 'status') NOT IN ('unknown', 'settlement_unknown'))
    OR (NEW.outcome = 'FAILED' AND lower(response ->> 'status') NOT IN ('error', 'failed', 'rejected'))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'dispatch result evidence status contradicts the structured outcome';
  END IF;
  IF response ? 'success'
     AND (response ->> 'success')::boolean IS DISTINCT FROM (NEW.outcome = 'COMMITTED') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'dispatch result evidence success flag contradicts the structured outcome';
  END IF;
  IF response ? 'failureCode'
     AND response ->> 'failureCode' IS DISTINCT FROM NEW.failure_code THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'dispatch result evidence failure code contradicts the structured outcome';
  END IF;
  IF response ? 'errorReason'
     AND response ->> 'errorReason' IS DISTINCT FROM NEW.error_reason THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'dispatch result evidence error reason contradicts the structured outcome';
  END IF;

  IF response ? 'settlementId'
     AND response ->> 'settlementId' IS DISTINCT FROM NEW.observed_settlement_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'dispatch result evidence id differs from the structured observation';
  END IF;
  IF response ? 'transactionHash'
     AND response ->> 'transactionHash' IS DISTINCT FROM NEW.observed_transaction_hash THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'dispatch result evidence transaction differs from the structured observation';
  END IF;

  IF NEW.outcome = 'COMMITTED' AND (
    dispatch.state NOT IN ('AWAITING_FINALITY', 'SETTLED')
    OR NEW.observed_settlement_id IS DISTINCT FROM dispatch.settlement_id
    OR NEW.observed_transaction_hash IS DISTINCT FROM dispatch.transaction_hash
    OR NEW.observed_receipt_at IS DISTINCT FROM dispatch.receipt_at
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'committed result must match the dispatch settlement binding';
  END IF;

  IF NEW.outcome = 'UNKNOWN' AND (
    dispatch.state <> 'SETTLEMENT_UNKNOWN'
    OR dispatch.automatic_resubmit_allowed
    OR NEW.observed_settlement_id IS DISTINCT FROM dispatch.observed_settlement_id
    OR NEW.observed_transaction_hash IS DISTINCT FROM dispatch.observed_transaction_hash
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'unknown result must bind a fail-closed settlement-unknown dispatch';
  END IF;

  IF NEW.outcome = 'FAILED' AND (
    dispatch.state <> 'FAILED'
    OR NEW.failure_code IS DISTINCT FROM dispatch.failure_code
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'failed result must match the dispatch failure binding';
  END IF;

  IF NEW.observed_at < dispatch.dispatched_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'dispatch result cannot predate the attempt';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_dispatch_result_append_is_bound
BEFORE INSERT ON shops.payment_dispatch_results
FOR EACH ROW EXECUTE FUNCTION shops.validate_dispatch_result_append();

INSERT INTO shops.order_payment_legs (
  order_id, quote_id, leg, leg_quote_id, created_at, updated_at
)
SELECT orders.order_id, orders.quote_id, leg_quotes.leg, leg_quotes.leg_quote_id,
       orders.created_at, orders.updated_at
FROM shops.orders AS orders
JOIN shops.payment_leg_quotes AS leg_quotes ON leg_quotes.quote_id = orders.quote_id;

WITH latest_dispatch AS (
  SELECT DISTINCT ON (order_id, leg)
    dispatch_id, order_id, quote_id, leg, leg_quote_id, attempt_no, state, updated_at
  FROM shops.payment_dispatches
  ORDER BY order_id, leg, attempt_no DESC, created_at DESC
)
UPDATE shops.order_payment_legs AS legs
SET current_state = latest.state::text,
    current_dispatch_id = latest.dispatch_id,
    current_attempt_no = latest.attempt_no,
    state_version = 1,
    updated_at = GREATEST(legs.updated_at, latest.updated_at)
FROM latest_dispatch AS latest
WHERE latest.order_id = legs.order_id
  AND latest.quote_id = legs.quote_id
  AND latest.leg = legs.leg
  AND latest.leg_quote_id = legs.leg_quote_id;

INSERT INTO shops.payment_dispatch_results (
  result_id, dispatch_id, observation_no, observation_kind, outcome,
  observed_settlement_id, observed_transaction_hash, observed_receipt_at, failure_code, error_reason,
  evidence, observed_at
)
SELECT
  dispatch_id || ':result:1', dispatch_id, 1, 'LEGACY_BACKFILL',
  CASE
    WHEN state IN ('AWAITING_FINALITY', 'SETTLED') THEN 'COMMITTED'
    WHEN state = 'SETTLEMENT_UNKNOWN' THEN 'UNKNOWN'
    ELSE 'FAILED'
  END,
  settlement_id, transaction_hash, receipt_at, failure_code,
  CASE WHEN state = 'FAILED' THEN failure_code ELSE NULL END,
  jsonb_strip_nulls(jsonb_build_object(
    'status', lower(state::text),
    'settlementId', settlement_id,
    'transactionHash', transaction_hash,
    'receiptAt', receipt_at,
    'failureCode', failure_code
  )),
  COALESCE(receipt_at, updated_at)
FROM shops.payment_dispatches
WHERE state IN ('AWAITING_FINALITY', 'SETTLED', 'SETTLEMENT_UNKNOWN', 'FAILED');

CREATE FUNCTION shops.seed_order_payment_legs()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO shops.order_payment_legs (
    order_id, quote_id, leg, leg_quote_id, created_at, updated_at
  )
  SELECT NEW.order_id, NEW.quote_id, leg, leg_quote_id, NEW.created_at, NEW.updated_at
  FROM shops.payment_leg_quotes
  WHERE quote_id = NEW.quote_id
  ORDER BY leg;

  IF (SELECT count(*) FROM shops.order_payment_legs WHERE order_id = NEW.order_id) <> 2 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'order must seed exactly one fee and one product payment leg';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER order_seeds_durable_payment_legs
AFTER INSERT ON shops.orders
FOR EACH ROW EXECUTE FUNCTION shops.seed_order_payment_legs();

CREATE FUNCTION shops.validate_order_state_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  settled_finalized_legs integer;
  matching_legs integer;
BEGIN
  IF NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.quote_id IS DISTINCT FROM OLD.quote_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'order identity is immutable';
  END IF;

  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'order updated_at cannot move backwards';
  END IF;

  IF NEW.state IS NOT DISTINCT FROM OLD.state THEN
    IF NEW.state_version IS DISTINCT FROM OLD.state_version
       OR NEW.state_changed_at IS DISTINCT FROM OLD.state_changed_at THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'idempotent order update cannot change state version';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.state = 'PAYMENT_REQUIRED' AND NEW.state IN ('PAYMENT_UNKNOWN', 'PAID_AWAITING_FINALITY', 'READY_FOR_DELIVERY', 'FAILED'))
    OR (OLD.state = 'PAYMENT_UNKNOWN' AND NEW.state IN ('PAID_AWAITING_FINALITY', 'READY_FOR_DELIVERY', 'FAILED'))
    OR (OLD.state = 'PAID_AWAITING_FINALITY' AND NEW.state IN ('READY_FOR_DELIVERY', 'FAILED'))
    OR (OLD.state = 'READY_FOR_DELIVERY' AND NEW.state = 'DELIVERED')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'order state transition is not monotonic';
  END IF;

  PERFORM 1
  FROM shops.order_payment_legs
  WHERE order_id = NEW.order_id
  FOR UPDATE;

  IF NEW.state = 'PAYMENT_UNKNOWN' THEN
    SELECT count(*) INTO matching_legs
    FROM shops.order_payment_legs
    WHERE order_id = NEW.order_id AND current_state = 'SETTLEMENT_UNKNOWN';
    IF matching_legs < 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'payment-unknown order requires a settlement-unknown payment leg';
    END IF;
  END IF;

  IF NEW.state = 'PAID_AWAITING_FINALITY' THEN
    SELECT count(DISTINCT legs.leg) INTO matching_legs
    FROM shops.order_payment_legs AS legs
    JOIN shops.payment_dispatches AS dispatch
      ON dispatch.dispatch_id = legs.current_dispatch_id
     AND dispatch.order_id = legs.order_id
     AND dispatch.quote_id = legs.quote_id
     AND dispatch.leg = legs.leg
     AND dispatch.leg_quote_id = legs.leg_quote_id
    WHERE legs.order_id = NEW.order_id
      AND legs.current_state IN ('AWAITING_FINALITY', 'SETTLED')
      AND dispatch.settlement_id IS NOT NULL
      AND dispatch.transaction_hash IS NOT NULL
      AND dispatch.receipt_at IS NOT NULL;
    IF matching_legs <> 2 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'paid-awaiting-finality order requires committed settlements for both payment legs';
    END IF;
  END IF;

  IF NEW.state = 'FAILED' THEN
    SELECT count(*) INTO matching_legs
    FROM shops.order_payment_legs
    WHERE order_id = NEW.order_id AND current_state = 'FAILED';
    IF matching_legs < 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'failed order requires a failed payment leg';
    END IF;
  END IF;

  IF NEW.state = 'READY_FOR_DELIVERY' THEN
    SELECT count(DISTINCT dispatch.leg) INTO settled_finalized_legs
    FROM shops.payment_dispatches AS dispatch
    JOIN shops.finality_receipts AS finality ON finality.dispatch_id = dispatch.dispatch_id
    WHERE dispatch.order_id = NEW.order_id
      AND dispatch.state IN ('AWAITING_FINALITY', 'SETTLED');
    IF settled_finalized_legs <> 2 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'ready-for-delivery requires finality receipts for both payment legs';
    END IF;
  END IF;

  IF NEW.state = 'DELIVERED' AND NOT EXISTS (
    SELECT 1 FROM shops.delivery_receipts WHERE order_id = NEW.order_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'delivered order requires an immutable delivery receipt';
  END IF;

  NEW.state_version := OLD.state_version + 1;
  NEW.state_changed_at := NEW.updated_at;
  RETURN NEW;
END;
$$;

CREATE TRIGGER order_state_is_monotonic_and_versioned
BEFORE UPDATE ON shops.orders
FOR EACH ROW EXECUTE FUNCTION shops.validate_order_state_transition();

CREATE FUNCTION shops.validate_order_payment_leg_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_dispatch shops.payment_dispatches%ROWTYPE;
  new_dispatch shops.payment_dispatches%ROWTYPE;
BEGIN
  IF NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.quote_id IS DISTINCT FROM OLD.quote_id
     OR NEW.leg IS DISTINCT FROM OLD.leg
     OR NEW.leg_quote_id IS DISTINCT FROM OLD.leg_quote_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'order payment-leg identity is immutable';
  END IF;

  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'order payment-leg updated_at cannot move backwards';
  END IF;

  IF NEW.current_dispatch_id IS NULL THEN
    IF NEW.current_state <> 'QUOTED' OR NEW.current_attempt_no IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'quoted payment leg cannot claim a dispatch state';
    END IF;
  ELSE
    SELECT * INTO new_dispatch
    FROM shops.payment_dispatches
    WHERE dispatch_id = NEW.current_dispatch_id
      AND order_id = NEW.order_id
      AND quote_id = NEW.quote_id
      AND leg = NEW.leg
      AND leg_quote_id = NEW.leg_quote_id;
    IF NOT FOUND
       OR NEW.current_state <> new_dispatch.state::text
       OR NEW.current_attempt_no <> new_dispatch.attempt_no THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'payment-leg summary must match its bound dispatch attempt';
    END IF;
  END IF;

  IF NEW.current_state IS NOT DISTINCT FROM OLD.current_state
     AND NEW.current_dispatch_id IS NOT DISTINCT FROM OLD.current_dispatch_id
     AND NEW.current_attempt_no IS NOT DISTINCT FROM OLD.current_attempt_no THEN
    IF NEW.state_version IS DISTINCT FROM OLD.state_version THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'idempotent payment-leg update cannot change state version';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.current_dispatch_id IS NOT NULL
     AND NEW.current_dispatch_id IS DISTINCT FROM OLD.current_dispatch_id THEN
    SELECT * INTO old_dispatch FROM shops.payment_dispatches WHERE dispatch_id = OLD.current_dispatch_id;
    IF old_dispatch.state <> 'FAILED' OR NEW.current_attempt_no <> old_dispatch.attempt_no + 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'payment-leg successor requires a higher attempt after terminal failure';
    END IF;
  ELSIF OLD.current_dispatch_id IS NOT NULL AND NEW.current_state IS DISTINCT FROM OLD.current_state THEN
    IF NOT (
      (OLD.current_state = 'AUTHORIZED' AND NEW.current_state IN ('DISPATCHED', 'SETTLEMENT_UNKNOWN', 'AWAITING_FINALITY', 'SETTLED', 'FAILED'))
      OR (OLD.current_state = 'DISPATCHED' AND NEW.current_state IN ('SETTLEMENT_UNKNOWN', 'AWAITING_FINALITY', 'SETTLED', 'FAILED'))
      OR (OLD.current_state = 'SETTLEMENT_UNKNOWN' AND NEW.current_state IN ('AWAITING_FINALITY', 'SETTLED', 'FAILED'))
      OR (OLD.current_state = 'AWAITING_FINALITY' AND NEW.current_state IN ('SETTLED', 'FAILED'))
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'order payment-leg state transition is not monotonic';
    END IF;
  END IF;

  NEW.state_version := OLD.state_version + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER order_payment_leg_state_is_bound_and_versioned
BEFORE UPDATE ON shops.order_payment_legs
FOR EACH ROW EXECUTE FUNCTION shops.validate_order_payment_leg_transition();

CREATE FUNCTION shops.validate_product_dispatch_gate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  leg_row shops.order_payment_legs%ROWTYPE;
  predecessor shops.payment_dispatches%ROWTYPE;
  fee_dispatch shops.payment_dispatches%ROWTYPE;
  leg_quote shops.payment_leg_quotes%ROWTYPE;
  response jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.order_id || ':dispatch-gate', 0));

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO leg_row
    FROM shops.order_payment_legs
    WHERE order_id = NEW.order_id AND leg = NEW.leg
    FOR UPDATE;

    IF NOT FOUND
       OR leg_row.quote_id <> NEW.quote_id
       OR leg_row.leg_quote_id <> NEW.leg_quote_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'dispatch attempt has no matching durable payment leg';
    END IF;

    IF leg_row.current_dispatch_id IS NULL THEN
      IF NEW.attempt_no <> 1 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'first dispatch attempt number must be one';
      END IF;
    ELSE
      SELECT * INTO predecessor
      FROM shops.payment_dispatches
      WHERE dispatch_id = leg_row.current_dispatch_id;
      IF predecessor.state = 'FAILED'
         AND NEW.attempt_no <> leg_row.current_attempt_no + 1 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'dispatch successor requires the next attempt number after terminal failure';
      END IF;
    END IF;
  END IF;

  IF NEW.settlement_evidence IS NOT NULL THEN
    SELECT * INTO leg_quote
    FROM shops.payment_leg_quotes
    WHERE quote_id = NEW.quote_id
      AND leg = NEW.leg
      AND leg_quote_id = NEW.leg_quote_id;

    IF NEW.settlement_evidence ? 'facilitatorResponse' THEN
      IF NEW.settlement_evidence ->> 'paymentFingerprint' IS DISTINCT FROM NEW.payment_fingerprint
         OR NEW.settlement_evidence ->> 'quoteHash' IS DISTINCT FROM leg_quote.leg_quote_hash
         OR NEW.settlement_evidence ->> 'network' IS DISTINCT FROM NEW.payment_network
         OR lower(NEW.settlement_evidence ->> 'asset') IS DISTINCT FROM lower(NEW.payment_asset)
         OR lower(NEW.settlement_evidence ->> 'payTo') IS DISTINCT FROM lower(NEW.pay_to)
         OR NEW.settlement_evidence ->> 'amountMinor' IS DISTINCT FROM NEW.amount_minor::text THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'settlement evidence differs from the bound dispatch terms';
      END IF;
      response := NEW.settlement_evidence -> 'facilitatorResponse';
    ELSE
      response := NEW.settlement_evidence;
      IF response ? 'payer'
         OR (response ? 'network' AND response ->> 'network' IS DISTINCT FROM NEW.payment_network) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'bare settlement evidence contains an unbound identity term';
      END IF;
    END IF;

    IF response ? 'status' AND (
      (NEW.state IN ('AWAITING_FINALITY', 'SETTLED') AND lower(response ->> 'status') NOT IN ('committed', 'settled', 'success'))
      OR (NEW.state = 'SETTLEMENT_UNKNOWN' AND lower(response ->> 'status') NOT IN ('unknown', 'settlement_unknown'))
      OR (NEW.state = 'FAILED' AND lower(response ->> 'status') NOT IN ('error', 'failed', 'rejected'))
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'settlement evidence status contradicts the dispatch state';
    END IF;
    IF response ? 'success'
       AND (response ->> 'success')::boolean IS DISTINCT FROM (NEW.state IN ('AWAITING_FINALITY', 'SETTLED')) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'settlement evidence success flag contradicts the dispatch state';
    END IF;
    IF response ? 'failureCode'
       AND response ->> 'failureCode' IS DISTINCT FROM NEW.failure_code THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'settlement evidence failure code contradicts the dispatch state';
    END IF;
    IF response ? 'errorReason'
       AND response ->> 'errorReason' IS DISTINCT FROM NEW.error_reason THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'settlement evidence error reason contradicts the dispatch state';
    END IF;

    IF response ? 'settlementId'
       AND response ->> 'settlementId' IS DISTINCT FROM COALESCE(NEW.observed_settlement_id, NEW.settlement_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'settlement evidence id differs from the dispatch observation';
    END IF;
    IF response ? 'transactionHash'
       AND response ->> 'transactionHash' IS DISTINCT FROM COALESCE(NEW.observed_transaction_hash, NEW.transaction_hash) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'settlement evidence transaction differs from the dispatch observation';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.leg = 'product' THEN
    SELECT fee.* INTO fee_dispatch
    FROM shops.payment_dispatches AS fee
    WHERE fee.order_id = NEW.order_id
      AND fee.quote_id = NEW.quote_id
      AND fee.leg = 'fee'
    ORDER BY fee.attempt_no DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND
       OR fee_dispatch.state NOT IN ('AWAITING_FINALITY', 'SETTLED')
       OR fee_dispatch.settlement_id IS NULL
       OR fee_dispatch.transaction_hash IS NULL
       OR fee_dispatch.receipt_at IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'product dispatch requires the latest fee attempt to have a committed settlement';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.updated_at < OLD.updated_at THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'dispatch updated_at cannot move backwards';
    END IF;
    IF NEW.observed_settlement_id IS DISTINCT FROM OLD.observed_settlement_id
       OR NEW.observed_transaction_hash IS DISTINCT FROM OLD.observed_transaction_hash THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'observed settlement identifiers are immutable after dispatch insertion';
    END IF;
    IF NEW.state IN ('AWAITING_FINALITY', 'SETTLED')
       AND NEW.observed_settlement_id IS NOT NULL
       AND (
         NEW.settlement_id IS DISTINCT FROM NEW.observed_settlement_id
         OR NEW.transaction_hash IS DISTINCT FROM NEW.observed_transaction_hash
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'committed settlement must match provisional observed identifiers';
    END IF;
    IF NEW.state IS NOT DISTINCT FROM OLD.state AND (
      NEW.settlement_evidence IS DISTINCT FROM OLD.settlement_evidence
      OR NEW.error_reason IS DISTINCT FROM OLD.error_reason
      OR NEW.failure_code IS DISTINCT FROM OLD.failure_code
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'dispatch terminal binding can change only with a monotonic result transition';
    END IF;
    IF NEW IS DISTINCT FROM OLD THEN NEW.state_version := OLD.state_version + 1; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER product_dispatch_requires_committed_fee
BEFORE INSERT OR UPDATE ON shops.payment_dispatches
FOR EACH ROW EXECUTE FUNCTION shops.validate_product_dispatch_gate();

CREATE FUNCTION shops.sync_order_payment_leg_from_dispatch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE shops.order_payment_legs
  SET current_state = NEW.state::text,
      current_dispatch_id = NEW.dispatch_id,
      current_attempt_no = NEW.attempt_no,
      updated_at = NEW.updated_at
  WHERE order_id = NEW.order_id
    AND quote_id = NEW.quote_id
    AND leg = NEW.leg
    AND leg_quote_id = NEW.leg_quote_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'dispatch has no durable order payment-leg row';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER dispatch_updates_durable_order_payment_leg
AFTER INSERT OR UPDATE OF state, updated_at ON shops.payment_dispatches
FOR EACH ROW EXECUTE FUNCTION shops.sync_order_payment_leg_from_dispatch();

CREATE FUNCTION shops.append_dispatch_result_from_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  latest shops.payment_dispatch_results%ROWTYPE;
  next_outcome text;
  next_no integer;
BEGIN
  IF NEW.state NOT IN ('SETTLEMENT_UNKNOWN', 'AWAITING_FINALITY', 'SETTLED', 'FAILED') THEN
    RETURN NEW;
  END IF;

  next_outcome := CASE
    WHEN NEW.state IN ('AWAITING_FINALITY', 'SETTLED') THEN 'COMMITTED'
    WHEN NEW.state = 'SETTLEMENT_UNKNOWN' THEN 'UNKNOWN'
    ELSE 'FAILED'
  END;

  SELECT * INTO latest
  FROM shops.payment_dispatch_results
  WHERE dispatch_id = NEW.dispatch_id
  ORDER BY observation_no DESC
  LIMIT 1;

  IF FOUND AND latest.outcome = next_outcome THEN RETURN NEW; END IF;

  next_no := COALESCE(latest.observation_no, 0) + 1;
  INSERT INTO shops.payment_dispatch_results (
    result_id, dispatch_id, observation_no, observation_kind, outcome,
    observed_settlement_id, observed_transaction_hash, observed_receipt_at, failure_code, error_reason,
    evidence, observed_at
  ) VALUES (
    NEW.dispatch_id || ':result:' || next_no,
    NEW.dispatch_id,
    next_no,
    CASE
      WHEN next_no = 1 THEN 'INITIAL'
      WHEN latest.outcome = 'COMMITTED' AND next_outcome = 'FAILED' THEN 'TERMINAL'
      ELSE 'RECONCILIATION'
    END,
    next_outcome,
    COALESCE(NEW.observed_settlement_id, NEW.settlement_id),
    COALESCE(NEW.observed_transaction_hash, NEW.transaction_hash),
    NEW.receipt_at,
    NEW.failure_code,
    CASE WHEN next_outcome = 'FAILED' THEN COALESCE(NEW.error_reason, NEW.failure_code) ELSE NULL END,
    COALESCE(
      NEW.settlement_evidence,
      jsonb_strip_nulls(jsonb_build_object(
        'status', lower(NEW.state::text),
        'settlementId', NEW.settlement_id,
        'transactionHash', NEW.transaction_hash,
        'receiptAt', NEW.receipt_at,
        'failureCode', NEW.failure_code,
        'errorReason', NEW.error_reason
      ))
    ),
    COALESCE(NEW.receipt_at, NEW.updated_at)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER dispatch_appends_durable_result
AFTER INSERT OR UPDATE OF state, settlement_id, transaction_hash, receipt_at, failure_code
ON shops.payment_dispatches
FOR EACH ROW EXECUTE FUNCTION shops.append_dispatch_result_from_state();

CREATE VIEW shops.order_dispatch_readback AS
SELECT
  orders.order_id,
  orders.quote_id,
  orders.state AS order_state,
  orders.state_version AS order_state_version,
  orders.created_at AS order_created_at,
  orders.updated_at AS order_updated_at,
  quotes.quote_hash,
  quotes.product_id,
  quotes.product_version,
  catalogue.artifact_id,
  catalogue.artifact_version,
  catalogue.artifact_sha256,
  legs.leg,
  legs.leg_quote_id,
  legs.current_state AS leg_state,
  legs.current_attempt_no,
  legs.state_version AS leg_state_version,
  dispatch.dispatch_id,
  dispatch.attempt_no,
  dispatch.state AS dispatch_state,
  result.observation_no AS result_observation_no,
  result.observation_kind AS result_observation_kind,
  result.outcome AS result_outcome,
  result.observed_at AS result_observed_at,
  result.observed_settlement_id,
  result.observed_transaction_hash,
  result.observed_receipt_at,
  result.failure_code,
  dispatch.automatic_resubmit_allowed
FROM shops.orders AS orders
JOIN shops.quotes AS quotes ON quotes.quote_id = orders.quote_id
JOIN shops.catalogue_versions AS catalogue
  ON catalogue.product_id = quotes.product_id
 AND catalogue.product_version = quotes.product_version
JOIN shops.order_payment_legs AS legs ON legs.order_id = orders.order_id
LEFT JOIN shops.payment_dispatches AS dispatch ON dispatch.dispatch_id = legs.current_dispatch_id
LEFT JOIN LATERAL (
  SELECT *
  FROM shops.payment_dispatch_results AS candidate
  WHERE candidate.dispatch_id = dispatch.dispatch_id
  ORDER BY candidate.observation_no DESC
  LIMIT 1
) AS result ON true;

COMMIT;
