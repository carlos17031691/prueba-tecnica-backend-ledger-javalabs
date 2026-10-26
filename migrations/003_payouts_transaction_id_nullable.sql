-- Permitir que transaction_id sea NULL en ledger_movements para registros de tipo payout
ALTER TABLE ledger_movements ALTER COLUMN transaction_id DROP NOT NULL;
