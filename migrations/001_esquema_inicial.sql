-- Esquema inicial del ledger.
-- Montos: BIGINT en centavos. Nunca punto flotante.

CREATE TABLE merchants (
  id             TEXT PRIMARY KEY,
  name           TEXT        NOT NULL,
  -- SHA-256 en hex de la API key. La key en claro no se guarda.
  api_key_hash   TEXT        NOT NULL UNIQUE,
  -- Comisión en puntos básicos: 250 = 2,5 %.
  commission_bps INTEGER     NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Inbox: cada webhook aceptado se persiste acá antes de responder 200.
-- La PK sobre event_id es la garantía de idempotencia en la recepción.
CREATE TABLE inbox_events (
  event_id        TEXT PRIMARY KEY,
  type            TEXT        NOT NULL CHECK (type IN (
                    'payment.created', 'payment.approved', 'payment.rejected', 'payment.reversed')),
  transaction_id  TEXT        NOT NULL,
  -- Sin FK a merchants: un evento de un comercio desconocido se registra igual y se marca invalid.
  merchant_id     TEXT        NOT NULL,
  amount_cents    BIGINT      NOT NULL CHECK (amount_cents > 0),
  currency        TEXT        NOT NULL,
  occurred_at     TIMESTAMPTZ NOT NULL,
  payload         JSONB       NOT NULL,
  -- Hash del contenido normalizado: detecta un event_id repetido con datos distintos.
  payload_hash    TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'received' CHECK (status IN (
                    'received', 'processed', 'deferred', 'invalid', 'failed')),
  reason          TEXT,
  attempts        INTEGER     NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duplicate_count INTEGER     NOT NULL DEFAULT 0,
  correlation_id  TEXT,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  processed_at    TIMESTAMPTZ
);

-- Cola de trabajo del worker: solo los eventos pendientes de procesar.
CREATE INDEX inbox_events_pendientes_idx ON inbox_events (next_attempt_at) WHERE status = 'received';
-- Historial de una transacción y búsqueda de eventos diferidos.
CREATE INDEX inbox_events_transaccion_idx ON inbox_events (transaction_id, received_at);

CREATE TABLE transactions (
  id           TEXT PRIMARY KEY,
  merchant_id  TEXT        NOT NULL REFERENCES merchants (id),
  amount_cents BIGINT      NOT NULL CHECK (amount_cents > 0),
  currency     TEXT        NOT NULL,
  status       TEXT        NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'reversed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX transactions_merchant_idx ON transactions (merchant_id);

-- Ledger append-only. El saldo de un comercio es SUM(amount_cents) de sus movimientos.
-- amount_cents tiene signo: positivo acredita, negativo debita.
CREATE TABLE ledger_movements (
  id             BIGSERIAL PRIMARY KEY,
  merchant_id    TEXT        NOT NULL REFERENCES merchants (id),
  kind           TEXT        NOT NULL CHECK (kind IN ('payment_credit', 'payment_reversal')),
  transaction_id TEXT        NOT NULL REFERENCES transactions (id),
  -- Un evento genera a lo sumo un movimiento.
  event_id       TEXT        NOT NULL UNIQUE REFERENCES inbox_events (event_id),
  gross_cents    BIGINT      NOT NULL,
  fee_cents      BIGINT      NOT NULL,
  amount_cents   BIGINT      NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ledger_movements_signo_chk CHECK (
    (kind = 'payment_credit' AND amount_cents > 0) OR
    (kind = 'payment_reversal' AND amount_cents < 0)
  )
);

-- Segunda red de seguridad: una transacción se acredita una vez y se revierte una vez.
CREATE UNIQUE INDEX ledger_movements_tx_kind_uq ON ledger_movements (transaction_id, kind);
-- Saldo y paginación por cursor (id DESC) por comercio.
CREATE INDEX ledger_movements_merchant_idx ON ledger_movements (merchant_id, id DESC) INCLUDE (amount_cents, created_at);

-- La base rechaza cualquier intento de modificar o borrar un movimiento.
CREATE FUNCTION ledger_movements_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_movements es append-only: % no permitido', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_movements_sin_update_delete
  BEFORE UPDATE OR DELETE ON ledger_movements
  FOR EACH ROW EXECUTE FUNCTION ledger_movements_append_only();

CREATE TRIGGER ledger_movements_sin_truncate
  BEFORE TRUNCATE ON ledger_movements
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_movements_append_only();
