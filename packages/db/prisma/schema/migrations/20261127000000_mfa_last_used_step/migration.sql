-- Wave 1e — two-step verification (Settings > Users and permissions).
-- Written by hand and NOT applied by the agent that authored it. The owner deploys it from Railway's
-- Console (`cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`) BEFORE the release
-- that reads it.
--
-- PURELY ADDITIVE: one new nullable column; nothing existing changes, no backfill, no default.
--
-- `last_used_step` holds the TOTP time-step counter (floor(unix_seconds / 30)) of the last accepted
-- sign-in code, so the same code (or an older one) can never be accepted twice. NULL = no code has
-- been used yet. It is written in the same compare-and-set save (`version`) as backup-code consumption.
-- The table already has RLS ENABLED and FORCED with the `tenant_isolation` policy; that is unchanged.

ALTER TABLE "security"."mfa_enrollments" ADD COLUMN "last_used_step" INTEGER;
