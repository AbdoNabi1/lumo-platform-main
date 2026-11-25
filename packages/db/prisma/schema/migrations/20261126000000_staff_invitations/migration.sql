-- Wave 1d — staff invitations (Settings > Users and permissions).
-- Written by hand and NOT applied by the agent that authored it. The owner deploys it from Railway's
-- Console (`cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`) BEFORE the release
-- that reads it.
--
-- PURELY ADDITIVE: one new table; nothing existing changes, no backfill.
--
-- WHOSE ROW. The shop's own tenant (`tenant_id`), RLS ENABLED and FORCED with the same
-- `tenant_isolation` policy as every tenant-scoped table. `token_hash` holds only SHA-256 (hex) of the
-- single-use invitation token; the token itself lives in the invitation email alone. There is no
-- `expired` status: expiry is computed from `expires_at`. At most one `pending` invitation exists per
-- (tenant, email) — a partial unique index, which Prisma cannot express, so it lives only in this SQL.

CREATE TABLE "security"."staff_invitations" (
  "id" UUID NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "principal_external_id" TEXT NOT NULL,
  "role_key" TEXT NOT NULL,
  "invited_by" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "accepted_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_invitations_email_normalized" CHECK ("email" = lower(btrim("email")) AND "email" <> ''),
  CONSTRAINT "staff_invitations_role_key_check" CHECK ("role_key" IN ('admin','operator','viewer')),
  CONSTRAINT "staff_invitations_status_check" CHECK ("status" IN ('pending','accepted','revoked'))
);
CREATE UNIQUE INDEX "staff_invitations_token_hash_key" ON "security"."staff_invitations"("token_hash");
CREATE UNIQUE INDEX "staff_invitations_one_pending_per_email" ON "security"."staff_invitations"("tenant_id", "email") WHERE "status" = 'pending';
CREATE INDEX "staff_invitations_tenant_id_status_idx" ON "security"."staff_invitations"("tenant_id", "status");
ALTER TABLE "security"."staff_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "security"."staff_invitations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "security"."staff_invitations";
CREATE POLICY tenant_isolation ON "security"."staff_invitations" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
