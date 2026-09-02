# 01 — CRO Engine specification

> **Status: CONTRACT (Phase 1 — Growth) — 2026-06-28.** Product specification for the conversion-rate
> optimization engine. This is the **product/feature** contract; the underlying **architecture** is
> [arch 21 — experimentation and CRO](../architecture/21-experimentation-and-cro.md). Measurement is
> defined by [arch 16 — tracking specification](../architecture/16-tracking-specification.md); flags
> by [arch 12](../architecture/12-feature-flags-and-configuration.md); attribution by
> [arch 17](../architecture/17-attribution-specification.md). No application code.
>
> **Design system note:** the current UI is the source of truth ([`../ui/`](../ui/README.md)). Operator
> controls map to the existing admin screens **A/B testing**, **Feature flags**, **Upsells**,
> **Cross-sells**, **Analytics**, **UTM reports**. Storefront modules render via the page-builder
> block registry (storefront output). Any **new admin screen/control requires approval** — this spec
> describes capability and measurement, not a UI redesign.

## 1. Cross-cutting compliance baseline (applies to every CRO feature)

Every feature in this document MUST satisfy:

| Concern         | Requirement                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tracking        | Emit standardized events per [arch 16](../architecture/16-tracking-specification.md); always emit `experiment_exposed` when a variant/module is seen      |
| Analytics       | Outcomes queryable in ClickHouse joined to variant/module ([arch 10](../architecture/10-analytics-and-feed-engine.md))                                    |
| Audit logs      | Every config change → `audit.entry.recorded` ([arch 20](../architecture/20-events-catalog.md), WORM)                                                      |
| Permissions     | RBAC+ReBAC gated ([arch 07](../architecture/07-auth-and-authorization.md)); experiment edit vs. view separated                                            |
| Feature flags   | Every module/experiment is behind a flag with an instant kill switch ([arch 12](../architecture/12-feature-flags-and-configuration.md))                   |
| Dark mode       | Operator surfaces use Lumo Design System tokens ([`../ui/LUMO_DESIGN_SYSTEM.md`](../ui/LUMO_DESIGN_SYSTEM.md))                                            |
| Responsive      | Operator surfaces follow [`../ui/LUMO_DESIGN_SYSTEM.md`](../ui/LUMO_DESIGN_SYSTEM.md) §11; storefront modules are responsive across desktop/tablet/mobile |
| Localization    | All copy is i18n-keyed; offers/timers respect locale + currency + timezone                                                                                |
| Accessibility   | WCAG 2.2 AA; modules keyboard-operable, announce dynamic changes, respect reduced-motion                                                                  |
| Version history | Every experiment/module config is versioned with rollback                                                                                                 |

## 2. Capability split

- **Experimentation primitives** — the engine that decides _what a visitor sees_ and _measures it_.
- **Conversion modules** — the storefront widgets whose visibility/variant the engine controls.

Both share one assignment engine and one measurement pipeline (no bespoke metrics).

## 3. Experimentation primitives

| Primitive             | What it does                                                                                   | Config                                                                   | Measurement basis                  | Admin surface               |
| --------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------- | --------------------------- |
| A/B testing           | 2-variant weighted split                                                                       | experiment def                                                           | sequential / Bayesian (arch 21 §7) | A/B testing                 |
| Multivariate (MVT)    | Factorial across multiple factors                                                              | experiment def                                                           | per-factor + interaction           | A/B testing                 |
| Personalization       | Deterministic variant by audience rule (not randomized)                                        | audience + variant content                                               | lift vs. holdout                   | A/B testing / Feature flags |
| Audience segmentation | Eligibility cohorts (segment, lifecycle stage, geo, device, source, new/returning, cart state) | segment rule DSL ([arch 19](../architecture/19-marketing-data-model.md)) | targeting filter                   | (uses Marketing segments)   |
| Feature flags         | On/off + % rollout primitive shared with experiments                                           | flag + rules                                                             | n/a (gating)                       | Feature flags               |

Assignment is deterministic + edge-side (no flash, sticky across devices once identity is stitched — arch 21 §2, [arch 17](../architecture/17-attribution-specification.md)). Mutual-exclusion groups and a global holdout are enforced centrally.

## 4. Conversion modules

Each module is a storefront block whose visibility/variant is flag/experiment/audience-controlled and which emits standardized tracking events.

| Module                     | Purpose                                      | Placement / trigger      | Data source                                                    | Tracking events ([arch 16](../architecture/16-tracking-specification.md)) |
| -------------------------- | -------------------------------------------- | ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Dynamic offers             | Show the right promo per audience/experiment | PDP/cart/landing         | Pricing offers, segment                                        | `offer_viewed`, `offer_claimed`                                           |
| Dynamic product blocks     | Swap product content by variant/audience     | PDP/home                 | CMS block + experiment handle                                  | `experiment_exposed`, `product_viewed`                                    |
| Exit intent                | Recover abandoning visitors                  | exit-intent / inactivity | offer + flag                                                   | `popup_shown`, `popup_dismissed`, `offer_claimed`                         |
| Sticky add-to-cart         | Keep ATC in view                             | PDP scroll past fold     | flag/experiment                                                | `product_added_to_cart`, `experiment_exposed`                             |
| Frequently bought together | Attach rate                                  | PDP/cart                 | Recommendations                                                | `offer_viewed`, `product_added_to_cart`                                   |
| Upsells                    | Higher-value alternative                     | post-add / pre-checkout  | Catalog relations                                              | `offer_viewed`, `offer_claimed`, `product_added_to_cart`                  |
| Cross-sells                | Complementary items                          | cart / PDP               | Catalog relations                                              | `offer_viewed`, `product_list_clicked`, `product_added_to_cart`           |
| Bundles                    | Raise AOV via curated sets                   | PDP/cart                 | Catalog bundles                                                | `offer_viewed`, `product_added_to_cart`                                   |
| Trust badges               | Reduce anxiety (safety certs)                | PDP/checkout             | Catalog safety certs                                           | `experiment_exposed`                                                      |
| Countdown timers           | Urgency on active offers                     | PDP/cart                 | offer validity (locale/timezone-aware)                         | `offer_viewed`, `experiment_exposed`                                      |
| Social proof               | Live activity / review counts / "N viewing"  | PDP/collection           | events read model                                              | `experiment_exposed`, `product_viewed`                                    |
| Recently viewed            | Re-engagement                                | PDP/home rail            | Social recently_viewed                                         | `product_list_clicked`, `product_viewed`                                  |
| AI recommendations         | Personalized discovery                       | home/PDP/cart/search     | Recommendations service (consent-respecting; never child data) | `product_list_clicked`, `product_viewed`                                  |

Upsells, Cross-sells, Bundles also have the existing admin screens (**Upsells**, **Cross-sells**) for their rules.

## 5. Measurement, dashboard, and reports

All measurement flows through the tracking pipeline → ClickHouse; nothing is measured outside [arch 16](../architecture/16-tracking-specification.md).

- **Experiment dashboard** (**A/B testing** screen): per variant — exposures, primary + secondary metric conversion, uplift, confidence/posterior, revenue/visitor, guardrails; segment breakdowns; reproducible from the event log.
- **Statistical significance:** sequential always-valid p-values (safe peeking), Bayesian probability-to-beat + expected loss, multi-armed bandit for low traffic; required MDE + power pre-launch; SRM detection; minimum runtime ≥ 1 business cycle (arch 21 §7).
- **Revenue attribution:** module/experiment exposure is joined to conversions and credited under the configured attribution model ([arch 17](../architecture/17-attribution-specification.md)); revenue is net of refunds.
- **Conversion reports** (**Analytics**/**Funnels**/**UTM reports** screens): funnel impact, attach rate, AOV lift, incremental revenue vs. control/holdout, and module-level conversion contribution.

## 6. Rollout strategy and kill switch

- Ramp 1% → 5% → 25% → 50% → 100%, gated on guardrails; a winning variant graduates to a flag-controlled 100% rollout, then the experiment is archived and the flag cleaned up.
- **Kill switch:** every experiment and module is behind a flag that disables instantly (no deploy), reverting all subjects to control/default; guardrail breach can auto-kill.

## 7. Governance

Experiments are config (no deploy to launch/stop); one primary metric declared up front; owner + hypothesis + MDE + planned runtime recorded via `experiment.launched`; mutual exclusion + holdout enforced centrally; children are never targeted, profiled, or used as a model input.

## Requires ADR to change

- The shared assignment/measurement engine, the "every CRO feature measurable through the tracking spec" rule, or the kill-switch-behind-a-flag rule.
- The set of experimentation primitives or the conversion-module catalog.
- Any change that introduces a new admin surface (also requires UI approval per [`../ui/`](../ui/README.md)).
