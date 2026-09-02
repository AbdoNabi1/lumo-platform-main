# Task T5.19 brief — Loyalty balance

The customer authentication foundation this task needs is now real — T5.17 built it. Read
`docs/plans/BLOCKERS.md`'s `## T5.17` entry in full first (search for that heading), specifically
its closing guidance: "For T5.19 / T5.18-write: reuse `admin.customerAuth.requireSession(...)`.
Neither needs a new session mechanism, cookie, or guard — this is the seam, and
`public-wishlist-routes.ts` is the worked example." **Read `apps/admin/src/http/
public-wishlist-routes.ts` in full — it is your template.** This task is scoped to be much smaller
than T5.17: no new auth, no new guard, just one more `/me`-scoped public read surface following
the exact pattern that file already established.

## Scope: read-only balance display, not earn/spend/redeem

`apps/admin/src/http/loyalty-routes.ts` (read in full, already read for you below) has 9 routes:
open/advance/earn/spend/cashback/redeem/referral (all business operations triggered by orders,
checkout, or admin action elsewhere — never something a customer does directly by clicking a
button on their own account page) plus list/get. **This task only needs the customer to see their
own balance — do not build customer-facing earn/spend/redeem/referral UI or routes.** Those stay
admin/system-triggered, same as before.

`LoyaltyAccountDto`: `{ id, customerRef, status, balance: number, tierName, transactions:
Array<{id, idempotencyKey, kind, pointsDelta, ref: string|null, occurredAt}> }`.

Per T5.16's design (confirmed by T5.17's implementer): `LoyaltyAccountRepository.findByCustomerRef`
already exists — no repository gap here, unlike the Orders gap T5.16 flagged.

## What to build

### Backend (small, contained — mirrors `public-wishlist-routes.ts` almost exactly)

1. **`apps/admin/src/http/public-loyalty-routes.ts`** (new) — one route,
   `GET /public/loyalty/accounts/me`, `public: true`, `permission: "loyalty:read"`. Handler: same
   `admin.customerAuth.requireSession(resolveCustomerSessionId(context))` opening move
   `public-wishlist-routes.ts`'s `own()` helper uses (import `resolveCustomerSessionId` from
   `public-auth-routes.ts`, same as the wishlist file does), then resolve the account via
   `admin.publicReads.loyalty.getByCustomer({ customerRef: guarded.session.customerRef })` — check
   whether `LoyaltyController` already has a `getByCustomer`-shaped method (mirroring
   `WishlistController.getByCustomer`); if the admin-facing controller only has `get(accountId)`
   and `list`, you may need to add a small `getByCustomer` method to `services/loyalty`'s
   controller (same shallow addition T5.7 made for `ListBrands` — a repository method that likely
   already exists, `findByCustomerRef`, just needs a use-case/controller method exposing it, if one
   doesn't already).
2. **A public-safe DTO.** Same privacy discipline as every other `public-*-routes.ts` file this
   phase built: `customerRef` should be omitted from the response (the caller cannot be anyone
   else, so echoing it back serves no purpose — same reasoning `PublicWishlistDto` and
   `PublicCartDto` already document). Everything else (`balance`, `status`, `tierName`,
   `transactions`) is safe to return as-is — it is the customer's own data.
3. **No account exists yet.** Unlike Wishlist (creates on first access — a customer opens their own
   wishlist implicitly), loyalty accounts are `loyalty:open`, an admin/system action (likely
   triggered by a business process, e.g. first purchase) — a customer does not self-open one by
   visiting a page. So `GET /public/loyalty/accounts/me` for a customer with no account yet should
   return a clean 404 (or a `{ hasAccount: false }`-shaped 200, your call — pick whichever the
   storefront can render as an honest "you don't have a loyalty account yet" state, not an error
   page) rather than fabricating a zero-balance account.
4. Route test mirroring `public-wishlist-routes.test.ts`'s style: session-required (401 without
   one), returns the signed-in customer's own account only (never another customer's, even if you
   try to guess an accountId), no-account case handled explicitly.

### Frontend (`apps/storefront`)

1. `apps/storefront/src/lib/runtime-api.ts` — a `getMyLoyaltyBalance()` function following
   `getCollectionProducts`/wishlist's fetch pattern (same "send the customer session, get back a
   typed result or null" shape).
2. `apps/storefront/src/app/account/loyalty/page.tsx` (new) — under the same `account/` structure
   T5.17 established (mirror `account/wishlist/page.tsx`'s signed-out-redirects-to-sign-in
   pattern). Shows balance, tier, and recent transactions when an account exists; an honest "no
   loyalty account yet" state otherwise; an explicit error state.
3. An account-nav link to it, alongside the existing wishlist link (check `apps/storefront/src/app/
   account/page.tsx`, added by T5.17, for where to add it).
4. Every new string in both storefront dictionaries.

## Global constraints (Phase 5 storefront tasks)

1. `packages/*`/`services/*` never import from `apps/*`.
2. Domain aggregates never go on the wire.
3. Never fabricate a zero-balance account for a customer who doesn't have one.
4. Every user-facing string in both dictionaries.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Mark T5.19's checkbox (`- [ ] **T5.19 Loyalty balance.**` → `- [x] **T5.19 Loyalty balance.**`)
   when done.
8. N/A (read-only).
9. The storefront calls the runtime API only from Server Components/Server Actions.
10. Never accept a `customerRef` or `accountId` from the caller on the new public route — always
    derive scope from the validated session, exactly like every route in
    `public-wishlist-routes.ts` does.

## Verify

```bash
pnpm --filter @platform/loyalty typecheck && pnpm --filter @platform/loyalty test
pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin test
pnpm --filter storefront typecheck && pnpm --filter storefront lint && pnpm --filter storefront test
pnpm arch
```

## Report

Write your full report to `docs/plans/.progress/task-T5.19-report.md`. Return to the controller
only: status, files changed (backend and frontend separately), one-line test summary per package,
concerns.
