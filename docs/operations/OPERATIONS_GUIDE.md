# Operations Guide

> Day-2 operations for the Morbeh runtime: scaling, common procedures, and the error-budget policy.
> For incident-time procedures see [RUNBOOKS](RUNBOOKS.md) and [INCIDENT_RESPONSE](INCIDENT_RESPONSE.md).

## Topology recap

| Process             | Role                                     | Scaling                      | Notes                        |
| ------------------- | ---------------------------------------- | ---------------------------- | ---------------------------- |
| `runtime-api`       | HTTP transport (`/api`) + health/metrics | HPA 2–10, CPU 70 %           | stateless                    |
| `runtime-worker`    | Kafka/Redpanda consumers                 | HPA 2–6 (= topic partitions) | at-least-once + inbox dedupe |
| `runtime-scheduler` | periodic jobs                            | **singleton** (Redis lock)   | PDB `maxUnavailable: 1`      |

Operational endpoints (`/healthz`, `/readyz`, `/metrics`) are **cluster-internal only** — never
exposed through the Ingress (which routes `/api` alone).

## Scaling

- Automatic: HPAs (`40-autoscaling.yaml`) scale on CPU. Worker `maxReplicas` is capped at the topic
  partition count — more readers than partitions is wasted capacity.
- Manual burst: `kubectl -n morbeh-runtime scale deploy/runtime-api --replicas=N` (HPA resumes control).
- Vertical: adjust `resources.requests/limits` in the deployment; requests drive HPA math.

## Common procedures

### Replaying a dead-letter queue

1. Fix and deploy the handler.
2. Replay from the DLQ topic back onto the source topic (or a dedicated replay consumer).
3. The **inbox** deduplicates, so already-processed messages are skipped
   (`messaging_messages_duplicate_total` rises, not `_processed_`). Verify
   `sli:messaging_success:ratio5m` recovers.

### Draining a node

PDBs (`minAvailable: 1` for api/worker) keep availability during `kubectl drain`. The scheduler
tolerates eviction (`maxUnavailable: 1`) and re-acquires its Redis lock on reschedule.

### Rotating a secret

See [BACKUP_AND_RECOVERY §key rotation](BACKUP_AND_RECOVERY.md#key-rotation). App secrets are picked
up on pod restart; roll the deployment after updating the Secret.

### Reading telemetry

- Metrics: Grafana _Morbeh_ folder (Overview / Messaging / Security).
- Traces: Tempo (Grafana Explore); logs: Loki. Trace↔log↔metric correlation is provisioned.

## Known non-durable state

**Platform Console KPIs and the Analytics semantic registry reset on every restart/rollout.** Both
`wirePlatformConsole()` (`services/platform-console`) and `wireAnalytics()` (`services/analytics`) are
intentionally dependency-free, in-process read-models with no backing aggregate and nothing to persist —
`PlatformKpisProjection` and `SemanticRegistry` are rebuilt from scratch on every process start. A pod
restart, rollout, or HPA scale-event **is not a data-loss incident** for either surface; it is expected
behavior. Platform Console repopulates as live events are re-ingested; the Analytics registry
re-registers each context's canonical semantics (today: Finance) at boot. Do not page or open an
incident for an empty/zeroed Platform Console dashboard or Analytics catalog immediately after a
deploy — check deploy history first.

## Error-budget policy

Governed by [SLO_SLI](SLO_SLI.md). Policy (not tooling):

1. **Budget healthy** (burn < 1 over 30 days) → ship features normally.
2. **Slow burn** (`ApiErrorBudgetSlowBurn`) → next sprint prioritises the top reliability regression.
3. **Fast burn** (`ApiErrorBudgetFastBurn`) → page; feature deploys **freeze** until the burn stops.
4. **Budget exhausted** → release train pauses; only reliability fixes ship until the 30-day window
   recovers the budget.

## Capacity & cost

- Prometheus retention is 15d locally; production uses remote-write/long-term store (out of scope of
  the compose stack).
- Right-size from the Overview dashboard: sustained CPU < 30 % with min replicas → lower requests;
  frequent HPA ceiling hits → raise `maxReplicas`.

## Routine maintenance calendar

| Cadence     | Task                                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Weekly      | review `security.yml` scheduled scan; triage Dependabot/advisories                                                                                  |
| Monthly     | review error-budget consumption; rotate short-lived secrets                                                                                         |
| Quarterly   | key rotation drill + restore drill ([BACKUP_AND_RECOVERY](BACKUP_AND_RECOVERY.md)); chaos game-day ([../../chaos/README.md](../../chaos/README.md)) |
| Per release | run the [PRODUCTION_CHECKLIST](PRODUCTION_CHECKLIST.md)                                                                                             |
