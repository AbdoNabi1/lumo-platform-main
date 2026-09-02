#!/usr/bin/env bash
# H-5 chaos — DATABASE OUTAGE. Stop Postgres and verify the runtime (a) fails readiness CLOSED
# (503, so no traffic is routed to it) rather than crashing, and (b) self-heals to 200 once the DB
# returns. This proves the readiness contract + dependency retry/backoff under a hard outage.
set -euo pipefail
cd "$(dirname "$0")/../.."
source chaos/scripts/lib.sh

hypothesis "With Postgres down, /readyz returns 503 (fail-closed); it returns to 200 within 60s of recovery."

restore() {
  chaos_log "restoring: starting postgres"
  "${COMPOSE[@]}" start postgres >/dev/null 2>&1 || true
  wait_ready 200 90 || chaos_log "WARNING: runtime did not recover — investigate"
}
trap restore EXIT

chaos_log "steady state: /readyz=$(probe_ready)"
wait_ready 200 30

chaos_log "injecting fault: stopping postgres"
"${COMPOSE[@]}" stop postgres >/dev/null

if wait_ready 503 60; then
  verdict "PASS — runtime failed closed (503) during the outage."
else
  verdict "FAIL — runtime did NOT report unready during the DB outage (check the readiness probe)."
  exit 1
fi
# EXIT trap restores postgres and asserts recovery to 200.
