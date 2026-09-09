# Backup, Recovery & Disaster Recovery

> Data-durability procedures for every stateful store in the platform, plus key rotation and DR.
> Scripts referenced here live in [`scripts/ops`](../../scripts/ops). All commands read connection
> details from environment/secret-manager values — never hardcode credentials.

## Recovery objectives

| Tier      | Store                         | RPO         | RTO      | Method                                    |
| --------- | ----------------------------- | ----------- | -------- | ----------------------------------------- |
| Critical  | PostgreSQL (system of record) | ≤ 5 min     | ≤ 30 min | WAL archiving + PITR, nightly base backup |
| Critical  | Key material (KMS/Vault)      | 0 (managed) | ≤ 15 min | managed KMS backup + envelope-key export  |
| Important | Redpanda (event log)          | ≤ 15 min    | ≤ 1 h    | topic replication + tiered/object storage |
| Important | ClickHouse (analytics)        | ≤ 1 h       | ≤ 4 h    | rebuildable from events + native backup   |
| Important | MinIO / object store          | ≤ 15 min    | ≤ 1 h    | bucket replication / versioning           |
| Ephemeral | Redis (cache/locks)           | n/a         | seconds  | rebuilds from source; no backup required  |

## Backup strategy

### PostgreSQL

Logical replication is on from day one (`wal_level=logical`). For production durability:

- **Continuous**: WAL archiving to object storage (`archive_mode=on`, `archive_command` → bucket).
  Enables Point-In-Time Recovery to any moment within retention.
- **Periodic**: nightly base backup (`pg_basebackup`) + a logical `pg_dump` for portable exports.
- Run [`scripts/ops/backup-postgres.sh`](../../scripts/ops/backup-postgres.sh) from a cron/CronJob.

### Redpanda / Kafka

Enable topic replication (`replication.factor ≥ 3`) and tiered storage to an object store so the
event log survives broker loss. The `platform.outbox` CDC stream is reproducible from Postgres.

### Object store (MinIO/S3)

Enable bucket **versioning** + cross-region replication. Attachments/media are content-addressed.

### Encryption keys (H-3)

Data-at-rest uses envelope encryption: a KMS-held **Key Encryption Key** (KEK) wraps **Data
Encryption Keys** (DEKs). Back up: (a) the managed KMS (provider-native backup), and (b) the wrapped
DEKs stored alongside the ciphertext. Losing the KEK = unrecoverable data — treat as tier-0.

## Restore procedures

### database-recovery

```bash
# Point-in-time restore to a target timestamp.
scripts/ops/restore-postgres.sh --base s3://backups/pg/base/<date> \
                                --wal  s3://backups/pg/wal \
                                --target-time "2026-07-19T12:00:00Z"
# Then re-point the runtime and confirm readiness.
kubectl -n morbeh-runtime rollout restart deploy/runtime-api deploy/runtime-worker
```

After restore, replay any events produced after the restore point from Redpanda; the **inbox**
deduplicates so replay is idempotent (see [OPERATIONS_GUIDE](OPERATIONS_GUIDE.md#replaying-a-dead-letter-queue)).

### Analytics / object store

- ClickHouse: restore from native backup, or **rebuild** by replaying the event log (analytics is a
  read model — no data loss if events survive).
- MinIO: restore the object version or fail over to the replica bucket.

## Disaster recovery (region loss)

1. **Declare** DR (IC per [INCIDENT_RESPONSE](INCIDENT_RESPONSE.md)).
2. **Provision** the standby region from IaC (`infrastructure/`), applying the k8s manifests.
3. **Restore** Postgres (PITR) + object store from replicated backups; bring up Redpanda from tiered
   storage.
4. **Rehydrate** derived stores (ClickHouse, search indices) by replaying events.
5. **Cut over** DNS/ingress; verify `/readyz` and SLIs; rebuild caches (Redis) lazily.
6. **Validate** with the smoke suite (health + one write round-trip) before reopening traffic.

## key-rotation

Envelope encryption makes rotation cheap — rotating the KEK re-wraps DEKs without re-encrypting data.

```bash
# 1. Create a new KEK version in the KMS (provider CLI / Vault).
# 2. Re-wrap active DEKs under the new KEK version (no plaintext data touched).
scripts/ops/rotate-keys.sh --rewrap-deks --new-kek-version <v>
# 3. App/Ingress TLS + JWT signing keys: publish the new key, keep the old in the JWKS during the
#    overlap window, then retire the old key after tokens/sessions expire.
# 4. Roll the runtime so new secret material is picked up:
kubectl -n morbeh-runtime rollout restart deploy/runtime-api
```

Rotation cadence: KEK quarterly (or on suspected compromise), TLS per cert lifetime, app secrets on
compromise. Rotation drills are a release precondition ([PRODUCTION_CHECKLIST](PRODUCTION_CHECKLIST.md)).

## Verification (do not trust an untested backup)

- **Quarterly restore drill**: restore the latest Postgres backup into a scratch environment and run
  the smoke suite. A backup that has never been restored is a hypothesis, not a backup.
- Alert on backup job failure and on backup age exceeding RPO.
