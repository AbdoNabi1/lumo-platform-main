#!/usr/bin/env bash
# H-5 chaos — NETWORK DEGRADATION. Inject latency + packet loss on a running container's network
# using Pumba (github.com/alexei-led/pumba), which drives `tc netem` inside the target's netns —
# no image changes, no privileged app. Verifies the runtime stays within (degraded but acceptable)
# bounds and that timeouts/retries behave under a slow, lossy link rather than a clean cut.
#
#   chaos/scripts/network-degradation.sh [container] [delay_ms] [loss_pct] [duration]
#   defaults: morbeh-postgres-1 200ms 5% 60s
set -euo pipefail
cd "$(dirname "$0")/../.."
source chaos/scripts/lib.sh

TARGET="${1:-morbeh-postgres-1}"
DELAY="${2:-200}"
LOSS="${3:-5}"
DURATION="${4:-60s}"

command -v pumba >/dev/null 2>&1 || { chaos_log "pumba not installed — see https://github.com/alexei-led/pumba"; exit 127; }

hypothesis "With ${DELAY}ms delay + ${LOSS}% loss to '${TARGET}', /readyz stays 200 (degraded) and latency rises but recovers."

wait_ready 200 30
chaos_log "steady latency baseline (bench 200 reqs):"
node perf/bench/http-bench.mjs --url "${API_URL}/readyz" --requests 200 --concurrency 10 --p95 100000 --p99 100000 || true

chaos_log "injecting: delay=${DELAY}ms jitter=50ms loss=${LOSS}% on ${TARGET} for ${DURATION}"
# Pumba self-reverts the netem qdisc when the duration elapses (built-in restore) — no trap needed.
pumba netem --duration "${DURATION}" \
  --tc-image gaiadocker/iproute2 \
  delay --time "${DELAY}" --jitter 50 loss --percent "${LOSS}" "${TARGET}" &
PUMBA_PID=$!

sleep 5
chaos_log "degraded latency sample (during fault):"
node perf/bench/http-bench.mjs --url "${API_URL}/readyz" --requests 200 --concurrency 10 --p95 100000 --p99 100000 || true
chaos_log "readiness during degradation: $(probe_ready)"

wait "${PUMBA_PID}" || true
wait_ready 200 60
verdict "network restored; confirm the latency sample returned to baseline on the Grafana Overview dashboard."
