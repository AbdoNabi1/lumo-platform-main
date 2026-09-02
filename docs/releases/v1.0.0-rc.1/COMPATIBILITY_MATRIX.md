# Compatibility Matrix — v1.0.0-rc.1

> Supported runtimes, datastores, and platform dependencies for this release. Versions reflect what
> the platform is built and tested against (compose stack + CI). "Supported" = validated;
> "Compatible" = expected to work within the stated bound.

## Runtime & toolchain

| Component      | Version                          | Status    | Notes                                                      |
| -------------- | -------------------------------- | --------- | ---------------------------------------------------------- |
| Node.js        | ≥ 22 (built on 22-bookworm-slim) | Supported | executes TS via `tsx`, no compile step                     |
| pnpm           | 11.9.0 (corepack-pinned)         | Supported | frozen-lockfile installs                                   |
| Container base | `node:22-bookworm-slim`          | Supported | multi-stage, non-root                                      |
| Kubernetes     | 1.27 – 1.31                      | Supported | uses `autoscaling/v2`, `policy/v1`, `networking.k8s.io/v1` |
| Helm           | n/a                              | —         | kustomize base is the source of truth                      |

## Datastores & infrastructure

| Dependency                | Version         | Status    | Notes                                             |
| ------------------------- | --------------- | --------- | ------------------------------------------------- |
| PostgreSQL                | 16              | Supported | `wal_level=logical` for outbox CDC; 15 Compatible |
| Redis                     | 7.x             | Supported | cache, locks                                      |
| Redpanda                  | Kafka API (v24) | Supported | Apache Kafka 3.x brokers Compatible               |
| Debezium                  | 2.x             | Supported | outbox → CDC connector                            |
| ClickHouse                | 24.x            | Supported | analytics read models                             |
| MinIO / S3                | S3 API          | Supported | object storage                                    |
| Ory Hydra / Kratos / Keto | current LTS     | Supported | OIDC / identity / ReBAC                           |

## Observability (H-5)

| Component               | Version       | Status    |
| ----------------------- | ------------- | --------- |
| Prometheus              | 2.55.x        | Supported |
| Alertmanager            | 0.27.x        | Supported |
| Grafana                 | 11.3.x        | Supported |
| Loki / Tempo            | 3.2.x / 2.6.x | Supported |
| OpenTelemetry Collector | current       | Supported |

## Supply chain / release tooling

| Tool       | Purpose                              | Status    |
| ---------- | ------------------------------------ | --------- |
| cosign     | keyless image signing + verification | Supported |
| Syft       | SPDX SBOM                            | Supported |
| Trivy      | image/dependency CVE scan            | Supported |
| gitleaks   | secret scanning                      | Supported |
| Changesets | versioning / changelog               | Supported |

## Version-to-version guarantee

From 1.0.0 GA: **N ↔ N-1** app versions are wire- and schema-compatible during a rollout, guaranteed
by the expand/migrate/contract discipline. Skipping a MAJOR is not supported — upgrade sequentially.
