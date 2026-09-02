# T5.17 report — Customer auth foundation (Part A) + Wishlist (Part B)

## BOTH PARTS LANDED

**Part A (the customer authentication foundation T5.16 designed) and Part B (Wishlist built on top
of it) are both complete and verified.** `T5.17`'s checkbox in `PHASE-5-6-backlog.md` is ticked.

Part B was not rushed onto a shaky foundation: Part A was built first and verified green at every
layer (`services/security` → `services/cart` → `apps/admin` → `apps/storefront` → `pnpm arch`)
*before* any wishlist code was written. Part B's route tests establish their sessions by calling
Part A's own `/public/auth/register` + `/public/auth/login` routes against real compositions — so
the wishlist tests are simultaneously the end-to-end proof that the auth foundation works.

Four gaps were found while implementing and are recorded in full in `docs/plans/BLOCKERS.md`'s new
`## T5.17` entry. None blocked delivery; each was worked around honestly rather than papered over.

---

## Part A — what was built

### The core problem T5.16 left unsolved

T5.16's design is sound but stops one hop short. `IntrospectSession` returns
`SessionOutput.principalRef`, which is the Security-**internal** `Principal.id` — not an Identity id.
So a caller that introspected a session still could not say *whose* data that session may read, and
`PrincipalRepository.findById` was not reachable from any use case or controller. That last hop is
the entire foundation, so it was built first.

**`IntrospectSessionSubject`** (`services/security/src/application/session.use-cases.ts`) closes it:
`sessions.findById` → `principals.findById(session.principalRef)` → `principal.subjectRef`, returning
flat primitives only (never the `Session`/`Principal` aggregates). It is uniformly fail-closed —
unknown session, expired, revoked, missing principal, suspended/disabled principal, or a **non-human**
principal (a service account must never resolve to a customer identity) all return the identical
inactive answer, and always with a 200. One indistinguishable answer means the endpoint cannot be
used as an oracle to probe which sessions, principals, or customers exist.

### `CustomerGuard` — deliberately not a variant of `AdminGuard`

`apps/admin/src/interfaces/customer-guard.ts`. `AdminGuard` answers "may this principal perform this
permission?" — an ABAC decision against a permission grid, audited per call. A customer request has
no such question: there is exactly one thing to authorize, "is this the session's own `customerRef`",
which handlers enforce *structurally* by only ever using the guard-derived value. So `CustomerGuard`
takes no `Permission`, consults no `AccessControl`, and writes no per-request authorization audit.

Routing a shopper through `AdminGuard` would have meant fabricating a `Principal` — the exact
anti-pattern `public-reviews-routes.ts` and `public-catalog-routes.ts` document (silently allows
everything under `AllowAllAccessControl`, silently denies everything under Keto). This guard is a
different kind of thing: it validates a **real** session.

It resolves three hops on every request: session → `Principal` → Identity `Customer`. The third hop
is not ceremony — `subjectRef` is only a *reference*, and Security never learns a customer was
deleted, so without it a session could keep resolving to a `customerRef` whose `Customer` is gone.
Every failure returns one shared 401. Notably there is **no empty-result branch**: per T5.16 §3, an
unauthenticated caller gets a 401, never an empty list, because an empty list asserts "you have zero
of these" — false for someone who is not signed in.

### Principal provisioning — chosen placement, and why

T5.16 offered two options. The brief asked for whichever is less invasive to Identity's registration
flow. **Chosen: orchestrate in `CustomerAuthAdminController.register()`**, which changes
`services/identity` by exactly zero lines. Identity keeps owning the customer profile and stays
unaware Security exists — the ownership boundary ADR-0023 froze. A `CustomerRegistrationPort` inside
`RegisterCustomer` would have inverted that, making *every* customer registration anywhere (including
the admin console's) depend on Security being wired.

T5.16's other suggestion — provisioning lazily on first authentication — **does not work at all**:
`Authenticate` resolves the principal *during* login and fails closed when there is none, so the
principal must exist before the first login attempt, not after it.

Registration performs four steps in order: Identity `RegisterCustomer` (the transactional step and
the email-uniqueness authority) → `registerSubject` → Security `RegisterPrincipal` (`kind: "human"`,
`subjectRef: customerId`) → `setPassword`. The ordering is load-bearing and tested: a **rejected
duplicate registration must not overwrite the existing account's credential**, which would otherwise
be a trivial account takeover (re-register someone's email with a password of your choosing).

### Everything else in Part A

- **`CustomerAuthAdminController`** — thin orchestrator over Security's existing use cases. Nothing
  in it verifies a credential, scores risk, decides MFA, mints a session, or stores a password.
  Three rules it owns: a failed login is one indistinguishable answer (`AuthenticationOutcome.reason`
  distinguishes "no such account" from "bad password" internally and is never forwarded);
  `customerRef` is never accepted as input and never echoed from input — on login it is read back out
  of the freshly established session via the same introspection hop every later request uses; and
  registration provisions the principal synchronously.
- **`POST /public/auth/{register,login,logout,refresh,logout-all}`, `GET /public/auth/me`,
  `POST /public/auth/claim-cart`** (`apps/admin/src/http/public-auth-routes.ts`). `public: true`
  means only that the *admin* Bearer/RBAC pipeline does not apply — five of the seven run
  `CustomerGuard`. `/login` and `/refresh` are deliberately **not** `idempotent`: replaying a cached
  login would hand a second caller presenting the same `Idempotency-Key` the *first* caller's session
  id, and replaying a refresh would report a rotation that never happened. Every other write route
  is idempotent. Session ids travel in the `x-customer-session` header, never a query string (the
  same H-05 reasoning that moved `sessionRef` out of the cart routes' query string); passwords are
  POST bodies only.
- **`CUSTOMER_SESSION_COOKIE`** (`apps/storefront/src/lib/customer-session.ts`) — a third, distinct
  cookie, `HttpOnly`/`Secure`-in-prod/`SameSite: lax`, carrying only the opaque `Session.id`. One
  hour, not the cart's thirty days, kept in step with the backend's `CUSTOMER_SESSION_TTL_SECONDS` so
  cookie and session expire together. Opacity is what makes revocation immediate.
- **`AssignCartCustomer`** (`services/cart`) — `Cart.assignCustomer` existed and was tested since
  Sprint 4.5 but had **no use case wrapping it**, so no transport could reach it. The new use case
  adds the login-flow semantics the aggregate cannot express: re-login by the same customer is an
  idempotent no-op, while a cross-customer re-assignment is still refused (409).
- **Storefront**: `/account`, `/account/login`, `/account/register`, sign-out and sign-out-everywhere
  actions, `AuthForm`, `SignOutButton`, an account link in the site header, all strings in both
  dictionaries. Every mutation is a Server Action; the cookie is written in exactly one file.

### Deliberate deviation from T5.16 §2

The design said to clear `GUEST_SESSION_COOKIE` after folding the guest cart into the account. **It is
kept.** `CartRepository` has no `findByCustomerRef`, so `sessionRef` remains the only key that
resolves "my current cart" — clearing it would strand the just-claimed cart and silently empty the
shopper's cart on login, the exact data loss the promotion exists to prevent. Documented in code and
in BLOCKERS gap 2, with the fix that unblocks the design as written.

---

## Part B — Wishlist

`apps/admin/src/http/public-wishlist-routes.ts` follows T5.18's precedent exactly: extend
`admin.publicReads` with the unguarded `WishlistController` rather than routing through the guarded
`WishlistAdminController`. But unlike Reviews' display surface, **nothing here is anonymous** — every
route runs `requireSession` first.

The one rule the file exists to enforce: **no route accepts a `customerRef` — and none accepts a
`wishlistId` either.** `wishlist-routes.ts` takes both from the request because an operator
legitimately acts for any customer; here that would be a horizontal-privilege-escalation hole. Every
route is `/me`-scoped and re-resolves the wishlist from the session's `customerRef` via
`findByCustomerRef` on each request, so there is no id to tamper with and no ownership check that
could be forgotten. A customer has at most one wishlist, which is what makes this possible.

Routes: `GET /public/wishlists/me` (creates on first access — an account that never used the feature
is not an error state), `POST .../items`, `.../items/remove`, `.../items/share`,
`.../items/move-to-cart`. Remove and share use `createIfMissing: false` — only reads and adds bring a
wishlist into being.

**Move-to-cart deliberately does not call `MoveWishlistItemToCart`.** That use case reaches Cart
through `CartPort`, which the admin composition leaves as `InMemoryCartPort` — a stub that pushes
onto an in-process array and touches no cart. Routing through it would remove the item from the
wishlist and add nothing anywhere: the shopper would watch an item vanish while their cart stayed
empty, with the API reporting success. The route composes the two real operations instead, in the
safe order — resolve the price server-side (H-01), add to the real cart, and only then remove from
the wishlist, so a failure leaves the item where it was.

Storefront: `/account/wishlist` with four distinct states (signed-out redirects to sign-in rather
than rendering an empty list), `WishlistView` with per-line remove/move/share, and an
`AddToWishlistButton` on the product detail page rendered **only** when a real server-side session
check succeeds — a wishlist has no `customerRef` to be scoped to for a guest, so the control is
absent rather than present-and-failing. It was put on the detail page rather than `ProductCard`
because a card renders in grids, which would cost a session lookup per page render for a control most
visitors cannot use.

Share tokens are minted and displayed as a "share reference" with an explicit note that share links
cannot be opened yet — the Wishlist context has **no** token-resolution capability at all (BLOCKERS
gap 1), and rendering a link that 404s would be a fabricated affordance.

---

## Files changed

### `services/security`
- `src/application/session.use-cases.ts` — added `IntrospectSessionSubject` + `SessionSubject`.
- `src/application/session-subject.use-cases.test.ts` — **new**, 11 tests.
- `src/interfaces/security.controller.ts` — added `introspectSessionSubject`.
- `src/composition.ts`, `src/index.ts` — wiring + type exports.

### `services/cart`
- `src/application/assign-cart-customer.use-case.ts` — **new**.
- `src/application/assign-cart-customer.use-case.test.ts` — **new**, 5 tests.
- `src/interfaces/cart.controller.ts`, `src/composition.ts` — wiring.

### `services/identity`
- **Unchanged** (deliberately — see "Principal provisioning" above).

### `apps/admin`
- `src/interfaces/customer-guard.ts` — **new**.
- `src/interfaces/customer-auth.admin-controller.ts` — **new**.
- `src/interfaces/customer-credentials.port.ts` — **new**.
- `src/http/public-auth-routes.ts` — **new** (7 routes).
- `src/http/public-auth-routes.test.ts` — **new**, 37 tests.
- `src/http/public-wishlist-routes.ts` — **new** (5 routes).
- `src/http/public-wishlist-routes.test.ts` — **new**, 23 tests.
- `src/http/admin-routes.ts` — registered both route modules.
- `src/composition.ts` — `customerAuth` controller, `CustomerGuard`, the credentials adapter,
  `CUSTOMER_SESSION_TTL_SECONDS`, and `publicReads.{security,customers,wishlist}`.

### `apps/storefront`
- `src/lib/customer-session.ts`, `src/lib/wishlist.ts` — **new** (+ both `.test.ts`, 16 tests).
- `src/lib/runtime-api.ts` — auth + wishlist transports.
- `src/app/account/{actions.ts,page.tsx}`, `src/app/account/login/page.tsx`,
  `src/app/account/register/page.tsx` — **new** (+ `actions.test.ts`, 15 tests).
- `src/app/account/wishlist/{actions.ts,page.tsx}` — **new** (+ `actions.test.ts`, 13 tests).
- `src/components/{auth-form,sign-out-button,wishlist-view,add-to-wishlist-button}.tsx` — **new**.
- `src/components/site-header.tsx`, `src/app/products/[slug]/page.tsx` — account link, wishlist
  affordance.
- `src/messages/{en,ar}.ts` — every new string in both dictionaries.

### `docs/plans`
- `BLOCKERS.md` — new `## T5.17` entry (4 gaps + the config decision T5.16 left open).
- `PHASE-5-6-backlog.md` — T5.17 ticked.

---

## Verification

All commands run from the repo root; each layer was verified before the next was built on it.

| Package | Result |
| --- | --- |
| `@platform/security` | typecheck clean; **112 passed**, 6 skipped (11 new) |
| `@platform/identity` | typecheck clean; **37 passed**, 41 skipped (unchanged) |
| `@platform/cart` | typecheck clean; **49 passed**, 2 skipped (5 new) |
| `@platform/wishlist` | typecheck clean; **18 passed**, 1 skipped (unchanged) |
| `@platform/admin` | typecheck clean; **326 passed** (60 new) |
| `storefront` | typecheck + lint clean; **151 passed** (44 new) |
| `pnpm arch` | **no dependency violations** (1636 modules, 7469 dependencies) |
| `@platform/runtime` (regression) | typecheck clean; **213 passed** |
| `admin-web` (regression) | typecheck clean (untouched) |

The last two were checked because `SecurityControllerDeps` gained a required field; both consume
`SecurityController` and neither broke.

---

## Concerns

1. **Customer credentials are not durable** (BLOCKERS gap 4). `InMemoryPasswordAuthProvider` is the
   only `"password"` provider `wireSecurity` registers, and it holds accounts in process memory —
   they do not survive a restart or span replicas. This is pre-existing (it already backed the admin
   console's authenticate route) and reusing it was the correct reading of constraint 10 ("reuse the
   machinery, do not reimplement password hashing/storage"), but customer login now depends on it.
   `wireSecurity` also has no `deps.authProviders` seam, so a real provider cannot be injected today.
   **This is the single most important follow-up before this feature is production-real.**
2. **The guest cookie is not cleared on login**, deviating from T5.16 §2 — forced by the missing
   `CartRepository.findByCustomerRef` (gap 2). Documented in code and BLOCKERS.
3. **Share tokens cannot be redeemed** (gap 1). The owner-facing half is real; the recipient-facing
   half needs new Wishlist domain surface. The UI is worded honestly rather than implying a link.
4. **Wishlist's `CartPort` is still a stub** (gap 3). Move-to-cart works because the route composes
   real operations, but `MoveWishlistItemToCart` itself remains unsound in this composition and
   should not be exposed anywhere until a real adapter is wired.
5. **MFA on the customer surface is unfinished by design.** If the MFA Engine ever requires a factor,
   login returns 403 `MFA_REQUIRED` and the storefront shows an honest "not available here yet"
   message. Customers have no enrollments by default, so this does not trigger today, but a
   customer-facing MFA challenge flow does not exist.
6. **For T5.19 / T5.18-write:** reuse `admin.customerAuth.requireSession(...)`. Neither needs a new
   session mechanism, cookie, or guard — this is the seam, and `public-wishlist-routes.ts` is the
   worked example. Note T5.16 §3's still-open Orders gap: `OrderListQuery` has no exact-match
   `customerRef` filter, and the `search` substring field must not be used as security scoping.
