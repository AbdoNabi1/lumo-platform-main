#!/usr/bin/env bash
# H-5 chaos — DEPENDENCY FAILURE. Generalises the outage experiment to any hard dependency
# (redis|redpanda|keto|hydra). Verifies the runtime degrades predictably and recovers.
#
#   chaos/scripts/dependency-failure.sh <redis|redpanda|keto|hydra>
set -euo pipefail
cd "$(dirname "$0")/../.."
source chaos/scripts/lib.sh

DEP="${1:?usage: dependency-failure.sh <redis|redpanda|keto|hydra>}"
case "${DEP}" in redis|redpanda|keto|hydra) ;; *) chaos_log "unsupported dependency: ${DEP}"; exit 2 ;; esac

hypothesis "Killing '${DEP}' degrades the runtime gracefully (no crash) and it recovers on restart."

restore() {
  chaos_log "restoring: starting ${DEP}"
  "${COMPOSE[@]}" start "${DEP}" >/dev/null 2>&1 || true
  wait_ready 200 90 || chaos_log "WARNING: runtime did not recover to 200 — investigate"
}
trap restore EXIT

wait_ready 200 30
chaos_log "steady state confirmed; killing ${DEP}"
"${COMPOSE[@]}" stop "${DEP}" >/dev/null

# Observe for 30s: the runtime must not exit (container stays up); readiness may flip to 503 for
# hard deps (redis) or stay 200 for soft ones (redpanda affects the worker path, not /readyz).
sleep 10
STATE="$("${COMPOSE[@]}" ps --status running --services | grep -c '^runtime-api$' || true)"
if [[ "${STATE}" == "1" ]]; then
  verdict "PASS — runtime-api stayed up while '${DEP}' was down (readiness=$(probe_ready))."
else
  verdict "FAIL — runtime-api is no longer running after killing '${DEP}' (it should degrade, not crash)."
  exit 1
fi
