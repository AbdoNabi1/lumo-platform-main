# Lead Site Part A — Site Type at Sign-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Ruling (owner, 2026-11-22):** "كمل" while Sol (reviewer-astra) and Terra are rate-limited (reset ~17:43): Part A
starts before Sol's round-3 verdict, on impl-sonnet. Sol reviews round 3 and every finished Part A task when it returns;
any finding goes back as a fix round. Merge/push still need the owner's go-ahead.

**Status:** `OPUS: AGREED · Sol: PENDING (round 3 queued)` (revision 3 — answers plan reviews 1 and 2; see the "Opus triage" sections
at the end of `2026-11-20-lead-site-plan-review-1.md` and `-review-2.md`)

**Goal:** a new merchant chooses whether they are building an online store or a lead website; the choice is stored on
the shop, can never be changed afterwards, and drives the setup guide (and, in later plans, storefront and tracking).

**Architecture:** `site_type` and `site_type_settled_at` live on `tenancy.store_settings`. The type is written by exactly
one operation, `settleSignupSiteType(tenantId, requested)`: a single conditional write that sets the type and the
settled time **only if the row is not settled yet**, then returns the persisted type. The sign-up orchestrator calls it
right after `provision` and **before** `setOwnerPassword`, i.e. before any credential for the store exists. Ordinary
settings saves and the guide dismissal never write either column.

**Resulting rule (owner decision 1):**

- A retry after a failure **before** settlement (tenant creation, `provision`) applies the retrier's choice — no
  credential existed, nobody could have used the store.
- From settlement on, the type is fixed: every retry, concurrent resume, settings save or dismissal keeps it, and every
  response reports the persisted type (never the request's).
- This does not depend on which login surfaces refuse pending owners.

**Tech stack:** TypeScript, Prisma (hand-written additive SQL), zod, Next.js App Router, vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-lead-site-and-tracking-design.md` (decisions 1–2).

**Base:** branch `morbeh/lead-site` (worktree `F:/New folder/morbeh-lead-site`); dependencies are installed.

## Implementers

Task 1 `impl-terra` · Task 2 `impl-sonnet` · Task 3 `impl-sonnet` (UI) · Task 4 `impl-sonnet` (UI).

## Global Constraints

- `SITE_TYPES = ["store", "lead_site"] as const`. No third value. Existing rows and new rows default to `store`.
- No HTTP route, server action or settings form may write `site_type` / `site_type_settled_at`. `PUT /store/settings`
  keeps its five-field allow-list (`apps/admin/src/http/store-settings-routes.ts:5-11`).
- Store-settings Prisma writes run in `runInTenantTransaction(prisma, <shop tenant id>, …)`
  (`packages/db/src/transaction.ts:41`), never the unscoped `PrismaUnitOfWork`. The tenancy composition keeps its shared
  `unitOfWork` for every other use case.
- Migration additive, hand-written, owner deploys. Never run `prisma migrate` / `db push`.
- Every command is printed in full and runs as is in bash. pnpm is always
  `node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs` (the shim fails in agent shells).
- Commit identity `git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com"`, conventional types,
  trailer `Co-Authored-By: <model that wrote it>`. Stage only the task's files. Never stash/checkout/reset/`--no-verify`.
- New test files: `beforeEach(() => { expect.hasAssertions(); })`. Exact-shape assertions are updated to include
  `siteType`, never loosened to partial matches. Remove imports/variables a change leaves unused (`noUnusedLocals`).
- Admin-web UI: Arabic + English side by side as the sign-up page does, existing `Label`/design tokens, RTL-safe.

## Review Focus

1. Two overlapping resumes with opposite choices: both responses and both GETs agree on one persisted type.
2. A settings save, an absent-row first save, or a dismissal can never write the type.
3. A sign-up POST without `siteType`, or with `"lead"`, is refused `422` `VALIDATION` by the real server.
4. A stored row with an unknown `site_type` fails loudly in the mapper (message contains `site_type`).
5. A viewer who cannot read private settings never sees commerce steps; the public reader exposes exactly
   `name`, `currency`, `siteType`.

---

### Task 1: `siteType` on store settings (tenancy)

**Files:**

- Modify: `services/tenancy/src/domain/store-settings.ts`, `services/tenancy/src/domain/repositories.ts:42-46`
- Modify: `services/tenancy/src/application/store-settings.use-cases.ts`
- Modify: `services/tenancy/src/infrastructure/mappers.ts:139-157`, `prisma-repositories.ts:259-289`,
  `in-memory-repositories.ts` (store-settings repository)
- Modify: `services/tenancy/src/interfaces/tenancy.controller.ts` (deps + method)
- Modify: `services/tenancy/src/composition.ts:157-163` (Update/Dismiss constructors lose `unitOfWork`; add `SettleSignupSiteType`)
- Modify: `services/tenancy/src/index.ts` (export `SITE_TYPES`, `SiteType`, `isSiteType`)
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
// StoreSettings gains `readonly siteType: SiteType` and `withSiteType(siteType: SiteType): StoreSettings` (copies
// every other field). withSiteType exists only for restoring a row (mapper: create(row) → withSetupGuideDismissedAt
// → withSiteType, in-memory adapter likewise); persistence ignores the field except in settleSignupSiteType.
// defaults() and create() give "store"; every with* method copies siteType.

// domain/repositories.ts — StoreSettingsRepository:
get(tenantId: string, tx?: unknown): Promise<StoreSettings | null>;           // unchanged signature
save(tenantId: string, settings: StoreSettings, tx?: unknown): Promise<void>; // create AND update data exclude both site-type columns
/** Read-modify-write in one tenant-scoped transaction; `change` gets the row or defaults; returns the row as persisted. */
modify(tenantId: string, change: (current: StoreSettings) => StoreSettings): Promise<StoreSettings>;
/** The only writer of the site type. Sets it (with settled time `at`) unless already settled; returns the persisted type. */
settleSignupSiteType(tenantId: string, requested: SiteType, at: Date): Promise<SiteType>;

// application
// StoreSettingsView.siteType: SiteType;  PublicStoreView.siteType: SiteType
export class SettleSignupSiteType {
  constructor(deps: { readonly settings: StoreSettingsRepository; readonly clock: { now(): Date } });
  execute(input: { readonly tenantId: string; readonly siteType: SiteType }): Promise<Result<{ siteType: SiteType }, DomainError>>;
}
// UpdateStoreSettings deps → { settings }; DismissSetupGuide deps → { settings, clock }. Both call settings.modify and
// present the value it returns. GetStoreSettings / GetPublicStore unchanged apart from the new view field.

// interfaces/tenancy.controller.ts — no HTTP route registers it:
settleSignupSiteType(tenantId: string, siteType: SiteType): Promise<ControllerResponse>; // present(result, 200) → { siteType }
```

**Prisma adapter, exact behavior** (all inside one `runInTenantTransaction(prisma, tenantId, async (tx) => …)`):

- `save`: `tx.storeSettings.upsert({ where: { tenantId }, create: { tenantId, …settingsColumns }, update: { …settingsColumns } })`
  where `settingsColumns` is today's column set **without** `siteType`/`siteTypeSettledAt` (the DB default gives
  `store` on insert).
- `modify`: `findFirst({ where: { tenantId } })` → `change(row ? toDomain(row) : defaults())` → the same `upsert` as
  `save` → return `toDomain(<row returned by the upsert>)` (so the reported type is the persisted one).
- `settleSignupSiteType`:
  1. `createMany({ data: [{ tenantId, siteType: requested, siteTypeSettledAt: at }], skipDuplicates: true })`;
  2. if `count === 0`: `updateMany({ where: { tenantId, siteTypeSettledAt: null }, data: { siteType: requested, siteTypeSettledAt: at } })`;
  3. `findFirst({ where: { tenantId } })` → return its `siteType` (mapped; unknown → the mapper's error).
     Each statement is a single-row atomic write; a concurrent second settle blocks on the row lock, re-evaluates
     `siteTypeSettledAt IS NULL` as false, and reads the winner's type.
- In-memory adapter mirrors this synchronously (check-and-set before any `await`).

- [ ] **Step 1: Failing tests.**
      `store-settings.use-cases.test.ts` — every constructor edit:
  - harness (line ~14–18): drop `const unitOfWork` and its `InMemoryUnitOfWork` import if unused; `update: new UpdateStoreSettings({ settings })`;
    add `dismiss: new DismissSetupGuide({ settings, clock: { now: () => AT } })`,
    `settle: new SettleSignupSiteType({ settings, clock: { now: () => AT } })`, and expose `settings`;
    `const AT = new Date("2026-11-20T10:00:00.000Z")`.
  - lines ~93–94, ~111–114, ~130–132, ~141–143: remove `unitOfWork` from each object literal and delete the now-unused
    `const unitOfWork = new InMemoryUnitOfWork();` lines.
  - add `siteType: "store"` to every existing exact view expectation. New cases:

```ts
it("settles the sign-up site type and reports it", async () => {
  const h = harness();
  expect(await h.settle.execute({ tenantId: TENANT, siteType: "lead_site" })).toEqual({
    ok: true,
    value: { siteType: "lead_site" },
  });
  const view = await h.get.execute({ tenantId: TENANT });
  expect(view.ok && view.value.siteType).toBe("lead_site");
});
it("a settled type never changes: a later settle reports the first", async () => {
  const h = harness();
  await h.settle.execute({ tenantId: TENANT, siteType: "lead_site" });
  expect(await h.settle.execute({ tenantId: TENANT, siteType: "store" })).toEqual({
    ok: true,
    value: { siteType: "lead_site" },
  });
});
it("two concurrent settles with opposite choices agree on one type", async () => {
  const h = harness();
  const [x, y] = await Promise.all([
    h.settle.execute({ tenantId: TENANT, siteType: "lead_site" }),
    h.settle.execute({ tenantId: TENANT, siteType: "store" }),
  ]);
  const persisted = (await h.settings.get(TENANT))?.siteType;
  expect(x.ok && x.value.siteType).toBe(persisted);
  expect(y.ok && y.value.siteType).toBe(persisted);
});
it("a settings save keeps the site type", async () => {
  const h = harness();
  await h.settle.execute({ tenantId: TENANT, siteType: "lead_site" });
  const saved = await h.update.execute(input);
  expect(saved.ok && saved.value.siteType).toBe("lead_site");
});
it("dismissing the guide keeps the site type", async () => {
  const h = harness();
  await h.settle.execute({ tenantId: TENANT, siteType: "lead_site" });
  const r = await h.dismiss.execute({ tenantId: TENANT });
  expect(r.ok && r.value.siteType).toBe("lead_site");
  expect(r.ok && r.value.setupGuideDismissedAt).toBe(AT.toISOString());
});
it("a stale snapshot saved after settlement cannot restore the old type", async () => {
  const h = harness();
  const stale = StoreSettings.defaults(); // siteType "store"
  await h.settle.execute({ tenantId: TENANT, siteType: "lead_site" });
  await h.settings.save(TENANT, stale);
  expect((await h.settings.get(TENANT))?.siteType).toBe("lead_site");
});
it("public store exposes exactly name, currency, siteType", async () => {
  const h = harness();
  await h.settle.execute({ tenantId: TENANT, siteType: "lead_site" });
  expect(await h.publicStore.execute({ tenantId: TENANT })).toEqual({
    ok: true,
    value: { name: "", currency: "EGP", siteType: "lead_site" },
  });
});
```

Domain (`store-settings.test.ts`): `defaults()` and `create(...)` give `"store"`; `withSiteType("lead_site")` keeps
currency, timezone and `setupGuideDismissedAt`; `defaults().withSiteType("lead_site").withSetupGuideDismissedAt(null)`
keeps `"lead_site"`; `isSiteType` true only for `"store"`/`"lead_site"` (false for `"lead"`, `""`,
`undefined`, `1`).
Prisma adapter (`prisma-store-settings.test.ts`, its existing `fakeClient` recorder; add `siteType: "store"`,
`siteTypeSettledAt: null` to existing row fixtures; make the fake's `upsert` return its `create`/`update` merged row,
`createMany` return `{ count }` and `updateMany` return `{ count }` as configured per test):

- `save("tenant-a", <settings>)` (absent row): the upsert's `create` and `update` objects have **no** `siteType` or
  `siteTypeSettledAt` key.
- `modify("tenant-a", (s) => s)`: `set_config` with `"tenant-a"` precedes `findFirst` and `upsert`; the returned
  `siteType` equals the `siteType` of the row the fake upsert returned (configure it to return `"lead_site"` while
  `findFirst` returned `"store"`, and expect `"lead_site"`).
- `settleSignupSiteType("tenant-b", "lead_site", AT)` with `createMany` count 1: records `set_config "tenant-b"`,
  `createMany` with data `[{ tenantId: "tenant-b", siteType: "lead_site", siteTypeSettledAt: AT }]` and
  `skipDuplicates: true`, no `updateMany`, then `findFirst`; returns `"lead_site"`.
- same with `createMany` count 0 and `updateMany` count 0 and `findFirst` row `siteType: "store"`: `updateMany` was
  called with `where: { tenantId: "tenant-b", siteTypeSettledAt: null }`; returns `"store"`.
- `get` on a row with `siteType: "shop"` rejects with an `Error` whose message contains `site_type`.
- [ ] **Step 2: Run, expect FAIL**

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/tenancy exec vitest run src/domain/store-settings.test.ts src/application/store-settings.use-cases.test.ts src/infrastructure/prisma-store-settings.test.ts
```

- [ ] **Step 3: Implement** domain, both adapters, use cases, mapper (unknown value →
      `throw new Error(\`store_settings.site_type is not a site type: ${String(value)}\`)`), controller, composition.
- [ ] **Step 4: Prisma schema + migration.** `StoreSettings` gains
      `siteType String @default("store") @map("site_type")` and `siteTypeSettledAt DateTime? @map("site_type_settled_at")`.

```sql
ALTER TABLE "tenancy"."store_settings"
  ADD COLUMN "site_type" TEXT NOT NULL DEFAULT 'store',
  ADD COLUMN "site_type_settled_at" TIMESTAMP(3);
ALTER TABLE "tenancy"."store_settings"
  ADD CONSTRAINT "store_settings_site_type_check" CHECK ("site_type" IN ('store', 'lead_site'));
```

(No backfill: rows of active shops are never settled again because only pending sign-ups reach the settle call.)

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

- [ ] **Step 6: Commit** `feat(tenancy): settle a shop's site type once, at sign-up`.

---

### Task 2: sign-up API settles `siteType`; storefront reads it

**Files:**

- Modify: `apps/admin/src/http/public-merchant-routes.ts:17-28` (`signupBody`) and both 201 bodies (~164–185)
- Modify: `apps/admin/src/merchant-onboarding/merchant-onboarding.ts` (`SignupInput`, ports, outcome; call between
  `provision` (~line 151) and `setOwnerPassword` (~155); update the resume comment at ~140–142)
- Modify: `apps/admin/src/composition.ts:1629-1631` (new port next to `saveStoreSettings`)
- Modify: `apps/storefront/src/lib/runtime-api.ts:334-354` (`PublicStore`, `getPublicStore`)
- Test: `apps/admin/src/merchant-onboarding/merchant-onboarding.test.ts`, `apps/admin/src/http/public-merchant-routes.test.ts`,
  `apps/admin/src/http/server.multi-tenant.test.ts`, `apps/admin/src/http/merchant-onboarding-isolation.e2e.test.ts`,
  `apps/admin/src/http/store-settings-routes.test.ts`, `apps/storefront/src/lib/runtime-api.calls.test.ts`

**Interfaces:**

- Consumes: Task 1 `SiteType`, controller `settleSignupSiteType`.
- Produces: `SignupInput.siteType: SiteType` (required). Port
  `readonly settleSiteType: (tenantId: string, siteType: SiteType) => Promise<SiteType>` — composition closure:
  `const r = await tenancy.settleSignupSiteType(tenantId, siteType); expectSuccess(r, "settleSignupSiteType"); return (r.body as { siteType: SiteType }).siteType;`
  The `created` outcome gains `siteType: SiteType` = **the value the port returned**; both 201 bodies (token branch and
  `signInRequired` branch) include it. When the returned type differs from `input.siteType`, log
  `p.logger.warn("merchant signup: site type already settled; keeping it", { tenantId })`.
- Storefront: `PublicStore.siteType: "store" | "lead_site"`; `getPublicStore` returns exactly `{ name, currency, siteType }`;
  absent `siteType` → `"store"` (older runtime); any other value → `null`.

- [ ] **Step 1: Failing tests**
  - Add `siteType: "store"` to every valid sign-up fixture: `merchant-onboarding.test.ts:120-125`,
    `merchant-onboarding-isolation.e2e.test.ts:206` (the `signUp` helper; give it a `siteType` parameter defaulting to
    `"store"`) and `:437-447`, `server.multi-tenant.test.ts:137-158`, `public-merchant-routes.test.ts` (including the
    stub and exact body at ~272–297).
  - `server.multi-tenant.test.ts` (real server, existing harness): POST without `siteType` → `422`,
    `body.code === "VALIDATION"`; with `siteType: "lead"` → same. Do not test validation through the route helper in
    `public-merchant-routes.test.ts` (it fabricates its own 400).
  - orchestrator (fake ports record call order): `siteType: "lead_site"` → `settleSiteType(<tenant>, "lead_site")` runs
    after `provision` and before `setOwnerPassword`; outcome `siteType: "lead_site"`.
  - orchestrator, failure before settlement (existing provisioning-failure path, `merchant-onboarding.test.ts:200-228`):
    first attempt `lead_site` stops at provision (settle never called), retry with `store` → `settleSiteType` called once,
    with `"store"`; outcome `"store"`.
  - orchestrator, failure after settlement (existing trial-failure path, `merchant-onboarding.test.ts:231-249`): first
    attempt `lead_site` fails at `startTrial`; the fake settle keeps the first settled value; retry with `store` →
    outcome `siteType: "lead_site"` and exactly one `warn` containing `site type already settled`.
  - route: both 201 bodies include `siteType` from the outcome.
  - `merchant-onboarding-isolation.e2e.test.ts` (shared real HTTP graph): sign up `"Gamma Clinic"` /
    `owner@gamma.test` with `siteType: "lead_site"` → 201 body `siteType: "lead_site"`; with its token,
    `PUT /store/settings` with a valid five-field body **plus** `siteType: "store"` → 200; GET `/store/settings` →
    `siteType: "lead_site"`. Overlap test: two resumes for one pending email with opposite choices, the first paused
    (wrap the e2e's settle port or use the orchestrator test's fake ports if the e2e cannot pause) until the second has
    activated → both 201 bodies and the private GET report the same type.
  - `store-settings-routes.test.ts`: existing exact read bodies gain `siteType: "store"`; keep the exact key checks at
    ~232 and ~284 (update the expected key lists to include `siteType` for reads only).
  - storefront `runtime-api.calls.test.ts` (near 181–192): body `{name,currency,siteType:"lead_site",extra:1}` →
    `{ name, currency, siteType: "lead_site" }`; no `siteType` → `"store"`; `siteType: "x"` → `null`.
- [ ] **Step 2: Run, expect FAIL**

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin exec vitest run src/merchant-onboarding src/http/public-merchant-routes.test.ts src/http/server.multi-tenant.test.ts src/http/merchant-onboarding-isolation.e2e.test.ts src/http/store-settings-routes.test.ts
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter storefront exec vitest run src/lib/runtime-api.calls.test.ts
```

- [ ] **Step 3: Implement.** `signupBody` adds `siteType: z.enum(["store", "lead_site"])` and stays `.strict()`.
- [ ] **Step 4: Run, expect PASS** — both Step 2 commands, then:

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter @platform/admin typecheck
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter storefront typecheck
```

- [ ] **Step 5: Commit** `feat(admin): take the site type at merchant sign-up`.

---

### Task 3: sign-up screen — choose store or lead website (UI)

**Files:**

- Modify: `apps/admin-web/src/app/signup/page.tsx` (form ~52; `ERROR_TEXT` ~14)
- Modify: `apps/admin-web/src/app/auth/signup/route.ts` (~30–50)
- Modify: `apps/admin-web/src/lib/auth/merchant.ts` (`signUpMerchant` ~88)
- Test: `apps/admin-web/src/app/signup/page.test.tsx`, `apps/admin-web/src/app/auth/signup/route.test.ts` (fixtures
  ~17–27), `apps/admin-web/src/lib/auth/merchant.test.ts` (~32–36, ~74–79)

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
- [ ] **Step 4: Run, expect PASS** — the Step 2 command, then:

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web typecheck
```

- [ ] **Step 5: Commit** `feat(admin-web): choose store or lead website at sign-up`.

---

### Task 4: setup guide per site type (UI)

**Files:**

- Modify: `apps/admin-web/src/lib/api/store-settings.ts` (read DTO `siteType?: "store" | "lead_site"`; the guard ~29
  accepts absent or one of the two and rejects anything else; `DEFAULT_STORE_SETTINGS.siteType = "store"`;
  `updateStoreSettings` (~48–55) sends only `storeName, contactEmail, currency, timezone, weightUnit`)
- Modify: `apps/admin-web/src/lib/dashboard/setup-guide.ts` (`SetupFacts.siteType`, `buildSetupSteps`)
- Modify: `apps/admin-web/src/components/dashboard/setup-guide-section.tsx:38-75` (resolve `siteType` from the settings
  fact **before** building `facts`: ok → its `siteType ?? "store"`; any other outcome → `null`)
- Test: `apps/admin-web/src/lib/dashboard/setup-guide.test.ts` (fixtures 4–18, 57–65, 115ff),
  `apps/admin-web/src/components/dashboard/setup-guide.test.tsx` (fixtures 33–43),
  `apps/admin-web/src/components/dashboard/setup-guide-section.test.tsx`,
  `apps/admin-web/src/lib/api/store-settings.test.ts` (create if absent)

**Interfaces:** `SetupFacts.siteType: "store" | "lead_site" | null` (`null` = settings unreadable).

- [ ] **Step 1: Failing tests**
  - `buildSetupSteps({ ...facts, siteType: "store" })` ids → `["product","shipping","payments","theme","domain","order"]`.
  - `siteType: "lead_site"` → `["theme","domain"]`; `siteType: null` → `["theme","domain"]`. Lead-form steps arrive
    with Plan C. Existing dismissal/completion visibility rules (`setup-guide.ts:50–57`) unchanged.
  - `setup-guide-section.test.tsx`:
    - "still renders when every request fails" (~119–125): expect `0 of 1 tasks complete` (was 0 of 5) and no links to
      products, shipping, payments or orders.
    - "keeps the guide but hides Dismiss when store settings are unauthorized" (~135–142): expect `0 of 1 tasks complete`,
      no commerce links, still no Dismiss.
    - "still renders when a request throws" (shipping fetch rejects, ~127–133): stays `0 of 5` (settings readable).
    - new: settings ok with `siteType: "lead_site"` → `0 of 1 tasks complete`, Dismiss offered; ok with `store` → `0 of 5`.
  - DTO guard accepts `siteType` absent / `"lead_site"` and rejects `"x"`;
    `updateStoreSettings({ ...dto, siteType: "lead_site" }, "k")` sends a body without `siteType` (assert on the mocked fetch).
- [ ] **Step 2: Run, expect FAIL**

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web exec vitest run src/lib/dashboard src/components/dashboard src/lib/api/store-settings.test.ts
```

- [ ] **Step 3: Implement.** No new copy.
- [ ] **Step 4: Run, expect PASS** — the Step 2 command, then:

```bash
cd 'F:/New folder/morbeh-lead-site' && node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs --filter admin-web typecheck
```

- [ ] **Step 5: Commit** `feat(admin-web): show the setup steps that fit the site type`.
