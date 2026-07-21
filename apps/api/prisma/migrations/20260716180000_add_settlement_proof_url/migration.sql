-- WI-023 (ADR-020): optional payment-proof attachment on a settlement.
-- Nullable, additive column mirroring Expense.receiptUrl exactly — no
-- backfill needed, existing rows read as NULL.
ALTER TABLE "Settlement" ADD COLUMN "proofUrl" TEXT;
