BEGIN;

CREATE SCHEMA IF NOT EXISTS shops;

CREATE TYPE shops.catalogue_availability AS ENUM (
  'AVAILABLE_FOR_QUOTE',
  'UNAVAILABLE',
  'UNKNOWN'
);
CREATE TYPE shops.order_state AS ENUM (
  'PAYMENT_REQUIRED',
  'PAYMENT_UNKNOWN',
  'PAID_AWAITING_FINALITY',
  'READY_FOR_DELIVERY',
  'DELIVERED',
  'FAILED'
);
CREATE TYPE shops.dispatch_leg AS ENUM ('fee', 'product');
CREATE TYPE shops.dispatch_state AS ENUM (
  'AUTHORIZED',
  'DISPATCHED',
  'SETTLEMENT_UNKNOWN',
  'AWAITING_FINALITY',
  'SETTLED',
  'FAILED'
);

CREATE TABLE shops.catalogue_versions (
  product_id text NOT NULL,
  product_version text NOT NULL,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  title text NOT NULL CHECK (btrim(title) <> ''),
  summary text NOT NULL,
  availability shops.catalogue_availability NOT NULL,
  artifact_id text NOT NULL,
  artifact_version text NOT NULL,
  artifact_sha256 char(64) NOT NULL CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  artifact_bytes bigint NOT NULL CHECK (artifact_bytes > 0),
  artifact_media_type text NOT NULL CHECK (btrim(artifact_media_type) <> ''),
  price_scheme text NOT NULL CHECK (btrim(price_scheme) <> ''),
  payment_network text NOT NULL CHECK (btrim(payment_network) <> ''),
  payment_asset text NOT NULL CHECK (btrim(payment_asset) <> ''),
  amount_minor numeric(78, 0) NOT NULL CHECK (amount_minor > 0),
  licence_id text NOT NULL,
  licence_version text NOT NULL,
  licence_reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (product_id, product_version),
  UNIQUE (artifact_id, artifact_version)
);

CREATE TABLE shops.quotes (
  quote_id text PRIMARY KEY,
  quote_hash char(64) NOT NULL UNIQUE CHECK (quote_hash ~ '^[0-9a-f]{64}$'),
  pair_hash char(64) NOT NULL UNIQUE CHECK (pair_hash ~ '^[0-9a-f]{64}$'),
  product_id text NOT NULL,
  product_version text NOT NULL,
  state text NOT NULL DEFAULT 'QUOTED' CHECK (state IN ('QUOTED', 'EXPIRED', 'VOID')),
  quote_body jsonb NOT NULL CHECK (jsonb_typeof(quote_body) = 'object'),
  licence_body jsonb NOT NULL CHECK (jsonb_typeof(licence_body) = 'object'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  FOREIGN KEY (product_id, product_version)
    REFERENCES shops.catalogue_versions (product_id, product_version),
  CHECK (expires_at > issued_at)
);

CREATE TABLE shops.payment_leg_quotes (
  leg_quote_id text PRIMARY KEY,
  quote_id text NOT NULL REFERENCES shops.quotes (quote_id),
  leg shops.dispatch_leg NOT NULL,
  leg_quote_hash char(64) NOT NULL UNIQUE CHECK (leg_quote_hash ~ '^[0-9a-f]{64}$'),
  payment_network text NOT NULL CHECK (btrim(payment_network) <> ''),
  price_scheme text NOT NULL CHECK (btrim(price_scheme) <> ''),
  payment_asset text NOT NULL CHECK (btrim(payment_asset) <> ''),
  amount_minor numeric(78, 0) NOT NULL CHECK (amount_minor > 0),
  pay_to text NOT NULL CHECK (btrim(pay_to) <> ''),
  facilitator_id text NOT NULL CHECK (btrim(facilitator_id) <> ''),
  valid_before timestamptz NOT NULL,
  quote_body jsonb NOT NULL CHECK (jsonb_typeof(quote_body) = 'object'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (quote_id, leg),
  UNIQUE (quote_id, leg, leg_quote_id)
);

CREATE TABLE shops.orders (
  order_id text PRIMARY KEY,
  quote_id text NOT NULL UNIQUE REFERENCES shops.quotes (quote_id),
  idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  state shops.order_state NOT NULL DEFAULT 'PAYMENT_REQUIRED',
  automatic_resubmit_allowed boolean NOT NULL DEFAULT false CHECK (automatic_resubmit_allowed = false),
  failure_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (order_id, quote_id),
  CHECK (updated_at >= created_at),
  CHECK ((state = 'FAILED') = (failure_code IS NOT NULL))
);

CREATE TABLE shops.payment_dispatches (
  dispatch_id text PRIMARY KEY,
  order_id text NOT NULL,
  quote_id text NOT NULL,
  leg shops.dispatch_leg NOT NULL,
  leg_quote_id text NOT NULL,
  attempt_no integer NOT NULL DEFAULT 1 CHECK (attempt_no > 0),
  state shops.dispatch_state NOT NULL,
  authorization_id text NOT NULL UNIQUE,
  payment_fingerprint text NOT NULL UNIQUE,
  payment_network text NOT NULL CHECK (btrim(payment_network) <> ''),
  price_scheme text NOT NULL CHECK (btrim(price_scheme) <> ''),
  payment_asset text NOT NULL CHECK (btrim(payment_asset) <> ''),
  amount_minor numeric(78, 0) NOT NULL CHECK (amount_minor > 0),
  pay_to text NOT NULL CHECK (btrim(pay_to) <> ''),
  facilitator_id text NOT NULL CHECK (btrim(facilitator_id) <> ''),
  valid_before timestamptz NOT NULL,
  dispatched_at timestamptz NOT NULL,
  settlement_id text UNIQUE,
  transaction_hash text UNIQUE,
  receipt_at timestamptz,
  failure_code text,
  automatic_resubmit_allowed boolean NOT NULL DEFAULT false CHECK (automatic_resubmit_allowed = false),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  FOREIGN KEY (order_id, quote_id)
    REFERENCES shops.orders (order_id, quote_id),
  FOREIGN KEY (quote_id, leg, leg_quote_id)
    REFERENCES shops.payment_leg_quotes (quote_id, leg, leg_quote_id),
  UNIQUE (order_id, leg, attempt_no),
  CHECK (dispatched_at <= valid_before),
  CHECK ((settlement_id IS NULL) = (transaction_hash IS NULL)),
  CHECK ((receipt_at IS NULL) = (transaction_hash IS NULL)),
  CHECK ((state = 'FAILED') = (failure_code IS NOT NULL)),
  CHECK (state NOT IN ('AWAITING_FINALITY', 'SETTLED') OR transaction_hash IS NOT NULL)
);

CREATE UNIQUE INDEX one_non_failed_dispatch_per_order_leg_idx
  ON shops.payment_dispatches (order_id, leg)
  WHERE state <> 'FAILED';

CREATE TABLE shops.finality_receipts (
  finality_receipt_id text PRIMARY KEY,
  dispatch_id text NOT NULL UNIQUE REFERENCES shops.payment_dispatches (dispatch_id),
  safe_at timestamptz NOT NULL,
  finalized_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (finalized_at >= safe_at),
  CHECK (observed_at >= finalized_at)
);

CREATE TABLE shops.delivery_receipts (
  receipt_id text PRIMARY KEY,
  order_id text NOT NULL UNIQUE REFERENCES shops.orders (order_id),
  entitlement_id text NOT NULL UNIQUE,
  artifact_id text NOT NULL,
  artifact_version text NOT NULL,
  artifact_sha256 char(64) NOT NULL CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  artifact_bytes bigint NOT NULL CHECK (artifact_bytes > 0),
  receipt_hash char(64) NOT NULL UNIQUE CHECK (receipt_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL,
  delivered_at timestamptz,
  receipt_body jsonb NOT NULL CHECK (jsonb_typeof(receipt_body) = 'object'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (delivered_at IS NULL OR delivered_at >= issued_at)
);

CREATE INDEX quotes_catalogue_version_idx
  ON shops.quotes (product_id, product_version, issued_at DESC);
CREATE INDEX orders_state_updated_idx
  ON shops.orders (state, updated_at);
CREATE INDEX dispatches_order_state_idx
  ON shops.payment_dispatches (order_id, state, leg);

CREATE FUNCTION shops.reject_immutable_row_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '23514',
    MESSAGE = format('%s rows are immutable', TG_TABLE_NAME);
END;
$$;

CREATE TRIGGER catalogue_versions_are_immutable
BEFORE UPDATE OR DELETE ON shops.catalogue_versions
FOR EACH ROW EXECUTE FUNCTION shops.reject_immutable_row_mutation();

CREATE TRIGGER quotes_are_immutable
BEFORE UPDATE OR DELETE ON shops.quotes
FOR EACH ROW EXECUTE FUNCTION shops.reject_immutable_row_mutation();

CREATE TRIGGER payment_leg_quotes_are_immutable
BEFORE UPDATE OR DELETE ON shops.payment_leg_quotes
FOR EACH ROW EXECUTE FUNCTION shops.reject_immutable_row_mutation();

CREATE TRIGGER finality_receipts_are_immutable
BEFORE UPDATE OR DELETE ON shops.finality_receipts
FOR EACH ROW EXECUTE FUNCTION shops.reject_immutable_row_mutation();

CREATE TRIGGER delivery_receipts_are_immutable
BEFORE UPDATE OR DELETE ON shops.delivery_receipts
FOR EACH ROW EXECUTE FUNCTION shops.reject_immutable_row_mutation();

CREATE FUNCTION shops.validate_order_quote_pair()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  leg_count integer;
BEGIN
  SELECT count(*) INTO leg_count
  FROM shops.payment_leg_quotes
  WHERE quote_id = NEW.quote_id;

  IF leg_count <> 2
     OR NOT EXISTS (
       SELECT 1 FROM shops.payment_leg_quotes
       WHERE quote_id = NEW.quote_id AND leg = 'fee'
     )
     OR NOT EXISTS (
       SELECT 1 FROM shops.payment_leg_quotes
       WHERE quote_id = NEW.quote_id AND leg = 'product'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'order quote must own exactly one fee and one product leg quote';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER order_requires_complete_quote_pair
BEFORE INSERT OR UPDATE OF quote_id ON shops.orders
FOR EACH ROW EXECUTE FUNCTION shops.validate_order_quote_pair();

CREATE FUNCTION shops.validate_payment_dispatch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  leg_quote shops.payment_leg_quotes%ROWTYPE;
  has_finality boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.dispatch_id IS DISTINCT FROM OLD.dispatch_id
       OR NEW.order_id IS DISTINCT FROM OLD.order_id
       OR NEW.quote_id IS DISTINCT FROM OLD.quote_id
       OR NEW.leg IS DISTINCT FROM OLD.leg
       OR NEW.leg_quote_id IS DISTINCT FROM OLD.leg_quote_id
       OR NEW.attempt_no IS DISTINCT FROM OLD.attempt_no
       OR NEW.authorization_id IS DISTINCT FROM OLD.authorization_id
       OR NEW.payment_fingerprint IS DISTINCT FROM OLD.payment_fingerprint
       OR NEW.payment_network IS DISTINCT FROM OLD.payment_network
       OR NEW.price_scheme IS DISTINCT FROM OLD.price_scheme
       OR NEW.payment_asset IS DISTINCT FROM OLD.payment_asset
       OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
       OR NEW.pay_to IS DISTINCT FROM OLD.pay_to
       OR NEW.facilitator_id IS DISTINCT FROM OLD.facilitator_id
       OR NEW.valid_before IS DISTINCT FROM OLD.valid_before
       OR NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'dispatch identity and quote binding are immutable';
    END IF;

    IF (OLD.settlement_id IS NOT NULL AND NEW.settlement_id IS DISTINCT FROM OLD.settlement_id)
       OR (OLD.transaction_hash IS NOT NULL AND NEW.transaction_hash IS DISTINCT FROM OLD.transaction_hash)
       OR (OLD.receipt_at IS NOT NULL AND NEW.receipt_at IS DISTINCT FROM OLD.receipt_at) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'dispatch settlement binding cannot be replaced once recorded';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM shops.finality_receipts WHERE dispatch_id = OLD.dispatch_id
    ) INTO has_finality;
    IF has_finality AND (
      NEW.settlement_id IS DISTINCT FROM OLD.settlement_id
      OR NEW.transaction_hash IS DISTINCT FROM OLD.transaction_hash
      OR NEW.receipt_at IS DISTINCT FROM OLD.receipt_at
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'finalized dispatch settlement binding is frozen';
    END IF;
    IF has_finality AND NEW.state IS DISTINCT FROM OLD.state AND NEW.state <> 'SETTLED' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'dispatch with finality can only advance to settled';
    END IF;

    IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
      (OLD.state = 'AUTHORIZED' AND NEW.state IN ('DISPATCHED', 'SETTLEMENT_UNKNOWN', 'AWAITING_FINALITY', 'SETTLED', 'FAILED'))
      OR (OLD.state = 'DISPATCHED' AND NEW.state IN ('SETTLEMENT_UNKNOWN', 'AWAITING_FINALITY', 'SETTLED', 'FAILED'))
      OR (OLD.state = 'SETTLEMENT_UNKNOWN' AND NEW.state IN ('AWAITING_FINALITY', 'SETTLED', 'FAILED'))
      OR (OLD.state = 'AWAITING_FINALITY' AND NEW.state IN ('SETTLED', 'FAILED'))
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'dispatch state transition is not monotonic';
    END IF;
  END IF;

  SELECT * INTO leg_quote
  FROM shops.payment_leg_quotes
  WHERE quote_id = NEW.quote_id
    AND leg = NEW.leg
    AND leg_quote_id = NEW.leg_quote_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'dispatch leg quote is not owned by the order quote';
  END IF;

  IF NEW.payment_network IS DISTINCT FROM leg_quote.payment_network
     OR NEW.price_scheme IS DISTINCT FROM leg_quote.price_scheme
     OR NEW.payment_asset IS DISTINCT FROM leg_quote.payment_asset
     OR NEW.amount_minor IS DISTINCT FROM leg_quote.amount_minor
     OR NEW.pay_to IS DISTINCT FROM leg_quote.pay_to
     OR NEW.facilitator_id IS DISTINCT FROM leg_quote.facilitator_id
     OR NEW.valid_before IS DISTINCT FROM leg_quote.valid_before THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'dispatch payment terms differ from the bound leg quote';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_dispatch_is_bound_and_monotonic
BEFORE INSERT OR UPDATE ON shops.payment_dispatches
FOR EACH ROW EXECUTE FUNCTION shops.validate_payment_dispatch();

CREATE FUNCTION shops.validate_finality_receipt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  dispatch shops.payment_dispatches%ROWTYPE;
BEGIN
  SELECT * INTO dispatch
  FROM shops.payment_dispatches
  WHERE dispatch_id = NEW.dispatch_id
  FOR UPDATE;

  IF dispatch.state = 'FAILED' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'finality cannot be recorded for a failed dispatch';
  END IF;
  IF dispatch.state NOT IN ('AWAITING_FINALITY', 'SETTLED')
     OR dispatch.transaction_hash IS NULL
     OR dispatch.settlement_id IS NULL
     OR dispatch.receipt_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'finality requires a complete bound settlement receipt';
  END IF;
  IF NEW.safe_at < dispatch.receipt_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'safe_at cannot predate settlement receipt_at';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER finality_receipt_requires_settlement
BEFORE INSERT ON shops.finality_receipts
FOR EACH ROW EXECUTE FUNCTION shops.validate_finality_receipt();

CREATE FUNCTION shops.validate_delivery_receipt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  order_row shops.orders%ROWTYPE;
  catalogue_row shops.catalogue_versions%ROWTYPE;
  finalized_legs integer;
BEGIN
  SELECT * INTO order_row
  FROM shops.orders
  WHERE order_id = NEW.order_id
  FOR KEY SHARE;

  IF order_row.state <> 'READY_FOR_DELIVERY' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'delivery requires READY_FOR_DELIVERY order state';
  END IF;

  SELECT count(DISTINCT dispatch.leg) INTO finalized_legs
  FROM shops.payment_dispatches AS dispatch
  JOIN shops.finality_receipts AS finality ON finality.dispatch_id = dispatch.dispatch_id
  WHERE dispatch.order_id = NEW.order_id
    AND dispatch.state = 'SETTLED'
    AND dispatch.leg IN ('fee', 'product');

  IF finalized_legs <> 2 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'delivery requires settled finality for fee and product dispatches';
  END IF;

  SELECT catalogue.* INTO catalogue_row
  FROM shops.quotes AS quote
  JOIN shops.catalogue_versions AS catalogue
    ON catalogue.product_id = quote.product_id
   AND catalogue.product_version = quote.product_version
  WHERE quote.quote_id = order_row.quote_id;

  IF NEW.artifact_id <> catalogue_row.artifact_id
     OR NEW.artifact_version <> catalogue_row.artifact_version
     OR NEW.artifact_sha256 <> catalogue_row.artifact_sha256
     OR NEW.artifact_bytes <> catalogue_row.artifact_bytes THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'delivery artifact differs from the pinned catalogue version';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER delivery_receipt_requires_finality
BEFORE INSERT ON shops.delivery_receipts
FOR EACH ROW EXECUTE FUNCTION shops.validate_delivery_receipt();

COMMIT;