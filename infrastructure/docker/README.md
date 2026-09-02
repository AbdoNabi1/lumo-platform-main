# Local infrastructure — operations guide (Sprint 2.2.5)

The full stack lives in [docker-compose.yml](docker-compose.yml). Topology rationale (why each
service exists, flows, scaling): [docs/architecture/26-infrastructure-topology.md](../../docs/architecture/26-infrastructure-topology.md).

## Start / stop / reset

```bash
# start everything (from repo root)
docker compose -f infrastructure/docker/docker-compose.yml up -d

# status + health
docker compose -f infrastructure/docker/docker-compose.yml ps

# stop (keeps data)
docker compose -f infrastructure/docker/docker-compose.yml down

# FULL RESET — destroys all volumes (databases, topics, buckets). Deliberate flag required:
docker compose -f infrastructure/docker/docker-compose.yml down -v
```

First-boot sequence (one time, in order):

1. `up -d` and wait until `ps` shows every service healthy.
2. Apply the schema: `pnpm --filter @platform/db db:migrate:deploy`
   (first real execution of the offline-bootstrapped `20260704000000_init` — see SPRINT_2_2 report).
3. Add the outbox table to the CDC publication (until it becomes migration #2):
   `docker compose -f infrastructure/docker/docker-compose.yml exec postgres psql -U lumo -d lumo -c 'ALTER PUBLICATION lumo_outbox ADD TABLE platform.outbox;'`
4. Register the CDC connector: `bash infrastructure/docker/debezium/register-connector.sh`
5. Run the gated integration tests:
   `DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo pnpm --filter @platform/orders test`

## Endpoints (local)

| Service                  | URL / port                        | Credentials (dev only)   |
| ------------------------ | --------------------------------- | ------------------------ |
| PostgreSQL               | `localhost:5432`                  | lumo / lumo              |
| Redis                    | `localhost:6379`                  | —                        |
| ClickHouse               | `http://localhost:8123`           | lumo / lumo              |
| MinIO S3 / console       | `:9000` / `http://localhost:9001` | minioadmin / minioadmin  |
| Redpanda (host clients)  | `localhost:19092`                 | —                        |
| Redpanda Console         | `http://localhost:8085`           | —                        |
| Kafka Connect (Debezium) | `http://localhost:8083`           | —                        |
| Apicurio Registry        | `http://localhost:8086`           | —                        |
| OTel Collector (OTLP)    | `:4317` gRPC / `:4318` HTTP       | —                        |
| Prometheus               | `http://localhost:9090`           | —                        |
| Grafana                  | `http://localhost:3001`           | admin / admin            |
| Loki / Tempo             | via Grafana datasources           | —                        |
| Mailpit SMTP / UI        | `:1025` / `http://localhost:8025` | —                        |
| pgAdmin                  | `http://localhost:5050`           | admin@lumo.local / admin |
| RedisInsight             | `http://localhost:5540`           | —                        |

> **G0-6 (launch-readiness review):** `.env.example`'s Stage 2 rewrite dropped `GRAFANA_URL`,
> `PROMETHEUS_URL`, and `SCHEMA_REGISTRY_URL` — correctly; no TypeScript process reads them, so
> they don't belong in a schema-generated env contract — but nothing pointed the operator at where
> that information now lives. It lives right here: **Grafana** and **Prometheus** are the
> identically-named rows above; **Apicurio Registry** (row above) is this stack's schema registry.

## Volumes & networks

Named volumes hold all state (`postgres-data`, `redpanda-data`, …) — `down` preserves them,
`down -v` destroys them. Four networks enforce least privilege: `data`, `messaging`,
`observability`, `tools`; a service joins only the planes it needs (e.g. Debezium: messaging +
data; Grafana: observability + tools; nothing from `tools` touches `messaging` except the
console, which operates it).

## Backups & restore (local)

```bash
# logical backup → backups bucket pattern (production: WAL archiving + PITR, doc 15 §2.5)
docker compose -f infrastructure/docker/docker-compose.yml exec postgres \
  pg_dump -U lumo -Fc lumo > lumo-$(date +%Y%m%d).dump

# restore into a FRESH database (never over a live one)
docker compose -f infrastructure/docker/docker-compose.yml exec -T postgres \
  pg_restore -U lumo -d lumo --clean --if-exists < lumo-YYYYMMDD.dump
```

Redpanda: topics are re-creatable from `redpanda/bootstrap-topics.sh`; consumer offsets and
unconsumed messages are development-expendable. MinIO: the `backups` bucket is versioned.

## Production differences (deliberate)

| Local                    | Production (doc 15 / doc 26)                             |
| ------------------------ | -------------------------------------------------------- |
| Single Postgres, no PITR | HA Postgres + WAL archiving + PITR + replicas; PgBouncer |
| Single Redpanda, RF=1    | 3+ brokers, RF=3, tiered storage for 7y topics           |
| Debezium single worker   | Connect cluster (2+), alerting on connector state        |
| Compose secrets in env   | Vault / secret manager; `*_FILE` variants everywhere     |
| Single-binary Loki/Tempo | Distributed targets, object-storage backends             |
| `down -v` resets world   | Nothing is ever `-v`'d; DR runbook applies               |

## Security assumptions (local)

Dev credentials are public by design and never reused; no port is exposed beyond localhost;
`redpanda-console` and `otel-collector` run read-only rootfs; Loki/Tempo run as uid 10001;
the app connects as `lumo` (migration role) locally but `lumo_app` (DML-only) is provisioned
for production posture — RLS policies land as migration #2 (ADR-0008 §3, MIGRATIONS.md).
