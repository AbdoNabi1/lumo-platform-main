-- Plan 1C — password reset tokens. Written by hand, NOT applied by the agent. The owner deploys it
-- from Railway's Console (`cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`) WITH
-- or BEFORE the release that serves /public/auth/staff/password-reset/*.
-- PURELY ADDITIVE: one new table. Only a SHA-256 hex digest of each token is stored.

CREATE TABLE "security"."password_reset_tokens" (
  "id"          UUID         NOT NULL,
  "tenant_id"   TEXT         NOT NULL,
  "token_hash"  TEXT         NOT NULL,
  "identifier"  TEXT         NOT NULL,
  "expires_at"  TIMESTAMP(3) NOT NULL,
  "used_at"     TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "password_reset_tokens_hash_format_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "password_reset_tokens_tenant_id_token_hash_key"
  ON "security"."password_reset_tokens" ("tenant_id", "token_hash");

CREATE INDEX "password_reset_tokens_tenant_id_identifier_idx"
  ON "security"."password_reset_tokens" ("tenant_id", "identifier");

ALTER TABLE "security"."password_reset_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "security"."password_reset_tokens" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "security"."password_reset_tokens";
CREATE POLICY tenant_isolation ON "security"."password_reset_tokens" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE "security"."password_reset_tokens" IS
  'Plan 1C: single-use, expiring password reset tokens (SHA-256 only). RLS forced.';
