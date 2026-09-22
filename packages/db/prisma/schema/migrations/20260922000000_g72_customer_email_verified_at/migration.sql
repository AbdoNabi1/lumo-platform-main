-- G-72 — additive, expand-only (MIGRATIONS.md §1).
--
-- Nullable: null means "never verified" (guest or pre-verification-flow row). Set once, at
-- CompleteSignup, alongside is_guest flipping to false. RLS is row-based on tenant_id and is
-- unaffected by a new column.

ALTER TABLE "identity"."customers" ADD COLUMN "email_verified_at" TIMESTAMP(3);
