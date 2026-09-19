-- G-63 — RECONSTRUCTED migration. Relaxes the READ half of tenant isolation for the two platform
-- tables that legitimately hold tenant-less rows, while keeping the WRITE half strict.
--
-- READ THIS BEFORE TOUCHING THIS FILE.
--
-- Not the original. Applied directly against the live Supabase database on 2026-08-23 and never
-- committed; Prisma stores only a checksum, so the original text is unrecoverable. Reconstructed
-- 2026-09-19 from read-only introspection, reproducing the effective state observed there. The
-- long-form note at the head of 20260823000000_rls_tenant_isolation applies to this file too,
-- including how it must be applied (`migrate resolve --applied`, never `migrate deploy`).
--
-- Evidence (live, 2026-09-19): exactly two of the 130 `tenant_isolation` policies carry the
-- nullable-read predicate, and they are on `platform.audit_events` and `platform.outbox`.
--
-- WHAT CHANGES, AND WHY IT IS ASYMMETRIC — this is the whole point of the migration:
--
--   USING      (the READ half)  tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)
--   WITH CHECK (the WRITE half) tenant_id = current_setting('app.tenant_id', true)
--
-- The strict policy from the previous migration makes a row with `tenant_id IS NULL` invisible to
-- everyone, because `NULL = anything` is NULL, not true. Both of these tables predate tenant
-- scoping and hold rows written before `tenant_id` was populated: `platform.outbox` (the
-- transactional outbox, drained by the relay) and `platform.audit_events` (the audit trail, which
-- must never lose a row). Making those rows unreadable would strand undelivered outbox messages
-- and silently truncate the audit trail — a compliance problem, not just an operational one.
--
-- So the READ half is relaxed to let the legacy tenant-less rows through, and the WRITE half is
-- left strict so that NO NEW tenant-less row can be created: `WITH CHECK` rejects an INSERT or
-- UPDATE whose `tenant_id` does not match the current GUC, and a NULL `tenant_id` fails that
-- comparison. The set of tenant-less rows can therefore only shrink over time, never grow. That
-- asymmetry is deliberate and must survive any future edit to these two policies.
--
-- Do not "simplify" this by making WITH CHECK match USING. That would reopen tenant-less writes
-- and convert a closing gap into a permanent one.
--
-- Like the previous migration, this file has never been executed anywhere: it is reconstructed,
-- will be recorded with `migrate resolve --applied`, and runs for real only on a future fresh
-- database. Verify there with:
--     SELECT schemaname||'.'||tablename FROM pg_policies
--      WHERE policyname = 'tenant_isolation' AND qual LIKE '%IS NULL%';
--     -- expect exactly: platform.audit_events, platform.outbox

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT *
    FROM (VALUES ('platform', 'audit_events'), ('platform', 'outbox')) AS v(s, t)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', r.s, r.t);
    -- Single-quoted format string, not a nested dollar-quoted one — same reasoning as the
    -- previous migration: do not stack a second untested SQL-quoting dependency on top of the
    -- first `DO` block in this history.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I.%I FOR ALL'
      || ' USING (tenant_id IS NULL OR tenant_id = current_setting(''app.tenant_id'', true))'
      || ' WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      r.s, r.t
    );
  END LOOP;
END
$$;
