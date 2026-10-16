# Morbeh Platform — Critical Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execute ONE PHASE PER SESSION.** Each phase ends with a `STOP` gate. Do not cross a gate without the human's approval.

**Goal:** Close the 9 Critical gaps that stand between the current codebase (41 well-built but disconnected bounded contexts) and a bootable, multi-tenant, customer-facing commerce platform.

**Architecture:** The platform is a modular monolith — `apps/runtime` composes all 41 contexts into one process. This plan keeps that shape. Cross-context calls become **in-process adapters** for anything the shopper waits on (price, tax, shipping, stock, payment), and **outbox events** for everything that happens after the shopper is told "done" (ledger, loyalty, customer profile, email). This is the Shopify model and it was chosen explicitly by the product owner. Multi-tenancy becomes real: repositories stop being pinned to one tenant at boot and are resolved per request from a cached per-tenant object graph, with PostgreSQL Row-Level Security as the enforcing floor.

**Tech Stack:** TypeScript 5.6 · Node 22+ (local runtime is v24.19.0) · pnpm 11.9 workspaces + Turborepo · Prisma 6.19.3 + PostgreSQL (Supabase, eu-west-3) · Fastify 5 via `@platform/http` · Next.js 15 App Router · Vitest · Kafka (kafkajs) · Redis (ioredis) · Ory Hydra/Kratos/Keto · zod

**Spec:** `docs/superpowers/plans/2026-08-22-critical-remediation.md` (this document). The findings it implements are the architecture review delivered on 2026-08-22; every gap ID (`C-1`…`C-9`, `H-8`) is restated inline in the task that closes it, so no external document is needed to execute.

---

## Global Constraints

Copy these verbatim into your working memory. Every task's requirements implicitly include this section.

- **Node is not on PATH in Git Bash.** Every bash command must start with:
  `export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"`
- **pnpm is not installed standalone.** It runs through a shim. In bash call it as `pnpm.cmd <args>`, never `pnpm`.
- **Docker is unavailable and cannot be installed** — hardware virtualization is disabled in BIOS (`systeminfo` reports `Virtualization Enabled In Firmware: No`). Never write a step that requires Docker, docker-compose, Testcontainers, or a locally-hosted Kafka/Debezium.
- **Database is Supabase.** Port `6543` = Transaction Pooler (app runtime, requires `?pgbouncer=true`). Port `5432` = Session Pooler (migrations, `DIRECT_URL`). The direct host `db.<ref>.supabase.co` does **not** resolve (IPv4 was withdrawn). Never write a step that connects to it.
- **Never lower a quality gate to make a step pass.** The repository currently sits at: `typecheck` 78/78 green, `test` 78/78 green, `lint` 0 errors / 408 warnings, `pnpm arch` 0 violations. Every task must leave all four at least as good.
- **`scripts/ops/check-env-docs.mjs` is a hard CI gate** (`.github/workflows/ci.yml:35`). Any new environment variable read by code MUST get a documented `KEY=` line in `.env.example` in the same commit, or CI fails.
- **`scripts/ops/check-lint-warnings.mjs` caps warnings at `MAX_WARNINGS = 413`** (`.github/workflows/ci.yml:42`). If your change reduces the real count, lower the cap in that file to the new count in the same commit — the script's own comment requires this.
- **`pnpm arch` (dependency-cruiser) enforces the layering.** `domain` imports nothing from `application`/`messaging`/`infrastructure`; `packages` never import `apps` or `services`; no cross-service internal imports. Note that `apps/**` is currently NOT cruised — do not rely on the tool to catch a layering mistake inside `apps/`.
- **Repository conventions, non-negotiable:**
  - Every `wireX(deps)` follows the `deps.port ?? new InMemoryPort()` shape. Adding a real adapter means passing it through `deps`, never replacing the fallback inline.
  - Outbox writes MUST happen inside the aggregate's own transaction (`PrismaOutboxStore.append` throws otherwise).
  - `tenantId` is required alongside `prisma` in every context's wiring (ADR-0008).
  - Comments explain _why_, not _what_, and cite the gap ID they close.
- **Commit style:** Conventional Commits, enforced by commitlint (`commitlint.config.mjs`). Example: `fix(db): set pgbouncer=true on pooled datasource URLs (C-6)`.
- **Git:** branch off `master`. There is no remote — do not attempt to push.

### Verification commands (memorize these)

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd exec turbo run typecheck --ui=stream
pnpm.cmd exec turbo run test --ui=stream
pnpm.cmd exec turbo run lint --ui=stream
pnpm.cmd run arch
node scripts/ops/check-env-docs.mjs
node scripts/ops/check-lint-warnings.mjs
```

To run one package's tests only (much faster during a task):

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd --filter @platform/db exec vitest run src/client.test.ts
```

---

## File Structure

Files this plan creates or modifies, and what each becomes responsible for.

### Phase 0 — Cheap fail-open closures

| File                                                                 | Responsibility                                                              |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/config/src/server/env.ts`                                  | add `DATABASE_PGBOUNCER`                                                    |
| `packages/config/src/server/config.ts`                               | add `DatabaseConfig.pgBouncer`, map it                                      |
| `packages/db/src/client.ts`                                          | emit `pgbouncer=true`; new `assertPgBouncerConfigured` guard                |
| `apps/runtime/src/config.ts`                                         | add `DATABASE_PGBOUNCER` to `RuntimeConfig`                                 |
| `apps/runtime/src/composition.ts`                                    | pass `pgBouncer` into `createPrismaClient`; call the guard                  |
| `services/catalog/src/domain/product-repository.ts`                  | `list`/`search` gain a `status` filter                                      |
| `services/catalog/src/infrastructure/prisma-catalog-repositories.ts` | apply the filter in SQL                                                     |
| `services/catalog/src/infrastructure/in-memory-*-repository.ts`      | apply the filter in memory                                                  |
| `services/catalog/src/application/list-products.use-case.ts`         | thread `status` through                                                     |
| `services/pricing`, `services/catalog` (collections)                 | same shape for `Price` and `Collection`                                     |
| `apps/admin/src/http/public-catalog-routes.ts`                       | pass `status: "published"`; drop `onHand`/`reserved` from the inventory DTO |
| `services/notifications/src/composition.ts`                          | make the 4 provider ports injectable                                        |
| `apps/admin/src/composition.ts`                                      | thread the 4 provider ports through `AdminWiringDeps`                       |
| `apps/runtime/src/api.ts`                                            | add the providers to the aggregated boot guard                              |
| `apps/runtime/src/worker.ts`                                         | start `wireSecurityIdentity`'s consumer fleet                               |
| `apps/runtime/src/security/seed-authorization.ts`                    | **new** — seeds Keto with the enterprise role model                         |

### Phase 1 — Real multi-tenancy + RLS

| File                                                                           | Responsibility                                                                                   |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `packages/db/src/tenant-context.ts`                                            | **new** — `AsyncLocalStorage` holding the current tenant                                         |
| `packages/db/src/client.ts`                                                    | `$extends` wrapping every query in a `set_config('app.tenant_id')` transaction                   |
| `packages/db/src/prisma-repository.ts`                                         | `PrismaUnitOfWork` sets `app.tenant_id` first inside its transaction                             |
| `packages/db/prisma/schema/migrations/<ts>_rls_tenant_isolation/migration.sql` | **new** — enable + force RLS with a `tenant_isolation` policy on every `tenant_id`-bearing table |
| `packages/db/prisma/MIGRATIONS.md`                                             | mark the §3 RLS contract as satisfied                                                            |
| `packages/http/src/server.ts`                                                  | run the request inside the tenant `AsyncLocalStorage` scope                                      |
| `apps/admin/src/http/tenant-graph-cache.ts`                                    | **new** — LRU of `wireAdmin` graphs keyed by tenant                                              |
| `apps/admin/src/http/server.ts`                                                | resolve the graph per request instead of once at boot                                            |
| `apps/runtime/src/composition.ts`                                              | delete the `TENANT_MODE=multi` boot refusal                                                      |

### Phase 2 — Event publishing

| File                                       | Responsibility                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `apps/runtime/src/outbox-relay-runtime.ts` | **new** — the polling relay loop with a distributed lock                          |
| `apps/runtime/src/worker.ts`               | start the relay                                                                   |
| `apps/runtime/src/scheduler.ts`            | prune on `status='published'` when relay mode is on                               |
| `apps/runtime/src/config.ts`               | add `OUTBOX_RELAY_ENABLED`, `OUTBOX_RELAY_INTERVAL_MS`, `OUTBOX_RELAY_BATCH_SIZE` |

### Phase 3 — In-process integration adapters (`C-3`)

| File                                                                                                                                       | Responsibility                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `apps/admin/src/infrastructure/cross-context/pricing-validation.adapter.ts`                                                                | Checkout → Pricing                                     |
| `.../tax-calculation.adapter.ts`                                                                                                           | Checkout → Pricing tax classes                         |
| `.../inventory-validation.adapter.ts`                                                                                                      | Checkout → Inventory                                   |
| `.../shipping-calculation.adapter.ts`                                                                                                      | Checkout → Shipping                                    |
| `.../promotion-validation.adapter.ts`                                                                                                      | Checkout → Promotions                                  |
| `.../orders-payment.adapter.ts`, `.../orders-inventory.adapter.ts`, `.../orders-shipping.adapter.ts`, `.../orders-notification.adapter.ts` | Orders → Payments/Inventory/Shipping/Notifications     |
| `.../payments-orders.adapter.ts`, `.../payments-finance.adapter.ts`, `.../payments-notification.adapter.ts`                                | Payments → Orders/Finance/Notifications                |
| `apps/admin/src/composition.ts`                                                                                                            | build all 12 after the contexts are wired, inject them |
| `apps/runtime/src/api.ts`                                                                                                                  | delete `assertProductionIntegrationPortsConfigured`    |

### Phase 4 — Checkout creates the order (`C-2`)

| File                                                                    | Responsibility                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `services/checkout/src/application/ports.ts`                            | new `OrderCreationPort`                                                        |
| `services/checkout/src/application/complete-checkout.use-case.ts`       | create the order instead of accepting `orderRef`                               |
| `apps/admin/src/infrastructure/cross-context/order-creation.adapter.ts` | **new** — Checkout → Orders                                                    |
| `apps/runtime/src/consumers/`                                           | **new** — Finance/Loyalty/Customer360/Notifications consumers on `orders.paid` |

### Phase 5 — Public customer surface (`C-1`)

| File                                            | Responsibility                                       |
| ----------------------------------------------- | ---------------------------------------------------- |
| `apps/admin/src/http/public-session.ts`         | **new** — Kratos-session authentication for shoppers |
| `apps/admin/src/http/public-ownership-guard.ts` | **new** — "this row belongs to this shopper"         |
| `apps/admin/src/http/public-checkout-routes.ts` | **new**                                              |
| `apps/admin/src/http/public-order-routes.ts`    | **new**                                              |
| `apps/admin/src/http/public-account-routes.ts`  | **new**                                              |
| `apps/storefront/src/app/checkout/*`            | **new** — the checkout screens                       |

---

# PHASE 0 — Close the fail-open holes

**Why first:** these four are cheap, independent of every architectural decision, and two of them are actively exploitable today. Nothing in later phases is easier if these wait.

---

### Task 1: Emit `pgbouncer=true` on pooled datasource URLs (`C-6`)

**Problem being fixed:** `buildDatasourceUrl` (`packages/db/src/client.ts:29`) sets `connection_limit` and `connect_timeout` but never `pgbouncer`, while its own sibling comment at line 46 states production fronts PostgreSQL with PgBouncer in transaction mode. Against Supabase's port-6543 pooler this makes **every query** fail with `42P05 prepared statement "s0" already exists` — reproduced experimentally against the live database.

**Files:**

- Modify: `packages/config/src/server/env.ts:21-25`
- Modify: `packages/config/src/server/config.ts:8-14` and `:145-148`
- Modify: `packages/db/src/client.ts:29-40`
- Modify: `apps/runtime/src/config.ts:14-25`
- Modify: `apps/runtime/src/composition.ts:139-145`
- Modify: `.env.example`
- Test: `packages/db/src/client.test.ts`

**Interfaces:**

- Produces: `DatabaseConfig.pgBouncer: boolean`; `buildDatasourceUrl(config: DatabaseConfig): string` (unchanged signature, new behaviour); `assertPgBouncerConfigured(config: DatabaseConfig): void` exported from `@platform/db`.
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Write the failing tests**

Append to `packages/db/src/client.test.ts`. The local `config()` helper already exists at the top of that file — extend its literal with `pgBouncer: false` so every existing test keeps compiling.

```ts
describe("buildDatasourceUrl — PgBouncer transaction mode (C-6)", () => {
  it("sets pgbouncer=true when the deployment is behind a transaction pooler", () => {
    const url = new URL(buildDatasourceUrl(config({ pgBouncer: true })));
    expect(url.searchParams.get("pgbouncer")).toBe("true");
  });

  it("does not set pgbouncer when the deployment talks to PostgreSQL directly", () => {
    const url = new URL(buildDatasourceUrl(config({ pgBouncer: false })));
    expect(url.searchParams.has("pgbouncer")).toBe(false);
  });

  it("does not override an explicit pgbouncer already present on the URL", () => {
    const url = new URL(
      buildDatasourceUrl(
        config({
          url: "postgresql://lumo:lumo@aws-0-eu-west-3.pooler.supabase.com:6543/postgres?pgbouncer=false",
          pgBouncer: true,
        }),
      ),
    );
    expect(url.searchParams.get("pgbouncer")).toBe("false");
  });
});

describe("assertPgBouncerConfigured (C-6)", () => {
  it("throws when the URL points at a transaction pooler port but pgBouncer is off", () => {
    expect(() =>
      assertPgBouncerConfigured(
        config({
          url: "postgresql://lumo:lumo@aws-0-eu-west-3.pooler.supabase.com:6543/postgres",
          pgBouncer: false,
        }),
      ),
    ).toThrow(/DATABASE_PGBOUNCER/);
  });

  it("accepts a transaction pooler port once pgBouncer is on", () => {
    expect(() =>
      assertPgBouncerConfigured(
        config({
          url: "postgresql://lumo:lumo@aws-0-eu-west-3.pooler.supabase.com:6543/postgres",
          pgBouncer: true,
        }),
      ),
    ).not.toThrow();
  });

  it("accepts a session-pooler / direct port with pgBouncer off", () => {
    expect(() =>
      assertPgBouncerConfigured(
        config({ url: "postgresql://lumo:lumo@localhost:5432/lumo", pgBouncer: false }),
      ),
    ).not.toThrow();
  });
});
```

Add `assertPgBouncerConfigured` to the file's import:

```ts
import { assertPgBouncerConfigured, buildDatasourceUrl } from "./client";
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd --filter @platform/db exec vitest run src/client.test.ts
```

Expected: FAIL — TypeScript cannot resolve `assertPgBouncerConfigured`, and `pgBouncer` is not a `DatabaseConfig` property.

- [ ] **Step 3: Add `pgBouncer` to the config contract**

`packages/config/src/server/config.ts` — extend the interface:

```ts
export interface DatabaseConfig {
  readonly url: string;
  readonly poolMax: number;
  readonly connectTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly logQueries: boolean;
  /**
   * C-6: true when `url` points at a connection pooler running in TRANSACTION mode (Supabase's
   * port-6543 pooler, PgBouncer `pool_mode=transaction`). Prisma must then disable prepared
   * statements via `?pgbouncer=true`, otherwise every query after the first fails with
   * `42P05 prepared statement "s0" already exists` — the pooler hands the same backend to a
   * different session that already declared that statement name.
   */
  readonly pgBouncer: boolean;
}
```

In the same file at the `database:` mapping (~line 145):

```ts
      poolMax: e.DATABASE_POOL_MAX,
      connectTimeoutMs: e.DATABASE_CONNECT_TIMEOUT_MS,
      statementTimeoutMs: e.DATABASE_STATEMENT_TIMEOUT_MS,
      logQueries: e.DATABASE_LOG_QUERIES,
      pgBouncer: e.DATABASE_PGBOUNCER,
```

`packages/config/src/server/env.ts` — after `DATABASE_LOG_QUERIES`:

```ts
  DATABASE_PGBOUNCER: zBool(false),
```

- [ ] **Step 4: Implement the URL parameter and the guard**

`packages/db/src/client.ts` — inside `buildDatasourceUrl`, before `return url.toString()`:

```ts
// C-6: PgBouncer transaction mode reuses one backend across sessions, so Prisma's named
// prepared statements collide (`42P05 prepared statement "s0" already exists` — reproduced
// against Supabase's port-6543 pooler). `pgbouncer=true` is Prisma's documented switch that
// disables them. An explicit value already on the URL wins, same rule as the two parameters above.
if (config.pgBouncer && !url.searchParams.has("pgbouncer")) {
  url.searchParams.set("pgbouncer", "true");
}
```

Then append to the same file:

```ts
/** Ports on which a PostgreSQL connection is a TRANSACTION-mode pooler, not a direct backend. */
const TRANSACTION_POOLER_PORTS = new Set(["6543"]);

/**
 * C-6 boot guard: refuses a datasource that is demonstrably behind a transaction pooler while
 * `DATABASE_PGBOUNCER` is off. Without `pgbouncer=true` that configuration does not degrade — it
 * fails every query with `42P05`, which looks like a database outage rather than a misconfiguration.
 * Fail closed at boot with the actual fix in the message, same posture as the five production
 * guards in `apps/runtime/src/api.ts`.
 */
export function assertPgBouncerConfigured(config: DatabaseConfig): void {
  const url = new URL(config.url);
  if (TRANSACTION_POOLER_PORTS.has(url.port) && !config.pgBouncer) {
    throw new Error(
      `db: DATABASE_URL points at a transaction-mode connection pooler (port ${url.port}) but ` +
        "DATABASE_PGBOUNCER is off. Prisma's prepared statements collide behind such a pooler and " +
        'every query fails with 42P05 "prepared statement already exists". Set ' +
        "DATABASE_PGBOUNCER=true (C-6). Migrations must keep using DIRECT_URL (session pooler, port 5432).",
    );
  }
}
```

Export it from `packages/db/src/index.ts` alongside `buildDatasourceUrl`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd --filter @platform/db exec vitest run src/client.test.ts
```

Expected: PASS, all tests in the file.

- [ ] **Step 6: Thread it through the runtime**

`apps/runtime/src/config.ts` — after `DATABASE_STATEMENT_TIMEOUT_MS` (line 25):

```ts
    /** C-6: true when DATABASE_URL is Supabase's transaction pooler (6543) or any PgBouncer in
     * transaction mode. Disables Prisma's prepared statements via `?pgbouncer=true`. */
    DATABASE_PGBOUNCER: z
      .string()
      .default("false")
      .transform((v) => v.toLowerCase() === "true"),
```

`apps/runtime/src/composition.ts` — in `buildRuntimeCore`, replace the `createPrismaClient({...})` call's options object with:

```ts
const databaseConfig = {
  url: config.DATABASE_URL,
  poolMax: config.DATABASE_POOL_MAX,
  connectTimeoutMs: config.DATABASE_CONNECT_TIMEOUT_MS,
  statementTimeoutMs: config.DATABASE_STATEMENT_TIMEOUT_MS,
  logQueries: false,
  pgBouncer: config.DATABASE_PGBOUNCER,
};
// C-6: refuse a pooler-shaped URL without the pgbouncer switch before any client is built —
// the failure mode otherwise is every query throwing 42P05 at request time, not at boot.
assertPgBouncerConfigured(databaseConfig);
const prisma = createPrismaClient(databaseConfig);
```

Add `assertPgBouncerConfigured` to the existing `@platform/db` import block at the top of the file.

- [ ] **Step 7: Document the variable**

`.env.example` — directly under the existing `DATABASE_URL=` / `DIRECT_URL=` block (around line 44):

```
# C-6: set to true whenever DATABASE_URL is a TRANSACTION-mode pooler (Supabase port 6543,
# or any PgBouncer with pool_mode=transaction). Prisma then stops using named prepared
# statements, which such a pooler cannot keep session-scoped — without this every query fails
# with 42P05 "prepared statement s0 already exists". DIRECT_URL (session pooler, port 5432)
# is unaffected and must NOT carry pgbouncer=true; the Prisma CLI needs prepared statements.
DATABASE_PGBOUNCER=false
```

- [ ] **Step 8: Verify the whole repository is still green**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd exec turbo run typecheck --ui=stream && pnpm.cmd exec turbo run test --ui=stream && node scripts/ops/check-env-docs.mjs
```

Expected: `Tasks: 78 successful, 78 total` twice, and the env-docs check exiting 0.

- [ ] **Step 9: Commit**

```bash
git add packages/config/src/server/env.ts packages/config/src/server/config.ts packages/db/src/client.ts packages/db/src/client.test.ts packages/db/src/index.ts apps/runtime/src/config.ts apps/runtime/src/composition.ts .env.example
git commit -m "fix(db): set pgbouncer=true behind transaction poolers and guard at boot (C-6)"
```

---

### Task 2: Stop serving unpublished catalog data on the public API (`C-9`)

**Problem being fixed:** `GET /api/v1/public/products` is `public: true` (unauthenticated) and calls `ListProducts` → `PrismaProductRepository.list` → `paginate({}, …)` — an **empty `where`**, so drafts, scheduled, and archived products are returned to any anonymous caller. The same holds for `/public/collections` and `/public/prices`. `apps/storefront/src/lib/catalog.ts:11-18` documents that publish-state filtering happens in the Next.js app; that is a client-side control on a server-side leak. `/public/inventory` additionally exposes `onHand` and `reserved` for the entire catalog.

**Files:**

- Modify: `services/catalog/src/domain/product-repository.ts`
- Modify: `services/catalog/src/domain/collection-repository.ts`
- Modify: `services/pricing/src/domain/price-repository.ts`
- Modify: `services/catalog/src/infrastructure/prisma-catalog-repositories.ts`
- Modify: `services/catalog/src/infrastructure/in-memory-*-repository.ts` (product, collection)
- Modify: `services/pricing/src/infrastructure/prisma-pricing-repositories.ts` and its in-memory sibling
- Modify: `services/catalog/src/application/list-products.use-case.ts`, `list-collections.use-case.ts`
- Modify: `services/pricing/src/application/list-prices.use-case.ts`
- Modify: `apps/admin/src/http/public-catalog-routes.ts`
- Test: `apps/admin/src/http/public-catalog-routes.test.ts` (exists), plus repository unit tests

**Interfaces:**

- Produces:
  - `ProductRepository.list(page: CursorPage, tx?: unknown, status?: PublishStateValue): Promise<Paginated<Product>>`
  - `ProductRepository.search(query: string, page: CursorPage, tx?: unknown, status?: PublishStateValue): Promise<Paginated<Product>>`
  - `CollectionRepository.list(page: CursorPage, tx?: unknown, status?: CollectionStatus)`
  - `PriceRepository.list(page: CursorPage, tx?: unknown, status?: PriceStatus)`
  - `ListProductsInput` gains `readonly status?: PublishStateValue`; `ListCollectionsInput` gains `readonly status?: CollectionStatus`; `ListPricesInput` gains `readonly status?: PriceStatus`
  - `PublicInventoryDto` loses `onHand` and `reserved`
- Consumes: nothing from earlier tasks.

Existing types you will reference (do not redefine them):

```ts
// services/catalog/src/domain/value-objects/publish-state.ts
export type PublishStateValue = "draft" | "scheduled" | "published" | "archived";
// services/catalog/src/domain/collection.ts
export type CollectionStatus = "draft" | "published";
// services/pricing/src/domain/price.ts
export type PriceStatus = "draft" | "published";
```

- [ ] **Step 1: Write the failing route test**

Open `apps/admin/src/http/public-catalog-routes.test.ts` and read how it builds its fixture — reuse that helper verbatim rather than inventing a new one. Add:

```ts
describe("public catalog routes withhold unpublished rows (C-9)", () => {
  it("GET /public/products returns only published products", async () => {
    // Arrange: seed one published and one draft product through the same admin controller the
    // existing tests in this file use.
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/public/products",
      headers: { "x-tenant-id": TENANT_ID },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: { status: string }[] };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item) => item.status === "published")).toBe(true);
  });

  it("GET /public/collections returns only published collections", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/public/collections",
      headers: { "x-tenant-id": TENANT_ID },
    });
    const body = response.json() as { items: { status: string }[] };
    expect(body.items.every((item) => item.status === "published")).toBe(true);
  });

  it("GET /public/prices returns only published prices", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/public/prices",
      headers: { "x-tenant-id": TENANT_ID },
    });
    const body = response.json() as { items: { status: string }[] };
    expect(body.items.every((item) => item.status === "published")).toBe(true);
  });

  it("GET /public/inventory never exposes onHand or reserved", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/public/inventory",
      headers: { "x-tenant-id": TENANT_ID },
    });
    const body = response.json() as { items: Record<string, unknown>[] };
    for (const item of body.items) {
      expect(item).not.toHaveProperty("onHand");
      expect(item).not.toHaveProperty("reserved");
      expect(item).toHaveProperty("available");
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd --filter @platform/admin exec vitest run src/http/public-catalog-routes.test.ts
```

Expected: FAIL — drafts appear in `items`, and `onHand`/`reserved` are present.

- [ ] **Step 3: Widen the repository ports**

`services/catalog/src/domain/product-repository.ts` — replace the two signatures:

```ts
  /**
   * C-9: `status`, when given, restricts the page to that publish state. The public catalog routes
   * pass `"published"` so no anonymous caller can page through drafts, scheduled, or archived rows.
   * Omitted ⇒ every non-deleted row, unchanged — the admin surface legitimately needs drafts.
   */
  list(page: CursorPage, tx?: unknown, status?: PublishStateValue): Promise<Paginated<Product>>;
  /** Case-insensitive substring match on name/sku/slug (a stopgap, not ranked search — Search context owns that, ADR-0020). `status` filters exactly as in `list`. */
  search(
    query: string,
    page: CursorPage,
    tx?: unknown,
    status?: PublishStateValue,
  ): Promise<Paginated<Product>>;
```

Add `import type { PublishStateValue } from "./value-objects/publish-state";` to that file.

- [ ] **Step 4: Implement in the Prisma repository**

`services/catalog/src/infrastructure/prisma-catalog-repositories.ts` — replace `list`, `search`, and `paginate`:

```ts
  async list(
    page: CursorPage,
    tx?: unknown,
    status?: PublishStateValue,
  ): Promise<Paginated<Product>> {
    return this.paginate(statusWhere(status), page, tx);
  }

  async search(
    query: string,
    page: CursorPage,
    tx?: unknown,
    status?: PublishStateValue,
  ): Promise<Paginated<Product>> {
    return this.paginate(
      {
        ...statusWhere(status),
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { sku: { contains: query, mode: "insensitive" } },
          { slug: { contains: query, mode: "insensitive" } },
        ],
      },
      page,
      tx,
    );
  }
```

And add this module-level helper next to the file's other helpers:

```ts
/** C-9: an empty object when no status is requested, so the admin listing is byte-for-byte unchanged. */
function statusWhere(status: string | undefined): Record<string, unknown> {
  return status === undefined ? {} : { status };
}
```

`paginate` itself is unchanged — it already spreads `where` before `tenantId`/`deletedAt`.

- [ ] **Step 5: Implement in the in-memory repository**

`services/catalog/src/infrastructure/in-memory-product-repository.ts` — mirror the same filter. Read the file's existing `list`/`search` first and apply the filter to the same array they already build:

```ts
  async list(
    page: CursorPage,
    _tx?: unknown,
    status?: PublishStateValue,
  ): Promise<Paginated<Product>> {
    const rows = this.all().filter(
      (product) => status === undefined || product.status.value === status,
    );
    return paginateArray(rows, page, (p) => p.id.toString());
  }
```

Use whatever pagination helper that file already uses — do not introduce a new one.

- [ ] **Step 6: Thread `status` through the use case**

`services/catalog/src/application/list-products.use-case.ts`:

```ts
export interface ListProductsInput extends CursorPage {
  readonly query?: string;
  /** C-9: restricts the page to one publish state. The public routes pass `"published"`. */
  readonly status?: PublishStateValue;
}
```

```ts
  async execute(input: ListProductsInput): Promise<Result<Paginated<Product>, DomainError>> {
    const { query, status, ...page } = input;
    return ok(
      query !== undefined
        ? await this.deps.products.search(query, page, undefined, status)
        : await this.deps.products.list(page, undefined, status),
    );
  }
```

- [ ] **Step 7: Repeat Steps 3–6 for Collections and Prices**

Identical shape, different types:

- `services/catalog/src/domain/collection-repository.ts` → `list(page, tx?, status?: CollectionStatus)`
- `services/catalog/src/infrastructure/prisma-catalog-repositories.ts` → `PrismaCollectionRepository.list` applies `statusWhere(status)`
- the in-memory collection repository → same array filter on `collection.status`
- `services/catalog/src/application/list-collections.use-case.ts` → `ListCollectionsInput` gains `status?: CollectionStatus`, threaded through
- `services/pricing/src/domain/price-repository.ts` → `list(page, tx?, status?: PriceStatus)`
- `services/pricing/src/infrastructure/prisma-pricing-repositories.ts` and its in-memory sibling → same
- `services/pricing/src/application/list-prices.use-case.ts` → `ListPricesInput` gains `status?: PriceStatus`, threaded through

- [ ] **Step 8: Make the public routes ask for published rows only, and shrink the inventory DTO**

`apps/admin/src/http/public-catalog-routes.ts` — in the three affected route handlers:

```ts
      handle: async ({ query }) =>
        mapPage(
          // C-9: the public surface asks Catalog for published rows only. Before this the empty
          // filter reached `PrismaProductRepository.paginate({})`, so drafts/scheduled/archived
          // products were served to anonymous callers and the storefront filtered them client-side.
          await admin.publicReads.products.list({ ...query, status: "published" }),
          toProductDto,
        ),
```

Do the same for `/public/collections` (`status: "published"`) and `/public/prices` (`status: "published"`).

Replace the inventory DTO type and mapper in the same file:

```ts
export interface PublicInventoryDto {
  readonly id: string;
  readonly productId: string;
  readonly warehouseId: string;
  readonly available: number;
}

/**
 * Public inventory projection — availability only. `onHand` and `reserved` are withheld (C-9):
 * together they disclose total stock position and in-flight demand for the entire catalog to any
 * anonymous caller, which is competitor-grade commercial data. `available` is the only figure a
 * storefront needs, and it is the only one `apps/storefront` reads.
 */
function toInventoryDto(item: InventoryItem): PublicInventoryDto {
  return {
    id: item.id.value,
    productId: item.product.value,
    warehouseId: item.warehouseId.value,
    available: item.stockLevel.available,
  };
}
```

- [ ] **Step 9: Update the storefront type**

`apps/storefront/src/lib/runtime-api.ts` — remove `onHand` and `reserved` from `InventoryItemSummary`:

```ts
export interface InventoryItemSummary {
  readonly id: string;
  readonly productId: string;
  readonly warehouseId: string;
  readonly available: number;
}
```

`apps/storefront/src/lib/catalog.ts` — replace the module doc comment that claims publish filtering happens here:

```ts
/**
 * Storefront-facing catalog resolution. As of C-9 the Runtime Gateway's public list routes already
 * return published rows only (`apps/admin/src/http/public-catalog-routes.ts` passes
 * `status: "published"`), so the filters below are a defence-in-depth restatement of the same
 * invariant, not the only thing enforcing it.
 */
```

Leave the `isPublishedProduct` / `isPublishedCollection` filters in place — belt and braces is correct here.

- [ ] **Step 10: Run the tests to verify they pass**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd --filter @platform/admin exec vitest run src/http/public-catalog-routes.test.ts
pnpm.cmd --filter @platform/catalog exec vitest run
pnpm.cmd --filter @platform/pricing exec vitest run
pnpm.cmd --filter storefront exec vitest run
```

Expected: PASS in all four.

- [ ] **Step 11: Full verification and commit**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd exec turbo run typecheck --ui=stream && pnpm.cmd exec turbo run test --ui=stream && pnpm.cmd run arch
git add -A
git commit -m "fix(security): serve only published catalog rows on the public API and withhold stock position (C-9)"
```

---

### Task 3: Make notification providers injectable and guard them at boot (`C-4`)

**Problem being fixed:** `services/notifications/src/composition.ts:67-70` **hardcodes** `InMemoryEmailProvider`, `InMemorySmsProvider`, `InMemoryPushProvider`, `InMemoryWebhookProvider` in both the Prisma and in-memory branches. The stubs (`in-memory-port-adapters.ts:19-23`) increment a counter and return a fabricated `providerRef`. They are not among the twelve ports `assertProductionIntegrationPortsConfigured` guards (that list's `notifications` key is Orders' own `OrdersNotificationPort`, a different type). The moment Phase 3 satisfies those twelve guards, the platform boots in production and every order confirmation, password reset, and shipping notice is silently discarded — with a success result returned to the domain. This is a direct violation of the product principle "Fail securely, never fail open."

**Files:**

- Modify: `services/notifications/src/composition.ts:39-97`
- Modify: `apps/admin/src/composition.ts` (`AdminWiringDeps`, and the `wireNotifications(deps)` call)
- Modify: `apps/runtime/src/api.ts`
- Test: `services/notifications/src/notifications.e2e.test.ts` (or a new `composition.test.ts` in that package), and `apps/runtime/src/composition.test.ts`

**Interfaces:**

- Produces: `NotificationsWiringDeps` gains `emailProvider?`, `smsProvider?`, `pushProvider?`, `webhookProvider?` typed as `EmailProviderPort`, `SmsProviderPort`, `PushProviderPort`, `WebhookProviderPort` (already exported from `services/notifications/src/application/ports.ts`). `AdminWiringDeps` gains the same four optional fields. `assertProductionNotificationProvidersConfigured(appEnv: RuntimeConfig["APP_ENV"], providers: { emailProvider?: unknown; smsProvider?: unknown; pushProvider?: unknown; webhookProvider?: unknown }): void` exported from `apps/runtime/src/api.ts`.
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Write the failing tests**

Create `services/notifications/src/composition.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { SystemClock } from "@platform/clock";
import { CryptoIdGenerator } from "@platform/id";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { EmailProviderPort, ProviderSendResult } from "./application/ports";
import { wireNotifications } from "./composition";

function baseDeps() {
  return {
    serializer: new InMemoryEventSerializer(),
    idGenerator: new CryptoIdGenerator(),
    clock: new SystemClock(),
  };
}

describe("wireNotifications provider injection (C-4)", () => {
  it("uses the injected email provider instead of the in-memory stub", async () => {
    const send = vi.fn(async (): Promise<ProviderSendResult> => ({ providerRef: "ses-1" }));
    const emailProvider: EmailProviderPort = { send };

    const wired = wireNotifications({ ...baseDeps(), emailProvider });

    // Drive one email notification all the way to send through the controller the routes use.
    // (Follow the arrange/act shape already used by notifications.e2e.test.ts in this package.)
    await sendOneEmailNotification(wired.notifications);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("falls back to the in-memory stub when no provider is injected (local/tests unchanged)", () => {
    expect(() => wireNotifications(baseDeps())).not.toThrow();
  });
});
```

Read `services/notifications/src/notifications.e2e.test.ts` and lift its create → queue → send sequence into the local `sendOneEmailNotification` helper. Do not invent an API — use the controller methods that file already calls.

Add to `apps/runtime/src/composition.test.ts`, in the existing `describe("api entrypoint", …)` block:

```ts
it("FAILS CLOSED outside local when no real notification providers are configured (C-4)", () => {
  expect(() => assertProductionNotificationProvidersConfigured("production", {})).toThrow(
    /notification provider/i,
  );
});

it("passes once every notification provider is supplied", () => {
  const stub = { send: async () => ({ providerRef: "x" }) };
  expect(() =>
    assertProductionNotificationProvidersConfigured("production", {
      emailProvider: stub,
      smsProvider: stub,
      pushProvider: stub,
      webhookProvider: stub,
    }),
  ).not.toThrow();
});

it("stays permissive in local (matches the other guards' dev-mode behavior)", () => {
  expect(() => assertProductionNotificationProvidersConfigured("local", {})).not.toThrow();
});
```

Add `assertProductionNotificationProvidersConfigured` to that file's `./api` import.

- [ ] **Step 2: Run both to verify they fail**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd --filter @platform/notifications exec vitest run src/composition.test.ts
pnpm.cmd --filter @platform/runtime exec vitest run src/composition.test.ts
```

Expected: FAIL — `emailProvider` is not a known dep, and the guard does not exist.

- [ ] **Step 3: Make the providers injectable**

`services/notifications/src/composition.ts` — extend the deps interface (replace the misleading comment on `prisma` that claims providers are out of scope):

```ts
export interface NotificationsWiringDeps {
  readonly serializer: EventSerializer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly prisma?: Database;
  /** Required alongside `prisma` (ADR-0008) — every Notifications table is tenant-scoped. */
  readonly tenantId?: string;
  /**
   * C-4: the four outbound delivery adapters. Present ⇒ real delivery; absent ⇒ the offline
   * in-memory stub, which returns a fabricated `providerRef` and delivers nothing. Before this
   * field existed the stubs were hardcoded in BOTH branches, so no caller could supply a real
   * provider at all and a production boot silently discarded every message.
   * `apps/runtime/src/api.ts` refuses to boot outside `local` while any of the four is absent.
   */
  readonly emailProvider?: EmailProviderPort;
  readonly smsProvider?: SmsProviderPort;
  readonly pushProvider?: PushProviderPort;
  readonly webhookProvider?: WebhookProviderPort;
}
```

Add the four port types to the file's `./application/ports` import.

In `buildController`, replace lines 67-70:

```ts
const emailProvider = deps.emailProvider ?? new InMemoryEmailProvider();
const smsProvider = deps.smsProvider ?? new InMemorySmsProvider();
const pushProvider = deps.pushProvider ?? new InMemoryPushProvider();
const webhookProvider = deps.webhookProvider ?? new InMemoryWebhookProvider();
```

- [ ] **Step 4: Thread them through the admin composition**

`apps/admin/src/composition.ts` — add to `AdminWiringDeps` (next to the other pass-through provider fields such as `objectStorage` and `paymentProvider`):

```ts
  /**
   * C-4: Notifications' four outbound delivery adapters. Passed straight through to
   * `wireNotifications(deps)` below; absent ⇒ Notifications' own offline stubs, which deliver
   * nothing and report success. Same boot guard as `objectStorage`/`paymentProvider`.
   */
  readonly emailProvider?: EmailProviderPort;
  readonly smsProvider?: SmsProviderPort;
  readonly pushProvider?: PushProviderPort;
  readonly webhookProvider?: WebhookProviderPort;
```

Import those four types from `@platform/notifications`. Verify they are re-exported from `services/notifications/src/index.ts`; if not, add them there. The existing `wireNotifications(deps)` call at line 448 already forwards the whole `deps` object, so no call-site change is needed — confirm this by reading the line.

- [ ] **Step 5: Add the boot guard**

`apps/runtime/src/api.ts` — add next to the other four `assertProduction*` functions:

```ts
/**
 * C-4: `services/notifications` hardcoded all four outbound provider ports to in-memory stubs
 * (`in-memory-port-adapters.ts` — each increments a counter and returns a fabricated
 * `providerRef`), in every environment and with no injection seam. A production boot would have
 * "sent" every order confirmation, password reset and shipping notice into a counter, reporting
 * success to the domain. These ports are NOT covered by
 * `assertProductionIntegrationPortsConfigured` — that guard's `notifications` key is Orders' own
 * `OrdersNotificationPort`, a different type on a different seam. Fail closed outside `local`,
 * mirroring the MFA (C2-4) / PaymentProvider (V-1) / Licensing (M2-3) / ObjectStorage (M2-2)
 * guards; `local` gets a warning so the gap stays visible during development.
 */
export function assertProductionNotificationProvidersConfigured(
  appEnv: RuntimeConfig["APP_ENV"],
  providers: {
    readonly emailProvider?: unknown;
    readonly smsProvider?: unknown;
    readonly pushProvider?: unknown;
    readonly webhookProvider?: unknown;
  },
): void {
  const missing = (
    ["emailProvider", "smsProvider", "pushProvider", "webhookProvider"] as const
  ).filter((name) => providers[name] === undefined);
  if (missing.length === 0) return;
  if (appEnv === "local") {
    logger.warn(
      "notification delivery is a no-op: no production providers configured, APP_ENV=local",
      {
        missing,
      },
    );
  } else {
    throw new Error(
      `api: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} still the offline ` +
        "in-memory notification stub(s) (C-4). They return a fabricated providerRef and deliver " +
        "nothing, so every order confirmation, password reset and shipping notice would be " +
        "silently discarded. Pass emailProvider/smsProvider/pushProvider/webhookProvider in " +
        "createAdminHttpApi's deps once real adapters exist.",
    );
  }
}
```

In `startApi`, declare the providers object above the guard block and add the guard to the aggregated array:

```ts
// C-4: single source of truth for both the guard below and the deps spread into
// createAdminHttpApi, same pattern as `integrationPorts` above — the two cannot drift.
const notificationProviders = {
  emailProvider: undefined,
  smsProvider: undefined,
  pushProvider: undefined,
  webhookProvider: undefined,
};
```

```ts
    collectGuardFailure(() =>
      assertProductionNotificationProvidersConfigured(config.APP_ENV, notificationProviders),
    ),
```

And spread it into `createAdminHttpApi`, right after `...integrationPorts`:

```ts
    ...notificationProviders,
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd --filter @platform/notifications exec vitest run
pnpm.cmd --filter @platform/runtime exec vitest run src/composition.test.ts
```

Expected: PASS.

- [ ] **Step 7: Full verification and commit**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd exec turbo run typecheck --ui=stream && pnpm.cmd exec turbo run test --ui=stream && pnpm.cmd run arch
git add -A
git commit -m "fix(notifications): make delivery providers injectable and fail closed outside local (C-4)"
```

---

### Task 4: Populate the authorization enforcement point (`C-5`)

**Problem being fixed:** `AdminGuard` authorizes every admin action through `KetoAccessControl` (`apps/runtime/src/composition.ts:172-179`). The consumer fleet that mirrors Security's authorization decisions into Keto lives in `apps/runtime/src/security/wire-security-identity.ts:54` and is **called by nothing but its own test file** — `worker.ts` registers `buildPaymentCapturedRuntime`, `buildTrackingIngestRuntime` and `wireSecurityProvisioning`, never `wireSecurityIdentity`. Separately, nothing ever writes the baseline enterprise role tuples. On a real deployment with `KETO_READ_URL` set, Keto is empty, so **every admin action returns 403** and the backoffice is unusable. `bootstrapSecurity` seeds Security's own principal/role store, which is a different store that no enforcement path reads.

**Files:**

- Modify: `apps/runtime/src/worker.ts`
- Create: `apps/runtime/src/security/seed-authorization.ts`
- Create: `apps/runtime/src/security/seed-authorization.test.ts`
- Modify: `apps/runtime/src/config.ts` (add `AUTHZ_SEED_ON_BOOT`)
- Modify: `.env.example`
- Test: `apps/runtime/src/security/wire-security-identity.test.ts` (assert the worker registers it)

**Interfaces:**

- Produces: `seedAuthorizationModel(keto: KetoRelationshipClient, tenantId: string, logger: Logger): Promise<number>` — writes the baseline role→permission tuples, returns how many were written. Idempotent (Keto `PUT` is an upsert).
- Consumes: `wireSecurityIdentity(core, metrics)` from `apps/runtime/src/security/wire-security-identity.ts` (already exists, returns `WiredSecurityIdentity | null`); `buildOryClients(core)` from `./ory-clients` (already exists, returns `{ keto, kratos } | null`).

- [ ] **Step 1: Write the failing worker test**

Append to `apps/runtime/src/security/wire-security-identity.test.ts` — or create `apps/runtime/src/worker.test.ts` if that file has no worker-level fixture. Read the existing test's `core` fixture builder and reuse it.

```ts
describe("worker registers the security identity fleet (C-5)", () => {
  it("supervises the Keto relation-sync consumers when the Ory URLs are configured", async () => {
    const core = buildTestCore({
      KETO_READ_URL: "http://keto:4466",
      KETO_WRITE_URL: "http://keto:4467",
      KRATOS_PUBLIC_URL: "http://kratos:4433",
      KRATOS_ADMIN_URL: "http://kratos:4434",
    });
    const supervisor = await startWorker(core.config, core);
    const groups = supervisor.status().map((s) => s.consumerGroup);
    expect(groups).toContain("security.relation-sync");
  });
});
```

`ConsumerSupervisor.status()` already exists (`worker.ts` logs `supervisor.status().length`). Read `packages/kafka/src/supervisor.ts` to confirm the field name on each status entry before asserting on it; if it is not `consumerGroup`, use the real one.

- [ ] **Step 2: Run it to verify it fails**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd --filter @platform/runtime exec vitest run src/security/wire-security-identity.test.ts
```

Expected: FAIL — `security.relation-sync` is not in the registered groups.

- [ ] **Step 3: Register the fleet in the worker**

`apps/runtime/src/worker.ts` — after the `securityProvisioning` block:

```ts
// C-5: `wireSecurityIdentity` builds the consumer fleet that mirrors Security's authorization
// decisions into Keto (`security.relation.written`/`.deleted`), projects consent, and syncs
// Kratos session revocation. Until this line it was referenced only by its own test file, so on
// any deployment with KETO_READ_URL set the enforcement store stayed empty and AdminGuard denied
// every admin action. Returns null when the Ory URLs are absent (local dev), so this is
// side-effect-free off the production path.
const securityIdentity = wireSecurityIdentity(runtime, runtime.metrics);
if (securityIdentity !== null) {
  for (const consumerRuntime of securityIdentity.runtimes) supervisor.register(consumerRuntime);
}
```

Import `wireSecurityIdentity` from `./security/wire-security-identity`. Extend the `shutdown` closure to disconnect its producer alongside the existing ones — read how `securityProvisioning.producer` is handled today and follow it exactly; if it is not disconnected either, add both.

- [ ] **Step 4: Write the failing seed test**

Create `apps/runtime/src/security/seed-authorization.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { logger } from "@platform/utils";
import { ENTERPRISE_ROLES, seedAuthorizationModel } from "./seed-authorization";

describe("seedAuthorizationModel (C-5)", () => {
  it("writes one relation tuple per (role, permission) pair", async () => {
    const write = vi.fn(async () => undefined);
    const keto = { write } as unknown as Parameters<typeof seedAuthorizationModel>[0];

    const written = await seedAuthorizationModel(keto, "tenant-local", logger);

    const expected = ENTERPRISE_ROLES.reduce((sum, role) => sum + role.permissions.length, 0);
    expect(written).toBe(expected);
    expect(write).toHaveBeenCalledTimes(expected);
  });

  it("covers every enterprise role named in the product brief", () => {
    expect(ENTERPRISE_ROLES.map((role) => role.name)).toEqual([
      "administrator",
      "operations",
      "finance",
      "marketing",
      "support",
      "product",
      "developer",
    ]);
  });

  it("grants no role a permission outside its own function", () => {
    const finance = ENTERPRISE_ROLES.find((role) => role.name === "finance");
    expect(finance?.permissions).not.toContain("products:write");
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd --filter @platform/runtime exec vitest run src/security/seed-authorization.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 6: Implement the seed**

Before writing, read `packages/auth/src/keto-relationships.ts` and use `KetoRelationshipClient`'s real `write` signature and `RelationTuple` shape — do not guess. Then create `apps/runtime/src/security/seed-authorization.ts`:

```ts
import type { KetoRelationshipClient } from "@platform/auth";
import type { Logger } from "@platform/utils";

/**
 * The baseline enterprise role model (C-5). `AdminGuard` asks Keto for every admin action, and
 * nothing in this codebase ever wrote a tuple into Keto — so a deployment with KETO_READ_URL set
 * denied everything, and one without it refused to boot outside `local`. This seeds the roles the
 * product brief names (§18: Administrators, Operations, Finance, Marketing, Customer Support,
 * Product Teams, Developers) with least-privilege permission sets.
 *
 * Idempotent: Keto's relation-tuple PUT is an upsert, so re-running on every boot converges rather
 * than duplicating. Role MEMBERSHIP (which human is in which role) is not seeded here — that comes
 * from Identity's `membership.created` events through `AssignRoleOnMembershipCreated`
 * (`security-provisioning.consumers.ts`), already wired behind SECURITY_PRINCIPAL_PROVISIONING.
 */
export interface EnterpriseRole {
  readonly name: string;
  readonly permissions: readonly string[];
}

export const ENTERPRISE_ROLES: readonly EnterpriseRole[] = [
  {
    name: "administrator",
    permissions: ["*:*"],
  },
  {
    name: "operations",
    permissions: [
      "orders:read",
      "orders:write",
      "inventory:read",
      "inventory:write",
      "fulfillment:read",
      "fulfillment:write",
      "shipping:read",
      "shipping:write",
      "returns:read",
      "returns:write",
    ],
  },
  {
    name: "finance",
    permissions: [
      "finance:read",
      "finance:write",
      "payments:read",
      "payments:refund",
      "orders:read",
      "reporting:read",
    ],
  },
  {
    name: "marketing",
    permissions: [
      "promotions:read",
      "promotions:write",
      "coupons:read",
      "coupons:write",
      "content:read",
      "content:write",
      "seo:read",
      "seo:write",
      "loyalty:read",
      "loyalty:write",
      "analytics:read",
    ],
  },
  {
    name: "support",
    permissions: [
      "orders:read",
      "customers:read",
      "returns:read",
      "returns:write",
      "notifications:read",
    ],
  },
  {
    name: "product",
    permissions: [
      "products:read",
      "products:write",
      "categories:read",
      "categories:write",
      "collections:read",
      "collections:write",
      "pricing:read",
      "pricing:write",
      "media:read",
      "media:write",
    ],
  },
  {
    name: "developer",
    permissions: [
      "feature-flags:read",
      "feature-flags:write",
      "feature-registry:read",
      "feature-registry:write",
      "platform-console:read",
    ],
  },
];

/** Writes every (role, permission) tuple into Keto. Returns the number written. */
export async function seedAuthorizationModel(
  keto: KetoRelationshipClient,
  tenantId: string,
  log: Logger,
): Promise<number> {
  let written = 0;
  for (const role of ENTERPRISE_ROLES) {
    for (const permission of role.permissions) {
      await keto.write({
        namespace: "permissions",
        object: `${tenantId}:${permission}`,
        relation: "granted",
        subject: `role:${tenantId}:${role.name}`,
      });
      written += 1;
    }
  }
  log.info("authorization model seeded into Keto", { tenantId, tuples: written });
  return written;
}
```

**Before implementing:** confirm the argument shape `keto.write(...)` expects by reading `packages/auth/src/keto-relationships.ts:103`. If it takes a `RelationTuple` domain object rather than a literal, construct that object instead and adjust the test's mock accordingly. Also confirm the permission strings match what `defineRoute({ permission: … })` actually passes — grep `apps/admin/src/http/*-routes.ts` for `permission:` and reconcile the list. **Any permission string in a route that no role grants must be added to a role, or the route becomes unreachable for everyone but `administrator`.**

- [ ] **Step 7: Call the seed from the worker**

`apps/runtime/src/config.ts` — add near the other security flags:

```ts
    /** C-5: seed the baseline Keto role model on worker boot. Idempotent (Keto PUT is an upsert). */
    AUTHZ_SEED_ON_BOOT: z
      .string()
      .default("false")
      .transform((v) => v.toLowerCase() === "true"),
```

`apps/runtime/src/worker.ts` — immediately after registering the security identity fleet:

```ts
if (config.AUTHZ_SEED_ON_BOOT) {
  const ory = buildOryClients(runtime);
  if (ory === null) {
    throw new Error(
      "worker: AUTHZ_SEED_ON_BOOT requires KETO_WRITE_URL/KRATOS_* to be configured (C-5).",
    );
  }
  await seedAuthorizationModel(ory.keto, config.TENANT_DEFAULT_ID, runtime.logger);
}
```

Import `buildOryClients` from `./security/ory-clients` and `seedAuthorizationModel` from `./security/seed-authorization`.

`.env.example` — document it:

```
# C-5: seeds the baseline enterprise role model (administrator/operations/finance/marketing/
# support/product/developer) into Ory Keto on worker boot. AdminGuard authorizes every admin
# action against Keto, and nothing else in this codebase ever writes a tuple there — leaving it
# empty means every admin action is denied 403. Idempotent; safe to leave on.
AUTHZ_SEED_ON_BOOT=false
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd --filter @platform/runtime exec vitest run
```

Expected: PASS, all 30 test files.

- [ ] **Step 9: Full verification and commit**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd exec turbo run typecheck --ui=stream && pnpm.cmd exec turbo run test --ui=stream && node scripts/ops/check-env-docs.mjs
git add -A
git commit -m "fix(security): register the Keto sync fleet and seed the enterprise role model (C-5)"
```

---

> ## STOP — Phase 0 gate
>
> Report to the human:
>
> - the four commits,
> - the output of `turbo run typecheck`, `turbo run test`, `turbo run lint`, `pnpm arch`,
> - the new warning total from `node scripts/ops/check-lint-warnings.mjs` (and whether you lowered `MAX_WARNINGS`).
>
> Do not begin Phase 1 without approval.

---

# PHASE 1 — Real multi-tenancy with RLS (`C-7`, `H-8`)

**Product decision on record:** Morbeh ships as **one deployment serving many merchant organizations (SaaS)**. Today `apps/runtime/src/composition.ts:125` refuses to boot with `TENANT_MODE=multi`, because every repository is pinned to one `tenantId` at construction. This phase makes tenancy per-request and puts PostgreSQL Row-Level Security underneath it as the enforcing floor — closing the `MIGRATIONS.md §3` contract that 37 migrations left unimplemented (0 tables have RLS today).

**Approach, and why:** we do **not** rewrite 57 repositories to thread `tenantId` through every method. Instead:

1. `wireAdmin(deps)` builds plain stateless objects over a shared `PrismaClient`. So we build **one object graph per tenant** and cache it. Zero repository changes.
2. An `AsyncLocalStorage` carries the current tenant so that `PrismaClient` itself can set `app.tenant_id` for RLS on every query, including reads that are not inside an explicit transaction.
3. RLS with `FORCE ROW LEVEL SECURITY` becomes the floor, so a repository bug or a raw query cannot cross a tenant boundary.

**Critical infrastructure prerequisite:** RLS is bypassed by superusers and, unless `FORCE` is used, by the table owner. Prisma must connect as a **non-superuser, non-owner** role. On Supabase the `postgres` role bypasses RLS. Step 1 of Task 5 creates and uses a dedicated `lumo_app` role. Migrations keep running as the owner over `DIRECT_URL`.

---

### Task 5: Carry the tenant into every database session

**Files:**

- Create: `packages/db/src/tenant-context.ts`
- Create: `packages/db/src/tenant-context.test.ts`
- Modify: `packages/db/src/client.ts`
- Modify: `packages/db/src/prisma-repository.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/http/src/server.ts`
- Test: `packages/http/src/server.test.ts`

**Interfaces:**

- Produces:
  - `tenantContext: AsyncLocalStorage<string>` — exported from `@platform/db`
  - `runWithTenant<T>(tenantId: string, fn: () => T): T`
  - `currentTenantId(): string | undefined`
  - `createPrismaClient` now returns a client whose every query runs inside a transaction that first executes `select set_config('app.tenant_id', $tenantId, true)` when a tenant is in scope.
- Consumes: `DatabaseConfig.pgBouncer` from Task 1.

- [ ] **Step 1: Write the failing tenant-context test**

Create `packages/db/src/tenant-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { currentTenantId, runWithTenant } from "./tenant-context";

describe("tenant context (C-7)", () => {
  it("is undefined outside any scope", () => {
    expect(currentTenantId()).toBeUndefined();
  });

  it("exposes the tenant inside the scope", () => {
    runWithTenant("tenant-a", () => {
      expect(currentTenantId()).toBe("tenant-a");
    });
  });

  it("survives an await boundary", async () => {
    await runWithTenant("tenant-b", async () => {
      await Promise.resolve();
      expect(currentTenantId()).toBe("tenant-b");
    });
  });

  it("does not leak between sibling scopes", async () => {
    const [a, b] = await Promise.all([
      runWithTenant("tenant-a", async () => {
        await new Promise((r) => setTimeout(r, 5));
        return currentTenantId();
      }),
      runWithTenant("tenant-b", async () => currentTenantId()),
    ]);
    expect(a).toBe("tenant-a");
    expect(b).toBe("tenant-b");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd --filter @platform/db exec vitest run src/tenant-context.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tenant context**

Create `packages/db/src/tenant-context.ts`:

```ts
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The tenant the current asynchronous execution belongs to (C-7 / H-8).
 *
 * Before multi-tenancy became real, every Prisma repository was closed over one `tenantId` at
 * construction (ADR-0008) and the runtime refused to boot with `TENANT_MODE=multi`. Repositories
 * still take a `tenantId` — that has not changed — but PostgreSQL Row-Level Security needs the
 * tenant on the *session*, not just in the `where` clause, and reads happen outside any explicit
 * transaction. `AsyncLocalStorage` is how the value reaches `createPrismaClient`'s query extension
 * without threading a parameter through every one of the 57 repositories.
 *
 * Set once per HTTP request (`packages/http/src/server.ts`, immediately after tenant resolution)
 * and once per consumed message (`packages/kafka`'s consumer runtime, from the envelope's
 * `tenantId` header).
 */
export const tenantContext = new AsyncLocalStorage<string>();

/** Runs `fn` with `tenantId` as the ambient tenant for the whole async subtree. */
export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  return tenantContext.run(tenantId, fn);
}

/** The ambient tenant, or `undefined` outside any scope (background jobs, boot-time work). */
export function currentTenantId(): string | undefined {
  return tenantContext.getStore();
}
```

Export all three from `packages/db/src/index.ts`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd --filter @platform/db exec vitest run src/tenant-context.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Make every query set `app.tenant_id`**

`packages/db/src/client.ts` — replace `createPrismaClient`:

```ts
/**
 * Creates a configured PrismaClient. The connection URL is injected (DI) rather than read from the
 * ambient environment, so callers control pooling/credentials per environment.
 *
 * C-7: every operation is wrapped in a transaction whose first statement sets the session-local
 * `app.tenant_id`, which is what the `tenant_isolation` RLS policy on every business table reads.
 * Two things force this shape rather than a plain `$executeRaw` before the query:
 *   1. `SET LOCAL` / `set_config(..., true)` is transaction-scoped, and most repository reads are
 *      not inside an explicit transaction — without the wrapper the setting would be gone by the
 *      time the read runs, and RLS would return zero rows (fail closed, but useless).
 *   2. Behind a transaction-mode pooler (C-6) a connection is only ours for the duration of a
 *      transaction, so a session-level `SET` would leak to, or be lost by, another tenant's query.
 * Outside any tenant scope (`currentTenantId() === undefined` — boot-time health probes, the outbox
 * relay, scheduler jobs) the query runs unwrapped, exactly as before this extension existed. Those
 * paths must therefore connect as a role that RLS permits, or touch only non-RLS tables.
 */
export function createPrismaClient(config: DatabaseConfig): PrismaClient {
  const base = new PrismaClient({
    datasourceUrl: buildDatasourceUrl(config),
    log: config.logQueries ? ["query", "warn", "error"] : ["warn", "error"],
  });

  return base.$extends({
    query: {
      async $allOperations({ args, query }) {
        const tenantId = currentTenantId();
        if (tenantId === undefined) return query(args);
        const [, result] = await base.$transaction([
          base.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
          query(args),
        ]);
        return result;
      },
    },
  }) as unknown as PrismaClient;
}
```

Import `currentTenantId` from `./tenant-context`.

> **Note on the cast:** `$extends` returns a structurally different type. The codebase's `Database` alias is `PrismaClient`, and widening it would ripple through all 57 repositories. The cast is deliberate and confined to this one line; add the comment `// The extension adds no models and removes none — the public surface is identical.` above it.

- [ ] **Step 6: Make the unit of work set it too**

`packages/db/src/prisma-repository.ts` — replace `PrismaUnitOfWork.run`:

```ts
  run<T>(work: (context: TransactionClient) => Promise<T>): Promise<T> {
    return runInTransaction(this.prisma, async (tx) => {
      // C-7: an interactive transaction opens its own session-local scope, so the setting applied
      // by `createPrismaClient`'s per-operation wrapper does not carry into it. Set it here as the
      // transaction's first statement — every write in this codebase goes through this method, so
      // this is the single choke point for the write side of RLS.
      const tenantId = currentTenantId();
      if (tenantId !== undefined) {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      }
      return work(tx);
    });
  }
```

Import `currentTenantId` from `./tenant-context`.

- [ ] **Step 7: Enter the scope on every HTTP request**

`packages/http/src/server.ts` — the pipeline already resolves the tenant at line 339 and assigns `request.tenantId` at line 348. Immediately after that assignment the remainder of the request must run inside the scope. Fastify's hook chain preserves `AsyncLocalStorage` when `run` wraps the `done` callback, so register a dedicated hook rather than trying to wrap the existing one:

```ts
// C-7: everything downstream of tenant resolution — guards, handlers, repositories — runs inside
// the tenant scope, which is what makes `createPrismaClient`'s RLS wrapper able to see the tenant
// without a parameter threaded through 57 repositories. Registered as its own `onRequest` hook
// because AsyncLocalStorage only propagates into the continuation started inside `run`.
app.addHook("onRequest", (request, _reply, done) => {
  const tenantId = request.tenantId;
  if (tenantId === null) {
    done();
    return;
  }
  runWithTenant(tenantId, done);
});
```

Register this hook **after** the hook that performs tenant resolution. Read the file around lines 300-350 to place it correctly, and confirm the resolution happens in an `onRequest`/`preHandler` hook rather than inline in a wrapper — if resolution is inline, call `runWithTenant` around the remainder of that same function instead.

Import `runWithTenant` from `@platform/db`. **Check `pnpm arch` after this** — if `@platform/http` may not depend on `@platform/db` under the layering rules, move `tenant-context.ts` to `@platform/contracts` (which both already depend on) and re-export it from `@platform/db`. Decide by running `pnpm arch`, not by guessing.

- [ ] **Step 8: Write and run the HTTP scope test**

Add to `packages/http/src/server.test.ts`:

```ts
it("runs the handler inside the resolved tenant's context (C-7)", async () => {
  let seen: string | undefined;
  const app = createHttpServer(deps);
  await registerRoutes(app, deps, [
    defineRoute({
      method: "GET",
      path: "/tenant-probe",
      version: 1,
      permission: "products:read",
      public: true,
      summary: "probe",
      handle: async () => {
        seen = currentTenantId();
        return { status: 200, body: { ok: true } };
      },
    }),
  ]);
  await app.ready();
  await app.inject({
    method: "GET",
    url: "/api/v1/tenant-probe",
    headers: { "x-tenant-id": "tenant-probe" },
  });
  expect(seen).toBe("tenant-probe");
});
```

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd --filter @platform/http exec vitest run
pnpm.cmd --filter @platform/db exec vitest run
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd exec turbo run typecheck --ui=stream && pnpm.cmd exec turbo run test --ui=stream && pnpm.cmd run arch
git add -A
git commit -m "feat(db): carry the request tenant into every database session for RLS (C-7)"
```

---

### Task 6: Enable Row-Level Security on every tenant-scoped table (`C-7`)

**Files:**

- Create: `packages/db/prisma/schema/migrations/20260823000000_rls_tenant_isolation/migration.sql`
- Modify: `packages/db/prisma/MIGRATIONS.md` §3
- Create: `packages/db/src/rls-coverage.test.ts` (integration, gated on `DATABASE_URL_TEST`)

**Interfaces:**

- Produces: a PostgreSQL role `lumo_app` and a `tenant_isolation` policy on every `tenant_id`-bearing base table.
- Consumes: `app.tenant_id`, set by Task 5.

- [ ] **Step 1: Write the migration**

Create the directory and `migration.sql`:

```sql
-- C-7 — Row-Level Security tenant isolation.
--
-- `packages/db/prisma/MIGRATIONS.md` §3 has required this since the first repository sprint:
-- "ENABLE ROW LEVEL SECURITY + a tenant_id = current_setting('app.tenant_id') policy — defense in
-- depth behind the adapter scoping (ADR-0008 §3)". Across 37 prior migrations, zero tables had it.
-- Until now the only thing preventing one merchant from reading another's rows was every repository
-- remembering its `where: { tenantId }` — including raw queries, of which this codebase has some.
--
-- Applied by iterating information_schema rather than listing 132 tables, so a table added later
-- that carries tenant_id is covered by re-running this shape (see the fitness test in
-- packages/db/src/rls-coverage.test.ts, which fails if any tenant_id table lacks a policy).

-- 1. The application role. RLS is bypassed outright by superusers, and by the table OWNER unless
--    FORCE is used. Prisma must therefore connect as a role that is neither. Migrations keep
--    running as the owner over DIRECT_URL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lumo_app') THEN
    CREATE ROLE lumo_app LOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA
  automation, cart, catalog, checkout, components, content, coupons, customer_360,
  experience, experiment, feature_registry, feature_flags, finance, fulfillment,
  identity, inventory, licensing, localization, loyalty, media, notifications, orders,
  pages, payments, platform, pricing, promotions, recommendations, reporting, returns,
  reviews, search, security, seo, shipping, tenancy, theme, tracking, wishlist
TO lumo_app;

-- 2. Enable + FORCE RLS and install the isolation policy on every base table with a tenant_id.
DO $$
DECLARE r RECORD;
DECLARE nullable BOOLEAN;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name, c.is_nullable
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.column_name = 'tenant_id'
      AND t.table_type = 'BASE TABLE'
      AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.table_schema, r.table_name);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', r.table_schema, r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', r.table_schema, r.table_name);

    nullable := (r.is_nullable = 'YES');

    IF nullable THEN
      -- platform.outbox and platform.audit_events carry a nullable tenant_id: some rows are
      -- genuinely platform-wide. Those rows stay visible to every tenant; tenant-stamped rows are
      -- isolated exactly like everything else.
      EXECUTE format($p$
        CREATE POLICY tenant_isolation ON %I.%I
          USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true))
          WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true))
      $p$, r.table_schema, r.table_name);
    ELSE
      -- current_setting(..., true) yields NULL when unset, so the comparison is NULL and no row
      -- matches: an un-scoped connection sees nothing. Fail closed, never fail open.
      EXECUTE format($p$
        CREATE POLICY tenant_isolation ON %I.%I
          USING (tenant_id = current_setting('app.tenant_id', true))
          WITH CHECK (tenant_id = current_setting('app.tenant_id', true))
      $p$, r.table_schema, r.table_name);
    END IF;

    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON %I.%I TO lumo_app',
      r.table_schema, r.table_name
    );
  END LOOP;
END $$;

-- 3. Tables WITHOUT a tenant_id (platform.processed_events, migration bookkeeping, reference data)
--    are left unrestricted deliberately: they carry no tenant-owned data. lumo_app still needs to
--    read and write them.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT t.table_schema, t.table_name
    FROM information_schema.tables t
    WHERE t.table_type = 'BASE TABLE'
      AND t.table_schema NOT IN ('pg_catalog', 'information_schema')
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = t.table_schema
          AND c.table_name = t.table_name
          AND c.column_name = 'tenant_id'
      )
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON %I.%I TO lumo_app',
      r.table_schema, r.table_name
    );
  END LOOP;
END $$;
```

**Before applying:** verify the schema list in the `GRANT USAGE` statement against the real database. Run:

```sql
SELECT DISTINCT table_schema FROM information_schema.tables
WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema')
ORDER BY 1;
```

and use that exact list. The Prisma schema files under `packages/db/prisma/schema/` use `@@schema(...)` names that may differ from the file names (e.g. `customer-360.prisma` declares `@@schema("customer_360")`).

- [ ] **Step 2: Write the fitness test**

Create `packages/db/src/rls-coverage.test.ts`, following the gating convention already used by the 17 files that read `DATABASE_URL_TEST` (read `packages/db/src/testing/index.ts` first and reuse its helper):

```ts
import { describe, expect, it } from "vitest";

const url = process.env["DATABASE_URL_TEST"];
const describeIfDb = url === undefined ? describe.skip : describe;

describeIfDb("RLS coverage (C-7)", () => {
  it("every table carrying tenant_id has RLS enabled, forced, and a tenant_isolation policy", async () => {
    const rows = await prisma.$queryRaw<{ schemaname: string; tablename: string }[]>`
      SELECT c.table_schema AS schemaname, c.table_name AS tablename
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      JOIN pg_class pc ON pc.relname = c.table_name
      JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = c.table_schema
      WHERE c.column_name = 'tenant_id'
        AND t.table_type = 'BASE TABLE'
        AND c.table_schema NOT IN ('pg_catalog','information_schema')
        AND (
          pc.relrowsecurity = false
          OR pc.relforcerowsecurity = false
          OR NOT EXISTS (
            SELECT 1 FROM pg_policies p
            WHERE p.schemaname = c.table_schema
              AND p.tablename = c.table_name
              AND p.policyname = 'tenant_isolation'
          )
        )
    `;
    expect(rows).toEqual([]);
  });

  it("a query with no tenant in scope returns zero rows from a tenant-scoped table", async () => {
    const rows = await prisma.$queryRaw`SELECT id FROM catalog.products LIMIT 1`;
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 3: Apply the migration against the real database**

Ask the human for the Supabase `DIRECT_URL` (port 5432, session pooler) before this step — it is not in the repository. Then:

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
export DIRECT_URL="<supplied by the human>"
export DATABASE_URL="$DIRECT_URL"
pnpm.cmd --filter @platform/db exec prisma migrate deploy
```

Expected: `1 migration applied`.

- [ ] **Step 4: Verify zero drift**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd --filter @platform/db exec prisma migrate diff \
  --from-schema-datamodel packages/db/prisma/schema \
  --to-schema-datasource packages/db/prisma/schema \
  --exit-code
```

Expected: exit code 0. Report the exact output.

- [ ] **Step 5: Run the fitness test against the real database**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
export DATABASE_URL_TEST="<supplied by the human>"
pnpm.cmd --filter @platform/db exec vitest run src/rls-coverage.test.ts
```

Expected: PASS, 2 tests. Report the real output — a `skipped` result is **not** a pass.

- [ ] **Step 6: Update the migrations contract**

`packages/db/prisma/MIGRATIONS.md` §3 — replace the Row-Level Security bullet:

```markdown
- **Row-Level Security** per business table: ✅ landed in `20260823000000_rls_tenant_isolation`
  (C-7). `ENABLE` + `FORCE ROW LEVEL SECURITY` and a `tenant_isolation` policy on every base table
  carrying `tenant_id`. The session variable is `app.tenant_id`, set by
  `packages/db/src/client.ts`'s query extension and by `PrismaUnitOfWork.run`, both fed from the
  `AsyncLocalStorage` in `packages/db/src/tenant-context.ts`. The application connects as
  `lumo_app` (neither superuser nor table owner) — connecting as the owner or as Supabase's
  `postgres` role silently bypasses every policy. `packages/db/src/rls-coverage.test.ts` fails if
  any future `tenant_id` table is added without a policy.
```

- [ ] **Step 7: Commit**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd exec turbo run typecheck --ui=stream && pnpm.cmd exec turbo run test --ui=stream
git add -A
git commit -m "feat(db): enable forced row-level security tenant isolation on every business table (C-7)"
```

---

### Task 7: Resolve the object graph per tenant (`H-8`)

**Problem being fixed:** `createAdminHttpApi` calls `wireAdmin(deps)` **once** with a single `deps.tenantId`, and `singleTenantGuardedResolver` (`apps/admin/src/http/server.ts:49-56`) rejects any request whose resolved tenant differs. That is the mechanism that makes multi-tenancy impossible, and it is why `composition.ts:125` refuses to boot with `TENANT_MODE=multi`.

**Files:**

- Create: `apps/admin/src/http/tenant-graph-cache.ts`
- Create: `apps/admin/src/http/tenant-graph-cache.test.ts`
- Modify: `apps/admin/src/http/server.ts`
- Modify: `apps/admin/src/http/admin-routes.ts` and every `*-routes.ts` file (they receive `admin: WiredAdmin` today; they must receive a per-request resolver instead)
- Modify: `apps/runtime/src/composition.ts` (delete the `TENANT_MODE=multi` refusal)
- Test: `apps/admin/src/http/tenant-guard.e2e.test.ts` (exists — rewrite its expectations)

**Interfaces:**

- Produces:
  - `createTenantGraphCache(deps: AdminWiringDeps, options?: { maxTenants?: number }): TenantGraphCache`
  - `interface TenantGraphCache { get(tenantId: string): WiredAdmin; size(): number }`
  - Route factories change from `xRoutes(admin: WiredAdmin)` to `xRoutes(forTenant: (tenantId: string) => WiredAdmin)`.
- Consumes: `runWithTenant` / `currentTenantId` from Task 5; RLS from Task 6.

- [ ] **Step 1: Write the failing cache test**

Create `apps/admin/src/http/tenant-graph-cache.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTenantGraphCache } from "./tenant-graph-cache";
import { testAdminDeps } from "../test-support/admin-deps"; // reuse the existing fixture; find it first

describe("tenant graph cache (H-8)", () => {
  it("builds one object graph per tenant", () => {
    const cache = createTenantGraphCache(testAdminDeps());
    const a = cache.get("tenant-a");
    const b = cache.get("tenant-b");
    expect(a).not.toBe(b);
    expect(cache.size()).toBe(2);
  });

  it("returns the same graph for the same tenant", () => {
    const cache = createTenantGraphCache(testAdminDeps());
    expect(cache.get("tenant-a")).toBe(cache.get("tenant-a"));
    expect(cache.size()).toBe(1);
  });

  it("evicts the least recently used graph past the cap", () => {
    const cache = createTenantGraphCache(testAdminDeps(), { maxTenants: 2 });
    cache.get("tenant-a");
    cache.get("tenant-b");
    cache.get("tenant-a"); // refresh a
    cache.get("tenant-c"); // should evict b
    expect(cache.size()).toBe(2);
  });
});
```

Before writing this, locate the existing test fixture that builds `AdminWiringDeps` — `apps/admin/src/http/admin-http.e2e.test.ts` has one. Reuse it; if it is inline, extract it to `apps/admin/src/test-support/admin-deps.ts` as part of this step.

- [ ] **Step 2: Run it to verify it fails**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd --filter @platform/admin exec vitest run src/http/tenant-graph-cache.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the cache**

Create `apps/admin/src/http/tenant-graph-cache.ts`:

```ts
import { wireAdmin, type AdminWiringDeps, type WiredAdmin } from "../composition";

export interface TenantGraphCache {
  /** The wired object graph for `tenantId`, built on first use and reused thereafter. */
  get(tenantId: string): WiredAdmin;
  /** How many graphs are currently held — for tests and the `/metrics` gauge. */
  size(): number;
}

export interface TenantGraphCacheOptions {
  /** Maximum graphs held before least-recently-used eviction. Default 256. */
  readonly maxTenants?: number;
}

/**
 * H-8: one wired object graph per tenant, built lazily and cached.
 *
 * `wireAdmin(deps)` used to be called exactly once, with one `deps.tenantId`, which pinned all 57
 * Prisma repositories to that tenant for the process's lifetime — the reason
 * `apps/runtime/src/composition.ts` refused to boot with `TENANT_MODE=multi`. Building the graph
 * per tenant instead is safe and cheap because, on the Prisma branch, `wireAdmin` produces only
 * stateless objects (use cases, controllers, repositories) over the ONE shared `PrismaClient`: no
 * second connection pool, no duplicated persistence, no background work. (The in-memory branch DOES
 * hold state, which is exactly why multi-tenant operation requires `deps.prisma` to be present —
 * asserted below.)
 *
 * Eviction is LRU rather than unbounded so a tenant enumeration attack, or simply a large customer
 * base, cannot grow the heap without limit. An evicted tenant is rebuilt on its next request; the
 * only cost is re-instantiating plain objects.
 */
export function createTenantGraphCache(
  deps: AdminWiringDeps,
  options: TenantGraphCacheOptions = {},
): TenantGraphCache {
  if (deps.prisma === undefined) {
    throw new Error(
      "createTenantGraphCache requires deps.prisma: the in-memory composition branch holds " +
        "per-graph state, so one graph per tenant would silently give each tenant its own " +
        "disconnected dataset instead of isolating rows in one database (H-8).",
    );
  }
  const maxTenants = options.maxTenants ?? 256;
  const graphs = new Map<string, WiredAdmin>();

  return {
    get(tenantId: string): WiredAdmin {
      const existing = graphs.get(tenantId);
      if (existing !== undefined) {
        // Map preserves insertion order, so delete+set moves this key to the most-recent position.
        graphs.delete(tenantId);
        graphs.set(tenantId, existing);
        return existing;
      }
      const graph = wireAdmin({ ...deps, tenantId });
      graphs.set(tenantId, graph);
      if (graphs.size > maxTenants) {
        const oldest = graphs.keys().next();
        if (!oldest.done) graphs.delete(oldest.value);
      }
      return graph;
    },
    size: () => graphs.size,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd --filter @platform/admin exec vitest run src/http/tenant-graph-cache.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Change the route factories to resolve per request**

This is mechanical and touches every `*-routes.ts` file in `apps/admin/src/http/`. Define the resolver type once, in `apps/admin/src/http/admin-routes.ts`:

```ts
/**
 * H-8: routes no longer close over ONE `WiredAdmin`. They receive a resolver and call it with the
 * request's own tenant, so a single process serves every tenant from the same route table.
 */
export type AdminForTenant = (tenantId: string) => WiredAdmin;
```

Export it from `apps/admin/src/index.ts`.

Then, for **each** route file:

1. change the factory signature from `export function xRoutes(admin: WiredAdmin)` to `export function xRoutes(forTenant: AdminForTenant)`;
2. inside each `handle`, replace every `admin.` with `forTenant(tenantId).`, taking `tenantId` from the handler context. Confirm the handler context field name by reading `packages/http/src/route.ts` — if `handle` does not already receive `tenantId`, add it there first (it is on `request.tenantId` and the route runner already builds the context object).

Work through the files in this order so each commit stays reviewable, running `turbo run typecheck` after each: `public-catalog-routes.ts`, `public-cart-routes.ts`, `payments-webhook-routes.ts`, then the remaining 40 alphabetically, then `admin-routes.ts` last (it aggregates the rest).

- [ ] **Step 6: Wire the cache into the server**

`apps/admin/src/http/server.ts` — replace the `wireAdmin` call and the single-tenant resolver:

```ts
export async function createAdminHttpApi(deps: AdminHttpDeps): Promise<FastifyInstance> {
  // H-8: one graph per tenant, resolved per request. `deps.tenantId`, when present, is now only a
  // DEFAULT for deployments that genuinely serve one merchant — it no longer pins the process.
  const graphs = createTenantGraphCache(deps);
  const guard = new AdminGuard({
    accessControl: deps.accessControl ?? new AllowAllAccessControl(),
    auditTrail: deps.auditTrail ?? new InMemoryAuditTrail(),
    clock: deps.clock,
  });

  const httpDeps: HttpServerDeps = {
    // ...unchanged...
    tenantResolvers: [headerTenantResolver],
    // ...unchanged...
  };

  const app = createHttpServer(httpDeps);
  await registerRoutes(
    app,
    httpDeps,
    adminRoutes((tenantId) => graphs.get(tenantId)),
  );
  await app.ready();
  return app;
}
```

Delete `singleTenantGuardedResolver` entirely and replace its doc comment with a short note in `createAdminHttpApi`'s own comment explaining that per-request graph resolution supersedes it (C2-6 closed by H-8).

> **This is the security-critical moment of the phase.** The old guard was the only thing preventing a mismatched `x-tenant-id` from reading the pinned tenant's rows. It is safe to remove **only because** Task 6's RLS is now the floor and Task 5 puts the resolved tenant on the session. Do not remove it in a commit that does not already contain Tasks 5 and 6.

- [ ] **Step 7: Rewrite the tenant-guard e2e test**

`apps/admin/src/http/tenant-guard.e2e.test.ts` currently asserts that a mismatched tenant is rejected. Rewrite it to assert the new, stronger property:

```ts
it("serves each tenant its own rows from one process (H-8)", async () => {
  const a = await app.inject({
    method: "GET",
    url: "/api/v1/public/products",
    headers: { "x-tenant-id": "tenant-a" },
  });
  const b = await app.inject({
    method: "GET",
    url: "/api/v1/public/products",
    headers: { "x-tenant-id": "tenant-b" },
  });
  expect(a.statusCode).toBe(200);
  expect(b.statusCode).toBe(200);
  expect(a.json()).not.toEqual(b.json());
});

it("still refuses a request that resolves to no tenant at all", async () => {
  const response = await app.inject({ method: "GET", url: "/api/v1/public/products" });
  expect(response.statusCode).toBe(403);
});
```

- [ ] **Step 8: Delete the boot refusal**

`apps/runtime/src/composition.ts` — remove the whole `if (config.TENANT_MODE === "multi") { throw … }` block (lines 120-131) and replace it with:

```ts
// H-8: `TENANT_MODE=multi` used to be refused here, because every repository was pinned to one
// tenantId at construction. `apps/admin/src/http/tenant-graph-cache.ts` now builds one object
// graph per tenant and resolves it per request, and PostgreSQL RLS (`tenant_isolation`, migration
// 20260823000000) is the enforcing floor underneath it. Both modes are real; `single` simply
// means one tenant ever reaches the cache.
```

Update `apps/runtime/src/composition.test.ts`'s corresponding assertion — it currently expects the throw. Replace it with a test that `buildRuntimeCore` succeeds under `TENANT_MODE=multi`.

- [ ] **Step 9: Full verification and commit**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd exec turbo run typecheck --ui=stream && pnpm.cmd exec turbo run test --ui=stream && pnpm.cmd exec turbo run lint --ui=stream && pnpm.cmd run arch
git add -A
git commit -m "feat(tenancy): resolve one object graph per tenant per request (H-8)"
```

---

> ## STOP — Phase 1 gate
>
> Report to the human:
>
> - the `prisma migrate deploy` and `prisma migrate diff --exit-code` outputs verbatim,
> - the `rls-coverage.test.ts` result (PASS, not SKIPPED),
> - all four quality gates,
> - the number of route files converted in Task 7 Step 5, and any that could not be.
>
> Do not begin Phase 2 without approval.

---

# PHASE 2 — Publish the outbox (`C-8`)

**Problem being fixed:** every Prisma repository writes integration events into `platform.outbox` inside the aggregate transaction (correct). Nothing publishes them. `OutboxRelay` exists (`packages/messaging/src/outbox/outbox-relay.ts`) but is instantiated **only in the in-memory branch** of each context's composition — never on the production path, which was designed around Debezium CDC (`infrastructure/k8s/70-debezium.yaml`). Debezium requires Kafka Connect, which requires Docker, which is unavailable. Meanwhile the worker registers exactly **one** business consumer. Result: Customer 360, Finance, Loyalty and Search receive nothing, ever.

**Product decision on record:** run `OutboxRelay` by polling inside the worker.

---

### Task 8: Run the outbox relay in the worker

**Files:**

- Create: `apps/runtime/src/outbox-relay-runtime.ts`
- Create: `apps/runtime/src/outbox-relay-runtime.test.ts`
- Modify: `apps/runtime/src/worker.ts`
- Modify: `apps/runtime/src/config.ts`
- Modify: `apps/runtime/src/scheduler.ts`
- Modify: `apps/runtime/src/metrics.ts`
- Modify: `.env.example`

**Interfaces:**

- Produces: `startOutboxRelay(core: RuntimeCore, producer: KafkaMessageProducer): { stop(): void } | null` — returns `null` when `OUTBOX_RELAY_ENABLED` is off.
- Consumes: `OutboxRelay` and `PrismaOutboxStore` (both already exist and compose directly — `KafkaMessageProducer implements EventPublisher`, verified at `packages/kafka/src/producer.ts:26`).

- [ ] **Step 1: Write the failing test**

Create `apps/runtime/src/outbox-relay-runtime.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { startOutboxRelay } from "./outbox-relay-runtime";

describe("outbox relay runtime (C-8)", () => {
  it("returns null when the relay is disabled", () => {
    const core = buildTestCore({ OUTBOX_RELAY_ENABLED: false });
    expect(startOutboxRelay(core, fakeProducer())).toBeNull();
  });

  it("drains pending entries on each tick while holding the distributed lock", async () => {
    vi.useFakeTimers();
    const publishBatch = vi.fn(async () => undefined);
    const core = buildTestCore({
      OUTBOX_RELAY_ENABLED: true,
      OUTBOX_RELAY_INTERVAL_MS: 1000,
    });
    core.prisma.outboxEntry.findMany = vi.fn(async () => [pendingEntryRow()]);
    core.prisma.outboxEntry.updateMany = vi.fn(async () => ({ count: 1 }));

    const handle = startOutboxRelay(core, { publishBatch } as never);
    expect(handle).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1000);
    expect(publishBatch).toHaveBeenCalledTimes(1);

    handle?.stop();
    vi.useRealTimers();
  });

  it("skips the tick when another instance holds the lock", async () => {
    vi.useFakeTimers();
    const publishBatch = vi.fn(async () => undefined);
    const core = buildTestCore({ OUTBOX_RELAY_ENABLED: true, OUTBOX_RELAY_INTERVAL_MS: 1000 });
    core.distributedLock.acquire = vi.fn(async () => null);

    const handle = startOutboxRelay(core, { publishBatch } as never);
    await vi.advanceTimersByTimeAsync(1000);
    expect(publishBatch).not.toHaveBeenCalled();

    handle?.stop();
    vi.useRealTimers();
  });
});
```

Reuse `apps/runtime/src/composition.test.ts`'s existing `buildTestCore`-equivalent fixture — read that file first and lift its helper into `apps/runtime/src/test-support/core.ts` if it is inline.

- [ ] **Step 2: Run it to verify it fails**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd --filter @platform/runtime exec vitest run src/outbox-relay-runtime.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the relay runtime**

Create `apps/runtime/src/outbox-relay-runtime.ts`:

```ts
import { PrismaOutboxStore } from "@platform/db";
import type { KafkaMessageProducer } from "@platform/kafka";
import { OutboxRelay } from "@platform/messaging";
import type { RuntimeCore } from "./composition";

export interface OutboxRelayHandle {
  stop(): void;
}

/**
 * C-8: publishes `platform.outbox` rows to Kafka on a timer.
 *
 * Every Prisma repository already appends integration events to the outbox inside the aggregate's
 * own transaction (ADR-0003) — that half has always worked. The publishing half did not exist on
 * the production path: `OutboxRelay` was instantiated only in each context's IN-MEMORY composition
 * branch, and production was designed around Debezium CDC streaming the table directly
 * (`infrastructure/k8s/70-debezium.yaml`). Debezium needs Kafka Connect, which needs Docker, which
 * this deployment target does not have. So outbox rows accumulated and nothing ever consumed them.
 *
 * Single-flight across instances via the same `RedisDistributedLock` the scheduler already uses:
 * two workers must not publish the same batch. `markPublished` is conditional on
 * `status = 'pending'` (`PrismaOutboxStore.markPublished`), so even a lock failure degrades to
 * at-least-once delivery, which every consumer already tolerates (Postgres inbox idempotency,
 * ADR-0005).
 *
 * Returns `null` when `OUTBOX_RELAY_ENABLED` is off, so an unmigrated deployment is unchanged.
 */
export function startOutboxRelay(
  core: RuntimeCore,
  producer: KafkaMessageProducer,
): OutboxRelayHandle | null {
  if (!core.config.OUTBOX_RELAY_ENABLED) return null;

  const relay = new OutboxRelay({
    store: new PrismaOutboxStore(core.prisma),
    publisher: producer,
    clock: core.clock,
    batchSize: core.config.OUTBOX_RELAY_BATCH_SIZE,
  });

  const intervalMs = core.config.OUTBOX_RELAY_INTERVAL_MS;
  const timer = setInterval(() => {
    void (async () => {
      const handle = await core.distributedLock.acquire("outbox-relay", intervalMs * 2);
      if (handle === null) return;
      try {
        const published = await relay.drainOnce();
        if (published > 0) {
          core.logger.info("outbox relay published", { count: published });
          core.metrics.recordOutboxPublished(published);
        }
      } catch (error) {
        core.logger.error("outbox relay failed", { error: String(error) });
        core.metrics.recordOutboxRelayFailure();
      } finally {
        await handle.release();
      }
    })();
  }, intervalMs);

  return { stop: () => clearInterval(timer) };
}
```

`apps/runtime/src/metrics.ts` — add the two counters, following the exact shape of the existing `recordCdcWatchdogRestart` method (read it first and mirror it):

```ts
  /** C-8: total outbox rows published by the polling relay. */
  recordOutboxPublished(count: number): void { /* … */ }
  /** C-8: relay ticks that threw. Alert on any sustained non-zero rate — it means events are stuck. */
  recordOutboxRelayFailure(): void { /* … */ }
```

- [ ] **Step 4: Add the configuration**

`apps/runtime/src/config.ts`:

```ts
    /** C-8: publish platform.outbox rows from the worker on a timer instead of via Debezium CDC. */
    OUTBOX_RELAY_ENABLED: z
      .string()
      .default("false")
      .transform((v) => v.toLowerCase() === "true"),
    /** Poll interval. Lower means fresher events and more database load. */
    OUTBOX_RELAY_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
    /** Rows published per tick. */
    OUTBOX_RELAY_BATCH_SIZE: z.coerce.number().int().positive().max(1000).default(200),
```

`.env.example`:

```
# C-8: the worker publishes platform.outbox rows to Kafka on a timer. Turn this ON unless
# Debezium CDC is actually running against this database — otherwise nothing ever publishes the
# outbox and every event-driven consumer (Finance, Loyalty, Customer 360, Search) stays starved.
# Mutually exclusive with Debezium: running both double-publishes (harmless — consumers are
# idempotent per ADR-0005 — but wasteful).
OUTBOX_RELAY_ENABLED=false
OUTBOX_RELAY_INTERVAL_MS=2000
OUTBOX_RELAY_BATCH_SIZE=200
```

- [ ] **Step 5: Start it in the worker**

`apps/runtime/src/worker.ts` — after `await supervisor.startAll()`:

```ts
// C-8: the publishing half of the outbox pattern. Without this the rows every repository writes
// inside its aggregate transaction are never delivered to anyone.
const outboxProducer = new KafkaMessageProducer(runtime.kafka);
await outboxProducer.connect();
const outboxRelay = startOutboxRelay(runtime, outboxProducer);
```

Extend `shutdown`:

```ts
outboxRelay?.stop();
await outboxProducer.disconnect();
```

Import `startOutboxRelay` from `./outbox-relay-runtime` and `KafkaMessageProducer` from `@platform/kafka` (already imported for other uses — check before adding a duplicate import).

- [ ] **Step 6: Fix the prune job for relay mode**

`apps/runtime/src/scheduler.ts` — the `outbox-prune` job currently prunes on **age alone** and gates on a `pg_replication_slots` row named `lumo_outbox` existing. In relay mode that slot does not exist, so the job would skip forever; and `markPublished` now genuinely runs, so `status` is meaningful again. Replace the job body's gate and delete condition:

```ts
// C-8: with the polling relay running, `markPublished` sets status='published' on every
// delivered row, so publication is directly observable again and pruning can be conditional
// on it — restoring the original OutboxStore contract. The pg_replication_slots gate below
// applies only to Debezium/CDC mode, where nothing ever writes the status back.
if (core.config.OUTBOX_RELAY_ENABLED) {
  const result = await core.prisma.outboxEntry.deleteMany({
    where: { status: "published", createdAt: { lt: cutoff } },
  });
  const stuck = await core.prisma.outboxEntry.count({
    where: { status: "pending", createdAt: { lt: cutoff } },
  });
  if (stuck > 0) {
    core.logger.error("outbox rows past retention are still unpublished", {
      count: stuck,
      retentionDays: core.config.OUTBOX_RETENTION_DAYS,
    });
  }
  core.logger.info("outbox pruned", { deleted: result.count });
  return;
}
```

Insert this immediately before the existing `pg_replication_slots` query, leaving the CDC path untouched below it. Update `apps/runtime/src/scheduler.test.ts` — add a case for relay mode and keep the existing CDC case passing.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd --filter @platform/runtime exec vitest run
```

Expected: PASS.

- [ ] **Step 8: Full verification and commit**

```bash
export PATH="/c/Program Files/nodejs:/c/Users/Abdo/bin:$PATH"
pnpm.cmd exec turbo run typecheck --ui=stream && pnpm.cmd exec turbo run test --ui=stream && node scripts/ops/check-env-docs.mjs
git add -A
git commit -m "feat(messaging): publish the outbox from the worker on a timer (C-8)"
```

---

> ## STOP — Phase 2 gate
>
> Report the four gates plus the new `outbox-prune` behaviour under both modes. Do not begin Phase 3 without approval.

---

# PHASE 3 — In-process integration adapters (`C-3`)

**Problem being fixed:** `apps/runtime/src/api.ts:196-209` passes `undefined` for all twelve cross-context ports. The consequences, verified in code: tax is `Math.round(subtotal * 0.1)` regardless of jurisdiction (`services/checkout/src/infrastructure/in-memory-orchestration-adapters.ts:35`); shipping is a hardcoded `standard: 500` / `express: 1500` (same file, lines 41-44); stock is never checked; promotions are accepted unvalidated. `assertProductionIntegrationPortsConfigured` correctly refuses to boot outside `local` — which means **the platform cannot run in production at all** until this phase lands.

**Approach:** all 41 contexts already live in one process. Each adapter is a thin class that implements the consuming context's port by calling the owning context's already-public controller. The pattern exists in this codebase — `PrismaPaymentsPortAdapter` (`apps/runtime/src/composition.ts:379`) does exactly this for Returns → Payments. Do not invent new business logic in any adapter; if a calculation does not already exist in the owning context, that is a finding to report, not a thing to implement in the adapter.

**Common structure for every task in this phase:**

```
Files:
- Create: apps/admin/src/infrastructure/cross-context/<name>.adapter.ts
- Create: apps/admin/src/infrastructure/cross-context/<name>.adapter.test.ts
- Modify: apps/admin/src/composition.ts  (build it after the contexts are wired; inject it)

Steps:
1. Read the port interface in the CONSUMING context's application/ports.ts — copy its exact signature.
2. Read the OWNING context's controller for the method that answers it. If none exists, STOP and report.
3. Write the failing adapter test (a fake owning controller, assert the mapping).
4. Run it — expect FAIL.
5. Implement the adapter.
6. Run it — expect PASS.
7. Inject it in apps/admin/src/composition.ts inside wireAdmin, AFTER the owning context is wired.
8. Delete the corresponding `undefined` from apps/runtime/src/api.ts's integrationPorts literal.
9. turbo typecheck + test + arch; commit.
```

## ⚠️ Verified scope limit on this phase — read before starting

Two of the twelve ports **cannot** be closed by an in-process adapter, because the capability they
need does not exist anywhere in this repository. This was verified against the code, not assumed:

| Port                  | Why no adapter is possible                                                                                               | Evidence                                                                                                                                                                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `taxCalculation`      | Nothing in this codebase computes tax. Pricing stores **tax classifications only** and says so.                          | `services/pricing/src/domain/tax-class.ts:10` — _"classification only — Pricing computes no tax (ADR-0024)"_. `grep -rn "calculateTax\|taxRate" services packages` returns no computation, only the flat-10% stub and read-model field names. (ADR-0024 itself does not exist — `docs/architecture/adr/` holds 0001–0013 only.) |
| `shippingCalculation` | Nothing in this codebase rates a shipment. Shipping owns the shipment **lifecycle** and carrier **labels**, not quoting. | `services/shipping/src/application/` contains `CreateShipment`, `AdvanceShipment`, `CreateLabel`, `VoidLabel`, `UpdateTracking`, `RetryShipment`, `RecordCarrierWebhook`, `GetShipmentByFulfillment` — and no rate or quote use case.                                                                                           |

**Consequence:** `C-3` closes ten of twelve ports in this phase. `assertProductionIntegrationPortsConfigured`
must stay, narrowed to those two. Building a tax engine or a shipping rate engine is new product
capability, not remediation — it needs its own brief and its own plan. **Do not invent either one
inside an adapter.** A fabricated tax rate in an adapter is the same class of defect as the flat 10%
this phase exists to remove.

---

### Task 9: Checkout → Pricing (`pricingValidation`)

Port definition to implement, read from `services/checkout/src/application/ports.ts`:

```ts
interface PricingValidationPort {
  validate(items: readonly CheckoutItem[]): Promise<PricingValidationResult>;
}
```

Implement it over Pricing's own published-price data — the same authoritative source
`apps/admin/src/http/pricing-resolution.ts` already reads. Note `H-1`: that helper pages 100 prices
and filters in memory. **Do not copy that approach into this adapter.** Add a
`PriceRepository.findPublishedByProduct(productRef, currency, tx?)` method backed by the existing
`@@index([tenantId, productRef])` (`packages/db/prisma/schema/pricing.prisma:38`) and use it. This
closes `H-1` as a side effect; say so in the commit message.

### Task 10: Checkout → Inventory (`inventoryValidation`)

### Task 11: Checkout → Promotions (`promotionValidation`)

### Task 12: Orders → Payments / Inventory / Shipping / Notifications (`paymentPort`, `inventoryPort`, `shippingPort`, `notifications`)

### Task 13: Payments → Orders / Finance / Notifications (`ordersPort`, `financePort`, `paymentsNotifications`)

### Task 14: Narrow the integration-ports boot guard to the two genuinely-missing capabilities

- [ ] **Step 1:** Confirm `apps/runtime/src/api.ts`'s `integrationPorts` literal has resolved adapters for all ten ports Tasks 9–13 covered, and `undefined` only for `taxCalculation` and `shippingCalculation`.
- [ ] **Step 2:** Rewrite `assertProductionIntegrationPortsConfigured`'s error message so it names only those two and states what each needs — a tax provider integration (Avalara/TaxJar/a local authority) and a shipping rate source (carrier rating API or an in-house rate table). Delete the now-false claims about stock never being checked and capture refs being fabricated.
- [ ] **Step 3:** Update `apps/runtime/src/composition.test.ts`'s guard assertions to the narrowed set.
- [ ] **Step 4:** Also correct the stale comment at `apps/runtime/src/api.ts:178-181` while you are in the file — it claims 35 wired contexts have no Prisma branch; the measured number is 4 (`analytics`, `media`'s base composition, `platform-console`, `example`). This is finding `M-4`.
- [ ] **Step 5:** `turbo typecheck && turbo test && pnpm arch`; commit as `feat(runtime): wire ten real cross-context integration adapters (C-3 partial)`.

---

> ## STOP — Phase 3 gate
>
> Report: the ten ports now backed by real adapters; confirmation that `taxCalculation` and
> `shippingCalculation` remain guarded and why; whether `H-1`'s indexed price lookup landed in
> Task 9; and the four quality gates.
>
> **Ask the human explicitly** whether a tax provider and a shipping rate source should become
> their own brief before Phase 4, since an order total is not correct without them.

---

# PHASE 4 — Checkout creates the order (`C-2`)

**Problem being fixed:** `CompleteCheckout` (`services/checkout/src/application/complete-checkout.use-case.ts:41`) validates a caller-supplied `input.orderRef` — it does not create an order. Nothing in this codebase turns a checkout session into an order, so `Cart → Checkout → Order → Payment → Fulfillment` has no implementation anywhere. `@platform/temporal` exists with **zero consumers**.

**Approach (Shopify model, per the product decision):** `CompleteCheckout` calls a new `OrderCreationPort` synchronously, inside its existing transaction. The order's `orders.paid` event goes out through the outbox (Phase 2 publishes it), and Finance / Loyalty / Customer 360 / Notifications consume it asynchronously. No Temporal, no saga framework.

### Task 16: Add `OrderCreationPort` and make `CompleteCheckout` use it

**Interfaces:**

- Produces, in `services/checkout/src/application/ports.ts`:

```ts
/**
 * C-2: the outbound seam Checkout uses to materialize an order from a completed session. Checkout
 * owns the session lifecycle, never the Order aggregate — this port is how the boundary is crossed
 * without Checkout importing @platform/orders.
 */
export interface OrderCreationPort {
  create(input: {
    readonly checkoutSessionId: string;
    readonly customerRef: string;
    readonly currency: string;
    readonly items: readonly CheckoutItem[];
    readonly shippingAddress: CheckoutAddress;
    readonly totalAmountMinor: number;
    readonly idempotencyKey: string;
  }): Promise<{ readonly orderRef: string }>;
}
```

- `CompleteCheckoutInput` loses `orderRef` and gains `idempotencyKey: string`.
- `CompleteCheckoutOutput` gains `orderRef: string`.

Steps follow the standard TDD cycle: write a failing use-case test with a fake `OrderCreationPort` asserting that a completed session yields an `orderRef` and that a repeated call with the same `idempotencyKey` returns the same `orderRef` without creating a second order; run it (FAIL); implement; run (PASS); commit.

**Migration note:** `POST /checkouts/:id/complete` currently accepts `orderRef` in its body (`apps/admin/src/http/checkout-routes.ts`). Remove it from the zod schema and add `idempotencyKey`. Update `apps/admin/src/http/cart-checkout-pricing-security.e2e.test.ts`, which exercises this route.

### Task 17: Create the adapter and consume `orders.paid`

- Create `apps/admin/src/infrastructure/cross-context/order-creation.adapter.ts` implementing `OrderCreationPort` over `wireOrders`'s `PlaceOrder` use case. Read `services/orders/src/application/` for the real use-case name and input shape before writing it.
- Create `apps/runtime/src/consumers/orders-paid.consumers.ts` registering, on `orders.paid`:
  - `services/finance/src/interfaces/finance-consumers.ts`'s `OrdersPaidConsumer` — **it already exists and has zero callers today**;
  - a Loyalty earn consumer calling `EarnPoints`;
  - a Customer 360 profile-update consumer;
  - a Notifications order-confirmation consumer.
- Register them in `worker.ts` via the existing `buildProcessedConsumer` helper (`apps/runtime/src/security/consumer-runtime.ts`) so each gets the standard inbox-idempotency + retry-topic + DLQ envelope.

---

> ## STOP — Phase 4 gate

---

# PHASE 5 — The public customer surface (`C-1`)

**Problem being fixed:** the platform exposes 361 routes, of which **13** are reachable without an admin bearer token: 5 catalog reads, 7 cart operations, 1 PSP webhook. There is no way for a shopper to check out, pay, see an order, or hold an account over HTTP. `apps/storefront` has exactly four screens — home, product, collection, cart — and no checkout.

**Product decision on record:** extend `/public/*` on the existing Fastify instance.

**Security posture, non-negotiable:** public routes bypass `AdminGuard` (`packages/http/src/route.ts:62`). A shopper route must therefore enforce **ownership**, not permissions: "does this cart / order / address belong to the session presenting this request?" `public-cart-routes.ts:169-183` already establishes the pattern for carts — read it and follow it exactly.

### Task 18: Shopper session authentication (`apps/admin/src/http/public-session.ts`)

Resolve an Ory Kratos session cookie to a `customerRef`. Return `null` for anonymous, which the cart routes already tolerate. Never reuse `Authenticator` (that is the admin JWT path).

### Task 19: Ownership guard (`apps/admin/src/http/public-ownership-guard.ts`)

One function: `assertOwns(resourceOwnerRef: string | null, session: PublicSession | null): AdminResponse | null`. Returns 404 (never 403) on mismatch, so the API does not confirm that a resource exists.

### Task 20: `public-checkout-routes.ts`

`POST /public/checkouts` (from a cart), `POST /public/checkouts/:id/shipping-address`, `/shipping-selection`, `/promotion`, `/recalculate`, `POST /public/checkouts/:id/complete`. Every route ownership-guarded. Response DTOs must be projections — never `JSON.stringify` of an aggregate (that was the `C-9`-class defect `public-catalog-routes.ts:39` documents).

### Task 21: `public-order-routes.ts`

`GET /public/orders` (the session's own), `GET /public/orders/:id`. Ownership-guarded.

### Task 22: `public-account-routes.ts`

`GET /public/me`, `PATCH /public/me`, addresses CRUD, `GET /public/me/loyalty`.

### Task 23: Storefront checkout screens

`apps/storefront/src/app/checkout/page.tsx`, `.../checkout/confirmation/[orderId]/page.tsx`, `.../orders/page.tsx`, `.../account/page.tsx`, plus the `runtime-api.ts` client functions for each new route. Follow the existing `fetchItem`/`postItem` helpers — do not add a second HTTP client.

### Task 24: Add a public by-slug product route

`GET /public/products/:slug`, closing the `M-6` limitation that `runtime-api.ts:148-151` documents (the product detail page currently fetches 100 products and filters). Requires `ProductRepository.findBySlug` — which **already exists** at `prisma-catalog-repositories.ts:104`.

---

> ## STOP — Phase 5 gate — final report

---

## Appendix A: What this plan deliberately does NOT fix

Report these to the human at the final gate; they are High/Medium findings outside the Critical scope:

| ID     | Gap                                                                                                                      | Why deferred                                                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `H-1`  | `resolvePrice` pages 100 prices and filters in memory on every cart add (`apps/admin/src/http/pricing-resolution.ts:29`) | **Closed as a side effect of Phase 3 Task 9**, which adds the indexed `findPublishedByProduct` lookup. Point `resolvePrice` at it in the same commit                                   |
| —      | No tax computation and no shipping rate calculation exist anywhere in the repository                                     | Verified in code (see the Phase 3 scope-limit table). These are new product capability, not remediation, and need their own brief. **An order total is not correct until they exist.** |
| `H-2`  | Search has no `search()` — `IndexProviderPort` only upserts and deletes                                                  | Needs a real OpenSearch/pgvector adapter and a query use case                                                                                                                          |
| `H-6`  | Analytics is a semantic registry only; `ClickHouseAnalyticsReadStore` has zero consumers                                 | Needs a ClickHouse deployment decision                                                                                                                                                 |
| `H-7`  | Recommendations always returns `[]` (`SearchQueryPort` is permanently the in-memory stub)                                | Blocked on `H-2`                                                                                                                                                                       |
| `H-10` | Prices carry no channel / market / customer-group                                                                        | Schema change; §9 of the brief                                                                                                                                                         |
| `M-1`  | `apps/**` is outside `pnpm arch`                                                                                         | One-line fix to `package.json`'s `arch` script — do it opportunistically if a phase touches that file                                                                                  |
| `M-3`  | 57 Prisma repositories, 24 integration test files, none ever executed                                                    | Needs `DATABASE_URL_TEST` pointed at a real Supabase branch                                                                                                                            |
| `M-4`  | `apps/runtime/src/api.ts:178-181` claims 35 contexts have no Prisma branch; the real number is 4                         | Stale comment — correct it whenever a task edits that file                                                                                                                             |
| `L-3`  | Code cites 12 ADRs that do not exist (`docs/architecture/adr/` holds 0001–0013; code references up to ADR-0060)          | Documentation debt                                                                                                                                                                     |
