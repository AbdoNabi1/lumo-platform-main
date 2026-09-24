# WP-14 — Morbeh SaaS billing: platform-global plans, dunning, billing analytics

> **Read first:** [`../README.md`](../README.md) and [`README.md`](README.md), completely.
> **Depends on:** `WP-11` (decimal money — this workstream is built entirely on the ledger `WP-11`
> makes correct) and `WP-13` (the shared Stripe/Paymob orchestrator contract this reuses).
> **Conflicts with:** `WP-3`, `WP-5`, `WP-6`, `WP-7`, `WP-9`, `WP-10`, `WP-13`, `WP-15`
> (`apps/runtime/src/composition.ts`) and `WP-4`, `WP-5`, `WP-6`, `WP-8`, `WP-9`, `WP-13`, `WP-15`
> (`apps/admin/src/http/admin-routes.ts`).
> **Closes:** Morbeh F-16 (SaaS plans are tenant-scoped; should be platform-global with immutable
> versions).

## Why this exists

This is Morbeh charging its merchants, as distinct from every other WP in this roadmap (which is
about a merchant's own store). Verified: `packages/db/prisma/schema/licensing.prisma` already
models `Plan`, `Subscription`, `MerchantFeatureOverride`, `MerchantCapabilities`, `UsageCounter`,
`Credit`, and `Invoice` — but `Plan` (line 4) carries `tenantId` and a `@@unique([tenantId, key])`
constraint, meaning today a "plan" is scoped _per merchant tenant_, not defined once by the
platform and sold to many. This is backwards for a SaaS billing model: a price change to a
tenant-scoped plan has no defined effect on other tenants because there are no other tenants
sharing that plan row.

**This workstream largely promotes an existing layer one level up the hierarchy rather than
building a new one.** `Subscription`, `UsageCounter`, `Credit`, and `Invoice` already exist, already
keyed by `(tenantId, tenantRef)`, and do not need to be reinvented — only `Plan` needs to become
platform-global.

## Decisions, already made

1. **Plans move from tenant-scoped to platform-global, with immutable published versions.** A price
   change must never silently reprice an existing subscription — a subscription pins the plan
   _version_ it was created against, not a live pointer to the current plan definition. This is the
   same versioning shape `WP-6`'s automation workflows use for definitions vs. runs, and the same
   principle `WP-10`'s tenancy work protects for repositories: **the thing that changes and the
   thing that must not change live in different rows.**
2. **Stripe and Paymob, through the same orchestrator contract `WP-13` builds.** Morbeh's own
   billing is not a third payment integration — it is a third _caller_ of the same
   `PaymentProvider` port. Do not build a parallel billing-specific payment path.
3. **Billing is strictly separate from merchant store checkout.** A merchant's shopper paying for a
   product and Morbeh charging that merchant for the platform are different money flows, different
   ledgers, and must never share a `PaymentIntent`.

## Tasks

- [x] **T14.1 — Read the existing licensing layer in full.**
      `packages/db/prisma/schema/licensing.prisma` (all seven models listed above);
      `services/licensing/src/domain/` and `application/` for the use cases already built over
      them. Confirm which parts of the existing model already work per-merchant (Subscription,
      UsageCounter, Credit, Invoice) and touch only what genuinely needs to change (`Plan`).

- [x] **T14.2 — Make `Plan` platform-global with immutable versions.**
      Add a `PlanVersion` (or equivalent — check whether `services/licensing`'s existing code
      already has a versioning convention from a neighbouring aggregate, e.g. the pattern
      `WP-6`'s T6.2 points to for automation workflow versions, and reuse it rather than inventing
      a second one). `Plan` becomes platform-owned (no `tenantId`); `Subscription` references a
      specific, immutable `PlanVersion`, never a live `Plan`. Write the migration: existing
      tenant-scoped `Plan` rows need a deliberate mapping to platform-global plans plus a version —
      decide and document how ambiguity (two tenants with what should be "the same" plan but
      slightly different tenant-scoped rows today) is resolved, rather than silently merging or
      dropping data.

- [ ] **T14.3 — Coupons, add-ons, and credits.**
      Give coupons a full lifecycle (issue, redeem, expire, revoke). Integrate discounts and add-ons
      with `MerchantFeatureOverride`/`MerchantCapabilities` and the existing `Credit` model, rather
      than a parallel entitlement mechanism — `packages/entitlement` already exists per Phase 7's
      `WP-5` citation (`the runtime PEP that already gates every protected command/API/admin
action/job/AI request`); check whether billing entitlements should flow through it before
      adding a second entitlement check path.

- [x] **T14.4 — Payment orchestration through `WP-13`'s contract.**
      Morbeh's own billing charges (subscription renewal, usage overage) go through the same
      `PaymentProvider` port `WP-13` wires Stripe and Paymob behind. Do not add a second Stripe
      client or a second webhook handler — reuse `packages/psp-stripe` and (once `WP-13` lands)
      `packages/psp-paymob` as-is.

- [ ] **T14.5 — Dunning.**
      Detection (a renewal/usage charge fails), a retry schedule, a grace period, notification
      (through `services/notifications`' real providers once `WP-6` lands — a stub notification
      provider for dunning is a business-critical failure waiting to happen, not an acceptable
      placeholder), state transitions (active → past_due → suspended, with the exact transitions
      as a state machine, not ad hoc flags), and recovery reporting. Every state transition needs
      its own test, including the "payment recovers mid-grace-period" case.

- [ ] **T14.6 — Billing analytics over the ledger.**
      MRR and its components (new, expansion, contraction, churned), ARPU, churn, retention, LTV,
      gross and contribution margin. Query this from the now-decimal ledger `WP-11` produces —
      **never recompute money from a tracking event or an estimate**; this is Morbeh's own revenue,
      and the "never trust a client-supplied amount" rule in `../README.md` rule 3 applies with
      full force to Morbeh's own billing numbers, not only to a merchant's storefront.

- [ ] **T14.7 — Screens.**
      Platform-side billing screens (plan management, subscription list, dunning queue, billing
      analytics dashboard) — these likely belong in `WP-15`'s platform-admin app rather than
      `apps/admin-web` (which is the _merchant's_ operator surface); confirm against `WP-15`'s
      scope before building the screen here, and if `WP-15` has not landed yet, build the screen in
      `apps/admin-web` gated to a platform-only role, with a note in this WP's commit that it should
      migrate to the platform-admin app once `WP-15` exists.

## Status — part 1 landed 2026-09-24 (T14.1, T14.2, T14.4)

T14.3 (coupons), T14.5 (dunning), T14.6 (analytics) and T14.7 (screens) are NOT started, so the Definition of Done
below stays open and Morbeh F-16 is recorded as **G-74**, open, with the follow-ups part 1 found. Design and
findings: **D-061** (Morbeh's own PSP account; no `PaymentIntent` row), **D-062** (platform-global plans,
pinned immutable versions, platform-only surface, row mapping), **D-063** (integer minor-unit money). Migration
`20260924000000_wp14_platform_plans` is created and **not applied**. New runtime env vars:
`PLATFORM_BILLING_STRIPE_SECRET_KEY` and `PLATFORM_BILLING_STRIPE_WEBHOOK_SECRET` (absent ⇒ no billing adapter,
never a stub; the boot guard refuses that outside `local`). The DoD's price-change test is
`services/licensing/src/platform-billing.test.ts`. **Known limit:** the `PaymentProvider` port is on-session, so
until a stored-payment-method / off-session path exists a real renewal capture fails closed (invoice `failed`,
money unmoved) — G-74 (1).

**Update 2026-09-24 — the known limit above is closed for Paymob (G-74 (1), D-065/D-066).** With
`PLATFORM_BILLING_PAYMOB_*` configured, a renewal charges the merchant's SAVED card with no payer present:
Paymob's card-token callback (its own scheme, verified separately) stores a sealed, platform-scoped token
in `licensing.billing_payment_methods` (migration `20260924020000_billing_payment_methods`, created, NOT
applied), and `StoredMethodBillingPaymentsAdapter` charges it MIT through the new narrow `OffSessionCharger`
port into the unchanged `CollectInvoice`. No stored card ⇒ the invoice fails visibly, no charge attempted.
Still open and NOT closed here: nothing schedules renewals (G-74 (7)); the first interactive invoice is not
settled by a PSP callback (G-74 (8)); Stripe billing is still on-session. Operator steps are in D-066.

## Definition of done

- [ ] Changing a plan's price leaves every existing subscription on its pinned version — prove it
      with a test that changes a plan's price and asserts an existing subscription's charge amount
      is unaffected.
- [ ] No price is hardcoded anywhere in the billing path.
- [ ] A failed charge walks the dunning path deterministically, with a test per state transition.
- [ ] Billing analytics reconcile to the ledger — an MRR figure traces back to real `Invoice`/
      `Subscription` rows, not an estimate.
- [ ] Morbeh F-16 closed in `docs/architecture/23-platform-gap-register.md` and
      `docs/KNOWN_GAPS.md`.
- [ ] Repo-wide gates green per `../UNIFIED-ROADMAP.md` §3, plus `pnpm arch`.

## Known traps

- **Do not let a merchant-store payment and a Morbeh billing payment share a `PaymentIntent` row or
  a webhook handler.** They are different money flows with different owners; conflating them is
  how a merchant's chargeback ends up looking like a Morbeh billing failure or vice versa.
- **Do not compute MRR from `UsageCounter` deltas alone without checking `Credit` and coupon
  discounts.** A merchant on a discounted plan will otherwise show inflated MRR.
- **This WP has the widest `composition.ts`/`admin-routes.ts` conflict footprint in the whole
  roadmap** (see `../UNIFIED-ROADMAP.md` §5) — do not start it while `WP-10`'s tenancy refactor is
  actively rewriting repository construction in the same file; land after `WP-10` or coordinate
  explicitly.
