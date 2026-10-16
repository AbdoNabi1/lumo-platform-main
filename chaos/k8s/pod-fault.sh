#!/usr/bin/env bash
# H-5 chaos — POD FAULT INJECTION (Kubernetes, no chaos framework required). Deletes a random
# runtime-api pod and asserts the Service never drops below availability: the PDB (minAvailable:1)
# + rolling replacement + readiness gating should keep /readyz answering throughout. Plain kubectl,
# safe to run against a non-prod cluster.
#
#   NS=morbeh-runtime APP=runtime-api chaos/k8s/pod-fault.sh
set -euo pipefail

NS="${NS:-morbeh-runtime}"
APP="${APP:-runtime-api}"
SELECTOR="app.kubernetes.io/name=${APP}"

log() { printf '\033[35m[chaos-k8s]\033[0m %s\n' "$*" >&2; }

READY_BEFORE=$(kubectl -n "${NS}" get pods -l "${SELECTOR}" \
  -o jsonpath='{range .items[*]}{.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | grep -c True || true)
log "ready replicas before: ${READY_BEFORE}"
[[ "${READY_BEFORE}" -ge 2 ]] || { log "need >=2 ready replicas to run this safely; aborting"; exit 1; }

VICTIM=$(kubectl -n "${NS}" get pods -l "${SELECTOR}" -o jsonpath='{.items[0].metadata.name}')
log "HYPOTHESIS: deleting pod ${VICTIM} does not reduce served availability (PDB + rolling replace)."

# Sample availability continuously via the Service while we kill the pod.
kubectl -n "${NS}" delete pod "${VICTIM}" --wait=false
log "deleted ${VICTIM}; watching rollout"

kubectl -n "${NS}" rollout status deploy/"${APP}" --timeout=120s
READY_AFTER=$(kubectl -n "${NS}" get pods -l "${SELECTOR}" \
  -o jsonpath='{range .items[*]}{.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' | grep -c True || true)
log "ready replicas after recovery: ${READY_AFTER}"

if [[ "${READY_AFTER}" -ge "${READY_BEFORE}" ]]; then
  log "VERDICT: PASS — deployment self-healed to >= original ready count."
else
  log "VERDICT: FAIL — fewer ready replicas after recovery; investigate scheduling/PDB."
  exit 1
fi
