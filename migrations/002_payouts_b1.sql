-- Migración para Extensión B1 (Payouts)

CREATE TABLE payouts (
  id              TEXT PRIMARY KEY,
  merchant_id     TEXT        NOT NULL REFERENCES merchants (id),
  idempotency_key TEXT        NOT NULL,
  request_hash    TEXT        NOT NULL,
  amount_cents    BIGINT      NOT NULL CHECK (amount_cents > 0),
  response_body   JSONB       NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT payouts_merchant_idempotency_uq UNIQUE (merchant_id, idempotency_key)
);

CREATE INDEX payouts_merchant_idx ON payouts (merchant_id);

-- Ajustar constraint de ledger_movements para permitir payouts
ALTER TABLE ledger_movements DROP CONSTRAINT IF EXISTS ledger_movements_kind_check;
ALTER TABLE ledger_movements ADD CONSTRAINT ledger_movements_kind_check
  CHECK (kind IN ('payment_credit', 'payment_reversal', 'payout'));

-- Agregar columna payout_id a ledger_movements y referenciarlo
ALTER TABLE ledger_movements ADD COLUMN IF NOT EXISTS payout_id TEXT REFERENCES payouts (id);

-- Ajustar que event_id sea nullable si es un payout
ALTER TABLE ledger_movements ALTER COLUMN event_id DROP NOT NULL;

-- Ajustar constraint de signos para incluir payout
ALTER TABLE ledger_movements DROP CONSTRAINT IF EXISTS ledger_movements_signo_chk;
ALTER TABLE ledger_movements ADD CONSTRAINT ledger_movements_signo_chk CHECK (
  (kind = 'payment_credit' AND amount_cents > 0 AND event_id IS NOT NULL) OR
  (kind = 'payment_reversal' AND amount_cents < 0 AND event_id IS NOT NULL) OR
  (kind = 'payout' AND amount_cents < 0 AND payout_id IS NOT NULL)
);
