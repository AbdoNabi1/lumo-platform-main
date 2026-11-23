# Sol review — Shopify parity Wave 1b, round 2

**Result: 11 resolved; R7 remains blocking.** Convergence review of accepted round-1 findings R1–R12 only. Plan citations refer to `docs/superpowers/plans/2026-11-23-shopify-parity-w1b.md` as reviewed (349 lines); code citations refer to the supplied worktree, HEAD `a8a8bf62`. The precedence at plan L14–17 is applied: amendments override original text. Accepted decisions are not reopened; R13/R14 remain OPTIONAL and are documented at plan L18.

## R1 — RESOLVED

- **Plan:** L121–131 replaces nonexistent shared `Page`/JSON `sendAdmin*` contracts with local `MediaFilesPage`, its guard, `getAdminApi`, and `MutationResult`/`mutateAdminApi` for archive. It distinguishes `BUSINESS_RULE` from idempotency `CONFLICT` and pins failure mappings.
- **Code evidence:** `apps/admin-web/src/lib/api/client.ts:31–35,49–67,116–119,174–183,223–235` supplies exactly those types/helpers and preserves conflict codes. `services/media/src/domain/media-asset.ts:70–73` throws `BusinessRuleError` for an already archived asset. The signatures now fit the actual helper API; unchanged upload/alt/download helpers are not repurposed.

## R2 — RESOLVED

- **Plan:** L17 explicitly replaces the abbreviated original commands. Full commands are printed at L80–84,139–141,243–251,288–290,343–345, with quoted worktree paths and the dependency-reconciliation override on pnpm commands. Direct Prisma validate/generate and the exported tenant scanner are separately spelled out.
- **Code evidence:** Read the six package manifests: filters are `@platform/media`, `@platform/admin`, `admin-web`, `@platform/identity`, `@platform/db`, and `@platform/security`. Filesystem checks confirmed the exact Node pnpm entry point, `packages/db/node_modules/prisma/build/index.js`, and `scripts/dev/check-prisma-tenant-where.mjs` exist. No pnpm or Prisma command was executed; this resolves command spelling/completeness, not future command success.

## R3 — RESOLVED

- **Plan:** L76–78 pins the working persistent-storage/public-URL harness, real ACL and token map, cache/key-store/clock/serializer, valid random UUIDs, distinct upload keys, tenant-B exclusion, sorted-ID route oracle, monotonic UUIDv7 unit fixtures, and unconditional gated Prisma cursor/filter deliverable.
- **Code evidence:** `apps/admin/src/http/media-upload-routes.test.ts:26–33,45–53,56–110` contains the specified fixed clock, PNG, recording storage, injected dependencies and cleanup pattern. `services/media/src/application/upload-image.use-case.ts:102–104,139–157` requires persistent storage/public URL and persists the byte length; the copied PNG matches the amendment's byte-size oracle. `services/media/src/infrastructure/prisma-library-repositories.ts:146–163` orders by ID; `prisma-library-repositories.integration.test.ts:20–22,67–75` is the real existing gated suite. The amendment avoids confusing random UUID order with chronology.

## R4 — RESOLVED

- **Plan:** L133 and L337 give the exact `highestRole((await readSession())?.roles ?? [])` expression, fail-closed operator/admin check and component props. Files viewers/unknown roles lose Upload/Delete/alt Save/signed Download while retaining Copy link. Customers viewers lose all writes and export. Negative assertions include `document.body`.
- **Code evidence:** `apps/admin-web/src/lib/auth/session.ts:24–29,43` exports these exact functions and return types. `packages/auth/src/role-table-access-control.ts:4–31,40–50` grants operator wildcards for customers/media/products but viewer reads only. The prescribed UI restrictions agree with existing API permissions without changing the role table.

## R5 — RESOLVED

- **Plan:** L135 specifies `stack`, push/pop transitions, empty-entry handling, q/sort resets, view preservation, three-page navigation and deep-link oracles. It explicitly requires no backward repository pagination.
- **Code evidence:** `apps/admin-web/src/components/content/content-pagination.tsx:22–49` implements that current-after/stack algorithm and preserves other query parameters. `services/media/src/infrastructure/prisma-library-repositories.ts:146–163` exposes the forward cursor read the plan extends. The old original-text objection to a stack is superseded.

## R6 — RESOLVED

- **Plan:** L202–209 pins adapter constructors, required writer tx, scoped read fallback, tenant/non-deleted parent checks, six use-case dependency sets and exports, all six controller methods/statuses, both repo literals, the same in-memory customer instance, controller/adapter tests, and real-Prisma create rollback coverage.
- **Code evidence:** `services/identity/src/composition.ts:77–94,94–132,202–209,215–233` contains the named interface, single controller constructor and both composition branches. `infrastructure/in-memory-customer-repository.ts:34–56` supports the prescribed constructor and tenant-aware `findById`; no invented orders-only helper is needed. `services/orders/src/infrastructure/prisma-order-annotation-repository.ts:22–28,73–97,114–124` confirms required writer tx versus scoped reader behavior.
- **Cross-task check:** Task 3's `customerAnnotations(input: GetCustomerAnnotationsInput)` at L207 matches Task 4's consumer name at L259 and its detail/export use at L267–268. The other five names agree as well. `services/identity/src/interfaces/customer.controller.ts:24–45,71–81` and `apps/admin/src/interfaces/customers.admin-controller.ts:26–32,53–59,77–83` provide the actual typed delegation/presenter pattern being extended. No contradictory legacy signature survives amendment precedence.

## R7 — STILL BLOCKING

- **Resolved portions:** Plan L211–217 supplies `validateProfile`, create/update normalization, omitted/null handling, aggregate issues before repository calls, copied `compareText`, and semantic-boundary tests. L277–282 removes the original raw 40/5000-unit limits and sends empty profile/consent bodies to application validation.
- **Remaining contradiction:** L278 and L280 still prescribe `tags: z.array(z.string().max(400)).max(1000)` before normalization. But L216 requires the 250-tag limit AFTER comma splitting/de-duplication, and Task 5 L330 deliberately sends the entire comma-separated form input as `[raw]`. Thus a perfectly valid form containing 100 short, distinct tags can never reach the application. Both conflicting instructions are in binding amendment blocks; precedence cannot make their shared wire contract work.
- **Code evidence and concrete oracle:** `services/orders/src/domain/order-tags.ts:29–35,43–60` splits Latin/Arabic commas, normalizes entries, discards blanks, de-duplicates, and checks each resulting tag's code-point length. The application is required to copy that behavior. A read-only Python probe constructed `", ".join(f"tag{i:03d}" for i in range(100))`: **100 distinct tags, each 6 code points, raw length 798 UTF-16 units**. `parseTags([raw])`'s specified rules accept all 100 and the post-normalization count is within 250; the prescribed transport `.max(400)` rejects the single raw string first. This is the same raw-before-normalization rejection identified in round-1 R7, not a new feature or reconsideration of the accepted validation design.
- **Required scoped fix:** Make the create and replacement tag transport schemas genuinely structural for the accepted raw-array/comma-separated contract (e.g. `z.array(z.string())`, leaving per-tag length and normalized distinct-count checks to the application), or specify an equivalent normalization-aware gate that accepts the same normalized set. A raw array-count limit must not stand in for the accepted post-de-duplication 250-tag limit. Add the concrete `[raw]` HTTP/create-action-to-API oracle above alongside the existing short-comma and 40-emoji cases. Keep 422/VALIDATION and aggregate application validation; no handler-side 400 and no change to Task 5's accepted action signature is needed.

## R8 — RESOLVED

- **Plan:** L219–235 names the explicit identity consistency block and its column/type/default/key/index/FK/CHECK/RLS assertions, gives a fully typed `CustomerTag` model, and names `services/security/src/infrastructure/consent-projection.test.ts` with SMS grant/revoke, independent channels and tenant isolation.
- **Code evidence:** `packages/db/src/schema-migration-consistency.test.ts:377–436` is the explicit orders block being mirrored, not automatic identity coverage. `packages/db/prisma/schema/identity.prisma:5–23,42–56` contains the referenced Customer model and existing UUID/customer relation conventions. `packages/db/prisma/schema/migrations/20261018010000_order_notes_tags_timeline/migration.sql:23–28` matches the amendment's full tenant predicate. `services/security/src/infrastructure/consent-projection.test.ts:18–46` supplies the actual event/consumer/projection fixture. Required tests remain honestly gated where applicable.

## R9 — RESOLVED

- **Plan:** L315–335 supplies client/body/page DTO contracts, encoded-ID POST paths, guards, mutation versus GET outcomes, action names/inputs, fresh keys, `result.data.customerId`, revalidation/redirect rules, exact duplicate-email mapping, generic contention handling and named client/action tests.
- **Code evidence:** `apps/admin-web/src/lib/api/customers.ts:34–62,71–106` has the flattened existing reader results the amendment preserves; `lib/api/client.ts:174–183` supports the proposed mutations. `lib/api/mutation.ts:20–29,59–78` supplies `FormState`/`toFormState`; the explicit duplicate override fixes its raw-conflict-message behavior. `services/identity/src/infrastructure/in-memory-customer-repository.ts:39–47` uses exactly the duplicate-email message being matched.
- **Cross-task check:** Task 4 L267–268 and Task 5 L315,323–325 agree on phone/language/isGuest/note/tags, detail `marketing.email/sms`, export `emailMarketing/smsMarketing`, address fields and cursor page shape. Existing backend DTO/mapper at `apps/admin/src/http/admin-routes.ts:473–498` agrees with the retained frontend base DTO. R7's remaining raw-tag rejection is counted only under R7, not duplicated here.

## R10 — RESOLVED

- **Plan:** L286 and L339 explicitly change the requirement to `customers_export.csv`, prohibit timezone/settings reads, pin no-store CSV headers, page/request/row limits and no-partial-file failure behavior.
- **Code evidence:** `apps/admin-web/src/app/orders/export/route.ts:4,21–22,36–42` shows the settings/day-dependent template that must NOT be copied for this filename. The accepted deviation removes that dependency rather than pretending operators can read tenant settings. No shop-local-date requirement remains after precedence. This narrowly accepts the already agreed product change, without reopening it or relying on the plan's external Shopify naming claim.

## R11 — RESOLVED

- **Plan:** L137 rewrites both existing navigation oracles and preserves Online Store/current-route assertions. L341 explicitly adds the existing consent card and named test, en/ar known-scope labels, unknown-scope fallback and changed-component render updates.
- **Code evidence:** `apps/admin-web/src/components/navigation.test.tsx:170–177,209–213` contains exactly the child-list and positional-label assertions being replaced. `components/customers/customer-consent-card.tsx:23–30,43–46` is the actual required component and raw-scope rendering seam. L133/L337 supplies the newly required boolean props rather than leaving their callers implicit.

## R12 — RESOLVED

- **Plan:** L237–241 specifies a parameterized tenant+UUID/non-deleted-parent `SELECT ... FOR UPDATE` inside the same required tx, null on missing parent, delete/create/read-back sequence, empty-set handling, unchanged version, and gated concurrent replacements from both initial states plus rollback after insert failure.
- **Code evidence:** `packages/db/prisma/schema/identity.prisma:5–15,20–22` confirms the SQL's identity/customers UUID, tenant and soft-delete columns. `packages/db/src/transaction.ts:15–23` leaves the original default-isolation concern relevant; explicit parent serialization now supplies the missing mechanism. `services/orders/src/infrastructure/prisma-order-annotation-repository.ts:127–164,166–187` is additive/removal behavior, not a replacement algorithm to copy blindly. The amendment settles that distinction without requiring another migration.

## Verification and scope

- Read `AGENTS.md`, the round-1 review/Opus triage, all five amendment blocks and the cited real-code seams. Read-only git inspection returned HEAD `a8a8bf62`.
- Wrote this review early, then updated it. Only `docs/superpowers/plans/w1b/plan-review-2.md` was edited by this reviewer. The separate Wave 1a `docs/superpowers/plans/plan-review-1.md` was already shown as modified by git when inspected; it was not touched or repaired here.
- No pnpm, install, test suite, build, migration, database call, source edit, commit or other git write was run. The R7 length/count probe is a read-only counterexample calculation, not claimed execution of future application code or an HTTP test.
- Finding scope remains R1–R12 only: 11 RESOLVED, 1 STILL BLOCKING (R7). No OPTIONAL finding was upgraded.

VERDICT: CHANGES_REQUESTED (1 blocking)

## Opus triage (round 2)

- R7 (still blocking) → accepted. Task 4 gets `**Amendments round 2 (binding)**`: tags transport `z.array(z.string())` with no array/string max (body-size limit only); 40-code-point and 250-after-dedupe limits live only in the application; added the 100-tags-in-one-raw-string oracle. Preamble precedence: round 2 > round 1 > task text.
