# Runbooks

> Operational response procedures. Each anchor is referenced directly by an alert's `runbook`
> annotation in [`alerts.rules.yml`](../../infrastructure/docker/prometheus/rules/alerts.rules.yml).
> Every runbook follows: **Symptom → Diagnose → Mitigate → Verify → Escalate.**

Conventions used below:

- `NS=lumo-runtime` (Kubernetes namespace).
- Compose stack: `infrastructure/docker/docker-compose.yml` (+ `docker-compose.runtime.yml`).

---

## runtime-process-down

**Symptom** — `RuntimeProcessDown`: Prometheus cannot scrape a runtime component for 2m.

**Diagnose**

```bash
kubectl -n lumo-runtime get pods -l app.kubernetes.io/name=runtime-api
kubectl -n lumo-runtime describe pod <pod>      # events: OOMKilled? CrashLoopBackOff? ImagePullBackOff?
kubectl -n lumo-runtime logs <pod> --previous   # crash cause from the prior container
```

**Mitigate**

- `CrashLoopBackOff` from a bad deploy → roll back: `kubectl -n lumo-runtime rollout undo deploy/runtime-api`.
- `OOMKilled` → see [high-memory](#high-memory).
- `ImagePullBackOff` → verify the image digest exists in GHCR and the pull secret is present.

**Verify** — `kubectl -n lumo-runtime rollout status deploy/runtime-api` and the alert clears.
**Escalate** — if the image itself is bad, page the release owner; block further promotion.

---

## runtime-not-ready

**Symptom** — `RuntimeNotReady`: `/readyz` has reported unhealthy for 5m (a critical dependency is down).

**Diagnose**

```bash
kubectl -n lumo-runtime exec <pod> -- wget -qO- localhost:3080/readyz    # shows failing component
```

The readiness report lists each dependency (`postgres`, `redis`, `redpanda`, `keto`, `hydra`).
**Mitigate** — jump to the specific dependency runbook: [dependency-down](#dependency-down).
Readiness fails **closed** by design — no traffic is routed to an unready pod (PDB keeps ≥1 old pod).
**Verify** — `runtime_ready == 1` and the pod re-enters the Service endpoints.
**Escalate** — datastore outage → DBA / platform on-call.

---

## dependency-down

**Symptom** — `DependencyDown`: a named dependency is unreachable for 3m.

**Diagnose** — identify `{{ $labels.name }}`:

| name         | check                                                                       |
| ------------ | --------------------------------------------------------------------------- |
| postgres     | `kubectl -n lumo-data get pods,svc -l app=postgres`; connections exhausted? |
| redis        | `redis-cli -h <host> ping`                                                  |
| redpanda     | `rpk cluster health`                                                        |
| keto / hydra | `curl -sf http://<host>:4466/health/ready`                                  |

**Mitigate** — restart/scale the dependency; check network policy (`50-networkpolicy.yaml`) wasn't
changed. The runtime **retries with backoff** and self-heals when the dependency returns.
**Verify** — `runtime_dependency_up{name="…"} == 1`.
**Escalate** — managed-service outage → provider status page + platform on-call.

---

## api-error-budget-burn

**Symptom** — `ApiErrorBudgetFastBurn` (page) or `ApiErrorBudgetSlowBurn` (ticket).

**Diagnose**

```promql
topk(10, sum by (status) (rate(http_requests_total{job="lumo-runtime",status=~"5.."}[5m])))
```

Correlate with a recent deploy (Grafana annotations), a dependency alert, or a traffic spike.
**Mitigate**

- Deploy-correlated → `kubectl rollout undo`.
- Dependency-correlated → follow [dependency-down](#dependency-down).
- Load-correlated → confirm the HPA is scaling (`kubectl -n lumo-runtime get hpa`); raise `maxReplicas` if capped.
  **Verify** — `slo:api_error_budget:burn1h < 1` and the budget stops draining.
  **Escalate** — budget exhausted → invoke the [error-budget policy](OPERATIONS_GUIDE.md#error-budget-policy).

---

## api-latency

**Symptom** — `ApiLatencyBudgetBreached`: 5m average latency > 300 ms.
**Diagnose** — check dependency latency (DB/Redis/Keto) via the Security & Overview dashboards; check
CPU throttling (`kubectl top pod`). **Mitigate** — scale out (HPA), or roll back a latency regression.
**Verify** — `sli:api_latency_ms:avg5m < 300`. **Escalate** — persistent regression → owning team.

---

## messaging-dead-letter

**Symptom** — `MessagingDeadLettering` / `MessagingSuccessSloBreached`.
**Diagnose** — identify `{{ $labels.topic }}` and `{{ $labels.group }}`; inspect the dead-letter
topic and worker logs for the handler exception. **Mitigate** — fix/deploy the handler, then replay
the DLQ per [OPERATIONS_GUIDE](OPERATIONS_GUIDE.md#replaying-a-dead-letter-queue). The inbox makes
replay **idempotent** (duplicate detection), so replay is safe. **Verify** —
`sli:messaging_success:ratio5m > 0.995`. **Escalate** — schema/contract break → producing team.

---

## high-memory

**Symptom** — `RuntimeHighMemory`: RSS > 480 Mi (limit 512 Mi) → OOMKill risk.
**Diagnose** — `nodejs_heap_used_bytes` trend on the Overview dashboard; steady climb = leak, sawtooth
= normal GC. **Mitigate** — short term, `kubectl rollout restart` to recycle; the HPA adds replicas
under CPU pressure. **Verify** — RSS below threshold. **Escalate** — confirmed leak → owning team with
a heap snapshot.

---

## failed-logins

**Symptom** — `ElevatedFailedLogins`: > 5/s for 5m (possible credential stuffing).
**Diagnose** — correlate source IPs/tenants in the Security dashboard and audit log. **Mitigate** —
the risk engine (H-2/H-4) raises step-up automatically; if a single source dominates, block at the
ingress/WAF. **Verify** — rate normalises. **Escalate** — coordinated attack → [INCIDENT_RESPONSE](INCIDENT_RESPONSE.md).

---

## authorization-latency

**Symptom** — `AuthorizationLatencyHigh`: authz p95 > 150 ms.
**Diagnose** — check Keto health and the edge policy cache hit ratio (`policy_cache_hits`).
**Mitigate** — a cold/low cache hit ratio after deploy self-warms; if Keto is slow, follow
[dependency-down](#dependency-down). **Verify** — p95 < 150 ms. **Escalate** — Keto capacity → platform on-call.

---

## cdc-connector-task-failed

**Symptom** — `CdcConnectorTaskFailed`: the `cdc_connector_task_failed{connector,task}` gauge (Phase
A.23's watchdog job, `apps/runtime/src/scheduler.ts`) has read 1 for 3m — a Kafka Connect task has
been in state `FAILED` across at least 6 watchdog polls.

**Diagnose**

```bash
curl -sf http://<debezium-connect-host>:8083/connectors/lumo-outbox/status | jq
kubectl -n lumo-runtime logs deploy/runtime-scheduler --since=10m | grep "cdc watchdog"
```

The scheduler log line tells you which branch fired: `restarted FAILED task` (it's retrying and
should clear soon), `restart call failed`/`restart call errored` (Kafka Connect's REST API itself is
unreachable — check `KAFKA_CONNECT_URL` and the `allow-debezium-connect-ingress` NetworkPolicy), or
`restart cap reached` (see [cdc-watchdog-restart-cap-reached](#cdc-watchdog-restart-cap-reached)).

**Mitigate** — A.22 proved the manual recovery primitive always works if the watchdog itself can't
reach Connect: `curl -X POST http://<connect-host>:8083/connectors/lumo-outbox/tasks/0/restart`.
WAL retention means no event is lost regardless of how long the task stays FAILED (bounded by disk —
see [WAL safety, PHASE_A22 report §8](../../PHASE_A22_CDC_RESILIENCE_AND_INTEGRATION_REPORT.md)).

**Verify** — `cdc_connector_task_failed == 0` and the connector status shows `"state":"RUNNING"`.
**Escalate** — if restarts succeed but the task fails again within minutes, the root cause is
PostgreSQL-side (connectivity, `wal_level`, replication slot dropped) — page the DB on-call, not the
Kafka Connect owner.

---

## cdc-watchdog-restart-cap-reached

**Symptom** — `CdcWatchdogRestartCapReached`: the watchdog issued its `CDC_WATCHDOG_MAX_RESTARTS`th
restart for this connector/task inside `CDC_WATCHDOG_RESTART_WINDOW_MS` and stopped trying further
(Task 4 Case D — the loop guard exists specifically so a task that fails immediately on every restart
attempt doesn't get hammered forever). This is a page, not a ticket: automatic recovery has stopped.

**Diagnose** — same first two commands as
[cdc-connector-task-failed](#cdc-connector-task-failed), plus check whether the task's failure reason
changed between attempts (a stable `UnknownHostException`/connection-refused across every restart
usually means the _database_, not Connect, is still down or unreachable — restarting the Connect task
repeatedly cannot fix that).

**Mitigate** — fix the underlying cause (Postgres reachability, credentials, dropped replication slot)
first, THEN issue one manual restart:
`curl -X POST http://<connect-host>:8083/connectors/lumo-outbox/tasks/0/restart`. The watchdog's
rolling window means it will resume trying automatically once `CDC_WATCHDOG_RESTART_WINDOW_MS` has
elapsed since the oldest counted attempt, but don't wait on that for an active incident — restart
manually.

**Verify** — `cdc_connector_task_failed == 0` and `rate(cdc_watchdog_restarts_skipped_total[5m]) == 0`.
**Escalate** — Postgres unreachable → DB on-call; Kafka Connect worker itself unhealthy (distinct from
the task) → platform on-call, per PHASE_A22's §6 note that this deployment runs a single Connect
worker with no failover.

---

## docker-desktop-wsl2-startup-crash

**Symptom** — Docker Desktop's backend crash-loops on startup (`docker info`/`docker ps` fail).
`com.docker.backend.exe.log` shows `starting services: initializing <Module> manager: listening on
unix://...: remove ...: The file cannot be accessed by the system`, naming a different module each
relaunch (Inference → Secrets Engine → Ethernet vfkit) because it stops at the first stale socket it
can't clear. Root-caused and recovered twice on this project's dev machine (Phases A.19 and A.25).

**Do not assume a missing/corrupted `docker-desktop-data` WSL distro** — a `wsl --import` recovery for
that architecture will not fix this and wastes time. Docker Desktop 4.79.0 on this machine registers
only a single `docker-desktop` distro (no separate data distro); WSL2 itself is typically healthy
throughout (verify via `wsl -l -v` and `HKCU\...\Lxss` — expect exactly `docker-desktop` + the
workspace distro, e.g. `Ubuntu-24.04`, no orphaned third entry).

**Diagnose** — the crash-loop line above names the stuck file: 0-byte AF_UNIX socket reparse points
orphaned by an earlier unclean shutdown/crash/force-kill, typically under
`%LOCALAPPDATA%\Docker\run\` (`dockerInference`, `dockerEthernetVfkit`, `userAnalyticsOtlpHttp.sock`)
or `%LOCALAPPDATA%\docker-secrets-engine\engine.sock`. Since the backend only reports the _first_
stuck file it hits and stops there, relaunching after clearing just that one can walk you into a
second crash naming the next one (confirmed on Phase A.26: Inference cleared, relaunch crashed on
Secrets Engine next). Faster: `wsl -d Ubuntu-24.04 -- ls -la /mnt/c/Users/<user>/AppData/Local/Docker/run/`
to see every stale file at once and clear them all in a single pass before relaunching.

**Mitigate** — no native Windows tool can remove these files (`Remove-Item`, `fsutil reparsepoint
delete`, elevated `takeown`, .NET `File.Delete` all fail with `ERROR_CANT_ACCESS_FILE`). Delete them
through WSL's Linux filesystem layer instead, then relaunch Docker Desktop:

```powershell
wsl -d Ubuntu-24.04 -- rm -fv /mnt/c/Users/<user>/AppData/Local/Docker/run/dockerInference `
  /mnt/c/Users/<user>/AppData/Local/Docker/run/dockerEthernetVfkit `
  /mnt/c/Users/<user>/AppData/Local/Docker/run/userAnalyticsOtlpHttp.sock `
  /mnt/c/Users/<user>/AppData/Local/docker-secrets-engine/engine.sock
```

**What did not help (documented to save time):** a reboot alone (clears one socket, but a second can
corrupt independently and survive a second clean reboot); Windows Defender exclusions (harmless, not
causal); `Stop-Process -Force` on a Docker process that hasn't fully crashed yet (appears to _cause_
further socket corruption — only force-kill once it's already crashed and idle).

**Verify no data loss** — this fix never touches the VHDX, named volumes, or WSL registration. Confirm
with `docker volume ls` (named volumes, e.g. `lumo_postgres-data`, still present) and
`docker exec lumo-postgres-1 psql -U lumo -d lumo -c "SELECT 1"` +
`prisma migrate status` → `Database schema is up to date!`. PostgreSQL's WAL-based crash recovery
replays cleanly on next start with no manual intervention needed.

**Escalate** — if `wsl -l -v` shows a genuinely corrupted or missing distro (not just stuck sockets),
that is a different and more serious failure than this runbook covers — do not assume the same fix
applies.
