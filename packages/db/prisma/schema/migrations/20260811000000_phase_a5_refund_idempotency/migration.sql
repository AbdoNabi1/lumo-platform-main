-- Phase A.5 (Refund Idempotency & Crash-Retry Security Closure) — additive, expand-only.
-- Generated offline (no database host in this environment); apply with `prisma migrate deploy`
-- against Postgres 16. See PHASE_A5_REFUND_IDEMPOTENCY_SECURITY_CLOSURE_REPORT.md.
--
-- Refund: new nullable idempotency key + unique constraint, same precedent as the Sprint A0
-- PaymentIntent.idempotency_key column (20260726000000_sprint_a0_preconditions). Safe without a
-- duplicate audit: the column is new (every existing row is NULL), and Postgres treats each NULL
-- as distinct in a unique index, so no pre-existing row can violate it. Scoped per intent (not
-- per tenant) — the same logical-refund key can never legitimately repeat across two different
-- payment intents, but this constraint does not need to reach across intents to prove that.
ALTER TABLE "payments"."refunds" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "refunds_intent_id_idempotency_key_key"
  ON "payments"."refunds"("intent_id", "idempotency_key");
