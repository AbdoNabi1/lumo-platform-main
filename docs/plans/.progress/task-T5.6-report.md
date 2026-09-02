# Task T5.6 report — Pricing

## Status: DONE

## What was built

A pure-write "Pricing operations console" — this domain has no `GET` route anywhere (no list, no
get-by-id, for prices, price lists, pricing rules, or tax classes; the brief's own ruling, which I
did not re-derive), so the screen is independent forms grouped into four sections, matching T5.5's
Inventory console's shape.

1. **`apps/admin-web/src/lib/api/pricing.ts`** (new) — 7 typed mutate functions:
   `createPriceList`, `activatePriceList`, `createPrice`, `changePrice`, `publishPrice`,
   `createTaxClass`, `createPricingRule`. The four "create" functions (`createPriceList`,
   `createPrice`, `createTaxClass`, `createPricingRule`) call routes whose handlers return the
   created domain aggregate directly (no DTO mapping — confirmed against `admin-routes.ts`'s
   `handle: (...) => admin.pricing.create*(...)`), so each reads only an `id` off the response
   via a shared `isCreatedPricingRecord` guard, the same `isCreatedProduct`-style pattern
   `lib/api/products.ts`'s `createProduct` uses, and returns `{ id: string }` in the
   `MutationResult`'s `data`. `activatePriceList`/`changePrice`/`publishPrice` read nothing off
   their responses (`isUnknown`), same as every other Phase 5 status-transition write.

2. **`apps/admin-web/src/lib/api/pricing.test.ts`** (new) — 10 tests covering all 7 functions:
   request shape (path/method/body/idempotency header) for each, the `createPriceList`
   id-extraction happy path plus its empty-id fallback when the response carries no `id` field,
   and 403→forbidden / 422→invalid mapping.

3. **`apps/admin-web/src/app/pricing/actions.ts`** (new) — 7 Server Actions, one per route.
   Introduces a local `CreateFormState` type (`{status:"idle"} | {status:"success", createdId:
   string} | {status:"error", message, fieldErrors}`) for the four create actions only — this
   is a local addition, not a change to the shared `FormState`/`toFormState` in
   `lib/api/mutation.ts` (left untouched, still used unmodified by `activatePriceListAction`/
   `changePriceAction`/`publishPriceAction` and by every other Phase 5 screen). A small
   `toCreateFormState` helper narrows `toFormState`'s output at runtime (no `as` cast) for the
   create actions' error paths. Every numeric/optional field is parsed defensively from
   `FormData` (mirroring `app/inventory/actions.ts`'s `intField`/`optionalStringField` helpers,
   redefined locally here per this codebase's per-route-group convention), one fresh
   `Idempotency-Key` is minted per submit via `newIdempotencyKey()`, and non-`ok` outcomes are
   projected through `toFormState`/`toCreateFormState` — never a raw error message. No
   `revalidatePath` calls anywhere in this file: there is no list/detail screen in the app that
   would ever read pricing data back, so there is nothing to revalidate.

4. **`apps/admin-web/src/components/pricing/pricing-operations-forms.tsx`** (new) — 7 form
   components (`CreatePriceListForm`, `ActivatePriceListForm`, `CreatePriceForm`,
   `ChangePriceForm`, `PublishPriceForm`, `CreateTaxClassForm`, `CreatePricingRuleForm`), each
   independently `useActionState`-driven. The four create forms render a `CreatedIdNotice` on
   success: `@platform/ui`'s exports (checked against `packages/ui/src/index.ts`) have no
   copy-button/copyable-text component, so per the brief's fallback this renders the id as plain
   selectable monospace text (`select-all font-mono`). Every `priceListId`/`productId`/`priceId`/
   `taxClassRef` field is a plain text `<Input>`, no picker, per the brief's ruling. The pricing
   rule's `type` field is a native `<select>` (percentage / fixed_amount), reusing the exact
   Tailwind class string `components/orders/return-lifecycle-actions.tsx` already uses for its own
   native `<select>` (no `<Select>` component exists in `@platform/ui` either). `effectiveFrom`/
   `effectiveTo` are plain text inputs with an ISO-8601 placeholder (`datetimePlaceholder`), per
   the brief's "either is acceptable, keep it simple" guidance — not `datetime-local` +
   conversion, to avoid timezone-offset edge cases for no real benefit here.

5. **`apps/admin-web/src/app/pricing/page.tsx`** (new) — the console page, sectioned "Price
   lists" (create + activate), "Prices" (create + change + publish), "Tax classes" (create),
   "Pricing rules" (create), matching `app/inventory/page.tsx`'s card-per-section layout.

6. **Navigation**: added a `pricing` entry to `PRIMARY_NAV`
   (`apps/admin-web/src/components/navigation.ts`) pointing at `/pricing`, using `TagIcon` from
   `lucide-react` (one of the two icons the brief suggested).

7. **`apps/admin-web/src/middleware.ts`**: added `["/pricing", "operator"]` to
   `ROUTE_ROLE_REQUIREMENTS` — pricing-affecting writes, `operator` not `viewer`, matching the
   brief and the same tier `/inventory` uses.

8. **Strings**: every new user-facing string added to both
   `apps/admin-web/src/messages/en.ts` (`nav.pricing` + a new `pricingPage` section) and
   `apps/admin-web/src/messages/ar.ts` (matching Arabic translations). `ar.ts` is typed as
   `Dictionary` (`import type { Dictionary } from "./en"`), so a missing/mistyped key would have
   failed `typecheck` — it didn't.

9. **`apps/admin-web/src/lib/i18n.test.ts`**: added `"pricingPage.datetimePlaceholder"` to the
   existing `SHARED_VERBATIM` allowlist (already used for `topbar.searchHint`'s "Ctrl K"). This
   is the one non-`docs/plans` file outside the enumerated exceptions I touched, and it was
   necessary: the ISO-8601 format token `YYYY-MM-DDTHH:mm:ssZ` an operator must type literally is
   a machine format string, not natural language, so it is intentionally identical in both
   locales — the existing "is actually translated, not copied" test flagged it as a false
   positive (an unmodified `pnpm test` run failed on exactly this one assertion before the
   allowlist entry was added) until whitelisted, same rationale the pre-existing `topbar.
   searchHint` entry already establishes for keyboard-shortcut-shaped tokens.

10. **`docs/plans/BLOCKERS.md`**: added one new `## T5.6` entry (not one entry per field, per the
    brief) covering this domain's complete lack of a read side, explicitly cross-referencing the
    T5.1 (brand/category) and T5.5 (warehouse) entries as the same class of gap, with a suggested
    fix (add `GET` list/get-by-id routes to `services/pricing`'s read side and
    `admin-routes.ts`).

11. **`docs/plans/PHASE-5-6-backlog.md`**: checked off `T5.6 Pricing.`.

## Routes wired (all in `apps/admin/src/http/admin-routes.ts`, confirmed at lines 1432-1502)

| Route | Method | Permission | Function |
| --- | --- | --- | --- |
| `/price-lists` | POST | `pricing:create_price_list` | `createPriceList` |
| `/price-lists/:priceListId/activate` | POST | `pricing:activate_price_list` | `activatePriceList` |
| `/prices` | POST | `pricing:create_price` | `createPrice` |
| `/prices/:priceId` | POST | `pricing:change_price` | `changePrice` |
| `/prices/:priceId/publish` | POST | `pricing:publish_price` | `publishPrice` |
| `/tax-classes` | POST | `pricing:create_tax_class` | `createTaxClass` |
| `/pricing-rules` | POST | `pricing:create_pricing_rule` | `createPricingRule` |

All 7 zod bodies were read directly from `admin-routes.ts` (lines 529-554) and matched field-for-
field against the brief's table before writing the TypeScript interfaces — confirmed identical
(names, optionality, `length(3)` on currency, `int().positive()`/`int().min(0)` splits on
`amountMinor`/`compareAtMinor`/`costMinor`, the `"percentage"|"fixed_amount"` enum, etc.).

## Files changed

New:
- `apps/admin-web/src/lib/api/pricing.ts`
- `apps/admin-web/src/lib/api/pricing.test.ts`
- `apps/admin-web/src/app/pricing/actions.ts`
- `apps/admin-web/src/app/pricing/page.tsx`
- `apps/admin-web/src/components/pricing/pricing-operations-forms.tsx`

Edited:
- `apps/admin-web/src/components/navigation.ts` (added `pricing` nav entry + `TagIcon` import)
- `apps/admin-web/src/middleware.ts` (added `["/pricing", "operator"]`)
- `apps/admin-web/src/messages/en.ts` (added `nav.pricing` + `pricingPage` section)
- `apps/admin-web/src/messages/ar.ts` (added `nav.pricing` + `pricingPage` section, Arabic)
- `apps/admin-web/src/lib/i18n.test.ts` (added one `SHARED_VERBATIM` allowlist entry)
- `docs/plans/BLOCKERS.md` (added the `## T5.6` entry)
- `docs/plans/PHASE-5-6-backlog.md` (checked off T5.6)

No files touched under `apps/admin`, `services/*`, or `packages/*`.

## Verification

```
cd "D:\lumo-platform-main-main\lumo-platform-main-main" && pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

- `typecheck`: passed clean, no errors.
- `lint`: passed — 0 errors, 1 pre-existing warning in `next.config.ts` (`require-await`),
  unrelated to this task.
- `test`: **46 test files passed, 427 tests passed, 0 failed.** (This includes the new
  `pricing.test.ts` file — 10 tests — plus the pre-existing suite; one `i18n.test.ts` assertion
  failed before the `SHARED_VERBATIM` fix described above and passes now.)

## Concerns / notes for the controller

- No `revalidatePath` calls in `app/pricing/actions.ts` is intentional, not an oversight — there
  is genuinely no screen anywhere in the app that reads pricing data back (see the BLOCKERS.md
  entry). Flagging in case a future task adds a read screen and needs to remember to revalidate
  it.
- `CreateFormState` is a new, pricing-local type living in `app/pricing/actions.ts`, not an
  addition to the shared `lib/api/mutation.ts` `FormState`/`toFormState`. I chose this over
  extending the shared type because extending `FormState`'s `"success"` variant with an optional
  `data`/`createdId` field would touch code every other Phase 5 write screen (T1-T5.5) already
  depends on, for a need only this task has. If a later task also needs to show a created id, it
  may be worth promoting this pattern into `lib/api/mutation.ts` at that point — not done here to
  keep this task's blast radius to its own domain.
- One non-obvious file outside the "apps/admin-web/ plus BLOCKERS.md plus backlog checkbox" scope
  was touched: `apps/admin-web/src/lib/i18n.test.ts` (still under `apps/admin-web/`, just not a
  file the brief named explicitly), to allowlist the one legitimately-identical-across-locales
  string this task introduced. No other file outside the stated scope was modified.
