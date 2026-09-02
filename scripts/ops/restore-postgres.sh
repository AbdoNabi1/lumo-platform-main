#!/usr/bin/env bash
# H-5 — PostgreSQL restore. Two modes:
#   1) dump restore : restore a pg_dump custom archive into TARGET_DATABASE_URL.
#   2) PITR         : print the point-in-time-recovery runbook for base-backup + WAL replay
#                     (WAL PITR is a cluster-level operation, not a single psql command).
#
# Restoring is destructive — it refuses to run unless CONFIRM=yes to prevent an accidental wipe.
#
#   Env:  TARGET_DATABASE_URL (required for --dump)   CONFIRM=yes (required for --dump)
set -euo pipefail

log() { printf '[restore-postgres] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

MODE=""
DUMP_FILE=""
BASE=""; WAL=""; TARGET_TIME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dump)        MODE="dump"; DUMP_FILE="${2:?--dump needs a file}"; shift 2 ;;
    --base)        MODE="pitr"; BASE="${2:?}"; shift 2 ;;
    --wal)         WAL="${2:?}"; shift 2 ;;
    --target-time) TARGET_TIME="${2:?}"; shift 2 ;;
    *) die "unknown arg: $1" ;;
  esac
done

case "${MODE}" in
  dump)
    : "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"
    [[ "${CONFIRM:-}" == "yes" ]] || die "refusing to restore without CONFIRM=yes (this overwrites data)"
    [[ -f "${DUMP_FILE}" ]] || die "dump file not found: ${DUMP_FILE}"
    if [[ -f "${DUMP_FILE}.sha256" ]]; then
      log "verifying checksum"; ( cd "$(dirname "${DUMP_FILE}")" && sha256sum -c "$(basename "${DUMP_FILE}").sha256" )
    fi
    log "restoring ${DUMP_FILE} → target (clean, single transaction where possible)"
    pg_restore --dbname="${TARGET_DATABASE_URL}" --clean --if-exists --no-owner --no-privileges \
               --exit-on-error --jobs="${PGRESTORE_JOBS:-2}" "${DUMP_FILE}"
    log "restore complete — run the smoke suite before reopening traffic"
    ;;
  pitr)
    cat <<EOF
[restore-postgres] Point-In-Time Recovery runbook
  base backup : ${BASE}
  WAL archive : ${WAL:-<required>}
  target time : ${TARGET_TIME:-<latest>}

Steps (operator, on a fresh data directory):
  1. Stop Postgres; move aside the current data dir.
  2. Restore the base backup:   aws s3 sync ${BASE} \$PGDATA
  3. Create \$PGDATA/recovery.signal ; set in postgresql.conf:
        restore_command = 'aws s3 cp ${WAL}/%f %p'
        recovery_target_time = '${TARGET_TIME}'
        recovery_target_action = 'promote'
  4. Start Postgres; it replays WAL to the target time and promotes.
  5. Verify readiness, then replay post-restore events from Redpanda (inbox dedupes).
See docs/operations/BACKUP_AND_RECOVERY.md#database-recovery.
EOF
    ;;
  *) die "specify --dump <file>  OR  --base <uri> [--wal <uri>] [--target-time <ts>]" ;;
esac
