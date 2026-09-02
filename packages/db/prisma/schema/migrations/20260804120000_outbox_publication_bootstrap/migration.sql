-- Phase A.20 (Task 2) — outbox publication self-containment fix.
--
-- The next migration, `20260805000000_outbox_cdc_publication`, runs
-- `ALTER PUBLICATION lumo_outbox ADD TABLE platform.outbox;` but never creates the publication
-- itself. `CREATE PUBLICATION lumo_outbox;` lived only in the local dev bootstrap script
-- (infrastructure/docker/postgres/init/01-roles-and-cdc.sql), which never runs in CI
-- (.github/workflows/db-integration.yml uses a bare `postgres:16` service image) or in any
-- environment provisioned by `prisma migrate deploy` alone — a fresh database's migration chain
-- always failed with P3018 ("publication ... does not exist") at that later migration.
--
-- Per MIGRATIONS.md §1 ("never edit an applied migration; always add a new one"),
-- `20260805000000_outbox_cdc_publication` is left untouched. This migration is instead inserted
-- immediately before it (timestamp between `20260804000000_sprint5x_schema_reconciliation` and
-- `20260805000000_outbox_cdc_publication`) so the publication exists by the time the later
-- migration's ALTER runs. The guard makes it safe to run against:
--   - a fresh database (creates the publication; nothing to add yet — the next migration adds
--     platform.outbox)
--   - the existing dev database (the publication already exists via the manual/init-script path;
--     the guard no-ops)
--   - CI's bare postgres:16 service (creates the publication itself, no init script needed)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'lumo_outbox') THEN
    CREATE PUBLICATION lumo_outbox;
  END IF;
END $$;
