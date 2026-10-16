# WP-18 — Make the order total real: tax, shipping, package weight

> **Read first:** [`../README.md`](../README.md) and [`README.md`](README.md), completely.
> **Depends on:** `WP-1` (guest checkout — both change the same order-creation path; land `WP-1`
> first so this doesn't have to re-adapt to it mid-flight).
> **Conflicts with:** none of the hot files in `../UNIFIED-ROADMAP.md` §5 — touches `services/tax`
> (new), `services/shipping`, `packages/db/prisma/schema/catalog.prisma`, and checkout's total
> calculation, none of which any other WP in this roadmap claims.
> **Closes:** Morbeh F-12 (tax is a flat 10% stub, shipping is hardcoded, no package weight exists
> anywhere in the schema).

## Why this exists

Verified in this session, directly from `apps/runtime/src/api.ts`'s own boot-guard message (the
same guard already cited for `WP-11`'s F-11 finding, confirming both in one read):

> _"taxCalculation needs a tax provider integration ... or a local tax-authority table — nothing in
> this codebase computes tax today (checkout's tax figure is a flat 10% stub). shippingCalculation
> needs a shipping rate source ... nothing in this codebase quotes a shipping rate today (checkout's
> shipping figures are hardcoded). shippingPort needs a source of package weight/dimensions per
> product — `services/shipping`'s shipment-creation flow requires `weightGrams` per package and
> nothing in Catalog, Orders, or Fulfillment computes or stores one."_

Independently confirmed: `services/shipping/src/application/create-shipment.use-case.ts:14` and
`services/shipping/src/domain/value-objects/shipment-package.ts` both require `weightGrams` as a
positive integer — but `packages/db/prisma/schema/catalog.prisma` has no weight field at all
(`grep -n weight` returns nothing). `services/shipping` cannot run against real product data today,
for any merchant, regardless of anything else in this roadmap. This is the hard blocker on any
merchant actually transacting, independent of and in addition to `WP-1`'s guest-checkout blocker.

## Decisions, already made

1. **Ports first, in-house rate tables first.** Define the tax and shipping ports and back them
   with in-house rate tables before evaluating any external provider. A provider integration
   (Avalara, TaxJar, a carrier rating API) is a procurement decision with recurring cost; the port
   is what makes it swappable later without another migration. **Do not integrate Avalara, TaxJar,
   or any carrier API in this WP** — that requires its own explicit approval and is out of scope
   here.
2. **Weight and dimensions are catalog data, carried through orders into fulfillment**, not
   computed or guessed at shipping time. A product without a recorded weight is a data-entry gap to
   surface to the merchant, not a default to silently substitute (a silent default here produces a
   wrong shipping quote, which is a real money and trust problem).

## Tasks

- [ ] **T18.1 — Add weight and dimensions to the catalog.**
      `packages/db/prisma/schema/catalog.prisma`: add `weightGrams` (integer, matching
      `services/shipping`'s existing expectation exactly) and dimension fields (length/width/height,
      unit — pick one unit repo-wide and document it) to the product/variant model, whichever level
      `services/shipping`'s `weightGrams` is actually consumed per-unit at (check
      `create-shipment.use-case.ts`'s call site to confirm whether weight is per-product or
      per-variant before deciding where the column goes). Nullable — existing products have no
      weight recorded yet. Own schema file, own `@@schema` annotation preserved, own migration.

- [ ] **T18.2 — Carry weight through orders into fulfillment.**
      Order line items must snapshot the product's weight at order time (the same "order-time
      snapshot" pattern this repository already uses for price — check `services/orders`' existing
      product-snapshot fields and follow that exact convention, do not invent a second snapshotting
      approach). Wire the snapshot through to wherever `services/shipping`'s
      `create-shipment.use-case.ts` currently receives `weightGrams` from its caller — verified at
      `:62`, `packageInput.weightGrams` — so it now receives a real value instead of whatever
      currently supplies it (read that call site to find out what supplies it today; if it is
      already a hardcoded or stubbed value, that caller is part of this task's scope).

- [ ] **T18.3 — Tax port and in-house rate table.**
      A `TaxCalculationPort` (or find and use the port name `assertProductionIntegrationPortsConfigured`
      already references as `taxCalculation` in `apps/runtime/src/api.ts` — reuse the existing name,
      do not introduce a second one). Back it with an in-house rate table: at minimum,
      jurisdiction → rate, with the jurisdiction resolved from the order's shipping address. Two
      jurisdictions must each produce a correct, different figure — that is the acceptance test, not
      an implementation detail. Replace the flat-10%-stub call site in checkout's total calculation
      with this port.

- [ ] **T18.4 — Shipping rate port and in-house rate table.**
      Same shape: a `ShippingCalculationPort` (reuse the existing `shippingCalculation` name from
      the boot guard). Back it with an in-house table keyed on whatever this platform's real
      shipping model is (weight bands per carrier/zone is the common shape — confirm against any
      existing shipping-zone concept in `services/shipping` before inventing one). Replace the
      hardcoded shipping-figure call site in checkout's total calculation with this port.

- [ ] **T18.5 — Retire the two stub-specific boot guards as each real adapter lands.**
      `apps/runtime/src/api.ts`'s `assertProductionIntegrationPortsConfigured` currently refuses to
      boot outside `local` while `taxCalculation`, `shippingCalculation`, and `shippingPort`
      (package weight) are stubbed. As each of T18.1–T18.4 lands, update the guard so it no longer
      lists the closed item, updating `apps/runtime/src/composition.test.ts`'s corresponding
      assertions in the same commit — the same "update the guard message deliberately, as the
      record of the gap closing" practice `WP-11`'s T11.2 uses for the finance guard.

- [ ] **T18.6 — Merchant-facing weight entry.**
      A way for a merchant to set a product's weight and dimensions in the admin surface (extend
      the existing product edit screen in `apps/admin-web` — do not build a separate screen for
      this). Surface which products are missing weight data somewhere a merchant would actually see
      it before it silently breaks their first real shipment.

- [ ] **T18.7 — Tests.**
      Two jurisdictions → two correct, different tax figures, from the in-house table, not a flat
      rate. Two shipping scenarios (different weight bands or zones) → two correct, different
      shipping quotes, derived from a real package weight carried from the order's line items. A
      product with no recorded weight is rejected at checkout with a clear error, not silently
      defaulted to some assumed weight.

## Definition of done

- [ ] Two jurisdictions produce two correct tax figures from the in-house rate table.
- [ ] Two shipping scenarios produce two correct shipping quotes derived from real package weight.
- [ ] No stub remains in `apps/runtime/src/api.ts`'s integration-ports guard for `taxCalculation`,
      `shippingCalculation`, or `shippingPort` (package weight).
- [ ] A merchant can see and set product weight/dimensions, and see which products are missing it.
- [ ] Morbeh F-12 closed in `docs/architecture/23-platform-gap-register.md` and
      `docs/KNOWN_GAPS.md`.
- [ ] Repo-wide gates green per `../UNIFIED-ROADMAP.md` §3, plus `pnpm arch`.

## Known traps

- **Do not silently default a missing weight to some "average" value.** It produces a shipping
  quote that looks correct and is wrong — the exact failure mode `WP-10`'s tenancy work and
  `WP-11`'s decimal work are both independently careful to avoid for other kinds of silent
  defaulting. Reject, and tell the merchant why.
- **Do not integrate a real tax or shipping provider in this WP.** Decision 1 is explicit: ports and
  in-house tables only. A provider integration is a procurement decision requiring its own
  approval.
- **The boot guard's message is shared across three findings (`taxCalculation`,
  `shippingCalculation`, `shippingPort`) and a fourth, unrelated one (`financePort`, closed by
  `WP-11`).** Read the whole guard before editing it, so a partial fix (e.g. tax closed, shipping
  not yet) updates only its own portion of the message and test assertions, not the whole guard.
