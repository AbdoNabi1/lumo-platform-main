-- G-72 — additive, expand-only (MIGRATIONS.md §1). New tenant-scoped table: needs its own RLS
-- policy explicitly. The loop-based 20260823000000_rls_tenant_isolation migration only covers
-- tables that existed when IT ran (G-63, documented KNOWN LIMITATION in that migration) — it will
-- not retroactively pick this one up.

CREATE TABLE "identity"."signup_tokens" (
  "id" UUID NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "customer_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "signup_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "signup_tokens_tenant_id_token_hash_key" ON "identity"."signup_tokens"("tenant_id", "token_hash");
CREATE INDEX "signup_tokens_tenant_id_customer_id_idx" ON "identity"."signup_tokens"("tenant_id", "customer_id");

ALTER TABLE "identity"."signup_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity"."signup_tokens" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "identity"."signup_tokens";
CREATE POLICY tenant_isolation ON "identity"."signup_tokens" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
