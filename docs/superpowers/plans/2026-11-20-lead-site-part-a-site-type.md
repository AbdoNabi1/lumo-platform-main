# Lead Site Part A — Site Type at Sign-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** `OPUS: PENDING · Sol: PENDING`

**Goal:** a new merchant chooses, once and forever, whether they are building an online store or a lead website; the
choice is stored on the shop and drives the setup guide (and, in later plans, the storefront and tracking events).

**Architecture:** `site_type` lives on `tenancy.store_settings` next to `setup_guide_dismissed_at` and follows the same
"preserved across a Settings save" pattern. It is written only by an internal `ChooseSiteType` use case that the sign-up
orchestrator calls; there is no HTTP route that writes it, so it cannot be changed from any UI or merchant API.

**Tech stack:** TypeScript, Prisma (hand-written additive SQL migration), zod, Next.js App Router (admin-web), vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-lead-site-and-tracking-design.md` (owner decisions 1–2).

**Base:** branch `morbeh/lead-site` at `5f9a2549` (= `morbeh/storefront-customization`, which contains
`morbeh/merchant-onboarding`). Worktree `F:/New folder/morbeh-lead-site`.

## Implementers

Task 1 `impl-terra` · Task 2 `impl-sonnet` · Task 3 `impl-sonnet` (UI) · Task 4 `impl-sonnet` (UI).

## Global Constraints

- `SITE_TYPES = ["store", "lead_site"] as const`. Wire values are exactly these strings. No third value.
- Existing rows become `store`; a new shop without a choice is `store` until sign-up chooses.
- The site type is **immutable once chosen** (`site_type_chosen_at` not null). Re-choosing keeps the first value.
- No HTTP route, server action or settings form may write `siteType`. `UpdateStoreSettings` must carry it over.
- Migration is additive, hand-written, owner deploys it. Never run `prisma migrate` / `db push`.
- pnpm: `node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs` (the shim fails in agents).
- Commit identity `git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com"`, conventional types,
  trailer `Co-Authored-By: <model that wrote it>`. Stage only the task's files. Never stash/checkout/reset/`--no-verify`.
- Admin-web UI: Arabic + English copy side by side as the sign-up page already does, RTL-safe, existing `Label`/`Input`
  components and design tokens; new test files start with `expect.hasAssertions()`.

## Review Focus

1. A sign-up **retry** (same email, the resume path) with a different `siteType` must keep the first choice.
2. A merchant saving Settings → General after sign-up must not reset `lead_site` to `store`.
3. A sign-up POST without `siteType` (old client, crafted request) must be refused `422` by the route schema, not
   default silently to `store`.
4. A stored row with an unknown `site_type` (impossible under the CHECK, but a corrupt restore) must fail loudly in the
   mapper rather than silently become `store`.
5. The storefront public store read must expose `siteType` without exposing anything else new.

---

### Task 1: `siteType` on store settings (tenancy domain, persistence, use case, views)

**Files:**
- Modify: `services/tenancy/src/domain/store-settings.ts`
- Modify: `services/tenancy/src/application/store-settings.use-cases.ts` (`StoreSettingsView`, `toStoreSettingsView`,
  `UpdateStoreSettings` line ~76, `PublicStoreView`, `GetPublicStore`; add `ChooseSiteType`)
- Modify: `services/tenancy/src/infrastructure/mappers.ts` (row ↔ domain, lines ~139–157)
- Modify: `services/tenancy/src/infrastructure/prisma-repositories.ts`, `in-memory-repositories.ts` (persist the 2 fields)
- Modify: `services/tenancy/src/interfaces/tenancy.controller.ts` (expose `chooseSiteType`, no route), `src/composition.ts`,
  `src/index.ts` (export `SITE_TYPES`, `SiteType`, `isSiteType`)
- Modify: `packages/db/prisma/schema/tenancy.prisma` (`StoreSettings`)
- Create: `packages/db/prisma/schema/migrations/20261120000000_store_site_type/migration.sql`
- Modify: `packages/db/prisma/MIGRATIONS.md` (one line, same style as the existing entries)
- Test: `services/tenancy/src/domain/store-settings.test.ts`, `services/tenancy/src/application/store-settings.use-cases.test.ts`

**Interfaces:**
- Produces (domain): `export const SITE_TYPES = ["store", "lead_site"] as const; export type SiteType = (typeof SITE_TYPES)[number];`
  `export function isSiteType(value: unknown): value is SiteType;`
  `StoreSettings.siteType: SiteType`, `StoreSettings.siteTypeChosenAt: Date | null`,
  `StoreSettings.withSiteType(siteType: SiteType, chosenAt: Date | null): StoreSettings` (copies every other field).
  `defaults()` → `siteType "store"`, `siteTypeChosenAt null`. `create(input)` → same defaults (input has no site type).
- Produces (application): `StoreSettingsView.siteType: SiteType`; `PublicStoreView.siteType: SiteType`;
  `class ChooseSiteType` with `execute({ tenantId: string; siteType: SiteType }): Promise<Result<{ siteType: SiteType; changed: boolean }, DomainError>>`.
- Produces (controller): `chooseSiteType(tenantId: string, siteType: SiteType): Promise<AdminResponse>` → `200 { siteType, changed }`.
  Not registered as an HTTP route.

- [ ] **Step 1: Write the failing domain tests** (`store-settings.test.ts`)

```ts
it("defaults to a store with no choice recorded", () => {
  const s = StoreSettings.defaults();
  expect(s.siteType).toBe("store");
  expect(s.siteTypeChosenAt).toBeNull();
});
it("withSiteType copies every other field", () => {
  const at = new Date("2026-11-20T10:00:00.000Z");
  const base = StoreSettings.defaults().withSetupGuideDismissedAt(at);
  const next = base.withSiteType("lead_site", at);
  expect(next.siteType).toBe("lead_site");
  expect(next.siteTypeChosenAt).toEqual(at);
  expect(next.setupGuideDismissedAt).toEqual(at);
  expect(next.currency).toBe(base.currency);
});
it("isSiteType accepts only the two wire values", () => {
  expect(isSiteType("store")).toBe(true);
  expect(isSiteType("lead_site")).toBe(true);
  expect(isSiteType("lead")).toBe(false);
  expect(isSiteType(undefined)).toBe(false);
});
it("withSetupGuideDismissedAt keeps the site type", () => {
  const at = new Date("2026-11-20T10:00:00.000Z");
  const s = StoreSettings.defaults().withSiteType("lead_site", at).withSetupGuideDismissedAt(null);
  expect(s.siteType).toBe("lead_site");
});
```

- [ ] **Step 2: Write the failing use-case tests** (`store-settings.use-cases.test.ts`, in-memory repos + fixed clock
  `2026-11-20T10:00:00.000Z`, same harness the file already uses)

```ts
it("ChooseSiteType records the first choice with the clock time", async () => {
  const r = await chooseSiteType.execute({ tenantId: "t-1", siteType: "lead_site" });
  expect(r.ok && r.value).toEqual({ siteType: "lead_site", changed: true });
  const view = await getStoreSettings.execute({ tenantId: "t-1" });
  expect(view.ok && view.value.siteType).toBe("lead_site");
});
it("ChooseSiteType never changes an existing choice", async () => {
  await chooseSiteType.execute({ tenantId: "t-1", siteType: "lead_site" });
  const r = await chooseSiteType.execute({ tenantId: "t-1", siteType: "store" });
  expect(r.ok && r.value).toEqual({ siteType: "lead_site", changed: false });
});
it("ChooseSiteType on the same value again is a no-op success", async () => {
  await chooseSiteType.execute({ tenantId: "t-1", siteType: "store" });
  const r = await chooseSiteType.execute({ tenantId: "t-1", siteType: "store" });
  expect(r.ok && r.value).toEqual({ siteType: "store", changed: false });
});
it("UpdateStoreSettings keeps the chosen site type (Review Focus 2)", async () => {
  await chooseSiteType.execute({ tenantId: "t-1", siteType: "lead_site" });
  await updateStoreSettings.execute({ tenantId: "t-1", storeName: "Clinic", contactEmail: null,
    currency: "EGP", timezone: "Africa/Cairo", weightUnit: "kg" });
  const view = await getStoreSettings.execute({ tenantId: "t-1" });
  expect(view.ok && view.value.siteType).toBe("lead_site");
});
it("GetPublicStore exposes siteType and nothing else new (Review Focus 5)", async () => {
  await chooseSiteType.execute({ tenantId: "t-1", siteType: "lead_site" });
  const r = await getPublicStore.execute({ tenantId: "t-1" });
  expect(r.ok && Object.keys(r.value).sort()).toEqual(["currency", "name", "siteType"]);
  expect(r.ok && r.value.siteType).toBe("lead_site");
});
```

Add a mapper test in the nearest existing mapper test (or a new `mappers.test.ts`):
`StoreSettingsMapper.toDomain({ ...validRow, siteType: "shop" })` **throws** `Error` whose message contains `site_type`
(Review Focus 4); `toRow(defaults().withSiteType("lead_site", at))` has `siteType: "lead_site", siteTypeChosenAt: at`.

- [ ] **Step 3: Run, expect FAIL**

`node <pnpm.cjs> --filter @platform/tenancy exec vitest run src/domain/store-settings.test.ts src/application/store-settings.use-cases.test.ts`
→ fails (`siteType` / `ChooseSiteType` not defined).

- [ ] **Step 4: Implement** domain, use case (`ChooseSiteType` runs inside `unitOfWork.run`: read current or
  `defaults()`; if `siteTypeChosenAt !== null` return `{ siteType: current.siteType, changed: false }` without writing;
  else save `current.withSiteType(input.siteType, clock.now())` and return `changed: true`), view mapping,
  `UpdateStoreSettings` carry-over (`.withSiteType(current?.siteType ?? "store", current?.siteTypeChosenAt ?? null)`
  chained after the existing `withSetupGuideDismissedAt`), mapper, both repositories, controller method, composition.

- [ ] **Step 5: Prisma + migration**

`tenancy.prisma` `StoreSettings`: `siteType String @default("store") @map("site_type")` and
`siteTypeChosenAt DateTime? @map("site_type_chosen_at")`. Migration file:

```sql
ALTER TABLE "tenancy"."store_settings"
  ADD COLUMN "site_type" TEXT NOT NULL DEFAULT 'store',
  ADD COLUMN "site_type_chosen_at" TIMESTAMP(3);
ALTER TABLE "tenancy"."store_settings"
  ADD CONSTRAINT "store_settings_site_type_check" CHECK ("site_type" IN ('store', 'lead_site'));
```

Run `node <pnpm.cjs> --filter @platform/db exec prisma validate` → `The schema ... is valid`. Run
`node <pnpm.cjs> --filter @platform/db exec prisma generate` → success. Do **not** run migrate.

- [ ] **Step 6: Run tests + typecheck, expect PASS**

`node <pnpm.cjs> --filter @platform/tenancy test` → all pass. `node <pnpm.cjs> --filter @platform/tenancy typecheck` → 0 errors.
Tenant-where guard:
`node -e "import('./scripts/dev/check-prisma-tenant-where.mjs').then(async m=>console.log(JSON.stringify(await m.scanPrismaTenantWhere(process.cwd()))))"`
→ no new finding in `services/tenancy`.

- [ ] **Step 7: Commit** `feat(tenancy): record a shop's site type once, at sign-up`.

---

### Task 2: sign-up API accepts and records `siteType`

**Files:**
- Modify: `apps/admin/src/http/public-merchant-routes.ts:17-28` (`signupBody`)
- Modify: `apps/admin/src/merchant-onboarding/merchant-onboarding.ts` (`SignupInput`, ports, step after `saveStoreSettings` ~line 156)
- Modify: `apps/admin/src/composition.ts` (~line 1629, add the `chooseSiteType` port next to `saveStoreSettings`)
- Test: `apps/admin/src/merchant-onboarding/merchant-onboarding.test.ts`, `apps/admin/src/http/public-merchant-routes.test.ts`

**Interfaces:**
- Consumes: Task 1 `SiteType`, controller `chooseSiteType(tenantId, siteType)`.
- Produces: `SignupInput.siteType: SiteType` (required). Port
  `readonly chooseSiteType: (tenantId: string, siteType: SiteType) => Promise<{ siteType: SiteType; changed: boolean }>`.
  Sign-up success body gains `siteType: SiteType` (the recorded value) next to `tenantId`/`storeUrl`.

- [ ] **Step 1: Failing tests**
  - route: body without `siteType` → `422` with code `VALIDATION` (Review Focus 3); `siteType: "lead"` → `422`;
    `siteType: "lead_site"` → handler receives it.
  - orchestrator (existing fake ports): a sign-up with `siteType: "lead_site"` calls `chooseSiteType("<tenant>", "lead_site")`
    **after** `saveStoreSettings` and before `startTrial`, and the `created` outcome carries `siteType: "lead_site"`.
  - resume (Review Focus 1): fake `chooseSiteType` returns `{ siteType: "store", changed: false }` for a retry asking
    `lead_site` → outcome carries `siteType: "store"` and the fake logger received one `warn` whose message contains
    `site type already chosen`; no exception.
- [ ] **Step 2:** run `node <pnpm.cjs> --filter @platform/admin exec vitest run src/merchant-onboarding src/http/public-merchant-routes.test.ts` → FAIL.
- [ ] **Step 3: Implement.** `signupBody` adds `siteType: z.enum(["store", "lead_site"])` (stays `.strict()`).
  Orchestrator records via the port and returns the recorded type. Composition port calls
  `tenancy.chooseSiteType(tenantId, siteType)` and `expectSuccess` like `saveStoreSettings` does.
- [ ] **Step 4:** same command → PASS; `node <pnpm.cjs> --filter @platform/admin typecheck` → 0 errors; the isolation
  e2e `apps/admin/src/http/merchant-onboarding-isolation.e2e.test.ts` still passes (send `siteType` in its bodies).
- [ ] **Step 5: Commit** `feat(admin): take the site type at merchant sign-up`.

---

### Task 3: sign-up screen — choose store or lead website (UI)

**Files:**
- Modify: `apps/admin-web/src/app/signup/page.tsx` (form at ~line 52; `ERROR_TEXT` at ~line 14)
- Modify: `apps/admin-web/src/app/auth/signup/route.ts` (~lines 30–50)
- Modify: `apps/admin-web/src/lib/auth/merchant.ts` (`signUpMerchant` input ~line 88)
- Test: `apps/admin-web/src/app/signup/page.test.tsx`, `apps/admin-web/src/app/auth/signup/route.test.ts`, `apps/admin-web/src/lib/auth/merchant.test.ts`

**Interfaces:** Consumes Task 2 (`siteType` in the POST body). Produces `SITE_TYPE_VALUES = ["store", "lead_site"] as const`
in `merchant.ts` and `signUpMerchant({ ..., siteType })`.

- [ ] **Step 1: Failing tests**
  - page: a `fieldset` whose `legend` reads `What are you building? / بتعمل إيه؟`, containing two radio inputs
    `name="siteType"` with values `store` and `lead_site`, **neither checked by default**, `required` on the group;
    labels exactly `Online store / متجر إلكتروني` and `Lead website / موقع لجمع العملاء`; helper texts
    `Sell products with a cart and cash on delivery / بيع منتجات بسلة ودفع عند الاستلام` and
    `Collect enquiries through a form, WhatsApp and calls / استقبل طلبات العملاء من فورم وواتساب واتصال`;
    a note `You can't change this later / مش هتقدر تغيّر النوع بعد كده`. The fieldset sits before the country select.
  - page: `?error=site-type` renders the alert `Choose what you're building / اختار نوع موقعك`.
  - route: form without `siteType` → 303 redirect to `/signup?error=site-type` and `signUpMerchant` not called;
    `siteType=lead_site` → `signUpMerchant` called with `siteType: "lead_site"`.
  - merchant.ts: the JSON body POSTed contains `"siteType":"lead_site"`.
- [ ] **Step 2:** `node <pnpm.cjs> --filter admin-web exec vitest run src/app/signup src/app/auth/signup src/lib/auth/merchant.test.ts` → FAIL.
- [ ] **Step 3: Implement** with the existing `Label` and the radio-card look of the design system (a bordered card per
  option, the whole card clickable via the `label`, visible focus ring, works in RTL). Use the existing `back(origin, code)`
  helper for `site-type`.
- [ ] **Step 4:** same command → PASS; `node <pnpm.cjs> --filter admin-web typecheck` → 0 errors.
- [ ] **Step 5: Commit** `feat(admin-web): choose store or lead website at sign-up`.

---

### Task 4: setup guide per site type (UI)

**Files:**
- Modify: `apps/admin-web/src/lib/api/store-settings.ts` (`StoreSettingsDto.siteType?: "store" | "lead_site"`, the
  guard ~line 29 accepts it, `DEFAULT_STORE_SETTINGS.siteType = "store"`)
- Modify: `apps/admin-web/src/lib/dashboard/setup-guide.ts` (`SetupFacts.siteType`, `buildSetupSteps`)
- Modify: `apps/admin-web/src/components/dashboard/setup-guide-section.tsx` (pass `storeSettings?.siteType ?? "store"`)
- Test: `apps/admin-web/src/lib/dashboard/setup-guide.test.ts`, `apps/admin-web/src/lib/api/store-settings.test.ts` (create if absent)

**Interfaces:** Consumes Task 1 view field `siteType`. Produces `SetupFacts.siteType: "store" | "lead_site"`.

- [ ] **Step 1: Failing tests**
  - `buildSetupSteps({ ...facts, siteType: "store" }).map(s => s.id)` →
    `["product", "shipping", "payments", "theme", "domain", "order"]` (unchanged).
  - `buildSetupSteps({ ...facts, siteType: "lead_site" }).map(s => s.id)` → `["theme", "domain"]`
    (the lead-form and test-lead steps arrive with Plan C).
  - DTO guard accepts `{ ...valid, siteType: "lead_site" }`, accepts it absent, rejects `siteType: "x"`.
- [ ] **Step 2:** `node <pnpm.cjs> --filter admin-web exec vitest run src/lib/dashboard src/lib/api/store-settings.test.ts` → FAIL.
- [ ] **Step 3: Implement.** No new copy needed (existing step labels).
- [ ] **Step 4:** PASS; `node <pnpm.cjs> --filter admin-web typecheck` → 0 errors.
- [ ] **Step 5: Commit** `feat(admin-web): show the setup steps that fit the site type`.
