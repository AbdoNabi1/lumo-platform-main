-- Plan 1B-1 — durable, tenant-scoped password credentials (replaces the process-memory provider).
-- Written by hand and NOT applied by the agent that authored it. The owner deploys it from Railway's
-- Console (`cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`) WITH or BEFORE the
-- release that injects HashedPasswordAuthProvider.
--
-- PURELY ADDITIVE: one new table; nothing existing changes. Passwords registered before this
-- release lived only in process memory and are already gone after any restart, so there is nothing
-- to backfill.
--
-- WHOSE ROW. The shop's own tenant (`tenant_id`), RLS ENABLED and FORCED with the same
-- `tenant_isolation` policy as every tenant-scoped table: one shop's session can never read
-- another shop's credentials. `password_hash` holds only a scrypt hash.

CREATE TABLE "security"."password_credentials" (
  "id"                    UUID         NOT NULL,
  "tenant_id"             TEXT         NOT NULL,
  "identifier"            TEXT         NOT NULL,
  "principal_external_id" TEXT         NOT NULL,
  "password_hash"         TEXT         NOT NULL,
  "failed_attempts"       INTEGER      NOT NULL DEFAULT 0,
  "locked_until"          TIMESTAMP(3),
  "version"               INTEGER      NOT NULL DEFAULT 0,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "password_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "password_credentials_identifier_normalised_check"
    CHECK ("identifier" = lower(btrim("identifier")) AND "identifier" <> ''),
  CONSTRAINT "password_credentials_hash_format_check"
    CHECK ("password_hash" LIKE 'scrypt$%'),
  CONSTRAINT "password_credentials_failed_attempts_check" CHECK ("failed_attempts" >= 0)
);

CREATE UNIQUE INDEX "password_credentials_tenant_id_identifier_key"
  ON "security"."password_credentials" ("tenant_id", "identifier");

CREATE INDEX "password_credentials_tenant_id_principal_external_id_idx"
  ON "security"."password_credentials" ("tenant_id", "principal_external_id");

ALTER TABLE "security"."password_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "security"."password_credentials" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "security"."password_credentials";
CREATE POLICY tenant_isolation ON "security"."password_credentials" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE "security"."password_credentials" IS
  'Plan 1B-1: scrypt-hashed password credentials, one per (tenant, identifier). RLS forced. Never holds a password.';
