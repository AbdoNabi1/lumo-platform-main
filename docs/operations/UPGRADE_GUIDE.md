# Upgrade Guide

> How to move a running environment from one release to the next with zero downtime. Builds on the
> existing [RELEASE_PROCESS](../RELEASE_PROCESS.md) and the expand/contract migration rule.

## Principles

1. **Migrations before code**, and **expand → migrate → contract** so old and new app versions run
   against the same schema during a rollout. Rollback never needs a down-migration.
2. **Immutable images by digest** — an upgrade is a change of the deployed digest, nothing more.
3. **One compatibility window** — N and N-1 app versions are wire/schema compatible.

## Standard upgrade

```bash
# 0. Verify + pin the target (see DEPLOYMENT_GUIDE for cosign verification).
DIGEST=ghcr.io/<org>/morbeh-platform/runtime@sha256:<digest>

# 1. EXPAND: apply additive (backward-compatible) migrations FIRST.
#    (new nullable columns, new tables, new topics) — safe for the running old version.
#    Uses the existing @platform/db script (prisma migrate deploy) run as a one-shot Job.
kubectl -n morbeh-runtime create job migrate-expand-$(date +%s) --image=$DIGEST -- \
  pnpm --filter @platform/db db:migrate:deploy   # expand-only migrations

# 2. ROLL the app (api → worker → scheduler); zero-downtime via maxUnavailable:0 + PDB.
cd infrastructure/k8s && kustomize edit set image morbeh-runtime=$DIGEST && kubectl apply -k .
kubectl -n morbeh-runtime rollout status deploy/runtime-api
kubectl -n morbeh-runtime rollout status deploy/runtime-worker
kubectl -n morbeh-runtime rollout status deploy/runtime-scheduler

# 3. Smoke: /readyz on each process + one write path (outbox → CDC → consumer round-trip).

# 4. CONTRACT: only in a LATER release, once no running version reads the old shape,
#    drop the deprecated columns/tables.
```

## Rollback

- **App only** (schema unchanged, still in expand state): `kubectl rollout undo deploy/<name>` — always safe.
- **Failed expand migration**: expand steps are additive and idempotent; re-run or roll the app back
  to the previous digest, which still matches the pre-expand schema.
- **Never** contract in the same release you expand — that is what preserves rollback safety.

## Version compatibility

See [COMPATIBILITY_MATRIX](../releases/v1.0.0-rc.1/COMPATIBILITY_MATRIX.md) for supported runtimes,
datastores, and N↔N-1 guarantees. Breaking changes are called out in the release's
[BREAKING_CHANGES](../releases/v1.0.0-rc.1/BREAKING_CHANGES.md) with migration notes.

## Dependency & infra upgrades

- **Datastores** (Postgres/Redis/Redpanda/Keto/Hydra) — upgrade one at a time; the runtime retries
  and readiness fails closed, so a brief dependency restart drains rather than errors.
- **Node/pnpm** — bump `.nvmrc` / corepack pin, rebuild the image, run the full gate.
