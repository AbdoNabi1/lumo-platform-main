# Sol review — Shopify parity Wave 1a, round 2

Convergence review of round-1 findings **4–9 only**, against `docs/superpowers/plans/2026-11-21-shopify-parity-w1a.md` and both Opus triage sections in `plan-review-1.md`. Findings 1–3 and the accepted design choices are not reopened. OPTIONAL findings 7–9 retain their original severity.

Precedence: plan L13 makes binding amendments override original task text, with later blocks winning within a task. Superseded original wording is not an unresolved contradiction.

## Finding 4 — RESOLVED (originally BLOCKING)

**Plan evidence:** L209–214 pins `searchCollectionProductsAction(q: string): Promise<readonly CollectionPickerProduct[]>` and the primitive `{id,name,status}` DTO. It specifies trim/100-character normalization, `fetchProductsPage({first:50,...})`, omission of an empty query, `[]` on non-ok, all returned statuses, and a 20-result display cap. The client calls only this action; no variant fetch is allowed. The same block requires the 300 ms debounce, stale-response counter, real Dialog, product-name `bdi`, and draft/published selection, product-ID/no-variant, timing and stale-drop tests.

**Code evidence:** `apps/admin-web/src/lib/api/products.ts:12–18,43–77` exposes precisely the required fields and server-side page/search contract, without a status filter. Its underlying client imports `next/headers` (`lib/api/client.ts:22–24`), so the dedicated server action is the correct boundary. `app/draft-orders/actions.ts:236–254` contains the sellability filter that the amendment explicitly forbids copying. `components/draft-orders/draft-product-picker.tsx:26,70–83,90–103,109–122` supplies the debounce/counter/Dialog mechanics and the separate variant branch that must not be copied. `services/catalog/src/application/list-products.use-case.ts:30–35` delegates to tenant-scoped list/search; `services/catalog/src/infrastructure/in-memory-product-repository.ts:115–136` excludes deleted products, not unpublished statuses. The original picker-read ambiguity is closed.

## Finding 5 — RESOLVED (originally BLOCKING)

**Plan evidence:** L216 specifies `membersPage` parsing, fixed page size 50, explicit Previous/Next links, Next gated by `hasNextPage`, global-position moves against the complete `fetchCollection().productIds`, and Remove on every row, including missing rows on later pages. Its 51-member test reaches/removes member 51 and moves it across the page boundary by submitting the complete 51-ID permutation. L128–132 supplies the ordered member DTO, missing slots and typed client.

**Cursor consistency:** L128 explicitly defines `after` as the index of the **last returned item**. L216's `String((page - 1) * 50 - 1)` therefore agrees with that definition: a read-only Node arithmetic probe returned page 1 → no cursor/start index 0, page 2 → `after="49"`/start index 50/member 51, page 3 → `after="99"`/start index 100/member 101. The introductory “start index” wording at L128 does not override its explicit last-returned-item definition; there is no unresolved cross-task contradiction.

**Code evidence:** `services/catalog/src/domain/collection.ts:78–98,143–144` exposes the complete ordered IDs, removes any specified member and enforces full-permutation reorder. Thus the specified full-array/global-position action works independently of the visible page. This is approval of the planned contract, not a claim that the new member endpoint/page already exists.

## Finding 6 — RESOLVED (originally BLOCKING)

**Plan evidence:** the later Task 1 block at L143–145 expressly replaces the old L90 cap with `z.array(z.string().uuid())`, no `.max()`, retaining the shared HTTP body limit. It requires a real 501-member route test: complete valid reorder → 200; missing ID or duplicate ID → 409 `BUSINESS_RULE`. Task 2 L218 repeats the same contract, without conflict.

**Code evidence:** `services/catalog/src/domain/collection.ts:68–75` adds members without a size cap, while L89–98 requires an exact permutation. `services/catalog/src/application/reorder-collection-products.use-case.ts:51–62` passes the complete array to that invariant and preserves domain errors; `services/catalog/src/interfaces/presenter.ts:9–16,31` maps `BUSINESS_RULE` to 409. The amendment removes the transport/domain mismatch without reopening the accepted no-domain-change decision.

## Finding 7 — RESOLVED (originally OPTIONAL; not upgraded)

**Plan evidence:** L147–149 and L220–224 replace the old `test --` invocations with the exact `exec vitest run <filters>` spelling and `exec tsc --noEmit --incremental false`. Both packages and the quoted worktree/pnpm entry point are named. Task 3 L285 expressly adopts its corrected command from the Task 2 block. Frontend test commands include the constrained worker flags verified in round 1.

**Code/execution evidence:** `apps/admin/package.json:2,12–16` names `@platform/admin` and defines the original `test` script as `vitest run`; `apps/admin-web/package.json:2,7–14` names `admin-web` with the same script. A fresh `exec vitest run navigation middleware --maxWorkers=1 --minWorkers=1 --no-file-parallelism` selected exactly four matching existing frontend files and passed 74 tests. Both packages' exact amended typecheck commands exited 0. No claim is made that future Collections/Settings tests have already been implemented or run.

## Finding 8 — RESOLVED (originally OPTIONAL; not upgraded)

**Plan evidence:** L287–292 explicitly replaces `en.nav.marketing` with `en.nav.growth` in the top-level label oracle; rewrites the old Menus test to the primary landmark with Content expansion, the unchanged ID/href and current-page assertion; and requires absence from sales channels. It preserves the Themes/Pages/Preferences/SEO and Languages→Settings oracles, retains old dictionary keys where used, and adds a shared-consumer regression through global search or the mobile drawer. This is the accepted alternative, not a requirement to implement both consumer tests.

**Code evidence:** `apps/admin-web/src/components/navigation.test.tsx:63–73,92–121,132–139` contains exactly the changed and preserved assertions identified by the amendment. `components/sidebar-nav.tsx:81–103,168–178` renders current children from the shared definitions into the primary/sales-channel landmarks. `components/global-search.tsx:6–13,48–75` flattens those same definitions, while `components/mobile-nav.tsx:14–20,54` consumes the shared SidebarNav presentation. The new test need not introduce another nav structure; the permitted mobile-drawer path can directly assert the Content hierarchy.

## Finding 9 — RESOLVED (originally OPTIONAL; not upgraded)

**Plan evidence:** L226 requires `/collections/new` → operator before `/collections` → viewer, and names viewer list/detail allowed, viewer new denied, operator new allowed, plus preservation of the existing nav-href walk. L151 retains the real viewer-read/write-denial API oracle. L294 preserves viewer access to `/online-store/navigation` and `/locales`, the `/settings/policies` exception, and admin-only settings placeholders, with explicit middleware tests.

**Code evidence:** `apps/admin-web/src/middleware.ts:77–81,106–121,133–154` implements longest-prefix matching with segment boundaries and admin default. The new, longer `/collections/new` prefix therefore wins over `/collections`; there is no conflicting existing collection entry. Existing `/online-store` supplies viewer access to Menus, with its own `/navigation/new` operator exception, and `/locales` remains viewer with its existing `/new` exception. The nine settings placeholders inherit `/settings` admin; `/settings/policies` remains the longer viewer exception. `middleware.test.ts:238–249` walks PRIMARY_NAV child hrefs. `packages/auth/src/role-table-access-control.ts:4–8,40–50` already grants viewers `collections:read`, not writes. No role-table change is needed.

## Verification and scope

All commands ran against `"F:/New folder/morbeh-shopify-parity"`. Fresh verification:

- PASS, exit 0: `node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web exec vitest run navigation middleware --maxWorkers=1 --minWorkers=1 --no-file-parallelism` — four matching files, 74 tests passed: middleware, navigation component, and Online Store navigation actions/page.
- PASS, exit 0: `node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web exec tsc --noEmit --incremental false`.
- PASS, exit 0: `node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin exec tsc --noEmit --incremental false`.
- PASS: read-only arithmetic probe of the exact member-page cursor formula, as recorded under finding 5.
- Verification caveat: an initial `exec vitest run --version` probe unexpectedly started the whole admin suite and hit the 120-second timeout. It is not reported as a passing suite or a new product/plan finding; the loop did not reach its later commands. The subsequent process check showed no remaining Vitest process for this worktree. The successful scoped run and typechecks above were separate, completed executions.

Only this new review file was authored. No source/plan edits, implementation, dependency installation, `next build`, commit or push. Findings 1–3 remain accepted/resolved; no new scope or severity upgrades. All six scoped findings are resolved and no contradiction survives the binding precedence rule. **Blocking findings remaining: 0.**

VERDICT: AGREED
