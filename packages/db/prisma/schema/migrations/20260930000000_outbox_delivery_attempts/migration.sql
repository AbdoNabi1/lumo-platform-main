-- Postgres event transport (`EVENT_TRANSPORT=postgres`): the worker delivers `platform.outbox` rows
-- straight to its in-process consumers instead of publishing them to Kafka. A delivery that fails has
-- to be retried LATER without blocking the rows behind it, so the row itself now carries how many
-- rounds failed and when the next one is due. Under Kafka the retry topic held that state; without a
-- broker there is nowhere else durable to keep it.
--
-- Written by hand and NOT applied by the agent that authored it: this repository's `.env` points at
-- the live database, so deploying is the operator's step.
--
-- PURELY ADDITIVE. Two columns on one table, no backfill, no constraint an existing row can violate:
-- `attempts` defaults to 0 and `available_at` is NULL (= due now) on every row that exists today.
-- Independent of every other pending migration — none of them touches `platform.outbox`.
--
-- ROLLING DEPLOY. Apply BEFORE any process built from this release starts: the generated Prisma
-- client names both columns whenever it reads `platform.outbox`, so a new worker against an
-- unmigrated table fails on its first poll. Whether an INSERT also names `attempts` is Prisma's
-- choice and was not checked — treat writes as affected too. `migrate deploy` as the API's pre-deploy step (what
-- `infrastructure/railway/runtime-api.railway.json` runs) gives that order; deploy the worker after.
-- An OLD process against the migrated table is unaffected: it never names either column.
--
-- KAFKA / DEBEZIUM. Unchanged. The Kafka relay (`PrismaOutboxStore`) never reads or writes either
-- column, and the Debezium EventRouter is configured by field name (`id`, `key`, `payload`, `topic`
-- — `infrastructure/docker/debezium/outbox-connector.json`), so extra columns are ignored.
--
-- NO NEW INDEX. The due-rows query is `status = 'pending' AND (available_at IS NULL OR available_at
-- <= now) ORDER BY created_at`, served by the existing `(status, created_at)` index; the
-- `available_at` test filters the few rows that are waiting on a retry.

ALTER TABLE "platform"."outbox"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "available_at" TIMESTAMP(3);

COMMENT ON COLUMN "platform"."outbox"."attempts" IS
  'Delivery rounds that failed so far. Written only by the Postgres event transport; always 0 under Kafka.';

COMMENT ON COLUMN "platform"."outbox"."available_at" IS
  'Earliest time the next delivery round may run; NULL = due now. Written only by the Postgres event transport.';
