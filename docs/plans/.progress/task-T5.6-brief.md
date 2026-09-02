# Task T5.6 brief — Pricing

Same write-screen recipe as prior Phase 5 tasks. This domain has **no existing UI at all** and
**no `lib/api/pricing.ts`** — create it from scratch.

## No read/list endpoint for anything in this domain — bigger than T5.1/T5.5's gap

There is no `GET` route anywhere for prices, price lists, pricing rules, or tax classes (confirmed:
every `admin.pricing.*` call in `admin-routes.ts` is a write; grep the file yourself to confirm
before assuming otherwise). This is a pure operations console with **no browsing at all** — worse
than T5.5's warehouses (which at least has one indirect read via product inventory). Consequences
for this task:

- After "Create price list" / "Create price" / "Create tax class", the response is the created
  aggregate (check each handler — none map through a DTO, so treat the response the same way
  T5.1 treated untyped aggregate responses: read only an `id` off it if present, same
  `isCreatedProduct`-style guard pattern from `lib/api/products.ts`). **Display the returned id
  prominently after a successful create** (e.g. in the success state of that form, with a "copy"
  affordance if `@platform/ui` has one, otherwise just render it as selectable text) — it is the
  only way an operator will ever see it, since there is no list to browse back to it later. Do the
  same for whatever id `createPricingRule`'s response carries.
- `priceListId`, `productId`, `priceId`, `taxClassRef` fields throughout are plain text inputs
  (operators paste in ids they were shown at creation time or already have) — same fallback pattern
  as T5.1/T5.5, for the same reason (no list endpoint to build a picker against). Add **one**
  `docs/plans/BLOCKERS.md` entry covering this whole domain's missing read side (link it to the
  T5.1/T5.5 entries — same class of gap, worth noting as a pattern across the pricing/inventory
  domains) rather than one entry per field.

## Routes — all in `apps/admin/src/http/admin-routes.ts`, lines ~1432-1502

| Route | Method | Permission | Idempotent | Body (zod, verbatim) |
| --- | --- | --- | --- | --- |
| `/price-lists` (create) | POST | `pricing:create_price_list` | yes | `{ name: string.min(1), currency: string.length(3) }` |
| `/price-lists/:priceListId/activate` | POST | `pricing:activate_price_list` | yes | none |
| `/prices` (create) | POST | `pricing:create_price` | yes | `{ priceListId, productId, amountMinor: int().positive(), currency: length(3), compareAtMinor?: int().positive(), costMinor?: int().min(0), effectiveFrom?: string.datetime(), effectiveTo?: string.datetime(), taxClassRef?: string.min(1) }` |
| `/prices/:priceId` (change) | POST | `pricing:change_price` | yes | `{ amountMinor: int().positive(), currency: length(3), compareAtMinor?: int().positive(), costMinor?: int().min(0) }` |
| `/prices/:priceId/publish` | POST | `pricing:publish_price` | yes | none |
| `/tax-classes` (create) | POST | `pricing:create_tax_class` | yes | `{ code: string.min(1), name: string.min(1) }` |
| `/pricing-rules` (create) | POST | `pricing:create_pricing_rule` | yes | `{ type: "percentage"\|"fixed_amount", value: number, priority: int() }` |

`z.string().datetime()` fields expect full ISO-8601 — use a `<input type="datetime-local">` and
convert, or a plain text field with format guidance; either is acceptable, keep it simple.

## What to build

1. **`apps/admin-web/src/lib/api/pricing.ts`** (new) — 7 typed mutate functions: `createPriceList`,
   `activatePriceList`, `createPrice`, `changePrice`, `publishPrice`, `createTaxClass`,
   `createPricingRule`. For the three "create" functions, read the id off the response per the
   guidance above and return it in the `MutationResult` data so the Server Action/form can display
   it.
2. **`apps/admin-web/src/app/pricing/page.tsx`** (new) + **`apps/admin-web/src/app/pricing/actions.ts`**
   (new) — one operations console page, sectioned the same way T5.5's inventory console is: "Price
   lists" (create + activate, two small forms), "Prices" (create + change + publish, three forms),
   "Tax classes" (create), "Pricing rules" (create). Each form independently
   `useActionState`-driven, each success state showing the created id where applicable (per the
   guidance above).
3. **Navigation**: add a `pricing` entry to `PRIMARY_NAV` in `navigation.ts` pointing at `/pricing`
   (pick a reasonable `lucide-react` icon consistent with what's already imported there, e.g.
   `TagIcon` or `DollarSignIcon`).
4. **`middleware.ts`**: add `["/pricing", "operator"]` to `ROUTE_ROLE_REQUIREMENTS` — these are
   pricing-affecting writes, never `viewer`.
5. Every new string in both `messages/en.ts` and `messages/ar.ts`.

## Global constraints (apply to every Phase 5 admin task)

1. `packages/*`/`services/*` never import from `apps/*`.
2. Domain aggregates never go on the wire — read only the `id` off create responses, never type or
   render the rest of an untyped aggregate response.
3. Never fabricate data — the plain-text-id-fields ruling above is this rule applied to a whole
   domain's missing read side.
4. Every user-facing string in both dictionaries.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Mark this task's checkbox (`- [ ] **T5.6 Pricing.**` → `- [x] **T5.6 Pricing.**`) when done, and
   add the BLOCKERS.md entry — both required.
8. One `Idempotency-Key` per user-initiated submit.
9. Never call the runtime API from browser JS.
10. Prices ARE operator-entered amounts here (this is the pricing-authoring console itself, not a
    storefront or checkout surface) — that is correct for this screen, not a violation of "never
    trust a client-supplied price" (which governs checkout/cart, where the backend re-derives from
    what this console publishes).

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

## Report

Write your full report to `docs/plans/.progress/task-T5.6-report.md`. Return to the controller
only: status, files changed, one-line test summary, concerns.
