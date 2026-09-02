-- Sprint 2.2.5 — PostgreSQL bootstrap (runs ONCE on first cluster init).
-- Prepares (does NOT enable) the production posture: least-privilege roles, CDC plumbing,
-- and the Apicurio registry database. Business schemas/tables come from Prisma migrations
-- (`pnpm --filter @platform/db db:migrate:deploy`), never from here.

-- ── Least-privilege roles ────────────────────────────────────────────────────────────────
-- `lumo` (superuser of this dev cluster) is the MIGRATION role only.
-- `lumo_app` is what the application connects as in production posture: DML on business
-- schemas, no DDL. Grants on future tables are wired per-schema after the first migration
-- (documented in packages/db/prisma/MIGRATIONS.md §3 — RLS lands there too).
CREATE ROLE lumo_app LOGIN PASSWORD 'lumo_app';

-- ── CDC (Debezium) ───────────────────────────────────────────────────────────────────────
-- Replication role for the outbox connector. wal_level=logical is set via server args.
-- The `lumo_outbox` publication itself is owned entirely by migration
-- `20260813000000_outbox_publication_self_contained` (idempotent CREATE PUBLICATION + ALTER
-- PUBLICATION ... ADD TABLE platform.outbox), NOT by this init script — Phase A.20 fixed a
-- hidden dependency where only this dev-only script created the publication, which meant CI
-- (bare `postgres:16` service, no init scripts) and any fresh production database could never
-- deploy the migration chain unattended. Do not re-add `CREATE PUBLICATION` here.
CREATE ROLE debezium LOGIN REPLICATION PASSWORD 'debezium';

-- ── Apicurio schema registry storage ─────────────────────────────────────────────────────
CREATE ROLE apicurio LOGIN PASSWORD 'apicurio';
CREATE DATABASE apicurio OWNER apicurio;

-- ── Ory Hydra/Kratos/Keto persistence (Phase A.34 — production auth persistence) ─────────
-- Dedicated least-privilege role+database per service, same convention as `apicurio` above.
-- Local dev docker-compose keeps `dsn: memory` for all three by default (unchanged, per
-- Phase A.34's "do not modify local dev behavior unnecessarily") — these are provisioned so
-- 1) a local operator can opt into persistence by pointing DSN at these, and 2) this same
-- init script works unmodified against a real production Postgres cluster, where the k8s
-- manifests (infrastructure/k8s/71-hydra.yaml, 72-kratos.yaml, 73-keto.yaml) DO set DSN.
CREATE ROLE hydra LOGIN PASSWORD 'hydra';
CREATE DATABASE hydra OWNER hydra;
CREATE ROLE kratos LOGIN PASSWORD 'kratos';
CREATE DATABASE kratos OWNER kratos;
CREATE ROLE keto LOGIN PASSWORD 'keto';
CREATE DATABASE keto OWNER keto;

-- ── Prepared-but-disabled (production notes; DO NOT enable locally) ──────────────────────
-- PITR: archive_mode=on + archive_command to the `backups` bucket (doc 15 §2.5).
-- Replicas: max_wal_senders/replication_slots already sized (server args) for one CDC slot
--           plus future physical replicas.
-- Partitioning: platform.outbox monthly partitions via migration SQL when volume demands
--           (MIGRATIONS.md §3).
-- RLS: per-business-table tenant policies land as migration #2 (ADR-0008 §3).
