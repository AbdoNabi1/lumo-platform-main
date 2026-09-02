# 01 — Analytics Hub specification

> **Status: CONTRACT (Phase 1 — Analytics) — 2026-06-28.** Operator-facing analytics platform over
> the first-party data plane. Built on [arch 10 — analytics and feed engine](../architecture/10-analytics-and-feed-engine.md),
> the tracking spec ([arch 16](../architecture/16-tracking-specification.md)), attribution
> ([arch 17](../architecture/17-attribution-specification.md)), and the marketing data model
> ([arch 19](../architecture/19-marketing-data-model.md)). No application code.
>
> **Design system note:** maps to the existing **Dashboard**, **Analytics**, **Funnels**, and
> **UTM reports** screens ([`../ui/`](../ui/README.md)) — functionality only, no redesign. A
> self-serve **custom report builder** is a net-new surface and **requires approval**.

## 1. Cross-cutting compliance baseline

| Concern                | Requirement                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Tracking               | All metrics derive from first-party events ([arch 16](../architecture/16-tracking-specification.md)); schema-registry-governed |
| Analytics              | ClickHouse is the system of record — never a vendor ([arch 10](../architecture/10-analytics-and-feed-engine.md))               |
| Audit logs             | Report/segment/export create + schedule → `audit.entry.recorded` (WORM)                                                        |
| Permissions            | Row/field-level scoping by role; financial metrics gated ([arch 07](../architecture/07-auth-and-authorization.md))             |
| Feature flags          | Report modules + reverse-ETL toggles                                                                                           |
| Dark mode / Responsive | Operator surface uses frozen tokens + responsive rules                                                                         |
| Localization           | Currency/locale/timezone-aware; labels i18n-keyed                                                                              |
| Accessibility          | WCAG 2.2 AA; charts have accessible data tables                                                                                |
| Version history        | Report + segment definitions versioned with rollback                                                                           |

## 2. Capabilities

| Capability                  | Description                                                                                                           | Screen                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Overview dashboards         | KPI tiles + trends ([arch 19 §6](../architecture/19-marketing-data-model.md) metrics)                                 | Dashboard / Analytics       |
| Metric catalog              | Governed definitions: AOV, LTV, CAC, ROAS, conversion rate, retention, etc.                                           | Analytics                   |
| Funnels                     | Step funnels + drop-off; integrates session replay ([growth 09](../growth/09-SESSION_REPLAY_AND_FUNNEL_SPEC.md))      | Funnels                     |
| Cohorts & retention         | Acquisition cohorts, retention curves                                                                                 | Analytics                   |
| Attribution reports         | Model comparison, assisted vs. last-click, path length ([arch 17](../architecture/17-attribution-specification.md))   | Analytics / UTM reports     |
| UTM / campaign / channel    | Source/medium/campaign/creative performance + ROAS                                                                    | UTM reports                 |
| Product performance         | Views→ATC→purchase, AOV, margin, attach rate; age-band/learning-outcome cuts                                          | Analytics                   |
| Search analytics            | Queries, zero-results, search→conversion ([growth 07](../growth/07-COMMERCE_MODULES_SPEC.md))                         | Analytics                   |
| Inventory analytics         | Sell-through, stockouts, days-of-cover                                                                                | Inventory / Analytics       |
| Real-time view              | Live orders/sessions/revenue                                                                                          | Dashboard                   |
| Custom report builder       | Self-serve metric+dimension queries over ClickHouse (no SQL)                                                          | **new — requires approval** |
| Segments                    | Shared with marketing ([arch 19](../architecture/19-marketing-data-model.md)); feed reverse-ETL audiences             | (Marketing)                 |
| Scheduled reports / exports | Email/file exports; Looker Studio connector via Integrations Hub ([growth 03](../growth/03-INTEGRATIONS_HUB_SPEC.md)) | Analytics                   |
| Alerts / anomaly detection  | Thresholds + anomalies on any metric → notifications                                                                  | Analytics                   |

## 3. Data model and governance

- **Source of truth:** ClickHouse, fed from the event backbone; definitions in the schema registry ([arch 16](../architecture/16-tracking-specification.md)); materialized views precompute funnels/cohorts/attribution ([arch 10](../architecture/10-analytics-and-feed-engine.md)).
- **Consistency:** financial reporting uses last-touch as the reconciliation ledger; paid-media optimizes on time-decay/data-driven ([arch 17](../architecture/17-attribution-specification.md)). Revenue is net of refunds.
- **Retention:** raw events ~25 months, aggregates indefinite; consent + erasure honored downstream.
- **Child-safety:** no child data is ever an input to any report, segment, or export ([arch 14](../architecture/14-security.md)).

## 4. Reverse-ETL / activation

Computed segments/audiences sync to ad platforms + ESP via reverse-ETL ([arch 10](../architecture/10-analytics-and-feed-engine.md) / [growth 03](../growth/03-INTEGRATIONS_HUB_SPEC.md)), consent-gated, never including minors.

## 5. Frozen-UI surface mapping

Dashboard, Analytics, Funnels, UTM reports (existing screens). The custom report builder is
net-new and **requires approval** ([`../ui/`](../ui/README.md)).

## Requires ADR to change

- ClickHouse as the analytics system of record, the metric-catalog definitions, or the schema-registry-governed ingestion.
- The retention model, the financial-reconciliation rule, or excluding-child-data rule.
- Introducing the custom-report-builder surface (also requires UI approval).
