# 01 — Admin Dashboard specification (functional)

> **Status: CONTRACT (Phase 1 — Admin) — 2026-06-28.** **Functional** specification for the admin
> dashboard application. The UI follows the **Morbeh Design System**: [`../ui/`](../ui/README.md) is the single visual
> source of truth (layout, colors, spacing, navigation, screens) and is **not superseded** by this
> document. This document governs **functionality only** — data sources, actions, permissions, and
> which platform capabilities power each existing screen. No application code. No UI redesign.

## 1. Purpose

The admin dashboard is the operator application. It is composed of the **25 screens** defined
in [`../ui/MORBEH_DESIGN_SYSTEM.md`](../ui/MORBEH_DESIGN_SYSTEM.md) and implemented in `apps/admin-web`.
This spec wires functionality behind those screens by pointing each to the owning context and the
relevant growth/analytics/architecture spec — without changing anything visual.

## 2. Cross-cutting compliance baseline (every screen)

| Concern         | Requirement                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tracking        | Operator actions emit admin events ([arch 16 §10.10](../architecture/16-tracking-specification.md))                                                      |
| Analytics       | Operator usage measurable in ClickHouse                                                                                                                  |
| Audit logs      | Every mutation → `audit.entry.recorded` (WORM) with actor + before/after ([arch 14](../architecture/14-security.md))                                     |
| Permissions     | RBAC+ReBAC per screen/action/field; step-up for sensitive actions ([arch 07](../architecture/07-auth-and-authorization.md))                              |
| Feature flags   | Screens/features gated + kill-switchable ([growth 06](../growth/06-FEATURE_MANAGEMENT_SPEC.md))                                                          |
| Dark mode       | Per the Morbeh Design System (toggle + tokens, [`../ui/MORBEH_DESIGN_SYSTEM.md`](../ui/MORBEH_DESIGN_SYSTEM.md)) — already implemented; not changed here |
| Responsive      | Per [`../ui/MORBEH_DESIGN_SYSTEM.md`](../ui/MORBEH_DESIGN_SYSTEM.md) §11 (1440/1280/1024/768/390)                                                        |
| Localization    | All copy i18n-keyed; locale/currency/timezone-aware                                                                                                      |
| Accessibility   | WCAG 2.2 AA (Morbeh Design System baseline)                                                                                                              |
| Version history | Config-bearing screens (flags, experiments, layouts, feeds, payload profiles) versioned with rollback                                                    |

## 3. Screen → functionality mapping

Each row: the screen, the owning context/data source, the powering spec, key actions, and the
primary permission role. Visuals are governed by [`../ui/MORBEH_DESIGN_SYSTEM.md`](../ui/MORBEH_DESIGN_SYSTEM.md).

| Screen        | Data source / context   | Powering spec                                                                                                                                                                                                           | Key actions                        | Primary role        |
| ------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------- |
| Dashboard     | Analytics read model    | [analytics/01](../analytics/01-ANALYTICS_HUB_SPEC.md), [arch 19](../architecture/19-marketing-data-model.md)                                                                                                            | view KPIs, drag KPI order (frozen) | all (scoped)        |
| Orders        | Orders                  | [arch 03](../architecture/03-domain-and-database-boundaries.md), Returns/Exchanges [growth 07](../growth/07-COMMERCE_MODULES_SPEC.md)                                                                                   | view, fulfill, refund, return      | cs_agent / finance  |
| Products      | Catalog                 | [arch 03](../architecture/03-domain-and-database-boundaries.md), [growth 02](../growth/02-PRODUCT_LAYOUT_BUILDER_SPEC.md)                                                                                               | create/edit/publish, layout        | merchandiser        |
| Inventory     | Inventory               | [arch 03], Multi-warehouse/Transfers [growth 07](../growth/07-COMMERCE_MODULES_SPEC.md)                                                                                                                                 | adjust, transfer                   | merchandiser        |
| Customers     | Identity                | [arch 03], wishlist insights [growth 07](../growth/07-COMMERCE_MODULES_SPEC.md)                                                                                                                                         | view, segment                      | cs_agent / marketer |
| Analytics     | Analytics               | [analytics/01](../analytics/01-ANALYTICS_HUB_SPEC.md)                                                                                                                                                                   | explore reports                    | analyst             |
| Funnels       | Analytics               | [analytics/01](../analytics/01-ANALYTICS_HUB_SPEC.md), [growth 09](../growth/09-SESSION_REPLAY_AND_FUNNEL_SPEC.md)                                                                                                      | build funnels, view drop-off       | analyst             |
| UTM reports   | Attribution             | [arch 17](../architecture/17-attribution-specification.md)                                                                                                                                                              | view attribution                   | analyst / marketer  |
| Marketing     | Marketing               | [arch 08](../architecture/08-marketing-core.md)                                                                                                                                                                         | campaigns, segments                | marketer            |
| Email         | Marketing/Notifications | [growth 07](../growth/07-COMMERCE_MODULES_SPEC.md), [growth 03](../growth/03-INTEGRATIONS_HUB_SPEC.md)                                                                                                                  | campaigns, automations             | marketer            |
| WhatsApp      | Marketing/Notifications | [growth 07](../growth/07-COMMERCE_MODULES_SPEC.md), [growth 03](../growth/03-INTEGRATIONS_HUB_SPEC.md)                                                                                                                  | broadcasts, automations            | marketer            |
| Automations   | Marketing (Temporal)    | [arch 08](../architecture/08-marketing-core.md)                                                                                                                                                                         | build lifecycle flows              | marketer            |
| Discounts     | Pricing                 | [arch 03](../architecture/03-domain-and-database-boundaries.md)                                                                                                                                                         | create discount rules              | marketer            |
| Coupons       | Pricing                 | [arch 03](../architecture/03-domain-and-database-boundaries.md)                                                                                                                                                         | create codes                       | marketer            |
| Upsells       | CRO engine              | [growth 01](../growth/01-CRO_ENGINE_SPEC.md)                                                                                                                                                                            | configure upsells                  | marketer            |
| Cross-sells   | CRO engine              | [growth 01](../growth/01-CRO_ENGINE_SPEC.md)                                                                                                                                                                            | configure cross-sells              | marketer            |
| Reviews       | Reviews/Q&A             | [growth 07](../growth/07-COMMERCE_MODULES_SPEC.md)                                                                                                                                                                      | moderate                           | merchandiser        |
| Landing pages | CMS                     | [arch 03], [growth 02](../growth/02-PRODUCT_LAYOUT_BUILDER_SPEC.md)                                                                                                                                                     | build, publish                     | merchandiser        |
| Page builder  | CMS / layout builder    | [growth 02](../growth/02-PRODUCT_LAYOUT_BUILDER_SPEC.md)                                                                                                                                                                | compose pages                      | merchandiser        |
| A/B testing   | Experimentation         | [growth 01](../growth/01-CRO_ENGINE_SPEC.md), [arch 21](../architecture/21-experimentation-and-cro.md)                                                                                                                  | launch/monitor experiments         | analyst / PM        |
| Feature flags | Experimentation         | [growth 06](../growth/06-FEATURE_MANAGEMENT_SPEC.md), [arch 12](../architecture/12-feature-flags-and-configuration.md)                                                                                                  | toggle, target, rollout            | developer / PM      |
| Users         | Identity                | [arch 07](../architecture/07-auth-and-authorization.md)                                                                                                                                                                 | invite, assign role                | admin               |
| Permissions   | Authz                   | [arch 07](../architecture/07-auth-and-authorization.md)                                                                                                                                                                 | manage roles                       | owner / admin       |
| Activity logs | Audit                   | [arch 14](../architecture/14-security.md), [arch 20](../architecture/20-events-catalog.md)                                                                                                                              | view audit trail                   | admin               |
| Settings      | Config + integrations   | [arch 12](../architecture/12-feature-flags-and-configuration.md), [growth 03](../growth/03-INTEGRATIONS_HUB_SPEC.md)/[04](../growth/04-EVENT_HEALTH_CENTER_SPEC.md)/[05](../growth/05-PURCHASE_PAYLOAD_MANAGER_SPEC.md) | configure store/integrations       | admin               |

## 4. Global behaviors (functional, not visual)

- **Auth/session:** SSO + MFA for operators; step-up for sensitive actions ([arch 07](../architecture/07-auth-and-authorization.md)).
- **Bulk actions** run as async jobs with progress/polling ([arch 05](../architecture/05-events-queues-workers-and-jobs.md)) — no UI change to the existing controls.
- **Global search / command** (the top-bar search) is wired to a cross-entity search service; wiring it functional is **not** a UI change.
- **Notifications** (the notifications bell) surface system/operational alerts.
- **Wiring roadmap:** this spec is the contract for connecting the admin's controls (search, filters, tabs, primary buttons) to the backend. Their appearance is governed by [`../ui/MORBEH_DESIGN_SYSTEM.md`](../ui/MORBEH_DESIGN_SYSTEM.md).

## 5. Freeze compliance (non-negotiable)

- No new screens, nav items, layouts, colors, spacing, or wording. The visual contract in [`../ui/`](../ui/README.md) is authoritative.
- New capability is wired **behind existing controls**. Any control/screen that does not already exist (e.g. Integrations Hub, Event Health Center, custom report builder, session-replay viewer, AI assistant panel) **requires approval** before any UI is added.

## Requires ADR to change

- The screen→capability/permission mapping, or the "functionality-only" boundary.
- The global behaviors (async bulk actions, search wiring, audit-on-mutation).
- Anything that would add a screen/control (also requires UI approval per [`../ui/`](../ui/README.md)).
