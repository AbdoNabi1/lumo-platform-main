# 15 — Scalability and deployment strategy

> **Status: CONTRACT — 2026-06-28.** Defines how the system scales and how it is built, released,
> and operated.

## 1. Scalability

### 1.1 Levers

| Lever | Applied to | Why |
|---|---|---|
| Horizontal stateless scaling | all services (K8s HPA/KEDA on CPU, p95 latency, queue lag) | elastic to load |
| Read replicas | catalog, identity, CMS | read-dominant; never read from the write primary on hot paths |
| Connection pooling | PgBouncer (transaction mode) | bound connections under autoscaling |
| Partitioning | orders, events, touchpoints, audit (by month); assignments (by hash) | retention rollover + pruning + write spread |
| Caching tiers | L1 in-proc, L2 Redis, L3 CDN | doc 06 |
| Read models | OpenSearch (search), ClickHouse (analytics) | take heavy reads off OLTP entirely |
| Async by default | email, exports, indexing, webhooks, analytics | smooth spikes |
| Edge compute | static catalog (ISR), A/B assignment, tracking beacon | offload origin |

Sharding the OLTP is a **last resort** — a single well-tuned PostgreSQL handles our domain's TPS;
contexts can be moved to their own physical DB first (the no-cross-FK rule makes this clean).

### 1.2 Performance budgets (enforced in CI)

Lighthouse-CI + k6: LCP ≤ 2.5s p75, INP ≤ 200ms p75, API p99 ≤ 500ms, search p99 ≤ 200ms,
checkout submit p99 ≤ 1s, pricing p99 ≤ 100ms. (Mirrors the SLOs in doc 13.)

### 1.3 Peak planning

Black Friday ≈ 50× baseline: provision peak + 30% headroom; quarterly load tests at 2× peak;
chaos game-days. Autoscaling pre-warmed ahead of known peaks.

### 1.4 Multi-region

- **Reads:** active-active for catalog/identity/search from regional replicas.
- **Writes:** active-passive with automated failover for the transactional core.
- Targets: RPO ≤ 1 min (orders/payments), RTO ≤ 5 min (storefront/checkout).

## 2. Deployment strategy

### 2.1 Platform and GitOps

- **Kubernetes (EKS)**, provisioned by **Terraform**; app delivery by **ArgoCD** (GitOps) — the cluster state is what's in Git; **no manual prod changes**.
- Secrets via **Vault**; DNS/TLS via External-DNS/Cert-Manager.

### 2.2 Pipeline

1. PR → CI: lint, types, unit/integration (testcontainers), contract (Pact), architecture fitness functions, security scans, performance budgets.
2. Merge to `main` (trunk-based, squash) → build signed image → deploy to staging automatically.
3. Promotion to prod via GitOps PR with required approval.

### 2.3 Environments

`dev` → `staging` (prod-like) → `prod`, identical config schema (doc 12), different values. Preview
environments per PR for the storefront.

### 2.4 Release techniques

- **Progressive delivery:** canary / blue-green for services; **feature flags** gate user-visible release independent of deploy (doc 12).
- **Zero-downtime:** rolling updates, readiness/liveness probes, pod disruption budgets, graceful connection draining.
- **Database migrations:** forward-only, backward-compatible (expand → migrate → contract); never a destructive DROP in the shipping migration; reversible via dual-write + backfill.
- **Rollback:** image rollback via GitOps + instant flag kill switch for the feature.

### 2.5 Backup / DR

- PostgreSQL PITR (WAL retention) + daily base backups + cross-region replica; ClickHouse replicated + object-storage backup.
- **Quarterly restore drills** — an untested backup is not a backup.

## Requires ADR to change

- The Kubernetes/Terraform/ArgoCD/GitOps platform or "no manual prod changes" rule.
- The performance budgets, multi-region read/write model, RPO/RTO targets, or the expand→contract migration rule.
