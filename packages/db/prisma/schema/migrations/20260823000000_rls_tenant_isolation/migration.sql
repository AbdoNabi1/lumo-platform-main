-- G-63 — RECONSTRUCTED migration. Postgres RLS tenant isolation across every tenant-scoped table.
--
-- READ THIS BEFORE TOUCHING THIS FILE.
--
-- This file is NOT the original. The original SQL was applied directly against the live Supabase
-- database on 2026-08-23 (07:11:18 UTC, per `_prisma_migrations`) and never committed to this
-- repository, on any branch. Prisma records only a checksum of a migration's text, not the text
-- itself, so the original is unrecoverable. What follows was reconstructed on 2026-09-19 from
-- read-only introspection of the live database's own catalogs (`pg_policies`,
-- `pg_class.relforcerowsecurity`, `information_schema.columns`), and reproduces the EFFECTIVE
-- STATE that introspection observed — not, and not claimed to be, the original keystrokes.
--
-- Evidence the reconstruction rests on (live, 2026-09-19):
--   tables_with_tenant_id           = 130
--   policies named tenant_isolation = 130
--   tables with FORCE ROW LEVEL SECURITY = 130
--   tenant-scoped tables WITHOUT a policy = none
-- The set of protected tables is therefore exactly "every base table carrying a `tenant_id`
-- column", which is what the loop below selects. 128 of those 130 carry the strict policy this
-- migration creates; the remaining two (`platform.outbox`, `platform.audit_events`) are relaxed
-- on the READ side only by the next migration, 20260823010000_rls_nullable_tenant_write_check.
--
-- HOW THIS FILE MUST BE APPLIED:
--   * Against the live database — it is ALREADY APPLIED. Use `prisma migrate resolve --applied`
--     to record it, NEVER `migrate deploy`. Running this SQL there would be a no-op at best
--     (every statement is idempotent) but the migration history, not the schema, is what is
--     actually out of sync.
--   * Against a fresh database built from this history — it runs for real, here, in order. That
--     is precisely why it must be committed: without it, a database created from this repository
--     comes up with NO row-level security at all while the live one has 130 policies, and nothing
--     in the migration history would reveal the difference.
--
-- KNOWN LIMITATION, recorded deliberately: the loop protects the tables that exist AT THE MOMENT
-- THIS MIGRATION RUNS. A tenant-scoped table introduced by any LATER migration gets no policy
-- from this file and must carry its own. As of 2026-09-19 no such table exists (130 = 130 above),
-- but nothing in the schema enforces that going forward — see G-63 in the gap register.
--
-- THIS FILE HAS NEVER BEEN EXECUTED, ANYWHERE. It is reconstructed, and it will be recorded with
-- `migrate resolve --applied`, which writes a history row without running the SQL. The live
-- database already has the state it describes. Its first real execution will therefore be on some
-- future fresh database, by whoever builds one — and no test in this repository covers that path,
-- because there is no local Postgres in the development environment this was written in. It is
-- also the first migration in this history to use a `DO` block (checked: zero of the other 38).
-- Whoever first builds a database from this history MUST verify, immediately afterwards:
--     SELECT count(*) FROM pg_policies WHERE policyname = 'tenant_isolation';   -- expect 130
--     SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--      WHERE c.relforcerowsecurity AND n.nspname NOT IN ('pg_catalog','information_schema');
--                                                                                -- expect 130
-- and treat a mismatch as a blocker, not a warning: a silent zero here means the database has no
-- tenant isolation at the storage layer while the application assumes it does.
--
-- The policy predicate reads the tenant from a per-transaction GUC, `app.tenant_id`, set by
-- `PrismaUnitOfWork.run`/`runReadScoped` (ADR-0014). `current_setting(..., true)` is the
-- missing-ok form: it returns NULL rather than raising when the GUC was never set, which makes an
-- unscoped connection see zero rows instead of erroring. FORCE ROW LEVEL SECURITY is what makes
-- the policy apply to the table's OWNER too; without it, the owning role silently bypasses every
-- policy here and the whole layer is decorative.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_schema AS s, c.table_name AS t
    FROM information_schema.columns c
    JOIN information_schema.tables ti
      ON ti.table_schema = c.table_schema
     AND ti.table_name = c.table_name
     AND ti.table_type = 'BASE TABLE'
    WHERE c.column_name = 'tenant_id'
      AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY c.table_schema, c.table_name
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.s, r.t);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', r.s, r.t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', r.s, r.t);
    -- Deliberately a single-quoted format string, not a nested dollar-quoted one: this file is
    -- already the first `DO` block in the migration history, and nested `$f$...$f$` inside `$$`
    -- would add a second untested dependency on how the migration runner hands SQL to Postgres.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I.%I FOR ALL'
      || ' USING (tenant_id = current_setting(''app.tenant_id'', true))'
      || ' WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      r.s, r.t
    );
  END LOOP;
END
$$;
