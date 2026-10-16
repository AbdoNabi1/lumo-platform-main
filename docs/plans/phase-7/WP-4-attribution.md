# WP-4 — Attribution: turn collected touchpoints into credited revenue

> **Read first:** [`../README.md`](../README.md) and [`README.md`](README.md), completely.
> **Depends on:** WP-3 (the touchpoint store) and, for real data, WP-2.
> **Conflicts with:** WP-5, WP-6, WP-8, WP-9 (`apps/admin/src/http/admin-routes.ts`).
> **Closes:** G-54.

## Why this exists

Brief §20 asks for six attribution models. The platform **collects** everything they need and
**computes** none of it.

What exists: `packages/tracking/src/envelope/attribution-context.ts` (with exported
`ATTRIBUTION_MODELS` and `CHANNEL_GROUPS` constants — read them, the model names are already
chosen), `click-ids.ts`, `pipeline/channel-resolver.ts` (resolves a touchpoint to a channel),
`pipeline/attribution.ts` (`AttributionSnapshot`), and `pipeline/enrichment.ts`
(`PersistedAttribution`, `mergeClickIds`, `enrichAttribution`).

What does not exist: anything that takes a set of touchpoints and a conversion and divides credit
between them. Grep the repo for `first_touch`, `time_decay`, `linear` outside those constant lists —
nothing implements them.

Without this, the platform can show _that_ revenue happened and _that_ traffic arrived, and can
never answer the brief's own question: **"Which campaign actually generated revenue?"**

## Design decisions, already made

1. **Attribution is a computation over the event store, not a new aggregate.** A touchpoint is an
   event you already have; a conversion is an event you already have. Attribution is a query with a
   crediting rule. Do not create an `Attribution` aggregate with a lifecycle — there is no
   business invariant to protect and no state that can be invalid.
2. **Therefore it belongs beside the semantic layer**, as a new module in `services/analytics`
   (`src/attribution/`), consuming the ClickHouse touchpoint data WP-3 lands. Not a new
   bounded context.
3. **Models are pure functions.** `(touchpoints, conversion, config) → credit[]`. That makes them
   trivially testable, which matters, because attribution bugs are invisible: the number looks
   plausible and is wrong.
4. **Lookback windows are configuration, not constants.** Different merchants need different ones.

## Tasks

- [ ] **T4.1 — Read the existing vocabulary and reuse it.**
      `packages/tracking/src/envelope/attribution-context.ts` — `ATTRIBUTION_MODELS` and
      `CHANNEL_GROUPS` already name the models and channel groupings. Use those exact names.
      `packages/tracking/src/pipeline/channel-resolver.ts` — channel resolution already exists; do
      not write a second `utm_source` → channel mapping.
      `packages/tracking/src/pipeline/attribution.ts` — read what `AttributionSnapshot` already
      captures per event before deciding what the store needs.

- [ ] **T4.2 — The touchpoint query.**
      Given a conversion (an order) and a lookback window, return the ordered touchpoints for that
      customer/session/visitor identity. Two sharp edges:

      - **Identity stitching.** A visitor is anonymous before they buy. `services/customer-360`
                already owns identity resolution (`observe-identity-link`, `merge-identities`,
                `get-identity-timeline`). Use it — do not re-derive identity from cookies here.
                Cross-context reads go through the port/adapter pattern the repo already uses; `pnpm arch`
                will tell you if you take a shortcut.
              - **The window is per model config**, and touchpoints outside it are dropped before
                crediting, not weighted to zero.

- [ ] **T4.3 — The six models, as pure functions.**
      `first_touch`, `last_touch`, `linear`, `position_based` (default 40/20/40 — make the split
      configurable), `time_decay` (default 7-day half-life — configurable), and a
      `last_non_direct` variant, which is what most merchants actually mean by "last touch" and is
      the one whose absence causes the most confusion.
      Non-negotiable properties, each with its own test:

      - **Credit sums to the conversion value.** Exactly. Test it with values that do not divide
                evenly, because that is where the rounding bug lives.
              - **Money stays in minor-unit integers.** Distribute remainder pennies deterministically
                (e.g. largest-remainder), never by rounding each share independently — that loses or
                invents money.
              - **Zero touchpoints is a defined case**, not a crash: the conversion is unattributed, and
                "unattributed" must be a visible bucket in every report, never silently dropped.
              - The functions are pure: no clock, no I/O, no randomness. Pass `now` in.

- [ ] **T4.4 — Expose it.**
      Read use cases + `GET` routes in a new `apps/admin/src/http/attribution-routes.ts`
      (registered in `admin-routes.ts`), returning credited revenue by channel / campaign / source,
      for a chosen model, date range and lookback. DTO-mapped, `AdminGuard`-wrapped, tenant-scoped —
      copy a neighbouring route file exactly.

- [ ] **T4.5 — The screen.**
      A new `apps/admin-web/src/app/analytics/attribution/page.tsx`: a model selector, a date range,
      and credited revenue by channel and campaign — plus, prominently, **the same conversions under
      two different models side by side.** Attribution's single most useful property is that it
      shows how much the answer depends on the model, and a UI that presents one number as _the_
      truth teaches the operator something false.
      Show the unattributed bucket. Show the lookback window in use. Strings in `en.ts` and `ar.ts`;
      `ROUTE_ROLE_REQUIREMENTS` entry.

- [ ] **T4.6 — Honest empty state.**
      Before WP-2/WP-3 have produced data, this screen has no touchpoints. It must say that
      explicitly — not render zeros, which read as "no campaigns worked". Follow
      `apps/admin-web/src/app/marketing/page.tsx`'s honest-gap pattern.

## Definition of done

- [ ] All six models implemented as pure functions, each with a credit-sums-exactly test including
      a non-divisible value.
- [ ] A conversion with zero touchpoints appears in an explicit unattributed bucket.
- [ ] The screen shows two models side by side over the same conversions.
- [ ] Reports are tenant-scoped, with a test proving cross-tenant touchpoints never mix.
- [ ] G-54 closed. Repo-wide gates green, plus `pnpm arch`.

## Known traps

- **Do not attribute from tracking events alone.** The conversion _value_ is money, and money comes
  from Orders/Payments in Postgres, not from a number a browser sent. `docs/plans/README.md` rule 3
  ("never trust a client-supplied price, amount, or rate") is exactly this situation. The event
  supplies the _touchpoints_; the order supplies the _value_.
- **Do not let a refund silently keep its attributed credit.** Decide the policy (subtract on
  refund, or report gross with a separate refund line), implement it, and document it on the screen
  so the operator knows which number they are reading.
- **Do not add a seventh "data-driven" model in this WP.** The brief lists it, but it needs a
  trained model, a training set, and a validation story. Record it as a follow-up gap.
