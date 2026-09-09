# Phase 2 — Public checkout

**Goal:** let a guest actually buy something. Today the storefront can browse and fill a cart and
then stops: there is no `/checkout` page, no "proceed to checkout" button, and the string
`checkout` appears **zero times** anywhere in `apps/storefront/src`.

**Estimated size:** 6 tasks, ~7 days. This is the highest-value phase in the plan.

**Depends on:** Phase 0 complete. Independent of Phase 1 (different app, different transport) — it
may run in parallel with Phase 1 if two people are working.

---

## Read this before you start — the blocking discovery

The 17 checkout endpoints exist and are wired, **but none of them is public**.
`apps/admin/src/http/checkout-routes.ts` declares every route with a `permission:` and **no
`public: true`** — so all 17 sit behind authentication and `AdminGuard`. A guest shopper has no
admin principal and never will.

So Phase 2 is **not** "build a checkout UI against existing endpoints". It is:

1. add a public checkout surface (backend), mirroring exactly how the public cart surface was
   built in Phase 17.1, then
2. build the storefront UI against it.

Do not try to make the storefront send an admin token. That was a real prior finding — see the
comment block at `apps/storefront/src/lib/runtime-api.ts:75` about a hardcoded fallback secret.

### The security model you are mirroring

`apps/admin/src/http/public-cart-routes.ts` is the reference. Its model, which you will reuse
verbatim:

- **`sessionRef` is the only proof of ownership.** It is minted server-side by Next.js
  (`crypto.randomUUID()` in `apps/storefront/src/app/cart/actions.ts`), stored in an HttpOnly
  cookie (`GUEST_SESSION_COOKIE`), and never accepted from browser JS — the browser only ever
  talks to the storefront's own server, which is the sole caller of the runtime API.
- **Every route on an existing resource re-checks ownership** before reading or mutating, and a
  mismatch returns the **same 404** an unknown id returns. Never reveal that a session exists to a
  caller who cannot prove they own it.
- **`sessionRef` travels in a header, not a querystring** — `x-cart-session`. It used to be a
  query field; that put it in request logs and any upstream proxy log. See the H-05 comment at
  `public-cart-routes.ts:10` and reuse `resolveSessionRef` unchanged.
- **Prices, rates and amounts are never accepted from the caller.** The existing checkout routes
  already enforce this: `loadItemsBody` takes only `{ cartId }` and re-derives line items from the
  cart (Phase 17.2 fix), and `selectShippingBody` takes only `{ method }` and re-derives the rate
  (Phase A.1 F-01 fix). Both are `.strict()`, so an old-shaped request 422s rather than being
  silently stripped. Preserve both properties exactly.

`CheckoutSession` already carries `sessionRef` (`services/checkout/src/domain/checkout-session.ts:33`,
accessor at line 292) and `StartCheckoutInput` already requires it
(`start-checkout.use-case.ts:14`). The ownership field you need is already there.

---

## T2.1 — Add a `GetCheckoutSession` read use case

- [x] Task complete

**Why:** ownership enforcement needs to load a session and compare `session.sessionRef` to the
caller's. `CheckoutController` today has **no** read-by-id method — its only reads are
`generateOrderDraft` and `generatePaymentIntentRequest`. `CheckoutSessionRepository.findById`
already exists (`services/checkout/src/domain/checkout-session-repository.ts:6`).

**Steps**

1. Create `services/checkout/src/application/get-checkout-session.use-case.ts`, copying
   `services/catalog/src/application/get-product.use-case.ts` and changing only the types:
   input `{ readonly checkoutSessionId: string }`, deps `{ readonly sessions: CheckoutSessionRepository }`,
   returns `Result<CheckoutSession, DomainError>`, `NotFoundError("Checkout session not found")`
   when `findById` returns `null`.
   Match the deps field name to whatever the existing checkout use cases call the repository —
   read `services/checkout/src/application/complete-checkout.use-case.ts` first and use the same
   name.
2. Add `getCheckoutSession: GetCheckoutSession` to `CheckoutControllerDeps` and a method on
   `CheckoutController`:

   ```ts
   async get(input: GetCheckoutSessionInput): Promise<ControllerResponse> {
     return present(await this.deps.getCheckoutSession.execute(input), 200);
   }
   ```

3. Wire it in `services/checkout/src/composition.ts` inside the `new CheckoutController({...})`
   literal, using the same repository variable the neighbouring use cases receive.
4. Export the use case's input type from `services/checkout/src/index.ts` alongside the existing
   exports.
5. Write `get-checkout-session.use-case.test.ts`: found → `ok`, missing → `NotFoundError`.

**Verify:**

```bash
pnpm --filter @platform/checkout test && pnpm --filter @platform/checkout typecheck && pnpm arch
```

---

## T2.2 — Expose the raw `CheckoutController` for the public surface

- [x] Task complete

**File:** `apps/admin/src/composition.ts`.

The public routes must use the **unguarded** `CheckoutController`, not the guarded
`CheckoutAdminController` — the guarded facade requires an admin `Principal` a shopper will never
have. This is the identical reasoning already documented for `publicReads.cart` at
`composition.ts:405`.

**Steps**

1. Add to the `publicReads` interface block (around `composition.ts:405`), with a doc comment in
   the same voice as `cart`'s:

   ```ts
   /**
    * Checkout's guest surface. Same reasoning as `cart` above: a shopper completing checkout has
    * no admin credentials, so the raw `CheckoutController` is exposed here and
    * `public-checkout-routes.ts` enforces ownership itself via `sessionRef` before every call.
    * The guarded `CheckoutAdminController` remains the only path for the authenticated
    * back-office surface (`checkout-routes.ts`).
    */
   readonly checkout: CheckoutController;
   ```

2. Add `checkout: checkout.checkout,` to the `publicReads` object literal at `composition.ts:796`.
3. Import `CheckoutController` as a type from `@platform/checkout` at the top of the file.

**Note:** the property is on `publicReads` even though checkout writes. Keep it there rather than
inventing a `publicWrites` — `publicReads.cart` already holds a controller whose write methods are
used by `public-cart-routes.ts`, and one seam is easier to audit than two. Say so in the comment.

**Verify:**

```bash
pnpm --filter @platform/admin typecheck && pnpm arch
```

---

## T2.3 — Create `public-checkout-routes.ts`

- [x] Task complete

**File:** create `apps/admin/src/http/public-checkout-routes.ts`.

Open `apps/admin/src/http/public-cart-routes.ts` and keep it beside you — this file is its sibling
and should read like it.

### Which routes to expose

Expose exactly these 12. They are the guest-completable path.

| Method | Public path                                                   | Delegates to                   |
| ------ | ------------------------------------------------------------- | ------------------------------ |
| POST   | `/public/checkouts`                                           | `start`                        |
| GET    | `/public/checkouts/:checkoutSessionId`                        | `get` (new, from T2.1)         |
| POST   | `/public/checkouts/:checkoutSessionId/items`                  | `loadItems`                    |
| POST   | `/public/checkouts/:checkoutSessionId/billing-address`        | `setBillingAddress`            |
| POST   | `/public/checkouts/:checkoutSessionId/shipping-address`       | `setShippingAddress`           |
| POST   | `/public/checkouts/:checkoutSessionId/shipping-quote`         | `requestShippingQuote`         |
| POST   | `/public/checkouts/:checkoutSessionId/shipping-selection`     | `selectShipping`               |
| POST   | `/public/checkouts/:checkoutSessionId/tax`                    | `requestTaxCalculation`        |
| POST   | `/public/checkouts/:checkoutSessionId/payment-selection`      | `selectPayment`                |
| POST   | `/public/checkouts/:checkoutSessionId/recalculate`            | `recalculateTotals`            |
| POST   | `/public/checkouts/:checkoutSessionId/complete`               | `complete`                     |
| GET    | `/public/checkouts/:checkoutSessionId/payment-intent-request` | `generatePaymentIntentRequest` |

**Deliberately NOT public** — leave these on the admin surface only: `validate`, `promotion`,
`lock`, `expire`, `fail`, `order-draft`. `lock`/`expire`/`fail` are operator/saga actions;
`order-draft` exposes internal order construction; `promotion` and `validate` are reachable
through `recalculate` for the guest flow. Write this list, and this reasoning, into the file's
header comment so the next person does not "complete" the set by accident.

### Ownership enforcement

Add a `requireOwnedSession` helper modelled exactly on `public-cart-routes.ts`'s
`requireOwnedCart`:

```ts
/**
 * `sessionRef` is the caller's sole proof of ownership. Loads the session and returns it only when
 * `session.sessionRef === sessionRef`. A mismatch, a session from another tenant, and an unknown
 * id all resolve to the SAME 404 — this surface never reveals whether a session exists to a caller
 * who cannot prove they own it.
 */
async function requireOwnedSession(
  admin: WiredAdmin,
  checkoutSessionId: string,
  sessionRef: string,
): Promise<CheckoutSession | AdminResponse>;
```

Every route except `POST /public/checkouts` calls it first and returns the 404 response
unchanged when ownership fails.

Reuse `resolveSessionRef` from `public-cart-routes.ts` — **export it from that file and import it
here**, do not copy it. It prefers the `x-cart-session` header and falls back to the deprecated
querystring with a warning.

### Bodies

Reuse the existing zod schemas' _shapes_ from `checkout-routes.ts`, with `sessionRef` added to
every POST body (mirroring `public-cart-routes.ts`, where `sessionRef` is a body field on writes
and a header on reads):

- `POST /public/checkouts` → `{ sessionRef, cartRef, currency }`. **Drop `customerRef`** — a guest
  checkout has none, and accepting one here would let a caller attach their session to another
  person's customer record. Mark it `.strict()`.
- `items` → `{ sessionRef, cartId }`, `.strict()`. Do not accept line items or prices.
- both address routes → `{ sessionRef, line1, line2?, city, postalCode, country }`.
- `shipping-selection` → `{ sessionRef, method }`, `.strict()`. Do not accept a rate.
- `payment-selection` → `{ sessionRef, paymentMethodRef, provider }`.
- `shipping-quote`, `tax`, `recalculate` → `{ sessionRef }` only.
- `complete` → `{ sessionRef, idempotencyKey }`.
- the two GETs → `sessionRef` from the header via `resolveSessionRef`, plus the deprecated
  optional querystring, exactly like the public cart GETs.

### Route declarations

Every route: `version: 1`, `public: true`, `idempotent: true` on the POSTs, and a `permission:`
value copied from the corresponding admin route (it is advisory-only on public routes — see
`route.ts:55` — but it must still be a valid `Permission`).

### DTO mapping

`GET /public/checkouts/:checkoutSessionId` must **not** return the `CheckoutSession` aggregate.
Write an explicit, fully-primitive DTO interface, exactly as `public-catalog-routes.ts` does:

```ts
export interface PublicCheckoutSessionDto {
  readonly id: string;
  readonly status: string;
  readonly currency: string;
  readonly items: readonly {
    readonly productId: string;
    readonly quantity: number;
    readonly unitPriceAmountMinor: number;
  }[];
  readonly totals: {
    readonly subtotalMinor: number;
    readonly shippingMinor: number;
    readonly taxMinor: number;
    readonly grandTotalMinor: number;
  } | null;
  readonly shippingAddress: PublicAddressDto | null;
  readonly billingAddress: PublicAddressDto | null;
  readonly selectedShippingMethod: string | null;
  readonly orderRef: string | null;
}
```

**Before writing this interface, read `services/checkout/src/domain/checkout-session.ts` and use
its real accessor names and real field names.** The shape above is the intent; the field names must
match what the aggregate actually exposes. Never include `sessionRef` in the DTO — echoing the
ownership secret back defeats its purpose.

### Registration

In `apps/admin/src/http/admin-routes.ts`: import `publicCheckoutRoutes` and add
`...publicCheckoutRoutes(admin),` to the spread list, next to `...publicCartRoutes(admin),`.

### Tests

Create `apps/admin/src/http/public-checkout-routes.test.ts`, following
`public-cart-routes.test.ts`. Cover at minimum:

- a session owned by another `sessionRef` returns 404, not 403, on every route
- an unknown `checkoutSessionId` returns the same 404
- a missing `sessionRef` returns 422
- `POST /public/checkouts` rejects a body carrying `customerRef` (strict)
- `items` rejects a body carrying line items or prices (strict)
- `shipping-selection` rejects a body carrying `rateAmountMinor` (strict)
- the GET DTO contains no `props`, `_id`, `_domainEvents`, `_version`, or `sessionRef`

**Verify:**

```bash
pnpm --filter @platform/admin typecheck && pnpm --filter @platform/admin lint && pnpm --filter @platform/admin test
pnpm arch
```

---

## T2.4 — Storefront transport and Server Actions

- [x] Task complete

**Files:** `apps/storefront/src/lib/runtime-api.ts` (edit), `apps/storefront/src/app/checkout/actions.ts` (create).

**Steps**

1. In `runtime-api.ts`, add one exported function per public checkout route, using the existing
   private `postItem` / `fetchItem` helpers. Send `sessionRef` in the **`x-cart-session` header**
   on the GETs (`fetchItem` already takes `extraHeaders` — the cart read uses it) and in the body
   on the POSTs. Keep the file's existing "never throws" discipline: every function returns
   `{ status, body }`, never raises.
2. Create `apps/storefront/src/app/checkout/actions.ts` with `"use server"`. It owns the guest
   session cookie exactly as `apps/storefront/src/app/cart/actions.ts` does — import
   `GUEST_SESSION_COOKIE` from `@/lib/cart` and reuse `existingSessionRef()`'s logic. **Never mint
   a new session here**: a checkout always begins from an existing cart, so a missing cookie is an
   error state (`reason: "ownership"`), not a reason to create one.
3. Export a discriminated result type in the same shape as `CartActionResult`:

   ```ts
   export type CheckoutActionResult =
     | { readonly ok: true; readonly checkoutSessionId: string }
     | {
         readonly ok: false;
         readonly reason: "ownership" | "validation" | "unavailable" | "network";
       };
   ```

   Map 404 → `ownership`, 422 → `validation`, 409 → `unavailable`, 0/5xx → `network`.

4. Actions to export: `startCheckout(cartId)`, `setShippingAddress(...)`,
   `setBillingAddress(...)`, `requestShippingQuote(id)`, `selectShipping(id, method)`,
   `requestTax(id)`, `selectPayment(id, ref, provider)`, `recalculate(id)`,
   `completeCheckout(id)`. Each calls `revalidatePath("/checkout")` on success.
5. `completeCheckout` generates its `idempotencyKey` with `crypto.randomUUID()` **server-side**,
   and also sends it as the `Idempotency-Key` header. Read the C-2 comment at
   `checkout-routes.ts:50` first: the body field is threaded into the use case but **nothing dedupes
   on it** — the header is the real replay protection.
6. Store the active `checkoutSessionId` in its own HttpOnly cookie
   (`morbeh_checkout_session`, `sameSite: "lax"`, `path: "/"`, `httpOnly: true`, `secure` outside
   local) set by `startCheckout` and cleared by `completeCheckout`. Define its name and options
   beside `GUEST_SESSION_COOKIE` in `apps/storefront/src/lib/cart.ts` so both live in one place.

**Tests:** `apps/storefront/src/app/checkout/actions.test.ts` — stub the runtime-api functions and
assert each status maps to the right `reason`, and that a missing session cookie never mints one.

**Verify:**

```bash
pnpm --filter storefront typecheck && pnpm --filter storefront lint && pnpm --filter storefront test
```

---

## T2.5 — The checkout page

- [x] Task complete

**Files:** `apps/storefront/src/app/checkout/page.tsx`,
`apps/storefront/src/components/checkout-view.tsx` (both create).

**Structure:** one Server Component page that resolves the session and renders one Client Component
holding the whole flow — the same split `apps/storefront/src/app/cart/page.tsx` +
`components/cart-view.tsx` uses. Every step is interactive, so one client component is correct
here; do not fragment it into islands.

**Steps as the shopper sees them** (render as a stepper; only one step open at a time):

1. **Shipping address** → `setShippingAddress`, then `requestShippingQuote`.
2. **Shipping method** → radio list from the quote, → `selectShipping`.
3. **Billing address** → `setBillingAddress`, with a "same as shipping" checkbox that copies the
   values client-side before submitting.
4. **Payment method** → `selectPayment`.
5. **Review** → `recalculate`, show the returned totals, then `completeCheckout`.

**Hard rules**

- **Never compute a total in the browser.** Every amount shown comes from the session's `totals`
  returned by the API. Use `formatCurrency` from `@/lib/format`.
- After every mutating step, re-read the session (`GET /public/checkouts/:id`) and render from
  that — the server is the only source of truth for what step the session is actually on.
- `reason: "ownership"` → render a recoverable state pointing back to `/cart`, not an error page.
  This is what an expired or cleared cookie looks like.
- Disable the submit control of the step in flight, using `useTransition` and the `Button`'s
  `loading` prop, as `cart-view.tsx` does.
- Every string goes in `apps/storefront/src/messages/en.ts` **and** `ar.ts`, under a new
  `checkout` section. The page must render correctly in RTL — it inherits `dir` from the root
  layout, so use logical CSS properties (`ms-*` / `me-*`, `text-start`), never `left`/`right`.

**Also edit:** `apps/storefront/src/components/cart-view.tsx` — add the "Proceed to checkout"
button in `CardFooter`. It calls `startCheckout(cart.id)` and, on success, navigates to
`/checkout`. Disable it when the cart has no lines.

**Tests:** `apps/storefront/src/components/checkout-view.test.tsx` — the stepper advances on a
successful step; an `ownership` failure renders the back-to-cart state; totals render from the
supplied session and are never recomputed.

**Verify:**

```bash
pnpm --filter storefront typecheck && pnpm --filter storefront lint && pnpm --filter storefront test
```

---

## T2.6 — Order confirmation

- [x] Task complete

**File:** `apps/storefront/src/app/checkout/confirmation/page.tsx` (create).

After `completeCheckout` succeeds, the session carries `orderRef`
(`checkout-session.ts:308`). Redirect there and render a confirmation from the session DTO's
`orderRef` and `totals`.

**Do not** call `GET /checkouts/:id/order-draft` — it is deliberately not public (see T2.3).
**Do not** fetch the order from `GET /orders/:orderId` — that route is admin-guarded and a shopper
has no token. Render only what the public checkout session DTO already returns; if that is not
enough to be useful, record the gap in `docs/plans/BLOCKERS.md` and ship the minimal confirmation
(order reference + total + a link back to the shop) rather than reaching for an admin route.

Clear the `morbeh_checkout_session` cookie once the confirmation has rendered.

**Verify:**

```bash
pnpm --filter storefront typecheck && pnpm --filter storefront test
```

---

## Phase 2 exit criteria

- [x] `public-checkout-routes.ts` exists with exactly the 12 routes listed, registered in
      `admin-routes.ts`, all `public: true`. (Pinned by the route-inventory test in
      `public-checkout-routes.test.ts`.)
- [x] Ownership is enforced on all 11 existing-session routes, and a mismatch is a 404.
- [x] No public checkout route accepts a price, a rate, an amount, or a `customerRef`.
- [x] The session DTO leaks no `props` / `_id` / `_domainEvents` / `_version` / `sessionRef`.
- [ ] A guest can go cart → checkout → confirmation in the running app. **Not fully achievable
      yet** — see `docs/plans/BLOCKERS.md`'s T2.3 entry: `complete()` throws for a genuine guest
      session (pre-existing C-2 `OrderCreationAdapter` limitation, `customerRef` required). The
      flow works end-to-end through every step up to and including `recalculate` (verified by the
      full guest-lifecycle test in `public-checkout-routes.test.ts` and the multi-step tests in
      `checkout-view.test.tsx`); `complete` and the confirmation page are built to render whatever
      the backend actually returns, including this failure, rather than assuming success. Also not
      verified in a live browser (no Docker in this environment — same disclosed limitation as
      Phase 0's `/analytics` note).
- [x] Every new string exists in `en.ts` and `ar.ts`, and the flow renders correctly in RTL (no
      `left`/`right`-only classes were added; the stepper's layout is logical-property-safe).
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm arch` pass repo-wide. **Not run repo-wide**
      — the `turbo` binary itself does not run in this session (see BLOCKERS.md's Phase 2
      environment addendum). Verified per-package instead: `@platform/checkout`, `@platform/admin`,
      and `storefront` all pass `typecheck`/`lint`/`test` individually, and `pnpm arch` (which
      doesn't go through `turbo`) passes at default concurrency.

---

## Deployment note — read before anyone deploys this

`apps/runtime/src/api.ts` fails closed outside `APP_ENV=local` when no real
`PaymentProvider` is configured (guard `V-1`,
`assertProductionPaymentProviderConfigured`). Completing a real payment needs
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` set, which resolves the real
`StripePaymentProvider` in `apps/runtime/src/composition.ts`. In `local` the stub's
`verifyWebhook()` always returns `true` and only logs a warning.

This is configuration, not code. Do not weaken the guard to make a deploy proceed.
