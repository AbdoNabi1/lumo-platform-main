# 06 — Feature Management specification

> **Status: CONTRACT (Phase 1 — Growth) — 2026-06-28.** Product specification for the feature
> management system. The underlying architecture is
> [arch 12 — feature flags and configuration](../architecture/12-feature-flags-and-configuration.md);
> the shared assignment engine is [arch 21](../architecture/21-experimentation-and-cro.md);
> measurement is [arch 16](../architecture/16-tracking-specification.md). No application code.
>
> **Design system note:** operator controls map to the existing **Feature flags** admin screen
> ([`../ui/`](../ui/README.md)); this spec extends _what that screen manages_, not its design. Any new
> control/screen requires approval.

## 1. Cross-cutting compliance baseline

| Concern         | Requirement                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Tracking        | Flag evaluations/exposures emit events ([arch 16](../architecture/16-tracking-specification.md)); features tie to outcome metrics |
| Analytics       | Adoption + impact queryable in ClickHouse ([arch 10](../architecture/10-analytics-and-feed-engine.md))                            |
| Audit logs      | Every flag change → `audit.entry.recorded` ([arch 20](../architecture/20-events-catalog.md), WORM) with actor + before/after      |
| Permissions     | Toggle / target / publish separated ([arch 07](../architecture/07-auth-and-authorization.md))                                     |
| Feature flags   | This _is_ the flag system; every platform feature is itself flaggable                                                             |
| Dark mode       | Operator surface uses frozen tokens ([`../ui/MORBEH_DESIGN_SYSTEM.md`](../ui/MORBEH_DESIGN_SYSTEM.md))                            |
| Responsive      | Operator surface per [`../ui/MORBEH_DESIGN_SYSTEM.md`](../ui/MORBEH_DESIGN_SYSTEM.md) §11                                         |
| Localization    | Flag names/descriptions i18n-keyed; schedules timezone-aware                                                                      |
| Accessibility   | WCAG 2.2 AA                                                                                                                       |
| Version history | Every flag/rule change versioned with rollback                                                                                    |

## 2. Feature model

A feature has a **master state** and a **release stage**; the two are independent.

| Master state | Meaning                            |
| ------------ | ---------------------------------- |
| Enabled      | Eligible to evaluate per its rules |
| Disabled     | Off for everyone (kill state)      |

| Release stage | Audience                              |
| ------------- | ------------------------------------- |
| Internal      | Staff/service accounts only           |
| Beta          | Opt-in users or a defined % of public |
| Public        | Generally available (GA)              |

A feature progresses internal → beta → public; the master Enable/Disable kill switch applies at any stage.

## 3. Targeting rules

Priority-ordered rules (first match wins; explicit allow/deny beats rollout), evaluated by the deterministic edge SDK (no flash, cached L1) — same engine as experiments ([arch 21 §2](../architecture/21-experimentation-and-cro.md)).

| Rule               | Behavior                                                                             |
| ------------------ | ------------------------------------------------------------------------------------ |
| Percentage rollout | Deterministic bucketing on subject id → stable per user                              |
| Country rules      | Allow/deny by geo                                                                    |
| Device rules       | By device type / OS / browser                                                        |
| Audience rules     | By segment / lifecycle stage ([arch 19](../architecture/19-marketing-data-model.md)) |
| Campaign rules     | By campaign id                                                                       |
| UTM rules          | By `utm_*` match                                                                     |
| Schedule           | Active window (start/end, timezone-aware)                                            |

Rollout types: boolean, multivariate, percentage.

## 4. Dependencies

- A feature may declare **prerequisites** (requires feature B enabled) and **conflicts** (mutually exclusive with C).
- Evaluation resolves the dependency graph; a feature cannot be enabled if a prerequisite is off, and the UI surfaces the blocker.
- Cycles are rejected at save time.

## 5. Feature health

Tracked per feature (ties [arch 13 — observability](../architecture/13-observability.md) + tracking):

| Signal            | Source                                             |
| ----------------- | -------------------------------------------------- |
| Adoption          | exposure events / eligible population              |
| Error rate delta  | Sentry/logs vs. baseline                           |
| Latency delta     | RED metrics vs. baseline                           |
| Guardrail metrics | conversion / revenue / bounce (from tracking)      |
| Health score      | weighted composite (errors + latency + guardrails) |

Guardrail breach raises an alert and can **auto-kill** (revert to control/disabled).

## 6. Audit, rollback, kill switch

- **Audit log:** every create/edit/enable/disable/target change is recorded (WORM) with actor, timestamp, before/after, and policy version.
- **Rollback:** restore any prior versioned configuration instantly; rollbacks are themselves versioned + audited.
- **Kill switch:** master Disable takes effect immediately (no deploy), reverting all subjects to default.

## 7. Governance

Every feature has an owner, a description, a created date, and an **expiry/review date**; stale flags are flagged for cleanup (graduated features should have their flag removed). Launch/stop is config — never a deploy.

## 8. Frozen-UI surface mapping

Managed through the existing **Feature flags** screen. Net-new controls (e.g. a dependency graph view) require approval per [`../ui/`](../ui/README.md).

## Requires ADR to change

- The feature model (master state + release stage), the rule set/precedence, or the deterministic-bucketing rule.
- The dependency-resolution model, the health-score composition, or the auto-kill-on-guardrail behavior.
- Any change introducing a new admin surface (also requires UI approval).
