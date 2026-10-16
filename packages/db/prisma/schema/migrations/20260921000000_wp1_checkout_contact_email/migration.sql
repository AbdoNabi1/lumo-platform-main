-- WP-1 (guest checkout, G-52) — additive, expand-only (MIGRATIONS.md §1).
--
-- A checkout session had nowhere to put a guest's contact address, so guest checkout could not
-- resolve a customer to place the order against. Adds the nullable column; every session created
-- before this migration simply has none. No backfill, no default, no index (never queried by it).
-- RLS is row-based on tenant_id and is unaffected by a new column.

ALTER TABLE "checkout"."checkout_sessions" ADD COLUMN "contact_email" TEXT;
