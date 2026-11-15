# Merchant Self-Serve Onboarding — Backend (Plan 1a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merchant can create a store from a public API call, sign in with email + password, and the store's settings, domains and billing work for that store under `TENANT_MODE=multi`.

**Architecture:** Tenancy gains a platform-scoped staff directory (email → store) and per-request store settings; merchants get unpinned `/store/*` routes for settings, domains and billing that always act on the caller's own tenant. An `apps/admin` `MerchantOnboarding` service orchestrates sign-up (tenant → directory row → provisioning → password → settings → trial subscription → sign-in), resumable per email. Plan 1b (admin-web screens) builds on these routes.

**Tech Stack:** TypeScript, Fastify via `defineRoute` (`@platform/http`), zod, Prisma 6 (hand-written SQL migrations), vitest, pnpm/turbo.

**Spec:** `docs/superpowers/specs/2026-10-16-merchant-self-serve-onboarding-design.md`

## Global Constraints

- Never run `prisma migrate`, `db push` or any SQL against a real database. Migrations are hand-written, additive only, and the owner deploys them. Each new tenant-scoped table gets its own RLS `tenant_isolation` policy (copy the block in `packages/db/prisma/schema/migrations/20261013000000_store_shipping_taxes/migration.sql`).
- Never enable `TENANT_MODE=multi` in any deployment config; document only.
- A client never supplies the tenant, shop, price or plan amount a route acts on. `/store/*` routes always use `context.tenantId` as the shop.
- No object reachable from `WiredAdmin` outside the `tenancy` key may carry a field named `tenantId`, `_tenantId`, `defaultTenantId` or `pinnedTenantId` (`apps/admin/src/tenant-mode-guard.ts` walks the graph under multi). Hand services narrow function ports (closures), never a controller or repository object.
- Errors use the existing `Result`/`err`/`ok` (`@platform/types`) and `DomainError` subclasses (`@platform/utils`: `ValidationError`, `ConflictError`, `NotFoundError`, `AuthorizationError`, `BusinessRuleError`).
- Conventional Commits, lower-case subject, body lines ≤ 100 chars; end every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit with `git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com" commit ...`. Never `--no-verify`. Stage only the task's files (never `.superpowers/` or `.claude/`).
- Countries: `EG`→`EGP`/`Africa/Cairo`, `SA`→`SAR`/`Asia/Riyadh`, `AE`→`AED`/`Asia/Dubai`; weight unit `kg`.
- Rate limits: sign-up 5 per IP per hour and 3 per email per hour; merchant login 10 per email per 15 minutes; reset request 5 per email per hour.
- Error codes on the wire: `EMAIL_TAKEN` (409), `SIGNUP_UNAVAILABLE` (503), `INVALID_CREDENTIALS` (401), `RATE_LIMITED` (429).
- Test commands: `pnpm --filter @platform/tenancy test`, `pnpm --filter @platform/licensing test`, `pnpm --filter @platform/admin test`, plus `typecheck` for each touched package (`pnpm --filter <pkg> typecheck`). Run `pnpm --filter @platform/db exec prisma validate` after editing a `.prisma` file (validation only; never migrate).

## Review Focus

1. **A retry after a half-finished sign-up** (provisioning or subscription failed): the same email must resume the same store, never create a second tenant, and never leave the email permanently blocked. Pinned in Task 7.
2. **A `/store/*` route given another store's id** (a domain id or invoice id belonging to store A, sent with store B's token): must answer 404 and change nothing. Pinned in Tasks 3 and 6.
3. **Settings save after the setup guide was dismissed**: a Settings → General save must not resurrect the guide. Pinned in Task 2.
4. **Unknown email vs wrong password at merchant login**: identical status and body. Pinned in Task 8.
5. **Arabic or punctuation-only store names**: must still yield a valid, unique slug. Pinned in Task 7.

---

### Task 1: Per-request store settings

The store-settings repository is bound to one tenant at construction, and its routes sit inside the tenancy family that is pinned to the platform tenant under multi mode, so a merchant's Settings → General cannot work. Make the tenant a per-call argument and move the routes out of the pinned family.

**Files:**

- Modify: `services/tenancy/src/domain/repositories.ts` (StoreSettingsRepository)
- Modify: `services/tenancy/src/infrastructure/in-memory-repositories.ts` (InMemoryStoreSettingsRepository)
- Modify: `services/tenancy/src/infrastructure/prisma-repositories.ts` (PrismaStoreSettingsRepository)
- Modify: `services/tenancy/src/application/store-settings.use-cases.ts`
- Modify: `services/tenancy/src/interfaces/tenancy.controller.ts` (getStoreSettings, updateStoreSettings, getPublicStore)
- Modify: `apps/admin/src/interfaces/tenancy.admin-controller.ts` (getStoreSettings, getStoreRegion, updateStoreSettings, getPublicStore)
- Modify: `apps/admin/src/http/store-settings-routes.ts`, `apps/admin/src/http/tenancy-routes.ts` (remove `...storeSettingsRoutes(admin)`), `apps/admin/src/http/admin-routes.ts` (register `...storeSettingsRoutes(admin)` unpinned, right after the tenancy block)
- Modify: every caller of `getStoreRegion` (grep `getStoreRegion` in `apps/admin/src`)
- Test: `services/tenancy/src/application/store-settings.use-cases.test.ts`, `services/tenancy/src/infrastructure/prisma-store-settings.test.ts`, `apps/admin/src/http/store-settings-routes.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export interface StoreSettingsRepository {
    get(tenantId: string, tx?: unknown): Promise<StoreSettings | null>;
    save(tenantId: string, settings: StoreSettings, tx?: unknown): Promise<void>;
  }
  // use cases
  GetStoreSettings.execute({ tenantId }): Result<StoreSettingsView>
  UpdateStoreSettings.execute({ tenantId, ...StoreSettingsInput }): Result<StoreSettingsView>
  GetPublicStore.execute({ tenantId }): Result<PublicStoreView>
  // TenancyController
  getStoreSettings(tenantId: string)
  updateStoreSettings(tenantId: string, input: StoreSettingsInput)
  getPublicStore(tenantId: string)
  // TenancyAdminController
  getStoreSettings(principal, tenantId)
  getStoreRegion(principal, tenantId)
  updateStoreSettings(principal, tenantId, input)
  getPublicStore(tenantId)
  ```

- [ ] **Step 1: Write the failing tests.** In `store-settings.use-cases.test.ts` add:

```ts
it("keeps each store's settings apart", async () => {
  const settings = new InMemoryStoreSettingsRepository();
  const unitOfWork = new InMemoryUnitOfWork();
  const update = new UpdateStoreSettings({ settings, unitOfWork });
  const get = new GetStoreSettings({ settings });
  const base = { contactEmail: null, timezone: "Africa/Cairo", weightUnit: "kg" };
  await update.execute({ tenantId: "shop-a", storeName: "A", currency: "EGP", ...base });
  await update.execute({ tenantId: "shop-b", storeName: "B", currency: "SAR", ...base });
  const a = await get.execute({ tenantId: "shop-a" });
  const b = await get.execute({ tenantId: "shop-b" });
  expect(a.ok && a.value.storeName).toBe("A");
  expect(b.ok && b.value.currency).toBe("SAR");
  const c = await get.execute({ tenantId: "shop-c" });
  expect(c.ok && c.value.storeName).toBe(""); // defaults, never another store's row
});
```

In `apps/admin/src/http/store-settings-routes.test.ts` add a case that two principals with different `context.tenantId` values save different store names through `PUT /store/settings` and each `GET /store/settings` returns its own (follow the file's existing harness for building `context`).

- [ ] **Step 2: Run** `pnpm --filter @platform/tenancy test -- store-settings` — expected FAIL (signature mismatch / shared row).

- [ ] **Step 3: Implement.**
  - In-memory: replace `private current` with `private readonly rows = new Map<string, StoreSettings>()`; `get(tenantId)` returns `this.rows.get(tenantId) ?? null`; `save(tenantId, s)` sets it.
  - Prisma: drop the use of `this.deps.tenantId` in `PrismaStoreSettingsRepository`. Reads: when `tx` is given use it, otherwise wrap in `runReadScoped(this.deps.prisma, tenantId, (client) => ...)` (import from `@platform/db`; same helper shape as `readScoped` in `services/shipping/src/infrastructure/prisma-shipment-repository.ts:20-30`). Writes: `upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data })` with the `tenantId` argument. The class keeps its constructor deps (it is still built inside `wireTenancy`).
  - Use cases: inputs gain `tenantId: string`; pass it through to the repository. `UpdateStoreSettings` builds `StoreSettings.create(rest)` from the input without `tenantId`.
  - `TenancyController`: the three methods take `tenantId` first and pass `{ tenantId }` / `{ tenantId, ...input }`.
  - `TenancyAdminController`: the four methods gain `tenantId: string` (after `principal` where there is one).
  - Routes: `GET /store/settings` → `admin.tenancy.getStoreSettings(context.principal, context.tenantId)`; `PUT` → `updateStoreSettings(context.principal, context.tenantId, body)`; `GET /public/store` → `admin.tenancy.getPublicStore(context.tenantId)`. Update every `getStoreRegion` caller to pass `context.tenantId`.
  - Move registration: delete `...storeSettingsRoutes(admin),` from `tenancyRoutes` (`tenancy-routes.ts:386`) and its import there; add `...storeSettingsRoutes(admin),` to `adminRoutes` in `admin-routes.ts` directly after the tenancy IIFE block, importing it from `./store-settings-routes`. Update the doc comment above `pinRoutesToTenant` if it lists store settings.

- [ ] **Step 4: Run** `pnpm --filter @platform/tenancy test`, `pnpm --filter @platform/tenancy typecheck`, `pnpm --filter @platform/admin test`, `pnpm --filter @platform/admin typecheck` — expected all PASS. Fix any other caller the typechecker reports (e.g. `prisma-store-settings.test.ts` now passes a tenant id).

- [ ] **Step 5: Commit** — `feat(tenancy): store settings are per request tenant, not pinned to the platform`.

---

### Task 2: Setup-guide dismissal on store settings

Shopify's Home shows a setup guide until the merchant finishes or dismisses it. Persist the dismissal on the store-settings row; a Settings → General save must keep it.

**Files:**

- Create: `packages/db/prisma/schema/migrations/20261016020000_setup_guide_dismissed/migration.sql`
- Modify: `packages/db/prisma/schema/tenancy.prisma` (StoreSettings: `setupGuideDismissedAt DateTime? @map("setup_guide_dismissed_at")`)
- Modify: `services/tenancy/src/domain/store-settings.ts`, `services/tenancy/src/infrastructure/mappers.ts` (StoreSettingsMapper), `services/tenancy/src/application/store-settings.use-cases.ts`, `services/tenancy/src/interfaces/tenancy.controller.ts`, `services/tenancy/src/composition.ts`, `apps/admin/src/interfaces/tenancy.admin-controller.ts`, `apps/admin/src/http/store-settings-routes.ts`
- Test: `services/tenancy/src/application/store-settings.use-cases.test.ts`, `services/tenancy/src/domain/store-settings.test.ts`, `apps/admin/src/http/store-settings-routes.test.ts`

**Interfaces:**

- Consumes: Task 1's per-tenant repository and use-case inputs.
- Produces: `StoreSettingsView.setupGuideDismissedAt: string | null` (ISO); use case `DismissSetupGuide.execute({ tenantId })` → `Result<StoreSettingsView>`; `TenancyController.dismissSetupGuide(tenantId)`; `TenancyAdminController.dismissSetupGuide(principal, tenantId)` (permission `settings:update`); route `POST /store/setup-guide/dismiss` (version 1, `idempotent: true`) → 200 with the view.

- [ ] **Step 1: Migration** (write exactly):

```sql
-- Project 1 (merchant onboarding) — when the merchant dismissed Home's setup guide. Written by hand,
-- NOT applied by the agent; the owner deploys it before the release that reads it. Additive,
-- expand-only (MIGRATIONS.md §1). The table already has its RLS policy.
ALTER TABLE "tenancy"."store_settings" ADD COLUMN "setup_guide_dismissed_at" TIMESTAMP(3);
```

- [ ] **Step 2: Failing tests.** Use-case test:

```ts
it("a settings save keeps the setup guide dismissed", async () => {
  const settings = new InMemoryStoreSettingsRepository();
  const unitOfWork = new InMemoryUnitOfWork();
  const clock = { now: () => new Date("2026-10-16T10:00:00.000Z") };
  const dismiss = new DismissSetupGuide({ settings, unitOfWork, clock });
  const update = new UpdateStoreSettings({ settings, unitOfWork });
  const dismissed = await dismiss.execute({ tenantId: "shop-a" });
  expect(dismissed.ok && dismissed.value.setupGuideDismissedAt).toBe("2026-10-16T10:00:00.000Z");
  const saved = await update.execute({
    tenantId: "shop-a",
    storeName: "A",
    contactEmail: null,
    currency: "EGP",
    timezone: "Africa/Cairo",
    weightUnit: "kg",
  });
  expect(saved.ok && saved.value.setupGuideDismissedAt).toBe("2026-10-16T10:00:00.000Z");
});
```

Route test: `POST /store/setup-guide/dismiss` returns 200 with a non-null `setupGuideDismissedAt`, and a following `GET /store/settings` shows it.

- [ ] **Step 3: Run** the tenancy tests — FAIL (no `DismissSetupGuide`).

- [ ] **Step 4: Implement.**
  - `StoreSettings`: add prop `setupGuideDismissedAt: Date | null` (default `null` in `defaults()` and `create()`); add `withSetupGuideDismissed(at: Date): StoreSettings` and `withSetupGuideDismissedAt(at: Date | null): StoreSettings` returning copies (keep the class immutable, as it is now); getter `setupGuideDismissedAt`. `StoreSettingsInput` does NOT gain the field — merchants never send it.
  - Mapper: read/write `setupGuideDismissedAt`.
  - `toStoreSettingsView`: add `setupGuideDismissedAt: s.setupGuideDismissedAt?.toISOString() ?? null`.
  - `UpdateStoreSettings`: inside the unit of work, load the current row and carry its `setupGuideDismissedAt` onto the newly created value (`created.value.withSetupGuideDismissedAt(current?.setupGuideDismissedAt ?? null)`) before saving.
  - `DismissSetupGuide` (deps `{ settings, unitOfWork, clock }`): load the row or `StoreSettings.defaults()`, `withSetupGuideDismissed(clock.now())`, save, return the view. Idempotent: an already-dismissed row keeps its first timestamp.
  - Wire it in `buildController` (`composition.ts`) and add the controller/admin-controller methods and the route.

- [ ] **Step 5: Run** tenancy + admin tests and typechecks, and `pnpm --filter @platform/db exec prisma validate` — PASS.

- [ ] **Step 6: Commit** — `feat(tenancy): remember when a merchant dismisses the setup guide`.

---

### Task 3: Merchant domain routes

Under multi mode the domain routes (`/tenants/:tenantId/domains`, `/domains/:domainId/*`) are operator routes pinned to the platform tenant. Give merchants their own routes that always act on their own shop.

**Files:**

- Modify: `services/tenancy/src/application/shop-domains.use-cases.ts` (`DomainIdInput` gains optional `shopId`)
- Modify: `apps/admin/src/interfaces/tenancy.admin-controller.ts` (four merchant methods)
- Create: `apps/admin/src/http/store-domains-routes.ts`
- Modify: `apps/admin/src/http/admin-routes.ts` (register `...storeDomainsRoutes(admin)` next to `storeSettingsRoutes`)
- Test: `services/tenancy/src/application/shop-domains.use-cases.test.ts`, `apps/admin/src/http/store-domains-routes.test.ts`

**Interfaces:**

- Consumes: existing `ListShopDomains({shopId})`, `AddCustomDomain({shopId, hostname})`, `VerifyDomain({domainId})`, `SetPrimaryDomain({domainId})`.
- Produces: `DomainIdInput { domainId: string; shopId?: string }` — when `shopId` is given and the domain's `shopRef` differs, the use case returns `NotFoundError("Domain not found")`. `TenancyAdminController.listMyDomains(principal, shopId)` (`settings:read`), `addMyDomain(principal, shopId, hostname)`, `verifyMyDomain(principal, shopId, domainId)`, `makeMyDomainPrimary(principal, shopId, domainId)` (all three `settings:update`). Routes (version 1): `GET /store/domains`, `POST /store/domains` (body `{ hostname: string 3..253 }`, strict), `POST /store/domains/:domainId/verify`, `POST /store/domains/:domainId/primary`. Each passes `context.tenantId` as `shopId`.

- [ ] **Step 1: Failing tests.** Use-case test: a domain added for `shop-a`, then `VerifyDomain.execute({ domainId, shopId: "shop-b" })` and `SetPrimaryDomain.execute({ domainId, shopId: "shop-b" })` both return `!ok` with a `NotFoundError`, and the domain is unchanged; with `shopId: "shop-a"` they behave as before. Route test (build the routes with a wired in-memory admin as `shop-domains-routes.test.ts` does): store A adds `shop-a.example.com`; with store B's context, `POST /store/domains/<A's id>/primary` → 404 and `GET /store/domains` for B does not list it; for A it does.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement.** In `VerifyDomain` and `SetPrimaryDomain`, right after loading the domain: `if (domain === null || (input.shopId !== undefined && domain.shopRef !== input.shopId)) return err(new NotFoundError("Domain not found"));`. Add the admin-controller methods (guard first, then delegate to the raw controller with `{ shopId }` / `{ shopId, hostname }` / `{ domainId, shopId }`). Routes in `store-domains-routes.ts`, shaped like `store-settings-routes.ts`; the add route is `idempotent: true`.

- [ ] **Step 4: Run** tenancy + admin tests and typechecks — PASS.

- [ ] **Step 5: Commit** — `feat(admin): merchant domain routes that act on the caller's own store`.

---

### Task 4: Staff directory (email → store)

**Files:**

- Create: `packages/db/prisma/schema/migrations/20261016030000_staff_directory/migration.sql`
- Modify: `packages/db/prisma/schema/tenancy.prisma` (model `StaffDirectoryEntry`)
- Create: `services/tenancy/src/domain/staff-directory.ts`
- Modify: `services/tenancy/src/domain/repositories.ts`, `services/tenancy/src/infrastructure/in-memory-repositories.ts`, `services/tenancy/src/infrastructure/prisma-repositories.ts`, `services/tenancy/src/composition.ts`, `services/tenancy/src/interfaces/tenancy.controller.ts`, `services/tenancy/src/index.ts`
- Create: `services/tenancy/src/application/staff-directory.use-cases.ts`
- Test: `services/tenancy/src/application/staff-directory.use-cases.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export type StaffDirectoryStatus = "pending" | "active";
  export interface StaffDirectoryEntryView {
    readonly email: string; readonly shopId: string;
    readonly ownerExternalId: string; readonly status: StaffDirectoryStatus;
  }
  export function normaliseEmail(email: string): string; // trim + lower-case
  export interface StaffDirectoryRepository {
    findByEmail(email: string, tx?: unknown): Promise<StaffDirectoryEntry | null>;
    save(entry: StaffDirectoryEntry, tx?: unknown): Promise<void>;
  }
  // TenancyController (raw, unguarded — only apps/admin services call these)
  findStaffDirectoryEntry(email: string): Promise<StaffDirectoryEntryView | null>
  recordPendingOwner(input: { email; shopId; ownerExternalId }): Promise<Result<StaffDirectoryEntryView, DomainError>>
  activateDirectoryEntry(email: string): Promise<Result<StaffDirectoryEntryView, DomainError>>
  ```

  These three return plain values/`Result`s, not `ControllerResponse`, because they are never exposed over HTTP.

- [ ] **Step 1: Migration** (write exactly):

```sql
-- Project 1 (merchant onboarding) — which store a staff email signs in to. Written by hand, NOT
-- applied by the agent; the owner deploys it before the release that reads it. Additive,
-- expand-only (MIGRATIONS.md §1). Platform-operator data like shop_domains: tenant_id is the
-- platform scope and shop_ref is the merchant's tenant. One store per email (unique email).
SET row_security = off;

CREATE TABLE "tenancy"."staff_directory" (
  "tenant_id"         TEXT NOT NULL,
  "email"             TEXT NOT NULL,
  "shop_ref"          TEXT NOT NULL,
  "owner_external_id" TEXT NOT NULL,
  "status"            TEXT NOT NULL,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_directory_pkey" PRIMARY KEY ("email"),
  CONSTRAINT "staff_directory_status_check" CHECK ("status" IN ('pending', 'active')),
  CONSTRAINT "staff_directory_email_normalised_check" CHECK ("email" = lower(btrim("email")))
);
CREATE INDEX "staff_directory_shop_ref_idx" ON "tenancy"."staff_directory" ("shop_ref");
ALTER TABLE "tenancy"."staff_directory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenancy"."staff_directory" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenancy"."staff_directory";
CREATE POLICY tenant_isolation ON "tenancy"."staff_directory" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
```

Prisma model:

```prisma
// Project 1 — which store a staff email signs in to. Platform-tenant scoped like ShopDomain;
// `shop_ref` is the merchant tenant. One store per email.
model StaffDirectoryEntry {
  tenantId        String   @map("tenant_id")
  email           String   @id
  shopRef         String   @map("shop_ref")
  ownerExternalId String   @map("owner_external_id")
  status          String // pending | active (CHECK + domain-enforced)
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @default(now()) @updatedAt @map("updated_at")

  @@index([shopRef])
  @@map("staff_directory")
  @@schema("tenancy")
}
```

- [ ] **Step 2: Failing tests** (`staff-directory.use-cases.test.ts`), through `wireTenancy` in-memory (`serializer: new InMemoryEventSerializer()`, an id generator and clock as in `tenancy.e2e.test.ts`):

```ts
it("records a pending owner, finds it by any casing, then activates it", async () => {
  const { tenancy } = wire();
  const recorded = await tenancy.recordPendingOwner({
    email: "  Owner@Shop.Test ",
    shopId: "shop-a",
    ownerExternalId: "ext-1",
  });
  expect(recorded.ok && recorded.value).toEqual({
    email: "owner@shop.test",
    shopId: "shop-a",
    ownerExternalId: "ext-1",
    status: "pending",
  });
  expect((await tenancy.findStaffDirectoryEntry("OWNER@shop.test"))?.shopId).toBe("shop-a");
  const active = await tenancy.activateDirectoryEntry("owner@shop.test");
  expect(active.ok && active.value.status).toBe("active");
});

it("refuses a second store for the same email", async () => {
  const { tenancy } = wire();
  await tenancy.recordPendingOwner({ email: "a@b.test", shopId: "shop-a", ownerExternalId: "x" });
  const again = await tenancy.recordPendingOwner({
    email: "A@b.test",
    shopId: "shop-b",
    ownerExternalId: "y",
  });
  expect(again.ok).toBe(false);
  expect(!again.ok && again.error.name).toBe("ConflictError");
});

it("activating an unknown email is not found", async () => {
  const { tenancy } = wire();
  const res = await tenancy.activateDirectoryEntry("nobody@b.test");
  expect(!res.ok && res.error.name).toBe("NotFoundError");
});
```

(Check the actual `name`/class of the errors in `@platform/utils` and assert with `toBeInstanceOf` if `name` differs.)

- [ ] **Step 3: Run** — FAIL.

- [ ] **Step 4: Implement.**
  - `staff-directory.ts`: an immutable `StaffDirectoryEntry` class with `static create({ email, shopId, ownerExternalId })` → `Result` (`ValidationError` when the normalised email lacks `@` or any field is empty; status `pending`), `static restore(props)`, `activate(): StaffDirectoryEntry` (copy with `active`), getters, and `normaliseEmail`.
  - In-memory repository: `Map<string, StaffDirectoryEntry>` keyed by normalised email.
  - Prisma repository (built with the same `PrismaTenancyRepositoriesDeps` as the others, so `tenantId` is the platform scope): `findByEmail` → `findFirst({ where: { email, tenantId } })`; `save` → `upsert({ where: { email }, create: {...row, tenantId}, update: { status, shopRef, ownerExternalId } })`.
  - Use cases in `staff-directory.use-cases.ts`: `RecordPendingOwner` (inside the unit of work: existing row → `ConflictError("Email already has a store")`, else create + save), `ActivateDirectoryEntry` (missing → `NotFoundError`; already active → returns it unchanged), `FindStaffDirectoryEntry` (normalises, returns view or null).
  - Add `staffDirectory` to `TenancyRepos` in both composition branches; wire the use cases into `TenancyController` and add the three methods; export `normaliseEmail`, `StaffDirectoryEntryView` and `StaffDirectoryStatus` from `services/tenancy/src/index.ts`.

- [ ] **Step 5: Run** tenancy tests + typecheck and `prisma validate` — PASS.

- [ ] **Step 6: Commit** — `feat(tenancy): staff directory mapping a staff email to its store`.

---

### Task 5: Licensing reads and actions for a merchant's own billing

**Files:**

- Modify: `services/licensing/src/domain/repositories.ts` (`PlanRepository.listPublished`, `InvoiceRepository.listByTenantRef`)
- Modify: the in-memory and Prisma implementations of those two repositories (find them with `grep -rn "implements PlanRepository\|implements InvoiceRepository" services/licensing/src`)
- Create: `services/licensing/src/application/merchant-billing.use-cases.ts`
- Modify: `services/licensing/src/composition.ts`, `services/licensing/src/interfaces/licensing.controller.ts`, `services/licensing/src/index.ts`
- Test: `services/licensing/src/application/merchant-billing.use-cases.test.ts`

**Interfaces:**

- Produces:

  ```ts
  // repositories
  PlanRepository.listPublished(tx?: unknown): Promise<readonly Plan[]>; // publishedVersionId set, sorted by basePriceMinor then key
  InvoiceRepository.listByTenantRef(tenantRef: string, tenantId: string, tx?: unknown): Promise<readonly Invoice[]>; // newest first

  export interface MerchantPlanView {
    readonly key: string; readonly name: string; readonly planVersionRef: string;
    readonly priceMinor: number; readonly currency: string;
    readonly billingCycle: "monthly" | "annual"; readonly trialDays: number;
  }
  export interface MerchantInvoiceView {
    readonly id: string; readonly status: string; readonly totalMinor: number;
    readonly currency: string; readonly createdAt: string;
  }
  export interface MerchantBillingView {
    readonly plan: MerchantPlanView | null;      // null ⇒ no subscription yet
    readonly status: string | null;              // subscription status
    readonly nextChargeAt: string | null;        // renewalSchedule.nextRenewalAt
    readonly trialEndsAt: string | null;         // = nextChargeAt while no invoice exists and trialDays > 0
    readonly cardOnFile: boolean;                // findActiveByTenantRef !== null
    readonly invoices: readonly MerchantInvoiceView[];
  }
  // use cases (all take the PLATFORM scope as tenantId and the merchant as tenantRef)
  GetMerchantBilling.execute({ tenantRef, tenantId }): Result<MerchantBillingView>
  ListPublishedPlans.execute({}): Result<readonly MerchantPlanView[]>
  ResolveDefaultPlanVersion.execute({ planKey }): Result<{ planVersionRef: string }> // NotFoundError when no plan or no published version
  ChangeMerchantPlan.execute({ tenantRef, tenantId, planKey }): Result<{ id: string }> // re-pins to that plan's published version
  // LicensingController — NOT wrapped in platformOnly; callers pass the platform scope themselves
  getMerchantBilling(input), listPublishedPlans(), resolveDefaultPlanVersion(input), changeMerchantPlan(input)
  ```

  If the existing `Invoice` lacks a `createdAt` getter, add one fed from the row (mapper) — check `services/licensing/src/domain/invoice.ts` first.

- [ ] **Step 1: Failing tests** through `wireLicensing` in-memory. Seed one plan with `createPlan` → `createPlanDraft` (pricing `{ basePriceMinor: 29900, currency: "EGP", billingCycle: "monthly", trialDays: 14, creditAllowances: {} }`) → `publishPlanVersion`, all with the platform `tenantId` (follow `services/licensing/src/licensing.e2e.test.ts` or the nearest existing test for the call shapes). Cases:
  1. `resolveDefaultPlanVersion({ planKey: "basic" })` returns the published version ref; an unknown key and a plan with no published version both return `NotFoundError`.
  2. After `createSubscription` + `activateSubscription` for `tenantRef: "shop-a"` with a clock at `2026-10-16T00:00:00Z`, `getMerchantBilling({ tenantRef: "shop-a", tenantId: PLATFORM })` returns `plan.priceMinor === 29900`, `status === "active"`, `nextChargeAt === "2026-10-30T00:00:00.000Z"`, `trialEndsAt === nextChargeAt`, `cardOnFile === false`, `invoices: []`.
  3. `getMerchantBilling` for `tenantRef: "shop-b"` (no subscription) returns `plan: null, status: null, invoices: []` — never shop-a's data.
  4. After an invoice is created for shop-a, `trialEndsAt` is `null` and the invoice is listed; shop-b still lists none.
  5. `listPublishedPlans()` lists the plan; a plan with only a draft is absent.
  6. `changeMerchantPlan({ tenantRef: "shop-a", tenantId: PLATFORM, planKey: "pro" })` re-pins to pro's published version (seed a second plan); an unknown key → `NotFoundError`; shop-b without a subscription → `NotFoundError`.

- [ ] **Step 2: Run** `pnpm --filter @platform/licensing test -- merchant-billing` — FAIL.

- [ ] **Step 3: Implement** the repository methods (Prisma: `plan.findMany({ where: { publishedVersionId: { not: null } } })` then sort in code; `invoice.findMany({ where: { tenantRef, tenantId }, orderBy: { createdAt: "desc" } })` through the same scoping helper the file already uses for invoice reads), the four use cases (use `findPinnedVersion` for the subscription's version; `ChangeMerchantPlan` loads the subscription by `findByTenantRef` and delegates to the existing `RepinSubscription` logic or calls the same aggregate method it uses), wiring and controller methods (present with the file's `present(result, 200)` helper).

- [ ] **Step 4: Run** licensing tests + typecheck — PASS.

- [ ] **Step 5: Commit** — `feat(licensing): merchant-scoped billing view, plan list and plan change`.

---

### Task 6: Merchant billing routes

**Files:**

- Modify: `apps/admin/src/interfaces/licensing.admin-controller.ts` (merchant methods)
- Modify: `apps/admin/src/composition.ts` (expose `platformScope(requestTenantId: string): string` on `WiredAdmin` = `deps.platformTenantId ?? requestTenantId`, as a function)
- Create: `apps/admin/src/http/store-billing-routes.ts`
- Modify: `apps/admin/src/http/admin-routes.ts` (register next to the other `/store/*` routes)
- Test: `apps/admin/src/http/store-billing-routes.test.ts`

**Interfaces:**

- Consumes: Task 5's controller methods; existing `LicensingController.beginCardEnrolment({ invoiceId, tenantId })`.
- Produces (all version 1, all use `context.tenantId` as `tenantRef` and `admin.platformScope(context.tenantId)` as `tenantId`):
  - `GET /store/billing` (`settings:read`) → `MerchantBillingView`
  - `GET /store/billing/plans` (`settings:read`) → `{ items: MerchantPlanView[] }`
  - `POST /store/billing/plan` (`settings:update`, body `{ planKey: string 1..64 }` strict, `idempotent: true`) → 200 `{ id }`
  - `POST /store/billing/invoices/:invoiceId/pay` (`settings:update`) → 200 `{ checkoutUrl }`. Before starting enrolment, load the merchant's invoices (`getMerchantBilling`) and answer **404** unless `invoiceId` is one of them — another store's invoice id is never paid or revealed.

- [ ] **Step 1: Failing tests** with an in-memory `wireAdmin` (seed the plan through `admin`'s licensing controller as the platform, as in Task 5): store A's `GET /store/billing` shows its plan; store B's shows `plan: null`; B's `POST /store/billing/invoices/<A's invoice id>/pay` → 404; `POST /store/billing/plan` with an unknown key → 404.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** the admin-controller methods (guard first) and routes, shaped like `store-settings-routes.ts`.

- [ ] **Step 4: Run** admin tests + typecheck — PASS.

- [ ] **Step 5: Commit** — `feat(admin): merchant billing routes over the caller's own subscription`.

---

### Task 7: Merchant onboarding service (sign-up orchestration)

**Files:**

- Create: `apps/admin/src/merchant-onboarding/slug.ts`, `apps/admin/src/merchant-onboarding/country.ts`, `apps/admin/src/merchant-onboarding/merchant-onboarding.ts`
- Modify: `apps/admin/src/composition.ts` (`AdminWiringDeps.defaultPlanKey?: string`; build `merchantOnboarding` and expose it on `WiredAdmin`)
- Modify: `apps/runtime/src/config.ts` (`DEFAULT_PLAN_KEY: z.string().min(1).optional()`), `apps/runtime/src/api.ts` (pass `defaultPlanKey`), `.env.example` (document `DEFAULT_PLAN_KEY=` near `TENANT_MODE`, with a comment: the licensing plan key new stores start their trial on; unset ⇒ self-serve sign-up is refused), `infrastructure/railway/README.md` (one table row like `PLATFORM_STORE_DOMAIN`'s)
- Test: `apps/admin/src/merchant-onboarding/slug.test.ts`, `apps/admin/src/merchant-onboarding/merchant-onboarding.test.ts`

**Interfaces:**

- Consumes: Task 1 `updateStoreSettings(tenantId, input)` (raw `TenancyController`), Task 4 directory methods, Task 5 `resolveDefaultPlanVersion`, existing `createTenant`, `createSubscription`, `activateSubscription`, `admin.tenantProvisioner.provision`, `admin.securityWiring.identityDirectory.register`, `admin.securityWiring.passwordRegistrar.setPassword`, `admin.staffAuth.login`.
- Produces:

  ```ts
  export type SignupCountry = "EG" | "SA" | "AE";
  export interface SignupInput {
    storeName: string;
    email: string;
    password: string;
    country: SignupCountry;
  }
  export type SignupOutcome =
    | { kind: "created"; tenantId: string; storeUrl: string | null; session: AdminResponse } // session = the staffAuth.login response (200 with accessToken)
    | { kind: "email-taken" }
    | { kind: "unavailable"; reason: "no-default-plan" | "provisioning-incomplete" | "not-multi" };
  export interface MerchantOnboarding {
    signUp(input: SignupInput): Promise<SignupOutcome>;
  }
  export function deriveSlugBase(storeName: string, random: () => string): string;
  export const COUNTRY_DEFAULTS: Readonly<
    Record<SignupCountry, { currency: string; timezone: string }>
  >;
  ```

  `WiredAdmin.merchantOnboarding: MerchantOnboarding`. Its constructor takes only functions (closures) and `platformTenantId: string | undefined` — no `tenantId` field anywhere (Global Constraints).

- [ ] **Step 1: Slug tests and code.** `slug.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveSlugBase } from "./slug";

const rnd = () => "k3x9qa";
describe("deriveSlugBase", () => {
  it("lower-cases and hyphenates Latin names", () => {
    expect(deriveSlugBase("  My Cool Shop!! ", rnd)).toBe("my-cool-shop");
  });
  it("strips accents", () => {
    expect(deriveSlugBase("Café Délice", rnd)).toBe("cafe-delice");
  });
  it("falls back to store-<random> for Arabic or symbol-only names", () => {
    expect(deriveSlugBase("متجر الأمل", rnd)).toBe("store-k3x9qa");
    expect(deriveSlugBase("!!!", rnd)).toBe("store-k3x9qa");
  });
  it("keeps Latin parts of a mixed name", () => {
    expect(deriveSlugBase("Nour نور Store", rnd)).toBe("nour-store");
  });
  it("caps the length at 40 without a trailing hyphen", () => {
    const slug = deriveSlugBase("a".repeat(30) + " " + "b".repeat(30), rnd);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });
});
```

`slug.ts`:

```ts
/**
 * Project 1: a store's URL slug from its name — ASCII lower-case letters, digits and single hyphens
 * (TenantSlug's rule). Names with no Latin letters or digits (Arabic names) get `store-<random>`;
 * the merchant can connect their own domain later. Uniqueness is the caller's job (suffix -2, -3…).
 */
export function deriveSlugBase(storeName: string, random: () => string): string {
  const ascii = storeName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const capped = ascii.slice(0, 40).replace(/-+$/g, "");
  return capped === "" ? `store-${random()}` : capped;
}

/** Six lower-case base-36 characters. */
export function randomSlugSuffix(): string {
  return Math.random().toString(36).slice(2, 8).padEnd(6, "0");
}
```

Run `pnpm --filter @platform/admin test -- slug` — PASS after writing both.

- [ ] **Step 2: `country.ts`:**

```ts
export type SignupCountry = "EG" | "SA" | "AE";

/** Project 1: launch countries and the store defaults each implies (spec §2 step 7). */
export const COUNTRY_DEFAULTS: Readonly<
  Record<SignupCountry, { readonly currency: string; readonly timezone: string }>
> = Object.freeze({
  EG: { currency: "EGP", timezone: "Africa/Cairo" },
  SA: { currency: "SAR", timezone: "Asia/Riyadh" },
  AE: { currency: "AED", timezone: "Asia/Dubai" },
});
```

- [ ] **Step 3: Failing orchestration tests** (`merchant-onboarding.test.ts`). Build a real in-memory admin with `wireAdmin({ serializer, idGenerator (UUID-shaped, as in public-staff-auth-routes.test.ts), clock, passwordAuthProvider: HashedPasswordAuthProvider(... ScryptPasswordHasher({ log2N: 10 })), staffTokenIssuer: <NativeTokenIssuer as in that test>, platformTenantId: "platform", defaultPlanKey: "basic", platformStoreDomain: "morbeh.test" })`, and seed plan `basic` (trialDays 14) via `admin`'s raw licensing as the platform. Cases:
  1. **Happy path:** `signUp({ storeName: "Nour Store", email: "Owner@Nour.test", password: "correct-horse-1", country: "SA" })` → `kind: "created"`, `storeUrl === "https://nour-store.morbeh.test"`, `session.status === 200` with an `accessToken`; the store's settings (`getStoreSettings(tenantId)` on the raw tenancy controller) are `{ storeName: "Nour Store", currency: "SAR", timezone: "Asia/Riyadh", weightUnit: "kg", contactEmail: "owner@nour.test" }`; the directory entry is `active`; `getMerchantBilling` for the tenant shows `status: "active"` and a `trialEndsAt` 14 days after the clock.
  2. **Email taken:** a second `signUp` with the same email in different casing → `{ kind: "email-taken" }` and no new tenant (count tenants via the raw `listTenants`).
  3. **Slug collision:** two stores named "Nour Store" with different emails → slugs `nour-store` and `nour-store-2`.
  4. **No default plan:** with `defaultPlanKey` unset (or naming a plan with no published version) → `{ kind: "unavailable", reason: "no-default-plan" }` and **no tenant created**.
  5. **Resume after a failure:** make provisioning report incomplete once (wrap `tenantProvisioner.provision` through the ports so the test can inject a one-time failure, e.g. by constructing `MerchantOnboarding` directly in this test with the real admin's closures except a `provision` that fails the first call) → first call `{ kind: "unavailable", reason: "provisioning-incomplete" }`, directory row `pending`; second call with the same email → `kind: "created"` with the **same** `tenantId` and the tenant count unchanged.
  6. **Not multi:** constructed with `platformTenantId: undefined` → `{ kind: "unavailable", reason: "not-multi" }`.

- [ ] **Step 4: Run** — FAIL.

- [ ] **Step 5: Implement `merchant-onboarding.ts`:**

```ts
import { randomUUID } from "node:crypto";
import type { Logger } from "@platform/utils";
import type { AdminResponse } from "./../interfaces/admin-response";
import { COUNTRY_DEFAULTS, type SignupCountry } from "./country";
import { deriveSlugBase, randomSlugSuffix } from "./slug";

export type { SignupCountry } from "./country";

export interface SignupInput {
  readonly storeName: string;
  readonly email: string;
  readonly password: string;
  readonly country: SignupCountry;
}

export type SignupOutcome =
  | {
      readonly kind: "created";
      readonly tenantId: string;
      readonly storeUrl: string | null;
      readonly session: AdminResponse;
    }
  | { readonly kind: "email-taken" }
  | {
      readonly kind: "unavailable";
      readonly reason: "no-default-plan" | "provisioning-incomplete" | "not-multi";
    };

interface DirectoryEntry {
  readonly email: string;
  readonly shopId: string;
  readonly ownerExternalId: string;
  readonly status: "pending" | "active";
}

/** Narrow function ports only — no controller or repository objects (tenant-mode-guard graph walk). */
export interface MerchantOnboardingPorts {
  readonly platformTenantId: string | undefined;
  readonly defaultPlanKey: string | undefined;
  readonly platformStoreDomain: string | undefined;
  readonly logger: Logger;
  readonly findEntry: (email: string) => Promise<DirectoryEntry | null>;
  readonly recordPending: (entry: {
    email: string;
    shopId: string;
    ownerExternalId: string;
  }) => Promise<boolean>;
  readonly activateEntry: (email: string) => Promise<void>;
  readonly resolveDefaultPlan: (planKey: string) => Promise<string | null>; // planVersionRef
  readonly slugTaken: (slug: string) => Promise<boolean>;
  readonly createTenant: (input: { slug: string; name: string }) => Promise<string | null>; // tenant id, null on slug conflict
  readonly provision: (tenantId: string, ownerExternalId: string) => Promise<boolean>; // report.complete
  readonly setOwnerPassword: (
    tenantId: string,
    email: string,
    password: string,
    ownerExternalId: string,
  ) => Promise<void>;
  readonly saveStoreSettings: (
    tenantId: string,
    input: {
      storeName: string;
      contactEmail: string;
      currency: string;
      timezone: string;
      weightUnit: string;
    },
  ) => Promise<void>;
  readonly startTrial: (tenantRef: string, planVersionRef: string) => Promise<void>; // create (conflict = already done) + activate
  readonly signIn: (tenantId: string, email: string, password: string) => Promise<AdminResponse>;
}

const MAX_SLUG_ATTEMPTS = 20;

export class MerchantOnboarding {
  constructor(private readonly ports: MerchantOnboardingPorts) {}

  async signUp(input: SignupInput): Promise<SignupOutcome> {
    const p = this.ports;
    if (p.platformTenantId === undefined || p.platformTenantId === "") {
      return { kind: "unavailable", reason: "not-multi" };
    }
    const email = input.email.trim().toLowerCase();
    const existing = await p.findEntry(email);
    if (existing?.status === "active") return { kind: "email-taken" };

    const planVersionRef =
      p.defaultPlanKey === undefined ? null : await p.resolveDefaultPlan(p.defaultPlanKey);
    if (planVersionRef === null) {
      p.logger.error("merchant signup refused: DEFAULT_PLAN_KEY unset or not a published plan", {
        defaultPlanKey: p.defaultPlanKey ?? null,
      });
      return { kind: "unavailable", reason: "no-default-plan" };
    }

    let tenantId: string;
    let ownerExternalId: string;
    let slug: string | null = null;
    if (existing !== null) {
      tenantId = existing.shopId; // resume the half-created store, never a second one
      ownerExternalId = existing.ownerExternalId;
    } else {
      const created = await this.createUniqueTenant(input.storeName.trim());
      tenantId = created.tenantId;
      slug = created.slug;
      ownerExternalId = randomUUID();
      if (!(await p.recordPending({ email, shopId: tenantId, ownerExternalId }))) {
        return { kind: "email-taken" }; // lost a race with a concurrent sign-up for this email
      }
    }

    if (!(await p.provision(tenantId, ownerExternalId))) {
      p.logger.error("merchant signup: provisioning incomplete; retry resumes", { tenantId });
      return { kind: "unavailable", reason: "provisioning-incomplete" };
    }
    await p.setOwnerPassword(tenantId, email, input.password, ownerExternalId);
    const defaults = COUNTRY_DEFAULTS[input.country];
    await p.saveStoreSettings(tenantId, {
      storeName: input.storeName.trim(),
      contactEmail: email,
      currency: defaults.currency,
      timezone: defaults.timezone,
      weightUnit: "kg",
    });
    await p.startTrial(tenantId, planVersionRef);
    await p.activateEntry(email);
    const session = await p.signIn(tenantId, email, input.password);
    const zone = p.platformStoreDomain;
    const storeUrl =
      slug !== null && zone !== undefined && zone !== "" ? `https://${slug}.${zone}` : null;
    return { kind: "created", tenantId, storeUrl, session };
  }

  private async createUniqueTenant(name: string): Promise<{ tenantId: string; slug: string }> {
    const base = deriveSlugBase(name, randomSlugSuffix);
    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
      const slug = attempt === 1 ? base : `${base}-${attempt}`;
      if (await this.ports.slugTaken(slug)) continue;
      const tenantId = await this.ports.createTenant({ slug, name });
      if (tenantId !== null) return { tenantId, slug };
    }
    throw new Error("merchant signup: no free slug after 20 attempts");
  }
}
```

On resume the store URL is unknown to the orchestrator (`slug` is null); make `storeUrl` come from a port instead if a test needs it — acceptable to return `null` on resume. The happy-path test asserts the URL only for a first-time sign-up.

In `composition.ts`, build it after `tenantProvisioner`, `staffAuth` and `security` exist, with closures over the raw `tenancy.tenancy` and `licensing.licensing` controllers (read the exact property names in the file), e.g.:

- `slugTaken: async (slug) => (await tenancyRaw.findTenantBySlug?.(slug)) ...` — if the raw controller has no slug lookup, add `TenancyController.slugTaken(slug): Promise<boolean>` backed by `tenants.findBySlug` (a plain method like Task 4's).
- `createTenant`: call `createTenant({ slug, name, isolationTier: "pooled" })`; status 201 → `body.id`; 409 → `null`; anything else → throw.
- `provision`: `(await admin-level tenantProvisioner.provision(tenantId, { ownerExternalId })).complete`.
- `setOwnerPassword`: `security.identityDirectory.register(ownerExternalId)` then `security.passwordRegistrar.setPassword({ tenantId, identifier: staffIdentifier(email), password, principalExternalId: ownerExternalId })`.
- `saveStoreSettings`: raw `updateStoreSettings(tenantId, input)`; status ≥ 300 → throw.
- `startTrial`: `createSubscription({ tenantRef, planVersionRef, tenantId: platformTenantId })` (201, or 409 = already created → look the subscription up with `getMerchantBilling` and skip activation when its `status` is already `active`), then `activateSubscription({ subscriptionId, tenantId: platformTenantId })`.
- `signIn`: `staffAuth.login({ tenantId, email, password })`.
- `platformTenantId: deps.platformTenantId`, `defaultPlanKey: deps.defaultPlanKey`, `platformStoreDomain: deps.platformStoreDomain`.
  Thread `DEFAULT_PLAN_KEY` from runtime config into `createAdminHttpApi`'s deps in `api.ts` the same way `PLATFORM_STORE_DOMAIN` is.

- [ ] **Step 6: Run** admin + runtime tests and typechecks, and `node scripts/ops/check-env-docs.mjs` (expect no NEW finding about `DEFAULT_PLAN_KEY`; pre-existing findings about other variables are not this task's) — PASS.

- [ ] **Step 7: Commit** — `feat(admin): self-serve merchant sign-up orchestration, resumable per email`.

---

### Task 8: Public sign-up, merchant login and password reset routes

**Files:**

- Create: `apps/admin/src/http/public-merchant-routes.ts`
- Modify: `apps/admin/src/http/admin-routes.ts` (options gain `platformTenantId?: string`; register `...publicMerchantRoutes(admin, { rateLimiter, platformTenantId })`)
- Modify: `apps/admin/src/http/server.ts` (pass `platformTenantId` into `adminRoutes` options when multi)
- Modify: `apps/admin/src/interfaces/staff-auth.admin-controller.ts` (`requestPasswordReset` gains optional `storeId` appended to the link as `&store=<id>`)
- Test: `apps/admin/src/http/public-merchant-routes.test.ts`

**Interfaces:**

- Consumes: Task 7 `admin.merchantOnboarding.signUp`, Task 4 `findStaffDirectoryEntry` (expose to admin as a closure `admin.findStoreForEmail(email): Promise<{ shopId: string; status: string } | null>` built in composition), existing `admin.staffAuth.login / requestPasswordReset / completePasswordReset`, `ScryptPasswordHasher` from `@platform/security`.
- Produces (version 1, `public: true`, permission `security:authenticate`, NOT idempotent):
  - `POST /public/merchant-signup` body (strict) `{ storeName: string 2..60 (trimmed), email: string 3..320 containing "@", password: string 8..256, country: "EG"|"SA"|"AE" }`. Refuse with `403` unless `context.tenantId === options.platformTenantId` (and `503 SIGNUP_UNAVAILABLE` when `options.platformTenantId` is undefined). Rate limits before any work: `rl:signup-ip:<ip>` 5/hour (use the request IP the route args expose; check `defineRoute`'s handler args for `ip`/`request` and use what exists), `rl:signup-email:<normalised email>` 3/hour. Outcomes: `created` → `201 { tenantId, storeUrl, accessToken, tokenType, expiresIn }` (taken from `session.body`); `email-taken` → `409 { code: "EMAIL_TAKEN", message }`; `unavailable` → `503 { code: "SIGNUP_UNAVAILABLE", message }` (no internal reason on the wire).
  - `POST /public/auth/merchant/login` body `{ email, password }` (same limits as staff login body). Platform tenant only (as above). Rate limit `rl:merchant-login:<email>` 10 per 15 min. Look up the store; when there is none or it is `pending`, run `hasher.verify(password, dummyHash)` once (a module-level `ScryptPasswordHasher` and a lazily computed dummy hash, as `HashedPasswordAuthProvider` does) and answer `401 { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect" }`. Otherwise `staffAuth.login({ tenantId: shopId, email, password })`; any non-200 except `403 MFA_REQUIRED` → the same 401 body; 200 → pass through.
  - `POST /public/auth/merchant/password-reset/request` body `{ email }` → always `202 {}` after the same lookup; when an active store exists, `staffAuth.requestPasswordReset({ tenantId: shopId, email, storeId: shopId })`. Rate limit `rl:merchant-reset:<email>` 5/hour.
  - `POST /public/auth/merchant/password-reset/complete` body `{ store: string 1..64, token, password: 8..256 }` → `staffAuth.completePasswordReset({ tenantId: store, token, password })` passed through.

- [ ] **Step 1: Failing tests** (route handlers called directly as `public-staff-auth-routes.test.ts` does, with its `CountingRateLimiter`, plus a seeded plan and `platformTenantId: "platform"`):
  1. sign-up with `context.tenantId: "platform"` → 201 with `accessToken`; same email again → 409 `EMAIL_TAKEN`.
  2. sign-up with `context.tenantId: "shop-x"` → 403.
  3. routes built with `platformTenantId: undefined` → sign-up 503 `SIGNUP_UNAVAILABLE`.
  4. merchant login: right password → 200 with `accessToken`; wrong password and unknown email → **deep-equal** status and body (`401`, `INVALID_CREDENTIALS`).
  5. reset request for an unknown email and a known one → both `202 {}`.
  6. the 4th sign-up from one IP within the hour is allowed only up to 5 (assert the limiter keys/limits recorded, e.g. `rl:signup-ip:...|5|3600000`).
  7. body validation: a 7-character password or `country: "US"` → 400.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** the routes and the `storeId` link parameter (`${origin}/reset-password?token=...&store=${encodeURIComponent(storeId)}` only when given).

- [ ] **Step 4: Run** admin tests + typecheck — PASS.

- [ ] **Step 5: Commit** — `feat(admin): public merchant sign-up, sign-in and password reset routes`.

---

### Task 9: Two signed-up stores stay apart (isolation cases) and docs

**Files:**

- Create: `apps/admin/src/http/merchant-onboarding-isolation.e2e.test.ts`
- Modify: `apps/runtime/src/composition.ts` (replace the stale "T10.5 has not been written" comment, around line 222)
- Modify: `docs/plans/UNIFIED-ROADMAP.md` (a dated status paragraph), `packages/db/prisma/schema/migrations/MIGRATIONS.md` or the repo's migrations log (find it: `find . -name MIGRATIONS.md -not -path "*/node_modules/*"`) — list the two new migrations under "owner deploys"

**Interfaces:**

- Consumes: everything above, through `createAdminHttpApi({ tenantMode: "multi", tenantId: "platform", ... })`.

- [ ] **Step 1: Write the suite.** Harness like `tenant-isolation.e2e.test.ts` (in-memory infra doubles, `tenantMode: "multi"`), but with: a real `NativeTokenIssuer` (`generateKeyPairSync("ec", { namedCurve: "P-256" })`) as `staffTokenIssuer`, an `authenticator` that verifies those tokens (use `JwtVerifier` with `localKeyResolver` from `@platform/auth` — see how `apps/runtime/src/api.ts` builds the native verifier — and map the verified claims to `{ principal, claims }`), `HashedPasswordAuthProvider` with `ScryptPasswordHasher({ log2N: 10 })`, `platformStoreDomain: "morbeh.test"`, `defaultPlanKey: "basic"`, and the plan seeded before the app starts (through `wireAdmin`'s licensing as the platform, or through `/api/v1/plans` with a platform token). Remove `tenantGate` from the deps so the real tenant rows are used. Sign up store A and store B over HTTP (`POST /api/v1/public/merchant-signup` with `x-tenant-id: platform`). Cases:
  1. B's token: `GET /api/v1/store/settings` shows B's name; with an added `x-tenant-id: <A>` header it still shows B's.
  2. B's token cannot read A's domains (`GET /store/domains` lists only B's) and `POST /store/domains/<A's domain id>/primary` → 404.
  3. B's token: `GET /store/billing` is B's; paying A's invoice id → 404.
  4. Merchant login with A's email returns a token whose `tenant_id` claim is A, never B.
  5. A sign-up retry with A's email → 409 and B's settings are unchanged.
  6. B's token on an operator route (`GET /api/v1/tenants`) → 403.

  (Check the route prefix the existing e2e uses — `/api/v1/...` — and match it.)

- [ ] **Step 2: Run** `pnpm --filter @platform/admin test -- merchant-onboarding-isolation` — fix only test wiring until it runs; any **product** failure is a real finding: fix it in the product code of the task it belongs to, in this commit, and say so in the report.

- [ ] **Step 3: Docs.** Replace the stale comment with: multi mode is possible, the T10.5 isolation suite exists (`apps/admin/src/http/tenant-isolation.e2e.test.ts`, `merchant-onboarding-isolation.e2e.test.ts`), and multi is still not to be enabled until the roadmap's remaining blockers close (legacy storage-key count, T10.7 class B). Add a roadmap status paragraph dated 2026-10-16: self-serve sign-up and per-store settings/domains/billing routes are code-complete on branch `morbeh/merchant-onboarding`; two additive migrations to deploy; sign-up answers 503 until `TENANT_MODE=multi` and `DEFAULT_PLAN_KEY` are set by the owner. List both migrations in the migrations log.

- [ ] **Step 4: Run** the full admin, tenancy and licensing suites and typechecks — PASS.

- [ ] **Step 5: Commit** — `test(admin): two self-serve stores stay isolated; docs for onboarding`.
