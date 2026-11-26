-- Wave 2b2 Task 3 - a store can also send customer email through its own mailbox over SMTP
-- (Gmail app password, Outlook, Zoho, or any server), not only through a Resend key (D52).
-- Written by hand and NOT applied by the agent that authored it. The owner deploys it from Railway's
-- Console (`cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`) BEFORE the release
-- that reads it. Run it after 20261130000000_store_email_connections.
--
-- ONE change: the `kind` CHECK on notifications.email_connections is widened from ('resend') to
-- ('resend','smtp'). Nothing else moves: no column is added (the SMTP host, port, security, username
-- and password all live INSIDE the sealed `sealed_credentials` blob), no row is touched, and the
-- table's RLS policy is unchanged. For an SMTP row `secret_last4` is the empty string.
--
-- The constraint is dropped and re-added under the same name so the rule has one definition.
-- Postgres named the original inline CHECK "email_connections_kind_check".

ALTER TABLE "notifications"."email_connections"
  DROP CONSTRAINT IF EXISTS "email_connections_kind_check";

ALTER TABLE "notifications"."email_connections"
  ADD CONSTRAINT "email_connections_kind_check" CHECK ("kind" IN ('resend','smtp'));
