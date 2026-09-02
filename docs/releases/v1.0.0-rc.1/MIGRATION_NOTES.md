# Migration Notes — v1.0.0-rc.1

> First release: there is no from-version data migration. These notes cover moving an environment
> **onto** the RC and the standing migration discipline going forward.

## Fresh install

1. Provision infrastructure (Postgres 16, Redis, Redpanda, Ory Hydra/Kratos/Keto, object store) via
   [`infrastructure/`](../../../infrastructure).
2. Apply schema: `pnpm --filter @platform/db db:migrate:deploy` (Prisma, expand-only).
3. Provide secrets from the secret manager/Vault (`infrastructure/k8s/secret.example.yaml` is a
   template only). Configure KMS envelope keys (H-3).
4. Deploy the signed runtime image by digest ([DEPLOYMENT_GUIDE](../../operations/DEPLOYMENT_GUIDE.md)).
5. Apply monitoring: rules + dashboards are auto-loaded in compose; on k8s use your Prometheus stack
   with the same rule files and pod scrape annotations.

## Standing migration discipline (every future upgrade)

- **Expand → migrate → contract.** Additive migrations ship and run **before** the new code; the
  contract (drop) step only ships in a **later** release once no running version reads the old shape.
  This keeps every rollback safe without a down-migration.
- Run migrations as a one-shot Job on the new image, then roll the deployments (`api → worker →
scheduler`).
- Event schemas evolve additively; consumers tolerate unknown fields (the inbox dedupes replays).

## Monitoring migration (H-5)

If you already ran an earlier compose stack:

- `docker compose … up -d` picks up the new `alertmanager` service, the mounted
  `prometheus/rules/`, and the provisioned Grafana dashboards automatically.
- No data migration is needed for monitoring — Prometheus/Grafana volumes are unchanged.

## Rollback

App rollback is `kubectl rollout undo` (image is immutable; schema stays in expand state). See
[UPGRADE_GUIDE §Rollback](../../operations/UPGRADE_GUIDE.md#rollback).
