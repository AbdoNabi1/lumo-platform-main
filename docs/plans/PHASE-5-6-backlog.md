# Phase 5 — Complete the surfaces · Phase 6 — Safety net

These two phases are deliberately less prescriptive than Phases 0–4, because by the time you reach
them the patterns are established and written down: Phase 1 produced the write recipe in
`apps/admin-web/README.md`, Phase 3 produced the read-screen method, and Phase 4 produced the
read-side recipe. Each task below names the endpoints and the reference file; follow the
established pattern.

**Phase 5 depends on:** Phase 4 (most of these screens have no data source until it lands).
**Phase 6 runs in parallel from Phase 1 onwards** — do not save it for the end.

---

# Phase 5 — Complete the admin and storefront surfaces

## Admin — write screens

Each task follows the recipe in `apps/admin-web/README.md`. For every one: read the route file,
record path/method/permission/`idempotent`/zod body, add the API function, add the Server Action,
add the form, add both dictionaries, add the `ROUTE_ROLE_REQUIREMENTS` entry.

- [x] **T5.1 Product editor, complete.** 20 routes in `apps/admin/src/http/admin-routes.ts` under
      `/products`: variants (add / update / remove), options, SEO, brand, categories, media
      (attach / detach / reorder), publish / schedule-publish / unpublish / archive / delete.
      Phase 1 T1.3/T1.4 built create and name/slug edit; this completes the screen.
- [x] **T5.2 Order actions.** 9 routes under `/orders`. Read
      `apps/admin/src/http/admin-routes.ts`'s `orderStatusValues` list first — the status machine
      has 21 states and the UI must only offer transitions the backend accepts.
- [x] **T5.3 Returns screen.** 9 routes in `returns-routes.ts`, of which only
      `GET /orders/:orderId/return` is used today (inside order detail). Give returns their own
      list and detail screens.
- [x] **T5.4 Fulfillment and shipping.** 6 + 8 routes. Both are read-only inside order detail
      today.
- [x] **T5.5 Inventory management.** 6 routes under `/inventory` plus `/warehouses`. Product
      detail shows stock read-only today.
- [x] **T5.6 Pricing.** `/prices`, `/price-lists`, `/pricing-rules`, `/tax-classes` — 9 routes,
      no UI at all.
- [x] **T5.7 Categories and brands.** 4 + 3 routes, no UI.
- [x] **T5.8 Coupons and promotions write.** `discounts/page.tsx` lists coupons read-only today;
      add create/edit, and add promotions (needs Phase 4 T4.5).
- [x] **T5.9 Content, pages, SEO, theme, components editors.** Needs Phase 4 T4.6–T4.10.
- [x] **T5.10 Review moderation queue.** Needs Phase 4 T4.1. The 6 write routes include
      `moderate`, `respond`, `report` and `vote`.
- [x] **T5.11 Notifications, localization, feature flags, experimentation.** Needs Phase 4
      T4.11, T4.12, T4.16, T4.17.
- [x] **T5.12 Security write actions.** 57 write routes across the six security route files.
      Phase 3 T3.1 deliberately shipped the console read-only. Add incident triage, session
      revocation, policy definition and credential rotation **last** — they are the highest-blast-
      radius controls in the product, and they should land on a console operators already trust.

## Admin — make the dashboard real

- [x] **T5.13 Live dashboard.** `apps/admin-web/src/data/dashboard.ts` returns
      `provenance: "demo"` unconditionally, and the UI says so honestly (`data.demoBadge`).
      Convert it tile by tile, keeping the badge accurate per tile rather than for the whole page —
      the file's own comment at line 106 explains why the tiles were split for exactly this.
      Sources: Orders (`GET /orders`), Finance (`GET /finance/income-statement`), Catalog
      (`GET /products`). **Never flip `provenance` to `"live"` for a tile still reading sample
      data.**
- [x] **T5.14 Marketing and Integrations screens.** Both currently render honest "no such context
      exists" states, and both comments are accurate: there is no `services/marketing`, and
      `docs/growth/03-INTEGRATIONS_HUB_SPEC.md` is contract-only with no application code.
      **Do not build either screen against invented data.** This task is to re-audit both after
      Phase 4 and either (a) wire whatever became real, or (b) leave them and update the comments
      with the current date. Either outcome closes the task.

## Storefront

- [x] **T5.15 Search.** Needs Phase 4 T4.3's `GET /search/indexes/:indexId/queries`. Add a header
      search field and a `/search` results page. Also expose a public search route the way
      `public-catalog-routes.ts` exposes catalog reads — the admin search routes are guarded.
- [x] **T5.16 Customer account and order history.** Requires a customer-facing auth story that does
      **not** exist yet: the storefront has no login, and `GET /orders/:orderId` is admin-guarded.
      Before writing any code, write the design into `docs/plans/BLOCKERS.md` — a public
      `/public/orders` surface scoped by an authenticated customer session is a security-design
      decision, not an implementation detail. Do not reuse the guest `sessionRef` cookie for it:
      it is an anonymous cart token, not an identity.
- [x] **T5.17 Wishlist.** Needs Phase 4 T4.2 plus the same customer-identity decision as T5.16.
      Both halves shipped: **Part A**, the customer auth foundation T5.16 designed (`CustomerGuard`,
      `CustomerAuthAdminController`, `POST /public/auth/{register,login,logout,refresh,logout-all}`
      + `GET /public/auth/me` + `POST /public/auth/claim-cart`, `IntrospectSessionSubject` in
      Security, `AssignCartCustomer` in Cart, `CUSTOMER_SESSION_COOKIE` + `/account/{login,register}`
      in the storefront); and **Part B**, wishlist on top of it (`/public/wishlists/me[/items…]`,
      `/account/wishlist`, a signed-in-only save affordance on product detail). `CustomerGuard`'s
      `requireSession` seam is the reusable piece T5.19 (loyalty) and T5.18-write should build on —
      neither needs a new session mechanism, cookie, or guard. Four gaps found and recorded in
      `BLOCKERS.md`'s T5.17 entry (share-token redemption, `CartRepository.findByCustomerRef`,
      Wishlist's stubbed `CartPort`, password-provider durability).
- [x] **T5.18 Product reviews.** Needs Phase 4 T4.1. Display is safe to ship without customer
      auth; **writing** a review is not — gate it behind the T5.16 decision. DISPLAY half shipped
      (`GET /public/reviews/by-product/:productRef` + storefront product-detail review section);
      write half intentionally deferred — see `docs/plans/.progress/task-T5.18-report.md`. **Write
      half now also shipped** (T5.18-write, once T5.17's customer-auth foundation existed) —
      `POST /public/reviews[/:reviewId/vote,/:reviewId/report]`, session-scoped exactly like
      Wishlist/Loyalty, plus the storefront's review-submission form; see
      `docs/plans/.progress/task-T5.18-write-report.md`.
- [x] **T5.19 Loyalty balance.** Needs Phase 4 T4.4 and T5.16.
- [x] **T5.20 Collection member products at scale.** Phase 0 T0.5 left
      `resolveCollectionBySlug`'s member-product resolution on the list route, bounded by
      `first=100`. Add a public route that returns a collection's products directly, paginated.

---

# Phase 6 — The safety net

**Start this at Phase 1, not after Phase 5.** Every task below gets cheaper the earlier it lands
and more expensive the longer write endpoints go untested.

- [x] **T6.1 Playwright.** There is currently **no** `playwright.config.*` and **zero** `*.spec.ts`
      files in the repo. Add Playwright at the root, wired into `turbo.json` as an `e2e` task.
      First three specs, in this order:
      1. guest purchase: browse → add to cart → checkout → confirmation (after Phase 2)
      2. operator create: log in → create product → see it in the storefront (after Phase 1)
      3. authorisation: `viewer`, `operator` and `admin` each hit a route above their level and get
         `/forbidden`, not the page

      Built as a new `apps/e2e` workspace package (root `pnpm-workspace.yaml` already globs
      `apps/*`), not a bare root-level config, so it gets the same tsconfig/eslint-config wiring as
      every other app. `playwright test --list` confirms all 3 specs parse correctly (5 tests: 1
      storefront project + 4 admin-web project, across `guest-purchase`/`operator-create-product`/
      `authorization`); `tsc --noEmit` and `eslint .` are both clean. **Could not run any spec
      against a live server in this session** — both `apps/storefront`/`apps/admin-web` fail closed
      outside `APP_ENV=local|development` with no mock-backend mode, and there is no Docker in this
      environment to bring up the required Postgres/Redis/Kafka/Keto/Kratos/Hydra stack (same
      limitation every "not verified in a live browser" note in `docs/plans/BLOCKERS.md` already
      records). See `apps/e2e/README.md` for the exact bring-up sequence and
      `docs/plans/BLOCKERS.md`'s T6.1 entry for what specifically needs live verification.
      `guest-purchase.spec.ts`'s final assertion is deliberately `test.fail()`-annotated — the
      known guest-checkout-completion gap this file's own T2.3 entry documents.
- [x] **T6.2 Contract tests.** Assert that every path a frontend calls exists in `adminRoutes()`.
      A test that enumerates the `lib/api/*.ts` paths and cross-checks them against the route table
      turns "the frontend calls a route that was renamed" from a production 404 into a red CI run.
      Built as `apps/admin-web/src/lib/api/route-contract.test.ts`: the real route table is read as
      plain text (brace-balanced parse of every `apps/admin/src/http/*-routes.ts` file's
      `defineRoute({...})` calls — not imported, so this test never pulls `zod`/`@platform/http`
      into `admin-web`'s dependency graph); what `admin-web` actually calls is captured by real
      execution — every exported function in every `lib/api/*.ts` file is invoked with a
      "chameleon" placeholder argument (callable, chainable, always stringifies to `PARAM`) while
      `./client`'s `getAdminApi`/`mutateAdminApi` are mocked to record the path/method instead of
      hitting the network. Verified it actually catches a regression (temporarily renamed a real
      path in `products.ts`, confirmed a clear failure, reverted). 593/593 admin-web tests still
      pass; `tsc --noEmit` and `eslint` both clean on the new file.
- [x] **T6.3 Coverage gate (partial).** `docs/KNOWN_GAPS.md` G-21 tracks an unenforced 80% gate.
      Turn it on once the Phase 1 write layer has stabilised, not before — enabling it during heavy
      churn just gets it disabled again. Phase 1 is stable (Phase 5 fully shipped), so gate infra
      is now real and CI-blocking: `@vitest/coverage-v8` + `coverage.thresholds` in all 74
      `vitest.config.ts` files, a `test:coverage` script/turbo task, and a blocking step in
      `ci.yml`. Deliberately **not** a flat 80% everywhere — measured every package's real coverage
      first (`pnpm --filter <name> test:coverage` across all 74), then ratcheted: already-≥80%
      packages capped at exactly 80 (most of `packages/*`, `apps/admin` 87.93%), below-80% packages
      floored 1pt under their measured baseline as a regression gate rather than an immediate
      backfill demand (`admin-web` 30.77% lines, `storefront` 46.63%, `runtime` 70.95%, `collector`
      45.54%, most of `services/*` in the 60-85% band). **The "use-case test backfill" half of
      G-21 is NOT done** — this session wired the gate and protected today's baseline from
      regressing, it did not write the tests needed to raise the low packages to 80%; see
      `docs/KNOWN_GAPS.md` G-21 for the full per-package picture and each config's own comment for
      that package's gap. Verified the gate actually fails on a regression (temporarily raised one
      package's threshold above its real coverage, confirmed red, reverted) — see
      `docs/plans/BLOCKERS.md` for why `turbo run test:coverage` itself couldn't be exercised in
      this session.
- [x] **T6.4 Dependency advisories.** G-31 tracks 8 open audit advisories and a non-blocking CI
      audit gate. Upgrade, then make the gate blocking. **Found already substantially done** by
      prior work (H-09): `ci.yml`/`security.yml`'s `pnpm audit` gates are hard-blocking (no
      `continue-on-error`), production-facing High advisories are fixed via `pnpm-workspace.yaml`
      overrides, and the remaining 9 High/Critical advisories are allowlisted by GHSA ID with
      per-advisory reasoning (dev-tooling-only, or — for prisma's `deepmerge-ts` transitive —
      verified non-reachable by untrusted input). Re-verified `pnpm audit --audit-level high`
      exits 0 today. See `docs/KNOWN_GAPS.md` G-31 (now closed).
- [x] **T6.5 Production configuration (audited, not configured).** `apps/runtime/src/api.ts` runs
      five fail-closed guards that abort boot outside `APP_ENV=local`, and `collectGuardFailure`
      aggregates them so one boot reports every missing piece at once. Before any staging deploy,
      configure all five:

      | Guard  | What it needs                                                    |
      | ------ | ---------------------------------------------------------------- |
      | `C2-4` | a real `MfaProviderResolver` (the in-memory one has a hardcoded code) |
      | `V-1`  | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`                    |
      | `M2-3` | real Licensing `payments` / `financeLedger` adapters             |
      | `M2-2` | `S3_ENDPOINT` + `S3_ACCESS_KEY_ID` + `S3_SECRET_ACCESS_KEY`      |
      | —      | KMS / secrets provider configuration                             |

      **Never weaken a guard to make a deploy proceed.** Each one documents a specific incident
      class in its own doc comment; read it before touching it. **This is an operator action**
      (real secrets, real credentials) this session cannot perform — audited instead: verified all
      four named guards (`C2-4`/`V-1`/`M2-3`/`M2-2`) are correctly implemented in `api.ts` and
      wrote `docs/operations/DEPLOYMENT_GUIDE.md`'s new "Pre-deploy guard checklist" distinguishing
      the two that are pure config (`V-1`, `M2-2` — set env vars, an adapter already exists) from
      the two that need new code no env var can substitute for (`C2-4`, `M2-3` — no real adapter
      exists anywhere in this codebase yet). **Found a sixth, previously-undocumented gap along the
      way:** the KMS row has no fail-closed guard at all, in either `api.ts` or the `worker.ts`
      process that actually uses it — see `docs/plans/BLOCKERS.md`'s T6.5 entry for the full
      finding and why it's recorded rather than patched blind (needs a live boot test this session
      couldn't run).

---

## Exit criteria for the whole plan

- [ ] Every backend domain with read endpoints has a screen, or a recorded reason it does not.
- [ ] Every screen that shows data shows real data, or says plainly that it cannot.
- [ ] A guest can complete a purchase. An operator can run the catalog and fulfil an order.
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm arch` pass, and Playwright covers the three
      critical journeys.
- [ ] `docs/KNOWN_GAPS.md` reflects reality.
