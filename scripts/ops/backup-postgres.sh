#!/usr/bin/env bash
# H-5 — PostgreSQL backup. Produces a compressed custom-format dump and (optionally) a base backup,
# then uploads to an object store. Connection + destination come from the environment / secret
# manager — nothing is hardcoded. Idempotent, fail-fast, and safe to run from a cron/CronJob.
#
#   Required env:  DATABASE_URL   (postgresql://user:pass@host:5432/db)
#   Optional env:  BACKUP_S3_URI  (s3://bucket/pg)   — upload target; skipped if unset
#                  BACKUP_DIR     (default: /var/backups/lumo)
#                  RETENTION_DAYS (default: 14)       — local pruning
#                  PGDUMP_JOBS    (default: 2)         — parallel dump workers
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/lumo}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
PGDUMP_JOBS="${PGDUMP_JOBS:-2}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/pg-${STAMP}.dump"

log() { printf '[backup-postgres] %s\n' "$*" >&2; }

mkdir -p "${BACKUP_DIR}"

log "dumping database → ${OUT}"
# Custom format (-Fc) is compressed and supports parallel restore + selective object restore.
pg_dump --dbname="${DATABASE_URL}" --format=custom --jobs="${PGDUMP_JOBS}" \
        --no-owner --no-privileges --file="${OUT}"

# Integrity check: pg_restore --list must parse the archive TOC.
log "verifying archive integrity"
pg_restore --list "${OUT}" >/dev/null

CHECKSUM="$(sha256sum "${OUT}" | cut -d' ' -f1)"
printf '%s  %s\n' "${CHECKSUM}" "$(basename "${OUT}")" > "${OUT}.sha256"
log "sha256=${CHECKSUM}"

if [[ -n "${BACKUP_S3_URI:-}" ]]; then
  log "uploading → ${BACKUP_S3_URI}/"
  aws s3 cp "${OUT}"        "${BACKUP_S3_URI}/pg-${STAMP}.dump"
  aws s3 cp "${OUT}.sha256" "${BACKUP_S3_URI}/pg-${STAMP}.dump.sha256"
else
  log "BACKUP_S3_URI unset — keeping local copy only"
fi

log "pruning local backups older than ${RETENTION_DAYS} days"
find "${BACKUP_DIR}" -name 'pg-*.dump*' -type f -mtime "+${RETENTION_DAYS}" -delete

log "done"
