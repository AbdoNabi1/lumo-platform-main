-- WP-1 (guest checkout, G-52) — additive, expand-only (MIGRATIONS.md §1).
--
-- Marks a customer created by guest checkout (find-or-create from the session's contact email)
-- as distinct from one who registered: no password, no verified email, no consent given.
-- NOT NULL with a constant default is a metadata-only change on PostgreSQL 11+ (no table rewrite),
-- and existing rows correctly read as "not a guest". The old app version never selects or writes
-- the column, so it keeps working against the migrated schema. RLS is row-based and unaffected.

ALTER TABLE "identity"."customers" ADD COLUMN "is_guest" BOOLEAN NOT NULL DEFAULT false;
