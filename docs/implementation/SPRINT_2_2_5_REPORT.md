# Sprint 2.2.5 Report — Infrastructure Foundation

> 2026-07-05. Scope: the complete Docker infrastructure every future sprint runs on. No business
> logic, no domain/aggregate/event/repository changes, no ADR redesign. Topology contract:
> doc 26; operations: `infrastructure/docker/README.md`.

## Delivered

**Compose stack (17 services, 4 least-privilege networks, 11 named volumes, health checks,
startup ordering, resource limits):** PostgreSQL 16 (wal_level=logical, CDC roles/publication
prepared by init SQL), Redis 7 (AOF, noeviction), ClickHouse, MinIO (+ idempotent bucket/
lifecycle bootstrap: media/exports/imports/backups, backups versioned), Redpanda v24.2
(+ idempotent topic bootstrap: all 17 doc-20 §1.1 topics + `.retry`/`.dlq` companions + audit
topic, retention per doc-20 keys), Redpanda Console, Debezium Connect 2.7 (+ outbox EventRouter
connector config + registration script), Apicurio (SQL-backed on Postgres), OTel Collector
(OTLP 4317/4318 → Tempo/Prometheus/Loki), Prometheus (scrapes collector + Redpanda), Grafana
(provisioned datasources, traces↔logs linking), Loki 3 (TSDB/filesystem), Tempo 2.6, Mailpit,
pgAdmin, RedisInsight, and the existing web dev container.

**Configuration:** `.env.example` extended with Messaging / Telemetry / Authentication /
Payments / Email / Feature-flags / Tenant groups (secret-bearing values deferred to the secret
manager with `*_FILE` variants — never committed).

**Docs:** doc 26 (why each service, data/event flow, failure recovery, scaling/HA, K8s path),
ops README (start/stop/reset, first-boot sequence, endpoints, backup/restore, prod differences,
security assumptions).

## Key decisions & tradeoffs (D-043)

1. **Debezium EventRouter routes by the outbox row's `topic` column with ByteArrayConverter** —
   the on-wire envelope is byte-identical to what `OutboxWriter` persisted; no re-serialization,
   no drift between relay and CDC paths.
2. **Redpanda Console over generic Kafka-UI** — native Connect + Redpanda admin integration;
   tradeoff: Redpanda-flavored tooling (the protocol surface stays vanilla Kafka).
3. **Per-topic `.retry`/`.dlq` companions** pre-created — the broker-side answer to the
   in-process-sleep retry (ADR-0005 note / G-9); consumers adopt them in Sprint 2.3+.
4. **Apicurio SQL-backed on the same Postgres** (own database/role) — durable registry without
   another stateful service; production may split it out.
5. **Prepared, deliberately not enabled:** RLS (migration #2), PITR/replicas (settings sized,
   archive off), outbox partitioning (SQL slot in MIGRATIONS.md), `lumo_app` DML-only role
   (created, unused until the transport composition).

## Known limitations

- Single-node everything, RF=1 — dev parity, not production sizing (doc 26 §6 is the posture).
- `deploy.resources.limits` are dev-box ceilings.
- Publication table-add + connector registration are manual first-boot steps until migration #2
  automates the publication (documented in README step 3–4).
- Grafana ships datasources only — dashboards arrive with app instrumentation (G-19).

## Validation (all executed this sprint)

| Gate                                  | Result                                                                                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose config`               | ✅ valid (client-side; Compose v5.1.4)                                                                                                                                                    |
| `prisma validate` / `prisma generate` | ✅                                                                                                                                                                                        |
| lint / typecheck / test / build       | ✅ 103/103 tasks                                                                                                                                                                          |
| dependency-cruiser                    | ✅ 0 violations (392 modules)                                                                                                                                                             |
| `docker compose up`                   | ⛔ **honestly blocked**: Docker Desktop is installed (CLI 29.5.3) but the engine is not running on this machine. First-boot runbook is written and ordered (README); no result was faked. |

## Readiness for Sprint 2.3

Everything Sprint 2.3 (Redis: cart cache/locks/rate-limit/idempotency) and the broker sprint
need is provisioned: Redis with AOF, topics with companions, CDC path configured end-to-end,
OTLP seam listening. The single prerequisite is operational, not engineering: **start the
Docker engine, run the first-boot sequence (README §Start), execute the gated integration
suites.** Until then, every adapter remains validated by typecheck/lint and honest gating.

## Checklists

**Operational (first boot):** engine up → `up -d` → all healthy → `db:migrate:deploy` →
publication add → connector register → integration tests → Grafana reachable → Console shows 54 topics.
**Disaster recovery (local):** `pg_dump` to backups bucket (versioned) → `down -v` only ever
deliberate → restore via `pg_restore` into fresh DB → topics re-bootstrap from script → offsets
expendable. **Production readiness:** everything in doc 26 §6 + secrets to Vault + alerting on
connector state/slot lag/DLQ depth — tracked in the gap register (G-13/14/19/26/31).
