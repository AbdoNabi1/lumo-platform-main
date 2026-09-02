# Task T5.19 report — Loyalty balance

**Status: DONE**

Implemented the customer's own read-only loyalty balance, following
`apps/admin/src/http/public-wishlist-routes.ts`'s pattern exactly, as directed by the brief and by
BLOCKERS.md's `## T5.17` entry (§4, "Blast radius on T5.17/T5.19/T5.18-write") and its confirmation
that `LoyaltyAccountRepository.findByCustomerRef` already exists — no repository gap.

## What was found before building

- `LoyaltyController` (`services/loyalty/src/interfaces/loyalty.controller.ts`) only exposed
  `get(accountId)` and `list` — no `getByCustomer`-shaped method, unlike `WishlistController`, which
  already had one. This matched the brief's anticipated gap exactly ("if the admin-facing controller
  only has `get(accountId)` and `list`, you may need to add a small `getByCustomer` method").
  `LoyaltyAccountRepository.findByCustomerRef` itself already existed
  (`services/loyalty/src/domain/loyalty-account-repository.ts:8`) — the same shallow
  "expose an existing repository method through a new use case + controller method" addition T5.7
  made for `ListBrands`, per the brief.
- `apps/admin/src/composition.ts`'s `publicReads` had no `loyalty` entry (only
  `products`/`categories`/`collections`/`prices`/`inventory`/`cart`/`checkout`/`reviews`/`security`/
  `customers`/`wishlist`).

## Backend changes (small, contained)

- **`services/loyalty/src/application/get-account-by-customer.use-case.ts`** (new) —
  `GetAccountByCustomer`, mirrors `GetAccount` but resolves by `customerRef` via
  `findByCustomerRef`, returning `NotFoundError` when the customer has no account (never a
  fabricated zero-balance account).
- **`services/loyalty/src/interfaces/loyalty.controller.ts`** — added `getAccountByCustomer` to
  `LoyaltyControllerDeps` and a `getByCustomer(input)` method on `LoyaltyController`, mirroring
  `WishlistController.getByCustomer`.
- **`services/loyalty/src/composition.ts`** — wired `getAccountByCustomer: new
  GetAccountByCustomer({ accounts })` into `buildController` (both the Prisma and in-memory
  branches use the shared `buildController`, so both get it for free).
- **`services/loyalty/src/application/loyalty-reads.use-case.test.ts`** — added a test for
  `GetAccountByCustomer` (found + not-found cases), mirroring the existing `GetAccount` test in the
  same file.
- **`apps/admin/src/composition.ts`** — imported `type LoyaltyController` from `@platform/loyalty`;
  added `readonly loyalty: LoyaltyController` to the `publicReads` interface (with a doc comment
  matching the `wishlist` entry's reasoning: the guarded `LoyaltyAdminController` requires a staff
  `Principal`, so the raw controller is exposed here instead, scoped by the session's `customerRef`
  only); added `loyalty: loyalty.loyalty` to the `publicReads` object literal.
- **`apps/admin/src/http/public-loyalty-routes.ts`** (new) — one route,
  `GET /public/loyalty/accounts/me`, `public: true`, `permission: "loyalty:read"`. Handler:
  `admin.customerAuth.requireSession(resolveCustomerSessionId(context))` (identical opening move to
  every route in `public-wishlist-routes.ts`), then `admin.publicReads.loyalty.getByCustomer({
  customerRef: guarded.session.customerRef })`, mapped to `PublicLoyaltyAccountDto` (omits
  `customerRef`, same reasoning `PublicWishlistDto`/`PublicCartDto` document). A 404 from the
  controller (no account) is passed straight through — chose the plain-404 option the brief offered
  rather than a `{ hasAccount: false }` 200 shape, for symmetry with how `fetchItem` on the
  storefront side already distinguishes status codes without a body-shape branch.
- **`apps/admin/src/http/admin-routes.ts`** — imported and registered `publicLoyaltyRoutes(admin)`
  alongside `publicWishlistRoutes(admin)`.
- **`apps/admin/src/http/public-loyalty-routes.test.ts`** (new) — mirrors
  `public-wishlist-routes.test.ts`'s style over a real composition (`wireSecurity`, `wireIdentity`,
  `wireLoyalty`) with real sessions from `public-auth-routes.ts`: 401 without a session, 404 for a
  signed-in customer with no account, a real balance/tier/transactions once an account is opened and
  earns points, `customerRef` never on the wire (exact key-set assertion), no aggregate internals
  leak (`props`/`_id`/`_domainEvents`/`_version`), two customers' balances kept separate (including
  one who never opened an account), access stops the moment the session is revoked, and a
  route-declaration check that the path is always `/public/loyalty/accounts/me` with no
  `:accountId`/`:customerRef`.

No admin-facing (guarded) loyalty routes were touched — `loyalty-routes.ts`'s
open/advance/earn/spend/cashback/redeem/referral/list/get all remain exactly as they were.

## Frontend changes (`apps/storefront`)

- **`src/lib/runtime-api.ts`** — added `LoyaltyTransactionSummary`/`LoyaltyAccountSummary` types and
  `getMyLoyaltyBalance(sessionId)`, following the `getMyWishlist` pattern: `fetchItem` against
  `/api/v1/public/loyalty/accounts/me` with the `x-customer-session` header, never a `customerRef`
  or `accountId` parameter anywhere in the function signature.
- **`src/lib/loyalty.ts`** (new) — `resolveMyLoyaltyBalance(sessionId)`, mirroring
  `lib/customer-session.ts`'s `resolveCurrentCustomer` in shape: `signed-out` short-circuits without
  a network call, `401` → `signed-out`, `404` → a distinct `no-account` state (never folded into
  `error` or a fabricated balance), any other non-2xx/null-body → `error`, otherwise `ok` with the
  real account.
- **`src/lib/loyalty.test.ts`** (new) — mirrors `lib/customer-session.test.ts`'s mocking style;
  covers all five states above including the `no-account` 404 case.
- **`src/app/account/loyalty/page.tsx`** (new) — under `account/`, mirrors
  `account/wishlist/page.tsx`: signed-out redirects to `/account/login`; renders one of
  error/no-account/ok states via `StatePanel` (error, no-account) or an inline `Card` (ok) showing
  balance, tier, and recent transactions (or an honest "no activity yet" line). No interactivity
  needed (read-only), so no client component was added — kept as a plain async Server Component,
  same as `account/page.tsx` itself.
- **`src/app/account/page.tsx`** — added a `/account/loyalty` nav link alongside the existing
  `/account/wishlist` link.
- **`src/messages/en.ts` / `src/messages/ar.ts`** — added a `loyalty` dictionary block (title, nav
  link label, balance/tier labels, transactions header, empty-transactions line, error state,
  no-account state, back-to-shop) to both locales. `i18n.test.ts` (dictionary key-parity check)
  passed, confirming the two locales stayed in sync.

No customer-facing earn/spend/redeem/referral UI or routes were built — those stay
admin/system-triggered, per the brief's explicit scope boundary.

## Verification (run synchronously, full output observed)

```
pnpm --filter @platform/loyalty typecheck   → clean (tsc --noEmit, no errors)
pnpm --filter @platform/loyalty test        → 3 files passed, 16 passed | 1 skipped (17 total)
                                               (the 1 skipped is the pre-existing Prisma integration
                                               test, gated on a live DB — unrelated to this change)
pnpm --filter @platform/admin typecheck     → clean (tsc --noEmit, no errors)
pnpm --filter @platform/admin test          → 44 files passed, 334/334 tests passed
pnpm --filter storefront typecheck          → clean (tsc --noEmit, no errors)
pnpm --filter storefront lint               → clean (eslint ., no errors)
pnpm --filter storefront test               → 16 files passed, 157/157 tests passed
pnpm arch                                   → no dependency violations (1637 modules, 7476 deps)
```

All eight verification commands passed with zero failures and zero pre-existing-test regressions.

## Global constraints checked

1. `packages/*`/`services/*` never import from `apps/*` — untouched; `services/loyalty` gained one
   new internal use-case file and controller method, no new imports from `apps/*`. `pnpm arch` clean.
2. Domain aggregates never go on the wire — `PublicLoyaltyAccountDto`/`LoyaltyAccountSummary` are
   flat DTOs; the route test explicitly asserts no `props`/`_id`/`_domainEvents`/`_version` leak.
3. Never fabricate a zero-balance account — enforced by the 404 pass-through server-side and the
   distinct `no-account` state client-side; verified by a route test and a lib test.
4. Every user-facing string in both dictionaries — done; `i18n.test.ts` (key-parity) passed.
5. No `git` commands were run (this repo has no `.git` anyway).
6. No questions were asked; nothing was blocking, so nothing new was added to `BLOCKERS.md`.
7. T5.19's checkbox marked `[x]` in `docs/plans/PHASE-5-6-backlog.md`.
8. N/A (read-only) — confirmed no write routes were added.
9. The storefront calls the runtime API only from Server Components (`account/loyalty/page.tsx`) via
   `lib/loyalty.ts` → `lib/runtime-api.ts`; no client-side fetch.
10. The public route never accepts `customerRef`/`accountId` from the caller — the route's `schema`
    is `{}` (no body/params/query at all), and the route-declaration test asserts the path never
    contains `:accountId` or `:customerRef`.

## Concerns / notes for the controller

- None outstanding. This task's scope was exactly as small as the brief described — one repository
  method already existed, one controller method needed adding, one route, one page. No new
  blockers were found or needed recording.
- `docs/plans/BLOCKERS.md`'s T5.17 entry was read in full but not modified — it required no update
  for this task (its §4 already correctly predicted this task would have no repository gap, which
  held true).

## Files changed

**Backend:**
- `services/loyalty/src/application/get-account-by-customer.use-case.ts` (new)
- `services/loyalty/src/interfaces/loyalty.controller.ts` (edited)
- `services/loyalty/src/composition.ts` (edited)
- `services/loyalty/src/application/loyalty-reads.use-case.test.ts` (edited)
- `apps/admin/src/composition.ts` (edited)
- `apps/admin/src/http/public-loyalty-routes.ts` (new)
- `apps/admin/src/http/public-loyalty-routes.test.ts` (new)
- `apps/admin/src/http/admin-routes.ts` (edited)

**Frontend:**
- `apps/storefront/src/lib/runtime-api.ts` (edited)
- `apps/storefront/src/lib/loyalty.ts` (new)
- `apps/storefront/src/lib/loyalty.test.ts` (new)
- `apps/storefront/src/app/account/loyalty/page.tsx` (new)
- `apps/storefront/src/app/account/page.tsx` (edited)
- `apps/storefront/src/messages/en.ts` (edited)
- `apps/storefront/src/messages/ar.ts` (edited)

**Docs:**
- `docs/plans/PHASE-5-6-backlog.md` (checkbox marked)
