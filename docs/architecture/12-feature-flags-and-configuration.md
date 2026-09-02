# 12 — Feature flags and configuration management

> **Status: CONTRACT — 2026-06-28.** Defines runtime feature flags and how configuration is
> managed across environments. Surfaces in the frozen admin under Feature flags.

## 1. Feature flags

Flags decouple deploy from release and power both gradual rollout and the experimentation system
(shared primitive, doc on experimentation).

| Aspect | Decision |
|---|---|
| Flag types | boolean, multivariate, percentage rollout |
| Targeting | rules over context (environment, lifecycle stage, geo, role, household), priority-ordered |
| Rollout | deterministic hashing of subject id → stable bucketing (no flash, no per-request DB read) |
| Evaluation | SDK (`packages/feature-flags`) on client + server; flags fetched/streamed and cached (L1) |
| Source of truth | Experimentation context (`feature_flags`, `feature_flag_rules`) |
| Change model | **config, not deploy** — editable in admin; effective immediately |
| Audit | every flag change recorded in the audit log with actor + before/after |
| Kill switch | every risky feature ships behind a flag that can be disabled instantly |

Flags are evaluated identically across services so a feature gates consistently everywhere. Removing
a stale flag is a code cleanup tracked as tech debt, not left forever.

## 2. Configuration management

### 2.1 Layers and precedence

Configuration resolves in this order (later overrides earlier):

1. Built-in defaults (in `packages/config`, schema-validated)
2. Environment config (per dev/staging/prod, in Git, non-secret)
3. Runtime/remote config (operationally tunable values, e.g. rate limits, retention windows)
4. Secrets (from Vault, never in Git or env files committed)

### 2.2 Rules

- All config is **schema-validated at boot** (the service refuses to start on invalid/missing required config — fail fast, no silent defaults for required values).
- **No hardcoded secrets, ever.** Secrets come from Vault via short-lived leases; rotation is automated; leak detection is on (doc 14).
- Config is **typed** and accessed through `packages/config` — no scattered `process.env` reads.
- Environment parity: the same config schema across all environments; only values differ.
- **Naming:** `SCREAMING_SNAKE_CASE`, service-prefixed (e.g. `ORDERS_DB_HOST`, `TRACKING_KAFKA_BROKERS`).
- **Behavioral config that changes often** (promotions, checkout flows, feeds, automations, experiments) is **data/config in the relevant context**, not deploy-time config — so business users change it without engineering.

### 2.3 Distinction: flags vs config vs experiments

| Concern | Tool | Audience |
|---|---|---|
| Release gating / kill switch | Feature flags | Engineering/PM |
| Operational tunables + secrets | Configuration layers | Ops/SRE |
| Measured behavior changes | Experiments (flags + stats) | Growth/PM |
| Business rules (promos, feeds, flows) | Context config/data | Business users |

## Requires ADR to change

- The flag types, deterministic-bucketing rule, or "flags are config not deploy".
- The config precedence order, fail-fast-on-invalid-config rule, or secrets-from-Vault-only rule.
