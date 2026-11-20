# Lead Site Part A — Site Type at Sign-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** `OPUS: PENDING · Sol: PENDING` (revised after plan review 1 — see `2026-11-20-lead-site-plan-review-1.md`,
section "Opus triage (round 1)")

**Goal:** a new merchant chooses whether they are building an online store or a lead website; the choice is stored on
the shop, can never be changed after sign-up, and drives the setup guide (and, in later plans, storefront and tracking).

**Architecture:** `site_type` lives on `tenancy.store_settings`. Its **only writer** is a dedicated repository method
called by the sign-up orchestrator, which runs only for new or still-pending sign-ups (a completed email answers
`409 EMAIL_TAKEN`). Ordinary settings saves and the setup-guide dismissal never write the column. Immutability is
structural: after activation no code path can write it.

**Decision on retries (Plan review 1, finding 3 — Opus ruling):** while a sign-up is still **pending**, a retry applies
the retrier's choice, exactly as it already applies the retrier's store name, password and country (comment at the
resume branch of `apps/admin/src/merchant-onboarding/merchant-onboarding.ts`). A pending store cannot be signed in to,
so nothing has used the first choice. The owner's rule "cannot be changed after onboarding" starts at activation.

**Tech stack:** TypeScript, Prisma (hand-written additive SQL), zod, Next.js App Router, vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-lead-site-and-tracking-design.md` (decisions 1–2).

**Base:** branch `morbeh/lead-site` (worktree `F:/New folder/morbeh-lead-site`); dependencies already installed with
`pnpm install --offline --frozen-lockfile`.

## Implementers

Task 1 `impl-terra` · Task 2 `impl-sonnet` · Task 3 `impl-sonnet` (UI) · Task 4 `impl-sonnet` (UI).

## Global Constraints

- `SITE_TYPES = ["store", "lead_site"] as const`. No third value. Existing rows and new rows default to `store`.
- No HTTP route, server action or settings form may write `site_type`. `PUT /store/settings` keeps its five-field
  allow-list (`apps/admin/src/http/store-settings-routes.ts:5-11`); unknown keys stay stripped.
- Store-settings Prisma writes run in `runInTenantTransaction(prisma, <shop tenant id>, …)`
  (`packages/db/src/transaction.ts:41`) — never the unscoped `PrismaUnitOfWork` (Plan review 1, finding 2).
- Migration additive, hand-written, owner deploys. Never run `prisma migrate` / `db push`.
- Every command runs as printed (bash): `cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs …`
  — the `pnpm` shim fails in agent shells.
- Commit identity `git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com"`, conventional types,
  trailer `Co-Authored-By: <model that wrote it>`. Stage only the task's files. Never stash/checkout/reset/`--no-verify`.
- New test files: `beforeEach(() => { expect.hasAssertions(); })`. Exact-shape assertions are updated to include
  `siteType`, never loosened to partial matches.
- Admin-web UI: Arabic + English side by side as the sign-up page does, existing `Label`/design tokens, RTL-safe.

## Review Focus

1. A merchant saving Settings → General (even with a crafted `siteType` in the body) must not change the type.
2. A sign-up POST without `siteType`, or with `"lead"`, is refused `422` `VALIDATION` by the real server.
3. A stored row with an unknown `site_type` fails loudly in the mapper (message contains `site_type`).
4. A viewer who cannot read private settings never sees commerce steps on a lead site.
5. The storefront public reader exposes exactly `name`, `currency`, `siteType`.

---

### Task 1: `siteType` on store settings (tenancy)

**Files:**
- Modify: `services/tenancy/src/domain/store-settings.ts`, `services/tenancy/src/domain/repositories.ts:42-46`
- Modify: `services/tenancy/src/application/store-settings.use-cases.ts`
- Modify: `services/tenancy/src/infrastructure/mappers.ts:139-157`, `prisma-repositories.ts:259-289`,
  `in-memory-repositories.ts` (store-settings repository)
- Modify: `services/tenancy/src/interfaces/tenancy.controller.ts` (deps + method), `services/tenancy/src/composition.ts`,
  `services/tenancy/src/index.ts` (export `SITE_TYPES`, `SiteType`, `isSiteType`)
- Modify: `packages/db/prisma/schema/tenancy.prisma` (`StoreSettings`), `packages/db/prisma/MIGRATIONS.md`
- Create: `packages/db/prisma/schema/migrations/20261120000000_store_site_type/migration.sql`
- Test: `services/tenancy/src/domain/store-settings.test.ts`, `services/tenancy/src/application/store-settings.use-cases.test.ts`,
  `services/tenancy/src/infrastructure/prisma-store-settings.test.ts`

**Interfaces (produced):**

```ts
// domain/store-settings.ts
export const SITE_TYPES = ["store", "lead_site"] as const;
export type SiteType = (typeof SITE_TYPES)[number];
export function isSiteType(value: unknown): value is SiteType;
// StoreSettings gains `readonly siteType: SiteType` and `withSiteType(siteType: SiteType): StoreSettings`
// (copies every other field); every existing with* method copies siteType. defaults() and create() give "store".

// domain/repositories.ts — StoreSettingsRepository:
get(tenantId: string, tx?: unknown): Promise<StoreSettings | null>;           // unchanged
save(tenantId: string, settings: StoreSettings, tx?: unknown): Promise<void>; // upsert UPDATE data excludes site_type
/** Read-modify-write in one tenant-scoped transaction; `change` gets the row or defaults; site_type is never written. */
modify(tenantId: string, change: (current: StoreSettings) => StoreSettings): Promise<StoreSettings>;
/** The only writer of site_type. Upsert: create { tenantId, siteType } (other columns default) / update { siteType }. */
recordSignupSiteType(tenantId: string, siteType: SiteType): Promise<void>;

// application
// StoreSettingsView.siteType: SiteType;  PublicStoreView.siteType: SiteType
export class RecordSignupSiteType {
  constructor(deps: { readonly settings: StoreSettingsRepository });
  execute(input: { readonly tenantId: string; readonly siteType: SiteType }): Promise<Result<{ siteType: SiteType }, DomainError>>;
}
// UpdateStoreSettings and DismissSetupGuide: deps become { settings } (+ clock for Dismiss); they call settings.modify
// instead of unitOfWork.run, and present the value modify returns. StoreSettingsDeps drops unitOfWork.

// interfaces/tenancy.controller.ts — no HTTP route registers it:
recordSignupSiteType(tenantId: string, siteType: SiteType): Promise<ControllerResponse>; // present(result, 200)
```

- [ ] **Step 1: Failing tests.** In `store-settings.use-cases.test.ts`: update `harness()` to the new deps (no
  `unitOfWork`), add `dismiss: new DismissSetupGuide({ settings, clock: { now: () => AT } })` and
  `record: new RecordSignupSiteType({ settings })` with `const AT = new Date("2026-11-20T10:00:00.000Z")`; add
  `siteType: "store"` to every existing exact view expectation; then add:

```ts
it("records the sign-up site type", async () => {
  const h = harness();
  expect(await h.record.execute({ tenantId: TENANT, siteType: "lead_site" })).toEqual({ ok: true, value: { siteType: "lead_site" } });
  const view = await h.get.execute({ tenantId: TENANT });
  expect(view.ok && view.value.siteType).toBe("lead_site");
});
it("a settings save keeps the site type", async () => {
  const h = harness();
  await h.record.execute({ tenantId: TENANT, siteType: "lead_site" });
  const saved = await h.update.execute(input);
  expect(saved.ok && saved.value.siteType).toBe("lead_site");
});
it("dismissing the guide keeps the site type", async () => {
  const h = harness();
  await h.record.execute({ tenantId: TENANT, siteType: "lead_site" });
  const r = await h.dismiss.execute({ tenantId: TENANT });
  expect(r.ok && r.value.siteType).toBe("lead_site");
  expect(r.ok && r.value.setupGuideDismissedAt).toBe(AT.toISOString());
});
it("a stale settings snapshot cannot restore the old type", async () => {
  const h = harness();
  const stale = StoreSettings.defaults(); // siteType "store"
  await h.record.execute({ tenantId: TENANT, siteType: "lead_site" });
  await h.settings.save(TENANT, stale);
  expect((await h.settings.get(TENANT))?.siteType).toBe("lead_site");
});
it("public store exposes exactly name, currency, siteType", async () => {
  const h = harness();
  await h.record.execute({ tenantId: TENANT, siteType: "lead_site" });
  expect(await h.publicStore.execute({ tenantId: TENANT })).toEqual({
    ok: true, value: { name: "", currency: "EGP", siteType: "lead_site" },
  });
});
```

  Domain (`store-settings.test.ts`): `defaults()` and `create(...)` give `"store"`; `withSiteType("lead_site")` keeps
  currency, timezone and `setupGuideDismissedAt`; `withSetupGuideDismissedAt(null)` keeps `siteType`; `isSiteType` is
  true only for `"store"`/`"lead_site"` (false for `"lead"`, `""`, `undefined`, `1`).
  Prisma adapter (`prisma-store-settings.test.ts`, its existing `fakeClient` call recorder; add `siteType: "store"` to
  the existing row fixtures):
  - `modify("tenant-a", (s) => s)` records `set_config` with `"tenant-a"` before `findFirst` and the `upsert`; the
    upsert's `update` object has no `siteType` key.
  - `save("tenant-a", StoreSettings.defaults().withSiteType("lead_site"))`: upsert `update` has no `siteType` key,
    `create` has `siteType: "lead_site"`.
  - `recordSignupSiteType("tenant-b", "lead_site")` records `set_config "tenant-b"` then upsert
    `{ where: { tenantId: "tenant-b" }, create: { tenantId: "tenant-b", siteType: "lead_site" }, update: { siteType: "lead_site" } }`.
  - `get` on a row with `siteType: "shop"` rejects with an `Error` whose message contains `site_type`.
- [ ] **Step 2: Run, expect FAIL**

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/tenancy exec vitest run src/domain/store-settings.test.ts src/application/store-settings.use-cases.test.ts src/infrastructure/prisma-store-settings.test.ts
```

- [ ] **Step 3: Implement** domain, both repository adapters (in-memory `save`/`modify` keep the stored `siteType`),
  use cases, mapper (unknown value → `throw new Error(\`store_settings.site_type is not a site type: ${value}\`)`),
  controller, composition (`RecordSignupSiteType` in the controller deps).
- [ ] **Step 4: Prisma schema + migration.** Add `siteType String @default("store") @map("site_type")` to `StoreSettings`.

```sql
ALTER TABLE "tenancy"."store_settings" ADD COLUMN "site_type" TEXT NOT NULL DEFAULT 'store';
ALTER TABLE "tenancy"."store_settings"
  ADD CONSTRAINT "store_settings_site_type_check" CHECK ("site_type" IN ('store', 'lead_site'));
```

```bash
cd 'F:/New folder/morbeh-lead-site' && DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy DIRECT_URL=postgresql://dummy:dummy@localhost:5432/dummy node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/db exec prisma validate
cd 'F:/New folder/morbeh-lead-site' && DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy DIRECT_URL=postgresql://dummy:dummy@localhost:5432/dummy node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/db exec prisma generate
```

  Expected: "is valid", generate succeeds. The dummy URLs are only for these two commands.
- [ ] **Step 5: Run, expect PASS**

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/tenancy test
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/tenancy typecheck
cd 'F:/New folder/morbeh-lead-site' && node -e "import('./scripts/dev/check-prisma-tenant-where.mjs').then(async m=>console.log(JSON.stringify(await m.scanPrismaTenantWhere(process.cwd()))))"
```

  Expected: all pass, 0 type errors, no new tenant-where finding under `services/tenancy`.
- [ ] **Step 6: Commit** `feat(tenancy): store a shop's site type, written only at sign-up`.

---

### Task 2: sign-up API records `siteType`; storefront reads it

**Files:**
- Modify: `apps/admin/src/http/public-merchant-routes.ts:17-28` (`signupBody`) and both 201 bodies (~164–185)
- Modify: `apps/admin/src/merchant-onboarding/merchant-onboarding.ts` (`SignupInput`, ports, outcome; call after `saveStoreSettings` ~156)
- Modify: `apps/admin/src/composition.ts:1629-1631` (new port next to `saveStoreSettings`)
- Modify: `apps/storefront/src/lib/runtime-api.ts:334-354` (`PublicStore`, `getPublicStore`)
- Test: `apps/admin/src/merchant-onboarding/merchant-onboarding.test.ts`, `apps/admin/src/http/public-merchant-routes.test.ts`,
  `apps/admin/src/http/server.multi-tenant.test.ts`, `apps/admin/src/http/merchant-onboarding-isolation.e2e.test.ts`,
  `apps/admin/src/http/store-settings-routes.test.ts`, `apps/storefront/src/lib/runtime-api.calls.test.ts`

**Interfaces:**
- Consumes: Task 1 `SiteType`, controller `recordSignupSiteType`.
- Produces: `SignupInput.siteType: SiteType` (required); port
  `readonly recordSiteType: (tenantId: string, siteType: SiteType) => Promise<void>` — composition closure
  `expectSuccess(await tenancy.recordSignupSiteType(tenantId, siteType), "recordSignupSiteType")`; the `created` outcome
  gains `siteType: SiteType` (= `input.siteType`); **both** 201 bodies (token branch and `signInRequired` branch)
  include it. Storefront: `PublicStore.siteType: "store" | "lead_site"`; `getPublicStore` returns exactly
  `{ name, currency, siteType }`; absent `siteType` → `"store"` (older runtime); any other value → `null`.

- [ ] **Step 1: Failing tests**
  - Add `siteType: "store"` to every valid sign-up fixture: `merchant-onboarding.test.ts:120-125`,
    `merchant-onboarding-isolation.e2e.test.ts:206,437-447`, `server.multi-tenant.test.ts:137-158`, and
    `public-merchant-routes.test.ts` (including the stub and exact body at ~272–297).
  - `server.multi-tenant.test.ts` (real server, its existing harness): sign-up POST without `siteType` → `422` with
    `body.code === "VALIDATION"`; with `siteType: "lead"` → same. Do not test validation through the route helper in
    `public-merchant-routes.test.ts` (it fabricates its own 400).
  - orchestrator: `siteType: "lead_site"` → `recordSiteType(<tenant>, "lead_site")` is called after
    `saveStoreSettings` and before `startTrial`; the outcome has `siteType: "lead_site"`. Resume after the existing
    provisioning-failure path (`merchant-onboarding.test.ts:200-228`): first attempt `lead_site` fails at provision,
    retry with `store` succeeds → `recordSiteType` is called once, with `"store"`, and the outcome carries `"store"`.
  - route: both 201 bodies include `siteType` from the outcome.
  - `store-settings-routes.test.ts`: existing exact read bodies gain `siteType: "store"`; new case — after recording
    `lead_site` through the tenancy controller, `PUT /store/settings` whose body also carries `siteType: "store"`
    answers 200, and a following GET still shows `siteType: "lead_site"`.
  - storefront `runtime-api.calls.test.ts` (near 181–192): body `{name,currency,siteType:"lead_site",extra:1}` →
    `{ name, currency, siteType: "lead_site" }`; no `siteType` → `"store"`; `siteType: "x"` → `null`.
- [ ] **Step 2: Run, expect FAIL** 

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin exec vitest run src/merchant-onboarding src/http/public-merchant-routes.test.ts src/http/server.multi-tenant.test.ts src/http/merchant-onboarding-isolation.e2e.test.ts src/http/store-settings-routes.test.ts
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter storefront exec vitest run src/lib/runtime-api.calls.test.ts
```

- [ ] **Step 3: Implement.** `signupBody` adds `siteType: z.enum(["store", "lead_site"])` and stays `.strict()`.
- [ ] **Step 4: Run, expect PASS** — Step 2 commands, then `--filter @platform/admin typecheck` and the storefront
  `typecheck`: 0 errors.
- [ ] **Step 5: Commit** `feat(admin): take the site type at merchant sign-up`.

---

### Task 3: sign-up screen — choose store or lead website (UI)

**Files:**
- Modify: `apps/admin-web/src/app/signup/page.tsx` (form ~52; `ERROR_TEXT` ~14)
- Modify: `apps/admin-web/src/app/auth/signup/route.ts` (~30–50)
- Modify: `apps/admin-web/src/lib/auth/merchant.ts` (`signUpMerchant` ~88)
- Test: `apps/admin-web/src/app/signup/page.test.tsx`, `apps/admin-web/src/app/auth/signup/route.test.ts` (fixtures
  ~17–27), `apps/admin-web/src/lib/auth/merchant.test.ts` (~35, ~74–79)

**Interfaces:** consumes Task 2's body field; produces `SITE_TYPE_VALUES = ["store", "lead_site"] as const` in
`merchant.ts` and `signUpMerchant({ ..., siteType })`.

- [ ] **Step 1: Failing tests** (existing fixtures gain `siteType`)
  - page: a `fieldset` with legend `What are you building? / بتعمل إيه؟`, before the country select; two radios
    `name="siteType"` with values `store` and `lead_site`, **neither checked**, the first `required`; labels exactly
    `Online store / متجر إلكتروني` and `Lead website / موقع لجمع العملاء`; helper texts
    `Sell products with a cart and cash on delivery / بيع منتجات بسلة ودفع عند الاستلام` and
    `Collect enquiries through a form, WhatsApp and calls / استقبل طلبات العملاء من فورم وواتساب واتصال`; note
    `You can't change this later / مش هتقدر تغيّر النوع بعد كده`.
  - page: `?error=site-type` shows the alert `Choose what you're building / اختار نوع موقعك`.
  - route: no `siteType`, and `siteType=lead` → 303 to `/signup?error=site-type`, `signUpMerchant` not called;
    `siteType=lead_site` → called with `siteType: "lead_site"`.
  - merchant.ts: the POSTed JSON contains `"siteType":"lead_site"`.
- [ ] **Step 2: Run, expect FAIL**

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web exec vitest run src/app/signup src/app/auth/signup src/lib/auth/merchant.test.ts
```

- [ ] **Step 3: Implement** with existing `Label`, one bordered card per option (the whole card is the `label`),
  visible focus ring, RTL-safe; reuse the route's `back(origin, code)` helper.
- [ ] **Step 4: Run, expect PASS** — Step 2 command, then `--filter admin-web typecheck`: 0 errors.
- [ ] **Step 5: Commit** `feat(admin-web): choose store or lead website at sign-up`.

---

### Task 4: setup guide per site type (UI)

**Files:**
- Modify: `apps/admin-web/src/lib/api/store-settings.ts` (read DTO `siteType?: "store" | "lead_site"`; the guard ~29
  accepts absent or one of the two and rejects anything else; `DEFAULT_STORE_SETTINGS.siteType = "store"`;
  `updateStoreSettings` (~48–55) sends only `storeName, contactEmail, currency, timezone, weightUnit`)
- Modify: `apps/admin-web/src/lib/dashboard/setup-guide.ts` (`SetupFacts.siteType`, `buildSetupSteps`)
- Modify: `apps/admin-web/src/components/dashboard/setup-guide-section.tsx:38-75` (resolve `siteType` from the settings
  fact **before** building `facts`: ok → its `siteType ?? "store"`, otherwise `null`)
- Test: `apps/admin-web/src/lib/dashboard/setup-guide.test.ts` (fixtures 4–18, 57–65, 115ff),
  `apps/admin-web/src/components/dashboard/setup-guide.test.tsx` (fixtures 33–43),
  `apps/admin-web/src/components/dashboard/setup-guide-section.test.tsx`,
  `apps/admin-web/src/lib/api/store-settings.test.ts` (create if absent)

**Interfaces:** `SetupFacts.siteType: "store" | "lead_site" | null` (`null` = settings unreadable).

- [ ] **Step 1: Failing tests**
  - `buildSetupSteps({ ...facts, siteType: "store" })` ids → `["product","shipping","payments","theme","domain","order"]`.
  - `siteType: "lead_site"` → `["theme","domain"]`; `siteType: null` → `["theme","domain"]` (only steps both types
    share). Lead-form steps arrive with Plan C.
  - section: settings fact `unauthorized` → steps rendered are theme and domain only, and no Dismiss; ok + `lead_site`
    → theme and domain; ok + `store` → all six.
  - DTO guard accepts `siteType` absent / `"lead_site"` and rejects `"x"`;
    `updateStoreSettings({ ...dto, siteType: "lead_site" }, "k")` sends a body without `siteType` (assert on the mocked fetch).
- [ ] **Step 2: Run, expect FAIL**

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web exec vitest run src/lib/dashboard src/components/dashboard src/lib/api/store-settings.test.ts
```

- [ ] **Step 3: Implement.** No new copy.
- [ ] **Step 4: Run, expect PASS** — Step 2 command, then `--filter admin-web typecheck`: 0 errors.
- [ ] **Step 5: Commit** `feat(admin-web): show the setup steps that fit the site type`.
