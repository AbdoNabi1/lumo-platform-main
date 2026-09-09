# Morbeh Platform — v1.0.0-rc.1 (Release Candidate)

> First production-grade release candidate. Marks the platform as **operationally ready**: the full
> commerce + experience + SaaS + security surface (P2.0) plus five hardening passes (H-1…H-5). This
> RC changes **no application behavior** vs. the hardened `main`; it packages, hardens, and documents
> the platform for production operation.

## Highlights

- **39 bounded-context modules** across commerce, experience, SaaS foundation, and enterprise
  security — composed by one runtime image (`api`/`worker`/`scheduler`).
- **Enterprise zero-trust security** (P2.0 + H-1…H-4): identity, RBAC/ABAC/ReBAC/PBAC, MFA, device &
  risk, envelope encryption with live KMS/HSM/Vault, WORM audit, OTel observability, edge guard.
- **Production release engineering (H-5)**:
  - CI/CD: matrix gate, caching, SBOM + provenance + **cosign image signing**, deploy-time signature
    verification, semver releases, changelog assembly.
  - Containers: multi-stage, non-root, read-only rootfs, image `HEALTHCHECK`, minimal attack surface.
  - Kubernetes: HPA, PDB, NetworkPolicy, resource limits, probes, zero-downtime rollout,
    edge security headers (TLS1.2/1.3, HSTS, CSP).
  - Monitoring: Prometheus recording + alerting rules, Alertmanager routing, provisioned Grafana
    dashboards, defined **SLOs/SLIs + error-budget burn alerts**.
  - Reliability: backup/restore/DR + key-rotation procedures, runbooks, incident response,
    load/stress/soak + benchmark suite, chaos experiments.
  - Documentation: deployment, operations, upgrade, production checklist, C4/deployment/sequence/
    infrastructure diagrams.

## Quality gates (this RC)

typecheck · lint · dependency-cruiser (arch) · test · governance fitness · duplication · dependency
audit · secret scan · image scan (Trivy) · SBOM — all green. See the H-5 Engineering Report in
`docs/implementation/P2_0_ENTERPRISE_SECURITY_REPORT.md`.

## What's included

| Area                                   | Location                                                              |
| -------------------------------------- | --------------------------------------------------------------------- |
| Runtime image                          | `infrastructure/docker/runtime.Dockerfile`                            |
| Kubernetes manifests                   | `infrastructure/k8s/`                                                 |
| Monitoring (rules/dashboards/alerting) | `infrastructure/docker/prometheus`, `.../grafana`, `.../alertmanager` |
| Operations docs                        | `docs/operations/`                                                    |
| Architecture diagrams                  | `docs/architecture/diagrams/`                                         |
| Performance suite                      | `perf/`                                                               |
| Chaos experiments                      | `chaos/`                                                              |
| Ops scripts                            | `scripts/ops/`                                                        |

## Known limitations

- Latency SLIs are **averages**; p95/p99 await OTel histogram buckets (tracked).
- Alertmanager receivers are placeholders — wire real on-call (PagerDuty/Slack) before go-live.
- Edge WAF / L7 rate-limiting is recommended but out of this repo's scope.

## Upgrade / compatibility

See [BREAKING_CHANGES](BREAKING_CHANGES.md), [MIGRATION_NOTES](MIGRATION_NOTES.md), and
[COMPATIBILITY_MATRIX](COMPATIBILITY_MATRIX.md).

## Verify this release

```bash
cosign verify ghcr.io/<org>/morbeh-platform/runtime@sha256:<digest> \
  --certificate-identity-regexp "https://github.com/<org>/morbeh-platform/.github/workflows/.+" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
