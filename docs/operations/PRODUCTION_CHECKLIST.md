# Production Readiness Checklist

> Run before promoting a release to production. Each item is either automated (gate/workflow) or a
> human sign-off. `[x]` = satisfied by the current platform state at H-5.

## Build & supply chain

- [x] Full gate green: typecheck · lint · arch (dependency-cruiser) · test (`validate.yml`) — re-verified live,
      Phase A.26: typecheck 78/78, lint 78/78 (0 warnings), arch 0 violations (1566 modules, 6791 dependencies),
      test 78/78 tasks, 0 cached (forced re-run) — 2,385 tests passed, 31 skipped (gated on optional
      infra/env, not failures), 0 failed. `governance`/`dup` are **not** separate gates: `scripts/governance/**`,
      `.jscpd.json`, and the `jscpd` devDependency don't exist on `main` (removed during history
      reconstruction; `validate.yml`'s own comment documents this) — this line previously claimed two gates
      that don't exist in this repository.
- [x] Dependency audit (prod graph, High/Critical fail) — `security.yml`
- [x] Secret scan (gitleaks, full history) — `security.yml`
- [x] Container image scan (Trivy, HIGH/CRITICAL) — `security.yml`
- [x] SBOM generated (SPDX) + build provenance attestation
- [x] Image **signed** (cosign keyless) and verifiable — `release.yml`
- [ ] Image digest **pinned** in the deploy (no mutable tags) — per release

## Runtime image

- [x] Multi-stage, minimal base (`node:22-bookworm-slim`), non-root (`USER node`)
- [x] `tini` PID 1 (zombie reaping + SIGTERM forwarding → graceful shutdown)
- [x] Read-only root filesystem in prod (k8s only — verified `readOnlyRootFilesystem: true` in
      `infrastructure/k8s/20-deployment-api.yaml:115` and sibling Deployments). **Not** true for
      docker-compose: `infrastructure/docker/docker-compose.runtime.yml`'s `api`/`worker`/`scheduler`
      services (the actual runtime app) set no `read_only`; only two unrelated infra-tool services in
      `docker-compose.yml` (`redpanda-console`, `otel-collector`) do. Previous wording claimed
      "(k8s + compose)" without compose-side evidence.
- [x] Container `HEALTHCHECK` (compose) + k8s startup/liveness/readiness probes
- [x] Dropped capabilities (`ALL`), `no-new-privileges`, `RuntimeDefault` seccomp

## Kubernetes

- [x] Deployment, Service, ConfigMap, Secret (template), Ingress
- [x] HPA (api 2–10, worker 2–6), PodDisruptionBudget, NetworkPolicy
- [x] Resource requests + limits set; zero-downtime rollout (`maxUnavailable: 0`)
- [x] `automountServiceAccountToken: false`; ops endpoints kept cluster-internal
- [ ] TLS cert provisioned for the Ingress host (cert-manager / external)

## Observability

- [x] Metrics scraped (`morbeh-runtime` job) — process, HTTP, messaging, dependency
- [x] Grafana dashboards provisioned (Overview / Messaging / Security)
- [x] Prometheus recording + alerting rules loaded; Alertmanager routing configured
- [x] SLOs, SLIs, error-budget burn alerts defined ([SLO_SLI](SLO_SLI.md))
- [ ] Alertmanager receivers wired to the real on-call (PagerDuty/Slack) via env

## Reliability

- [x] Runbooks for every alert ([RUNBOOKS](RUNBOOKS.md))
- [x] Incident-response process ([INCIDENT_RESPONSE](INCIDENT_RESPONSE.md))
- [x] Backup + restore + DR + key-rotation procedures ([BACKUP_AND_RECOVERY](BACKUP_AND_RECOVERY.md))
- [x] Load / stress / soak / benchmark suites ([../../perf/README.md](../../perf/README.md))
- [x] Chaos experiments ([../../chaos/README.md](../../chaos/README.md))
- [ ] Rollback drill + restore drill executed this cycle (release precondition)

## Security hardening

- [x] Security-headers / CSP / HSTS at the Ingress ([SECURITY_HARDENING](SECURITY_HARDENING.md))
- [ ] Secrets from a manager/Vault (H-3 envelope encryption + rotation); none committed — **FALSE as of
      Phase A.25**: a real pgAdmin credential is hardcoded in `infrastructure/docker/docker-compose.yml`
      at the current committed `HEAD`, which is identical to `origin/main` — i.e. live on the public repo
      right now, not merely in old history. A working-tree fix (env-var substitution) exists but is
      uncommitted. Required: rotate the credential (user action; not performed by this audit), then commit
      and push the fix. A separate history-rewrite to scrub the old commit needs its own explicit approval.
- [x] Supply chain: SBOM + provenance + signature; license inventory
- [ ] Penetration test / security review sign-off for the release

## Sign-off

- [ ] Release owner · [ ] SRE on-call · [ ] Security · [ ] Product
