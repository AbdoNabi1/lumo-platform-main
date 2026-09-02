#!/usr/bin/env bash
# H-5 — shared chaos helpers. Every experiment is a controlled, self-restoring fault: it records the
# steady state, injects, observes, then ALWAYS restores (trap on EXIT) so a failed run never leaves
# the stack degraded. Reuses the existing compose stack — no new infrastructure.
set -euo pipefail

COMPOSE=(docker compose -f infrastructure/docker/docker-compose.yml -f infrastructure/docker/docker-compose.runtime.yml)
API_URL="${API_URL:-http://localhost:3080}"

chaos_log() { printf '\033[35m[chaos]\033[0m %s\n' "$*" >&2; }

# Poll /readyz; print status code. The runtime is expected to fail CLOSED (503) when a hard
# dependency is down and recover to 200 when it returns.
probe_ready() {
  curl -s -o /dev/null -w '%{http_code}' "${API_URL}/readyz" || echo "000"
}

# Wait until /readyz returns the expected code (or timeout). Returns 0 on success.
wait_ready() {
  local expected="$1" timeout="${2:-60}" waited=0
  while [[ "$(probe_ready)" != "${expected}" ]]; do
    sleep 2; waited=$((waited + 2))
    if [[ ${waited} -ge ${timeout} ]]; then
      chaos_log "TIMEOUT waiting for /readyz=${expected} (last=$(probe_ready))"; return 1
    fi
  done
  chaos_log "/readyz=${expected} reached in ${waited}s"
}

hypothesis() { chaos_log "HYPOTHESIS: $*"; }
verdict() { chaos_log "VERDICT: $*"; }
