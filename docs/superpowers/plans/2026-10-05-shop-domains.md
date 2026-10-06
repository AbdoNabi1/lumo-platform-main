# Shop Domains (Plan 1A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **ملخص للمالك (بالعربي):** الخطة دي بتخلّي كل متجر له دومين.
>
> - كل تاجر بياخد تلقائياً `اسمه.morbeh.store`.
> - التاجر يقدر يربط دومين خاص بيه.
> - المتجر بيعرف هو متجر مين من الدومين، بدل ما يبقى متثبّت على متجر واحد.
>
> **مش هيتغيّر حاجة في الموقع الشغّال دلوقتي:** الميزة مقفولة بمفتاح (`STOREFRONT_HOST_ROUTING`) لحد ما نقرر نفتحها.

**Goal:** Every shop has one or more hostnames; the storefront resolves the shop from the request's `Host` header instead of a fixed `TENANT_DEFAULT_ID`, the way Shopify maps `Domain → Shop`.

**Architecture:**

- A new `ShopDomain` aggregate in the existing Tenancy context.
  - Rows are platform-tenant scoped, like `Tenant` rows and `licensing.billing_coupons`.
  - `hostname` is unique globally.
- `CreateTenant` auto-adds a verified primary `<slug>.<PLATFORM_STORE_DOMAIN>` domain.
- Custom domains start `pending` and become `verified` through a DNS check port.
- Two routes are public and run behind the existing tenant-resolution chain, using the platform tenant's header:
  - `GET /public/domains/resolve`, which maps a hostname to a shop;
  - an unguarded `resolveHost`.
- The storefront gets a Next.js `middleware.ts` that:
  - resolves `Host` to a shop id (cached);
  - overwrites `x-shop-id`;
  - is consumed by `runtime-api.ts`.
- All of it is behind `STOREFRONT_HOST_ROUTING=on`. Default off, so the live single-store deployment is byte-for-byte unchanged.

**Tech Stack:** TypeScript, vitest, Prisma 6 (multi-file schema), Fastify routes via `@platform/http` `defineRoute`, Next.js 15 middleware, `node:dns`.

**Spec:**

- [docs/plans/PLATFORM-MASTER-PLAN.md](../../plans/PLATFORM-MASTER-PLAN.md): Phase 0, unit 1 "Tenancy"; Domains row of §1.
- [docs/plans/PLATFORM-GAP-REVIEW.md](../../plans/PLATFORM-GAP-REVIEW.md): §2.1.

## Global Constraints

Copied from the standing project rules. Every task implicitly includes these.

### Git and branch

- Work on branch `morbeh/w0-w17-w12`. Never force-push. Never `--no-verify`. Never raise the lint warning cap.
- Never stage `.claude/worktrees/`.
- Commit subjects start lowercase (commitlint).
- End every commit message with: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`

### Database

- **Never set `TENANT_MODE=multi` in any env file, example, manifest or CI config.** Tests may pass `tenantMode: "multi"` in code, as existing tests do.
- **Agents must not connect to any database for any reason.**
  - Migrations are written by hand and applied by the owner from Railway's Console: `cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`.
  - `DATABASE_URL_TEST`-gated integration tests are skipped when the variable is absent; do not set it.

### Secrets

- Never print or log any secret, API key, HMAC secret or card token.

### Windows host and commands

- `turbo` is broken on Windows. Never run bare root scripts.
- Use per-package commands:
  - `pnpm.cmd --filter <name> run test`
  - `pnpm.cmd --filter <name> run typecheck`
- Never run a full typecheck and a full test suite at the same time.
- No Python, no `gh`. For shell quoting problems, write a `.cjs` script to the scratchpad and run it with `node`.
- Package names:

| Directory          | Package filter      |
| ------------------ | ------------------- |
| `services/tenancy` | `@platform/tenancy` |
| `apps/admin`       | `@platform/admin`   |
| `apps/runtime`     | `@platform/runtime` |
| `apps/storefront`  | `storefront`        |
| `packages/db`      | `@platform/db`      |

### Code conventions

- Money and events are not touched by this plan.
- `ShopDomain` raises **no** domain events. This avoids adding event types (G-80 topic inventory). Domain changes are audited by `AdminGuard` at the route.

---

## File Structure

### `services/tenancy/src/`

- **`domain/value-objects/hostname.ts`** (new): normalises and validates a hostname.
- **`domain/value-objects/hostname.test.ts`** (new).
- **`domain/shop-domain.ts`** (new): the aggregate, with `platform` / `custom` factories and `verify`, `makePrimary`, `demote`.
- **`domain/shop-domain.test.ts`** (new).
- **`domain/dns-verifier.ts`** (new): the port, `pointsToPlatform(hostname)`.
- **`domain/repositories.ts`** (modify): adds `ShopDomainRepository`.
- **`application/shop-domains.use-cases.ts`** (new): `AddCustomDomain`, `VerifyDomain`, `SetPrimaryDomain`, `ListShopDomains`, `ResolveHost`, and the `ShopDomainView` DTO.
- **`application/shop-domains.use-cases.test.ts`** (new).
- **`application/tenancy.use-cases.ts`** (modify): `CreateTenant` adds the platform subdomain.
- **`infrastructure/in-memory-repositories.ts`** (modify): adds `InMemoryShopDomainRepository`.
- **`infrastructure/mappers.ts`** (modify): adds `ShopDomainMapper`.
- **`infrastructure/prisma-repositories.ts`** (modify): adds `PrismaShopDomainRepository`.
- **`infrastructure/node-dns-verifier.ts`** (new), and **`infrastructure/node-dns-verifier.test.ts`** (new).
- **`interfaces/tenancy.controller.ts`** (modify): five new methods.
- **`composition.ts`** (modify): wires the repository, `platformStoreDomain` and `dnsVerifier`.
- **`index.ts`** (modify): exports.

### `packages/db/`

- **`prisma/schema/tenancy.prisma`** (modify): adds the `ShopDomain` model.
- **`prisma/schema/migrations/20261005000000_tenancy_shop_domains/migration.sql`** (new).
- **`src/schema-migration-consistency.test.ts`** (modify): the `tenancy.shop_domains` block.

### `apps/admin/src/`

- **`composition.ts`** (modify): `AdminWiringDeps` gains `platformStoreDomain?` and `dnsVerifier?`.
- **`interfaces/tenancy.admin-controller.ts`** (modify): guarded wrappers plus the unguarded `resolveHost`.
- **`http/tenancy-routes.ts`** (modify): four admin routes and one public route.
- **`http/shop-domains-routes.test.ts`** (new).

### `apps/runtime/src/`

- **`config.ts`** (modify): `PLATFORM_STORE_DOMAIN`, `STOREFRONT_CNAME_TARGET`, `STOREFRONT_IPV4`.
- **`api.ts`** (modify): passes them to `createAdminHttpApi`.

### `apps/storefront/src/`

- **`lib/shop-host.ts`** (new): `normalizeHost`, `createShopResolver`, `fetchShopFromRuntime`, `SHOP_ID_HEADER`.
- **`lib/shop-host.test.ts`** (new).
- **`middleware.ts`** (new).
- **`app/api/tls-allowed/route.ts`** (new): Caddy's on-demand TLS "ask" endpoint.
- **`lib/runtime-api.ts`** (modify): the tenant header comes from the request when routing is on.

### Docs and infrastructure

- **`infrastructure/caddy/Caddyfile`** (new): used at the Hetzner move; nothing deploys it now.
- **`infrastructure/railway/README.md`** (modify): env var rows.

---

### Task 1: `Hostname` value object

**Files:**

- Create: `services/tenancy/src/domain/value-objects/hostname.ts`
- Test: `services/tenancy/src/domain/value-objects/hostname.test.ts`

**Interfaces:**

- Produces: `Hostname.create(raw: string): Result<Hostname, ValidationError>`; `hostname.value: string`, which is lowercased, with no trailing dot and no port.

- [ ] **Step 1: Write the failing test**

```ts
// services/tenancy/src/domain/value-objects/hostname.test.ts
import { describe, expect, it } from "vitest";
import { Hostname } from "./hostname";

function value(raw: string): string {
  const result = Hostname.create(raw);
  if (!result.ok) throw new Error(`expected valid: ${raw}`);
  return result.value.value;
}

describe("Hostname", () => {
  it("lowercases, trims and drops a trailing dot", () => {
    expect(value("  Shop.Example.COM. ")).toBe("shop.example.com");
  });

  it("accepts punycode labels (Arabic domains arrive already IDNA-encoded)", () => {
    expect(value("xn--mgbh0fb.xn--wgbh1c")).toBe("xn--mgbh0fb.xn--wgbh1c");
  });

  it.each([
    ["", "empty"],
    ["localhost", "single label"],
    ["shop.example.com:8080", "port"],
    ["https://shop.example.com", "scheme"],
    ["shop.example.com/path", "path"],
    ["-bad.example.com", "leading hyphen"],
    ["bad-.example.com", "trailing hyphen"],
    ["sh_op.example.com", "underscore"],
    [`${"a".repeat(64)}.example.com`, "label over 63"],
    ["متجر.مصر", "raw unicode"],
  ])("rejects %s (%s)", (raw) => {
    expect(Hostname.create(raw).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/tenancy run test -- hostname`
Expected: FAIL, `Cannot find module './hostname'`.

- [ ] **Step 3: Write the implementation**

```ts
// services/tenancy/src/domain/value-objects/hostname.ts
import { ValueObject } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

interface HostnameProps {
  readonly value: string;
}

/**
 * A DNS hostname a shop is served on (Plan 1A). Normalised to lowercase with no trailing dot.
 * Unicode (IDN) hostnames must arrive IDNA-encoded (`xn--...`); browsers and `new URL()` already
 * send them that way in the `Host` header.
 */
export class Hostname extends ValueObject<HostnameProps> {
  static create(raw: string): Result<Hostname, ValidationError> {
    const value = raw.trim().toLowerCase().replace(/\.$/, "");
    const invalid = (message: string) =>
      err(new ValidationError("Invalid hostname", [{ field: "hostname", message }]));
    if (value.length === 0 || value.length > 253) return invalid("must be 1..253 characters");
    if (/[:/]/.test(value)) return invalid("must not contain a scheme, port or path");
    const labels = value.split(".");
    if (labels.length < 2) return invalid("must have at least two labels");
    if (!labels.every((label) => LABEL.test(label))) {
      return invalid(
        "each label must be 1..63 characters of a-z, 0-9 or '-', not starting or ending with '-'",
      );
    }
    return ok(new Hostname({ value }));
  }

  get value(): string {
    return this.props.value;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm.cmd --filter @platform/tenancy run test -- hostname`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add services/tenancy/src/domain/value-objects/hostname.ts services/tenancy/src/domain/value-objects/hostname.test.ts
git commit -m "feat(tenancy): add hostname value object for shop domains"
```

---

### Task 2: `ShopDomain` aggregate, repository port and DNS port

**Files:**

- Create: `services/tenancy/src/domain/shop-domain.ts`
- Create: `services/tenancy/src/domain/dns-verifier.ts`
- Modify: `services/tenancy/src/domain/repositories.ts` (append)
- Test: `services/tenancy/src/domain/shop-domain.test.ts`

**Interfaces:**

- Consumes: `Hostname` (Task 1).
- Produces:
  - `ShopDomain.platform(id, shopRef, hostname, at)`
  - `ShopDomain.custom(id, shopRef, hostname)`
  - `ShopDomain.reconstitute(id, props, version)`
  - `.verify(at)`, `.makePrimary()`, `.demote()`
  - getters `shopRef`, `hostname`, `kind`, `status`, `isPrimary`, `verifiedAt`
  - `ShopDomainRepository` and `DnsVerifier` (exact shapes below)

- [ ] **Step 1: Write the failing test**

```ts
// services/tenancy/src/domain/shop-domain.test.ts
import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { ShopDomain } from "./shop-domain";
import { Hostname } from "./value-objects/hostname";

function host(raw: string): Hostname {
  const result = Hostname.create(raw);
  if (!result.ok) throw new Error("bad fixture");
  return result.value;
}

const at = new Date("2026-10-05T00:00:00.000Z");

describe("ShopDomain", () => {
  it("a platform domain is born verified and primary", () => {
    const domain = ShopDomain.platform(
      UniqueEntityId.from("d-1"),
      "shop-1",
      host("acme.morbeh.store"),
      at,
    );
    expect(domain.kind).toBe("platform");
    expect(domain.status).toBe("verified");
    expect(domain.isPrimary).toBe(true);
    expect(domain.verifiedAt).toEqual(at);
  });

  it("a custom domain is born pending and not primary", () => {
    const domain = ShopDomain.custom(UniqueEntityId.from("d-2"), "shop-1", host("acme.com"));
    expect(domain.status).toBe("pending");
    expect(domain.isPrimary).toBe(false);
    expect(domain.verifiedAt).toBeUndefined();
  });

  it("refuses to make a pending domain primary", () => {
    const domain = ShopDomain.custom(UniqueEntityId.from("d-3"), "shop-1", host("acme.com"));
    expect(() => domain.makePrimary()).toThrow(/verified/);
  });

  it("verify is idempotent and keeps the first verification time", () => {
    const domain = ShopDomain.custom(UniqueEntityId.from("d-4"), "shop-1", host("acme.com"));
    domain.verify(at);
    domain.verify(new Date("2027-01-01T00:00:00.000Z"));
    expect(domain.status).toBe("verified");
    expect(domain.verifiedAt).toEqual(at);
    domain.makePrimary();
    expect(domain.isPrimary).toBe(true);
    domain.demote();
    expect(domain.isPrimary).toBe(false);
  });

  it("raises no domain events (no new event types, G-80)", () => {
    const domain = ShopDomain.platform(UniqueEntityId.from("d-5"), "shop-1", host("a.b.c"), at);
    expect(domain.pullDomainEvents()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/tenancy run test -- shop-domain`
Expected: FAIL, `Cannot find module './shop-domain'`.

- [ ] **Step 3: Write the implementation**

```ts
// services/tenancy/src/domain/shop-domain.ts
import { AggregateRoot, BusinessRuleError, type UniqueEntityId } from "@platform/domain";
import type { Hostname } from "./value-objects/hostname";

export type ShopDomainKind = "platform" | "custom";
export type ShopDomainStatus = "pending" | "verified";

export interface ShopDomainProps {
  readonly shopRef: string;
  readonly hostname: Hostname;
  readonly kind: ShopDomainKind;
  status: ShopDomainStatus;
  isPrimary: boolean;
  verifiedAt?: Date;
}

/**
 * A hostname a shop is served on (Plan 1A) — Shopify's `Domain`. `shopRef` is the merchant
 * tenant's id; the row itself lives in the platform tenant's scope like `Tenant`. Raises no
 * domain events on purpose: changes are audited by `AdminGuard` at the route, and adding event
 * types grows the topic inventory (G-80) for no consumer.
 */
export class ShopDomain extends AggregateRoot<ShopDomainProps> {
  static platform(id: UniqueEntityId, shopRef: string, hostname: Hostname, at: Date): ShopDomain {
    return new ShopDomain(
      { shopRef, hostname, kind: "platform", status: "verified", isPrimary: true, verifiedAt: at },
      id,
    );
  }

  static custom(id: UniqueEntityId, shopRef: string, hostname: Hostname): ShopDomain {
    return new ShopDomain(
      { shopRef, hostname, kind: "custom", status: "pending", isPrimary: false },
      id,
    );
  }

  static reconstitute(id: UniqueEntityId, props: ShopDomainProps, version: number): ShopDomain {
    return new ShopDomain({ ...props }, id, version);
  }

  verify(at: Date): void {
    if (this.props.status === "verified") return;
    this.props.status = "verified";
    this.props.verifiedAt = at;
  }

  makePrimary(): void {
    if (this.props.status !== "verified") {
      throw new BusinessRuleError("Only a verified domain can be made primary");
    }
    this.props.isPrimary = true;
  }

  demote(): void {
    this.props.isPrimary = false;
  }

  get shopRef(): string {
    return this.props.shopRef;
  }

  get hostname(): Hostname {
    return this.props.hostname;
  }

  get kind(): ShopDomainKind {
    return this.props.kind;
  }

  get status(): ShopDomainStatus {
    return this.props.status;
  }

  get isPrimary(): boolean {
    return this.props.isPrimary;
  }

  get verifiedAt(): Date | undefined {
    return this.props.verifiedAt;
  }
}
```

```ts
// services/tenancy/src/domain/dns-verifier.ts
/** Checks that a custom hostname's DNS points at the platform's storefront (Plan 1A). */
export interface DnsVerifier {
  pointsToPlatform(hostname: string): Promise<boolean>;
}
```

Append to `services/tenancy/src/domain/repositories.ts`. Add the import at the top beside the others:

```ts
import type { ShopDomain } from "./shop-domain";
```

```ts
export interface ShopDomainRepository {
  save(domain: ShopDomain, tx?: unknown): Promise<void>;
  findById(id: string, tx?: unknown): Promise<ShopDomain | null>;
  /** `hostname` is already normalised (`Hostname.value`). Unique across the whole platform. */
  findByHostname(hostname: string, tx?: unknown): Promise<ShopDomain | null>;
  listByShop(shopRef: string, tx?: unknown): Promise<readonly ShopDomain[]>;
}
```

- [ ] **Step 4: Run the tests to verify they pass, then typecheck**

Run: `pnpm.cmd --filter @platform/tenancy run test -- shop-domain`
Expected: PASS, 5 tests.

Run: `pnpm.cmd --filter @platform/tenancy run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add services/tenancy/src/domain/shop-domain.ts services/tenancy/src/domain/shop-domain.test.ts services/tenancy/src/domain/dns-verifier.ts services/tenancy/src/domain/repositories.ts
git commit -m "feat(tenancy): add shop domain aggregate and ports"
```

---

### Task 3: In-memory repository and the shop-domain use cases

**Files:**

- Modify: `services/tenancy/src/infrastructure/in-memory-repositories.ts` (append a class)
- Create: `services/tenancy/src/application/shop-domains.use-cases.ts`
- Test: `services/tenancy/src/application/shop-domains.use-cases.test.ts`

**Interfaces:**

- Consumes: Task 2's `ShopDomain`, `ShopDomainRepository`, `DnsVerifier`; the existing `TenantRepository`.
- Produces:
  - `ShopDomainsDeps`
  - `ShopDomainView`
  - `AddCustomDomain`, which takes `{ shopId, hostname }` and returns `{ id }`
  - `VerifyDomain`, which takes `{ domainId }` and returns `ShopDomainView`
  - `SetPrimaryDomain`, which takes `{ domainId }` and returns `ShopDomainView`
  - `ListShopDomains`, which takes `{ shopId }` and returns `{ items: ShopDomainView[] }`
  - `ResolveHost`, which takes `{ hostname }` and returns `ResolvedHost`
  - `InMemoryShopDomainRepository`

- [ ] **Step 1: Write the failing test**

```ts
// services/tenancy/src/application/shop-domains.use-cases.test.ts
import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Tenant } from "../domain/tenant";
import { TenantSlug } from "../domain/value-objects/tenant-slug";
import type { DnsVerifier } from "../domain/dns-verifier";
import {
  InMemoryShopDomainRepository,
  InMemoryTenantRepository,
} from "../infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { TenancyEventTranslator } from "../infrastructure/tenancy-event-translator";
import {
  AddCustomDomain,
  ListShopDomains,
  ResolveHost,
  SetPrimaryDomain,
  VerifyDomain,
  type ShopDomainsDeps,
} from "./shop-domains.use-cases";

const clock: Clock = { now: () => new Date("2026-10-05T00:00:00.000Z") };

async function setup(dns?: DnsVerifier) {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new TenancyEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "tenancy",
  });
  const context = rootEventContext(idGenerator, "platform");
  const tenants = new InMemoryTenantRepository({ outbox, context });
  const slug = TenantSlug.create("acme");
  if (!slug.ok) throw new Error("fixture");
  await tenants.save(
    Tenant.create(UniqueEntityId.from("shop-1"), slug.value, "Acme", "pooled", "e-1", clock.now()),
  );
  const deps: ShopDomainsDeps = {
    tenants,
    domains: new InMemoryShopDomainRepository(),
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator,
    clock,
    platformStoreDomain: "morbeh.store",
    ...(dns === undefined ? {} : { dnsVerifier: dns }),
  };
  return deps;
}

const pointsHere: DnsVerifier = { pointsToPlatform: async () => true };
const pointsElsewhere: DnsVerifier = { pointsToPlatform: async () => false };

describe("shop domain use cases", () => {
  it("adds a custom domain as pending, normalised", async () => {
    const deps = await setup();
    const added = await new AddCustomDomain(deps).execute({
      shopId: "shop-1",
      hostname: "Shop.Acme.COM",
    });
    expect(added.ok).toBe(true);
    const list = await new ListShopDomains(deps).execute({ shopId: "shop-1" });
    if (!list.ok) throw new Error("list failed");
    expect(list.value.items).toEqual([
      expect.objectContaining({ hostname: "shop.acme.com", status: "pending", isPrimary: false }),
    ]);
  });

  it("refuses an unknown shop, a taken hostname, and the platform's own zone", async () => {
    const deps = await setup();
    const unknown = await new AddCustomDomain(deps).execute({ shopId: "nope", hostname: "x.com" });
    expect(unknown.ok || unknown.error.code).toBe("NOT_FOUND");
    await new AddCustomDomain(deps).execute({ shopId: "shop-1", hostname: "acme.com" });
    const taken = await new AddCustomDomain(deps).execute({
      shopId: "shop-1",
      hostname: "ACME.com",
    });
    expect(taken.ok || taken.error.code).toBe("CONFLICT");
    const reserved = await new AddCustomDomain(deps).execute({
      shopId: "shop-1",
      hostname: "evil.morbeh.store",
    });
    expect(reserved.ok || reserved.error.code).toBe("VALIDATION");
  });

  it("verifies only when DNS points at the platform, and only when a verifier is configured", async () => {
    const noDns = await setup();
    const a = await new AddCustomDomain(noDns).execute({ shopId: "shop-1", hostname: "a.com" });
    if (!a.ok) throw new Error("add failed");
    const unconfigured = await new VerifyDomain(noDns).execute({ domainId: a.value.id });
    expect(unconfigured.ok || unconfigured.error.code).toBe("BUSINESS_RULE");

    const elsewhere = await setup(pointsElsewhere);
    const b = await new AddCustomDomain(elsewhere).execute({ shopId: "shop-1", hostname: "b.com" });
    if (!b.ok) throw new Error("add failed");
    const notYet = await new VerifyDomain(elsewhere).execute({ domainId: b.value.id });
    expect(notYet.ok || notYet.error.code).toBe("BUSINESS_RULE");

    const here = await setup(pointsHere);
    const c = await new AddCustomDomain(here).execute({ shopId: "shop-1", hostname: "c.com" });
    if (!c.ok) throw new Error("add failed");
    const verified = await new VerifyDomain(here).execute({ domainId: c.value.id });
    expect(verified.ok && verified.value.status).toBe("verified");
  });

  it("setting a primary demotes the previous primary of the same shop", async () => {
    const deps = await setup(pointsHere);
    const first = await new AddCustomDomain(deps).execute({
      shopId: "shop-1",
      hostname: "one.com",
    });
    const second = await new AddCustomDomain(deps).execute({
      shopId: "shop-1",
      hostname: "two.com",
    });
    if (!first.ok || !second.ok) throw new Error("add failed");
    await new VerifyDomain(deps).execute({ domainId: first.value.id });
    await new VerifyDomain(deps).execute({ domainId: second.value.id });
    await new SetPrimaryDomain(deps).execute({ domainId: first.value.id });
    await new SetPrimaryDomain(deps).execute({ domainId: second.value.id });
    const list = await new ListShopDomains(deps).execute({ shopId: "shop-1" });
    if (!list.ok) throw new Error("list failed");
    const primaries = list.value.items.filter((d) => d.isPrimary).map((d) => d.hostname);
    expect(primaries).toEqual(["two.com"]);
  });

  it("resolves a verified hostname to its shop and primary hostname; pending and unknown are NOT_FOUND", async () => {
    const deps = await setup(pointsHere);
    const added = await new AddCustomDomain(deps).execute({
      shopId: "shop-1",
      hostname: "acme.com",
    });
    if (!added.ok) throw new Error("add failed");

    const pending = await new ResolveHost(deps).execute({ hostname: "acme.com" });
    expect(pending.ok || pending.error.code).toBe("NOT_FOUND");

    await new VerifyDomain(deps).execute({ domainId: added.value.id });
    await new SetPrimaryDomain(deps).execute({ domainId: added.value.id });
    const resolved = await new ResolveHost(deps).execute({ hostname: "ACME.com." });
    expect(resolved.ok && resolved.value).toEqual({
      shopId: "shop-1",
      hostname: "acme.com",
      primaryHostname: "acme.com",
      shopStatus: "active",
    });

    const unknown = await new ResolveHost(deps).execute({ hostname: "nobody.com" });
    expect(unknown.ok || unknown.error.code).toBe("NOT_FOUND");
    const garbage = await new ResolveHost(deps).execute({ hostname: "not a host" });
    expect(garbage.ok || garbage.error.code).toBe("NOT_FOUND");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/tenancy run test -- shop-domains`
Expected: FAIL, `Cannot find module './shop-domains.use-cases'`.

- [ ] **Step 3: Write the implementation**

Append to `services/tenancy/src/infrastructure/in-memory-repositories.ts`. Add imports at the top: `import type { ShopDomainRepository } from "../domain/repositories";` (merge into the existing `repositories` import) and `import type { ShopDomain } from "../domain/shop-domain";`.

```ts
export class InMemoryShopDomainRepository implements ShopDomainRepository {
  private readonly store = new Map<string, ShopDomain>();

  async save(domain: ShopDomain): Promise<void> {
    this.store.set(domain.id.toString(), domain);
  }

  async findById(id: string): Promise<ShopDomain | null> {
    return this.store.get(id) ?? null;
  }

  async findByHostname(hostname: string): Promise<ShopDomain | null> {
    for (const domain of this.store.values()) {
      if (domain.hostname.value === hostname) return domain;
    }
    return null;
  }

  async listByShop(shopRef: string): Promise<readonly ShopDomain[]> {
    return [...this.store.values()]
      .filter((domain) => domain.shopRef === shopRef)
      .sort((a, b) => a.hostname.value.localeCompare(b.hostname.value));
  }
}
```

```ts
// services/tenancy/src/application/shop-domains.use-cases.ts
import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import {
  ConflictError,
  type DomainError,
  NotFoundError,
  ValidationError,
  isDomainError,
} from "@platform/utils";
import type { DnsVerifier } from "../domain/dns-verifier";
import type { ShopDomainRepository, TenantRepository } from "../domain/repositories";
import { ShopDomain } from "../domain/shop-domain";
import type { TenantStatus } from "../domain/tenant";
import { Hostname } from "../domain/value-objects/hostname";

export interface ShopDomainsDeps {
  readonly tenants: TenantRepository;
  readonly domains: ShopDomainRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** e.g. `morbeh.store`. Shops get `<slug>.<this>`; merchants may not claim names under it. */
  readonly platformStoreDomain?: string;
  /** Absent ⇒ custom domains cannot be verified (VerifyDomain answers BUSINESS_RULE). */
  readonly dnsVerifier?: DnsVerifier;
}

/** The wire shape of a shop domain — never the aggregate itself (see public-catalog-routes.ts). */
export interface ShopDomainView {
  readonly id: string;
  readonly shopId: string;
  readonly hostname: string;
  readonly kind: "platform" | "custom";
  readonly status: "pending" | "verified";
  readonly isPrimary: boolean;
  readonly verifiedAt: string | null;
}

export function toShopDomainView(domain: ShopDomain): ShopDomainView {
  return {
    id: domain.id.toString(),
    shopId: domain.shopRef,
    hostname: domain.hostname.value,
    kind: domain.kind,
    status: domain.status,
    isPrimary: domain.isPrimary,
    verifiedAt: domain.verifiedAt?.toISOString() ?? null,
  };
}

/** True when `hostname` is the platform zone itself or any name under it. */
export function isUnderPlatformZone(hostname: string, platformStoreDomain?: string): boolean {
  if (platformStoreDomain === undefined || platformStoreDomain === "") return false;
  const zone = platformStoreDomain.toLowerCase();
  return hostname === zone || hostname.endsWith(`.${zone}`);
}

export interface AddCustomDomainInput {
  readonly shopId: string;
  readonly hostname: string;
}

/** Adds a merchant-owned hostname as `pending`; it serves nothing until verified. */
export class AddCustomDomain implements UseCase<AddCustomDomainInput, { id: string }, DomainError> {
  private readonly deps: ShopDomainsDeps;

  constructor(deps: ShopDomainsDeps) {
    this.deps = deps;
  }

  async execute(input: AddCustomDomainInput): Promise<Result<{ id: string }, DomainError>> {
    const hostname = Hostname.create(input.hostname);
    if (!hostname.ok) return err(hostname.error);
    if (isUnderPlatformZone(hostname.value.value, this.deps.platformStoreDomain)) {
      return err(
        new ValidationError("Invalid hostname", [
          { field: "hostname", message: "names under the platform's own domain are reserved" },
        ]),
      );
    }
    return this.deps.unitOfWork.run<Result<{ id: string }, DomainError>>(async (tx) => {
      const shop = await this.deps.tenants.findById(input.shopId, tx);
      if (shop === null) return err(new NotFoundError("Shop not found"));
      const taken = await this.deps.domains.findByHostname(hostname.value.value, tx);
      if (taken !== null) {
        return err(new ConflictError(`Hostname "${hostname.value.value}" is already in use`));
      }
      const id = UniqueEntityId.from(this.deps.idGenerator.generate());
      await this.deps.domains.save(ShopDomain.custom(id, input.shopId, hostname.value), tx);
      return ok({ id: id.toString() });
    });
  }
}

export interface DomainIdInput {
  readonly domainId: string;
}

/** Marks a custom domain verified once its DNS points at the platform. Idempotent. */
export class VerifyDomain implements UseCase<DomainIdInput, ShopDomainView, DomainError> {
  private readonly deps: ShopDomainsDeps;

  constructor(deps: ShopDomainsDeps) {
    this.deps = deps;
  }

  async execute(input: DomainIdInput): Promise<Result<ShopDomainView, DomainError>> {
    const verifier = this.deps.dnsVerifier;
    if (verifier === undefined) {
      return err(new BusinessRuleError("Domain verification is not configured on this platform"));
    }
    return this.deps.unitOfWork.run<Result<ShopDomainView, DomainError>>(async (tx) => {
      const domain = await this.deps.domains.findById(input.domainId, tx);
      if (domain === null) return err(new NotFoundError("Domain not found"));
      if (domain.status === "verified") return ok(toShopDomainView(domain));
      if (!(await verifier.pointsToPlatform(domain.hostname.value))) {
        return err(
          new BusinessRuleError(
            `"${domain.hostname.value}" does not point at the platform yet; check its DNS record`,
          ),
        );
      }
      domain.verify(this.deps.clock.now());
      await this.deps.domains.save(domain, tx);
      return ok(toShopDomainView(domain));
    });
  }
}

/** Makes a verified domain the shop's primary; the previous primary is demoted first. */
export class SetPrimaryDomain implements UseCase<DomainIdInput, ShopDomainView, DomainError> {
  private readonly deps: ShopDomainsDeps;

  constructor(deps: ShopDomainsDeps) {
    this.deps = deps;
  }

  async execute(input: DomainIdInput): Promise<Result<ShopDomainView, DomainError>> {
    return this.deps.unitOfWork.run<Result<ShopDomainView, DomainError>>(async (tx) => {
      const domain = await this.deps.domains.findById(input.domainId, tx);
      if (domain === null) return err(new NotFoundError("Domain not found"));
      if (domain.isPrimary) return ok(toShopDomainView(domain));
      if (domain.status !== "verified") {
        return err(new BusinessRuleError("Only a verified domain can be made primary"));
      }
      // Demote BEFORE promoting: the database allows one primary per shop (partial unique index).
      for (const other of await this.deps.domains.listByShop(domain.shopRef, tx)) {
        if (other.isPrimary) {
          other.demote();
          await this.deps.domains.save(other, tx);
        }
      }
      try {
        domain.makePrimary();
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.domains.save(domain, tx);
      return ok(toShopDomainView(domain));
    });
  }
}

export interface ShopIdInput {
  readonly shopId: string;
}

export class ListShopDomains implements UseCase<
  ShopIdInput,
  { items: readonly ShopDomainView[] },
  DomainError
> {
  private readonly deps: Pick<ShopDomainsDeps, "domains">;

  constructor(deps: Pick<ShopDomainsDeps, "domains">) {
    this.deps = deps;
  }

  async execute(
    input: ShopIdInput,
  ): Promise<Result<{ items: readonly ShopDomainView[] }, DomainError>> {
    const domains = await this.deps.domains.listByShop(input.shopId);
    return ok({ items: domains.map(toShopDomainView) });
  }
}

export interface ResolveHostInput {
  readonly hostname: string;
}

export interface ResolvedHost {
  readonly shopId: string;
  readonly hostname: string;
  readonly primaryHostname: string;
  readonly shopStatus: TenantStatus;
}

/**
 * Host → shop, for the storefront edge (Plan 1A). Only VERIFIED domains resolve; a pending one is
 * NOT_FOUND exactly like an unknown one, so nobody can serve a shop on a name they have not proven.
 */
export class ResolveHost implements UseCase<ResolveHostInput, ResolvedHost, DomainError> {
  private readonly deps: Pick<ShopDomainsDeps, "domains" | "tenants">;

  constructor(deps: Pick<ShopDomainsDeps, "domains" | "tenants">) {
    this.deps = deps;
  }

  async execute(input: ResolveHostInput): Promise<Result<ResolvedHost, DomainError>> {
    const notFound = err(new NotFoundError("No shop is served on this hostname"));
    const hostname = Hostname.create(input.hostname);
    if (!hostname.ok) return notFound;
    const domain = await this.deps.domains.findByHostname(hostname.value.value);
    if (domain === null || domain.status !== "verified") return notFound;
    const shop = await this.deps.tenants.findById(domain.shopRef);
    if (shop === null) return notFound;
    const all = await this.deps.domains.listByShop(domain.shopRef);
    const primary = all.find((d) => d.isPrimary) ?? domain;
    return ok({
      shopId: domain.shopRef,
      hostname: domain.hostname.value,
      primaryHostname: primary.hostname.value,
      shopStatus: shop.status,
    });
  }
}
```

> **Note on `BusinessRuleError`:** `tenant.ts` imports it from `@platform/domain`. If the presenter maps it to code `BUSINESS_RULE` (presenter.ts `STATUS_BY_CODE` has `BUSINESS_RULE: 409`), the tests above hold. If the typecheck reports it is not a `DomainError`, import `BusinessRuleError` from `@platform/utils` instead. Check with: `grep -rn "export class BusinessRuleError" packages/`.

- [ ] **Step 4: Run the tests to verify they pass, then typecheck**

Run: `pnpm.cmd --filter @platform/tenancy run test -- shop-domains`
Expected: PASS, 5 tests.

Run: `pnpm.cmd --filter @platform/tenancy run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add services/tenancy/src/application/shop-domains.use-cases.ts services/tenancy/src/application/shop-domains.use-cases.test.ts services/tenancy/src/infrastructure/in-memory-repositories.ts
git commit -m "feat(tenancy): add shop domain use cases and host resolution"
```

---

### Task 4: `CreateTenant` gives every new shop its platform subdomain

**Files:**

- Modify: `services/tenancy/src/application/tenancy.use-cases.ts` (`TenancyDeps`, `CreateTenant.execute`)
- Test: `services/tenancy/src/application/shop-domains.use-cases.test.ts` (append a `describe`)

**Interfaces:**

- Consumes: `ShopDomainRepository`, `ShopDomain.platform`, `Hostname`.
- Produces: `TenancyDeps` gains optional `domains?: ShopDomainRepository` and `platformStoreDomain?: string`. When both are present, `CreateTenant` saves `<slug>.<platformStoreDomain>` (verified, primary) in the same unit of work.

- [ ] **Step 1: Write the failing test** (append to the same test file)

```ts
import { CreateTenant } from "./tenancy.use-cases";
import { InMemoryWorkspaceRepository } from "../infrastructure/in-memory-repositories";

describe("CreateTenant platform subdomain", () => {
  it("creates <slug>.<platformStoreDomain> as the verified primary domain", async () => {
    const deps = await setup();
    const workspaces = new InMemoryWorkspaceRepository({
      outbox: undefined as never,
      context: undefined as never,
    });
    const created = await new CreateTenant({ ...deps, workspaces }).execute({
      slug: "beta",
      name: "Beta",
      isolationTier: "pooled",
    });
    if (!created.ok) throw new Error("create failed");
    const resolved = await new ResolveHost(deps).execute({ hostname: "beta.morbeh.store" });
    expect(resolved.ok && resolved.value.shopId).toBe(created.value.id);
    expect(resolved.ok && resolved.value.primaryHostname).toBe("beta.morbeh.store");
  });

  it("adds no domain when platformStoreDomain is not configured", async () => {
    const deps = await setup();
    const { platformStoreDomain: _unused, ...withoutZone } = deps;
    const workspaces = new InMemoryWorkspaceRepository({
      outbox: undefined as never,
      context: undefined as never,
    });
    const created = await new CreateTenant({ ...withoutZone, workspaces }).execute({
      slug: "gamma",
      name: "Gamma",
      isolationTier: "pooled",
    });
    if (!created.ok) throw new Error("create failed");
    const list = await new ListShopDomains(deps).execute({ shopId: created.value.id });
    expect(list.ok && list.value.items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/tenancy run test -- shop-domains`
Expected: FAIL on "creates <slug>.<platformStoreDomain>…", because `resolved` is NOT_FOUND.

- [ ] **Step 3: Write the implementation**

In `tenancy.use-cases.ts`, add the imports:

```ts
import type { ShopDomainRepository } from "../domain/repositories";
import { ShopDomain } from "../domain/shop-domain";
import { Hostname } from "../domain/value-objects/hostname";
```

(Merge `ShopDomainRepository` into the existing `../domain/repositories` import.)

Add these fields to `TenancyDeps`:

```ts
  /** Plan 1A: present together with `platformStoreDomain` ⇒ CreateTenant adds the shop's subdomain. */
  readonly domains?: ShopDomainRepository;
  /** Plan 1A: e.g. `morbeh.store`. */
  readonly platformStoreDomain?: string;
```

In `CreateTenant.execute`, replace

```ts
await this.deps.tenants.save(tenant, tx);
return ok({ id: id.toString() });
```

with

```ts
await this.deps.tenants.save(tenant, tx);
const zone = this.deps.platformStoreDomain;
if (this.deps.domains !== undefined && zone !== undefined && zone !== "") {
  const hostname = Hostname.create(`${input.slug}.${zone}`);
  if (!hostname.ok) return err(hostname.error);
  if ((await this.deps.domains.findByHostname(hostname.value.value, tx)) !== null) {
    return err(new ConflictError(`Hostname "${hostname.value.value}" is already in use`));
  }
  const domain = ShopDomain.platform(
    UniqueEntityId.from(this.deps.idGenerator.generate()),
    id.toString(),
    hostname.value,
    this.deps.clock.now(),
  );
  await this.deps.domains.save(domain, tx);
}
return ok({ id: id.toString() });
```

- [ ] **Step 4: Run the whole tenancy package to verify it passes**

Run: `pnpm.cmd --filter @platform/tenancy run test`
Expected: PASS, every tenancy test including the existing ones.

Run: `pnpm.cmd --filter @platform/tenancy run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add services/tenancy/src/application/tenancy.use-cases.ts services/tenancy/src/application/shop-domains.use-cases.test.ts
git commit -m "feat(tenancy): give every new shop its platform subdomain"
```

---

### Task 5: Prisma model, hand-written migration, Prisma repository

**Files:**

- Modify: `packages/db/prisma/schema/tenancy.prisma` (append model)
- Create: `packages/db/prisma/schema/migrations/20261005000000_tenancy_shop_domains/migration.sql`
- Modify: `packages/db/src/schema-migration-consistency.test.ts` (append a describe)
- Modify: `services/tenancy/src/infrastructure/mappers.ts` (append `ShopDomainMapper`)
- Modify: `services/tenancy/src/infrastructure/prisma-repositories.ts` (append `PrismaShopDomainRepository`)

**Interfaces:**

- Produces: `PrismaShopDomainRepository(deps: PrismaTenancyRepositoriesDeps)` implements `ShopDomainRepository`. Every query filters by `deps.tenantId`, the platform scope.

- [ ] **Step 1: Write the failing test** (append to `schema-migration-consistency.test.ts`)

```ts
describe("tenancy.shop_domains — migration history matches the Prisma model (Plan 1A)", () => {
  const allSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(join(migrationsDir, entry.name, "migration.sql"), "utf-8"))
    .join("\n");

  it("every required column was created by some migration", () => {
    const actual = columnsEverAddedTo("tenancy", "shop_domains", allSql);
    for (const column of [
      "id",
      "tenant_id",
      "shop_ref",
      "hostname",
      "kind",
      "status",
      "is_primary",
      "version",
      "created_at",
      "updated_at",
    ]) {
      expect(actual.has(column), `expected "tenancy"."shop_domains"."${column}"`).toBe(true);
    }
  });

  it("is RLS-forced with the tenant_isolation policy and one primary per shop", () => {
    expect(allSql).toContain('ALTER TABLE "tenancy"."shop_domains" FORCE ROW LEVEL SECURITY;');
    expect(allSql).toContain('CREATE POLICY tenant_isolation ON "tenancy"."shop_domains"');
    expect(allSql).toContain('CREATE UNIQUE INDEX "shop_domains_one_primary_per_shop"');
    expect(allSql).toContain('CREATE UNIQUE INDEX "shop_domains_hostname_key"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/db run test -- schema-migration-consistency`
Expected: FAIL, `expected "tenancy"."shop_domains"."id"`.

- [ ] **Step 3: Write the model, migration, mapper and repository**

Append to `packages/db/prisma/schema/tenancy.prisma`:

```prisma
// Plan 1A — a hostname a shop is served on (Shopify's `Domain`). Platform-tenant scoped like
// `Tenant`; `shop_ref` is the merchant tenant's id. `hostname` is unique across the platform.
model ShopDomain {
  id         String    @id @db.Uuid
  tenantId   String    @map("tenant_id")
  shopRef    String    @map("shop_ref")
  hostname   String
  kind       String // platform | custom (domain-enforced, see ShopDomainKind)
  status     String // pending | verified (domain-enforced, see ShopDomainStatus)
  isPrimary  Boolean   @default(false) @map("is_primary")
  verifiedAt DateTime? @map("verified_at")
  version    Int       @default(0)
  createdAt  DateTime  @default(now()) @map("created_at")
  updatedAt  DateTime  @updatedAt @map("updated_at")

  @@unique([hostname])
  @@index([tenantId, shopRef])
  @@map("shop_domains")
  @@schema("tenancy")
}
```

Create `packages/db/prisma/schema/migrations/20261005000000_tenancy_shop_domains/migration.sql`:

```sql
-- Plan 1A — shop domains (Shopify's `Domain`): the hostnames a shop is served on.
-- Written by hand and NOT applied by the agent that authored it. The owner deploys it from Railway's
-- Console (`cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`) WITH or BEFORE the
-- release that reads `tenancy.shop_domains`.
--
-- PURELY ADDITIVE: one new table, nothing existing is altered, so it is safe in any order relative
-- to every earlier migration.
--
-- WHOSE ROW. Platform-tenant scoped (`tenant_id`, the ADR-0014 8f scope the tenancy context is pinned
-- to), exactly like `tenancy.tenants`; `shop_ref` is the merchant tenant the hostname serves. RLS is
-- ENABLED and FORCED with the same `tenant_isolation` policy every tenant-scoped table carries.
--
-- INVARIANTS AT THE DATABASE. `hostname` is unique platform-wide (one name serves one shop); a shop
-- has at most one primary (partial unique index, which Prisma cannot express); a primary domain is
-- always verified, and `verified_at` is set exactly when `status` is verified.

CREATE TABLE "tenancy"."shop_domains" (
  "id"          UUID         NOT NULL,
  "tenant_id"   TEXT         NOT NULL,
  "shop_ref"    TEXT         NOT NULL,
  "hostname"    TEXT         NOT NULL,
  "kind"        TEXT         NOT NULL,
  "status"      TEXT         NOT NULL,
  "is_primary"  BOOLEAN      NOT NULL DEFAULT false,
  "verified_at" TIMESTAMP(3),
  "version"     INTEGER      NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shop_domains_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shop_domains_kind_check" CHECK ("kind" IN ('platform', 'custom')),
  CONSTRAINT "shop_domains_status_check" CHECK ("status" IN ('pending', 'verified')),
  CONSTRAINT "shop_domains_verified_at_check"
    CHECK (("status" = 'verified') = ("verified_at" IS NOT NULL)),
  CONSTRAINT "shop_domains_primary_is_verified_check"
    CHECK (NOT "is_primary" OR "status" = 'verified'),
  CONSTRAINT "shop_domains_hostname_lowercase_check" CHECK ("hostname" = lower("hostname"))
);

CREATE UNIQUE INDEX "shop_domains_hostname_key"
  ON "tenancy"."shop_domains" ("hostname");

CREATE INDEX "shop_domains_tenant_id_shop_ref_idx"
  ON "tenancy"."shop_domains" ("tenant_id", "shop_ref");

CREATE UNIQUE INDEX "shop_domains_one_primary_per_shop"
  ON "tenancy"."shop_domains" ("tenant_id", "shop_ref")
  WHERE "is_primary";

ALTER TABLE "tenancy"."shop_domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenancy"."shop_domains" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenancy"."shop_domains";
CREATE POLICY tenant_isolation ON "tenancy"."shop_domains" FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE "tenancy"."shop_domains" IS
  'Plan 1A: hostnames a shop is served on. Platform-tenant scoped, RLS forced. Only verified rows resolve.';
```

Append to `services/tenancy/src/infrastructure/mappers.ts`. Add the imports:

```ts
import { ShopDomain, type ShopDomainKind, type ShopDomainStatus } from "../domain/shop-domain";
import { Hostname } from "../domain/value-objects/hostname";
```

```ts
export interface ShopDomainRow {
  readonly id: string;
  readonly shopRef: string;
  readonly hostname: string;
  readonly kind: ShopDomainKind;
  readonly status: ShopDomainStatus;
  readonly isPrimary: boolean;
  readonly verifiedAt: Date | null;
  readonly version: number;
}

export class ShopDomainMapper {
  static toDomain(row: ShopDomainRow): ShopDomain {
    const hostname = Hostname.create(row.hostname);
    if (!hostname.ok) throw new Error(`Corrupt shop_domains row: ${hostname.error.message}`);
    return ShopDomain.reconstitute(
      UniqueEntityId.from(row.id),
      {
        shopRef: row.shopRef,
        hostname: hostname.value,
        kind: row.kind,
        status: row.status,
        isPrimary: row.isPrimary,
        ...(row.verifiedAt === null ? {} : { verifiedAt: row.verifiedAt }),
      },
      row.version,
    );
  }

  static toRow(domain: ShopDomain, tenantId: string) {
    return {
      id: domain.id.toString(),
      tenantId,
      shopRef: domain.shopRef,
      hostname: domain.hostname.value,
      kind: domain.kind,
      status: domain.status,
      isPrimary: domain.isPrimary,
      verifiedAt: domain.verifiedAt ?? null,
      version: 1,
    };
  }
}
```

Append to `services/tenancy/src/infrastructure/prisma-repositories.ts`. Extend the imports with `ShopDomainRepository`, `ShopDomain`, `ShopDomainMapper` and `ShopDomainRow`.

```ts
export class PrismaShopDomainRepository implements ShopDomainRepository {
  private readonly deps: PrismaTenancyRepositoriesDeps;

  constructor(deps: PrismaTenancyRepositoriesDeps) {
    this.deps = deps;
  }

  async save(domain: ShopDomain, tx?: unknown): Promise<void> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const tenantId = this.deps.tenantId;
    const id = domain.id.toString();
    const row = ShopDomainMapper.toRow(domain, tenantId);
    if (domain.version === 0) {
      await client.shopDomain.create({ data: row });
      return;
    }
    const updated = await client.shopDomain.updateMany({
      where: { id, tenantId, version: domain.version },
      data: {
        status: row.status,
        isPrimary: row.isPrimary,
        verifiedAt: row.verifiedAt,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0)
      throw new ConcurrencyError(`ShopDomain ${id} was modified concurrently`);
  }

  async findById(id: string, tx?: unknown): Promise<ShopDomain | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.shopDomain.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    return row === null ? null : ShopDomainMapper.toDomain(row as ShopDomainRow);
  }

  async findByHostname(hostname: string, tx?: unknown): Promise<ShopDomain | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.shopDomain.findFirst({
      where: { hostname, tenantId: this.deps.tenantId },
    });
    return row === null ? null : ShopDomainMapper.toDomain(row as ShopDomainRow);
  }

  async listByShop(shopRef: string, tx?: unknown): Promise<readonly ShopDomain[]> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const rows = await client.shopDomain.findMany({
      where: { shopRef, tenantId: this.deps.tenantId },
      orderBy: { hostname: "asc" },
    });
    return rows.map((row) => ShopDomainMapper.toDomain(row as ShopDomainRow));
  }
}
```

**Regenerate the Prisma client.** This does NOT connect to a database:
`pnpm.cmd --filter @platform/db exec prisma generate`

If the package has a `generate`/`db:generate` script, use that instead. Check `packages/db/package.json`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm.cmd --filter @platform/db run test -- schema-migration-consistency`
Expected: PASS.

Run: `pnpm.cmd --filter @platform/tenancy run typecheck`
Expected: exit 0. `client.shopDomain` must exist after generate.

Run: `pnpm.cmd --filter @platform/tenancy run test`
Expected: PASS. The integration file stays skipped without `DATABASE_URL_TEST`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema/tenancy.prisma packages/db/prisma/schema/migrations/20261005000000_tenancy_shop_domains/migration.sql packages/db/src/schema-migration-consistency.test.ts services/tenancy/src/infrastructure/mappers.ts services/tenancy/src/infrastructure/prisma-repositories.ts
git commit -m "feat(tenancy): persist shop domains with an rls-forced table"
```

---

### Task 6: DNS verifier adapter, controller and composition

**Files:**

- Create: `services/tenancy/src/infrastructure/node-dns-verifier.ts`
- Test: `services/tenancy/src/infrastructure/node-dns-verifier.test.ts`
- Modify: `services/tenancy/src/interfaces/tenancy.controller.ts`
- Modify: `services/tenancy/src/composition.ts`
- Modify: `services/tenancy/src/index.ts`

**Interfaces:**

- Produces:
  - `NodeDnsVerifier({ cnameTarget, ipv4Targets, resolver? })`
  - `TenancyController` methods:
    - `addCustomDomain(input: AddCustomDomainInput)`
    - `verifyDomain(input: DomainIdInput)`
    - `setPrimaryDomain(input: DomainIdInput)`
    - `listShopDomains(input: ShopIdInput)`
    - `resolveHost(input: ResolveHostInput)`

    Each returns `Promise<ControllerResponse>`. Statuses: add → 201; the other four → 200.

  - `TenancyWiringDeps` gains `platformStoreDomain?: string` and `dnsVerifier?: DnsVerifier`.

- [ ] **Step 1: Write the failing test**

```ts
// services/tenancy/src/infrastructure/node-dns-verifier.test.ts
import { describe, expect, it } from "vitest";
import { NodeDnsVerifier, type DnsResolver } from "./node-dns-verifier";

function resolver(records: { cname?: string[]; a?: string[] }): DnsResolver {
  const notFound = Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
  return {
    resolveCname: async () => {
      if (records.cname === undefined) throw notFound;
      return records.cname;
    },
    resolve4: async () => {
      if (records.a === undefined) throw notFound;
      return records.a;
    },
  };
}

const options = { cnameTarget: "shops.morbeh.store", ipv4Targets: ["203.0.113.10"] };

describe("NodeDnsVerifier", () => {
  it("accepts a CNAME to the target (case and trailing dot ignored)", async () => {
    const dns = new NodeDnsVerifier({
      ...options,
      resolver: resolver({ cname: ["Shops.Morbeh.Store."] }),
    });
    expect(await dns.pointsToPlatform("www.acme.com")).toBe(true);
  });

  it("accepts an apex A record on a platform IPv4", async () => {
    const dns = new NodeDnsVerifier({ ...options, resolver: resolver({ a: ["203.0.113.10"] }) });
    expect(await dns.pointsToPlatform("acme.com")).toBe(true);
  });

  it("rejects other targets and missing records without throwing", async () => {
    const elsewhere = new NodeDnsVerifier({
      ...options,
      resolver: resolver({ cname: ["other.host"], a: ["198.51.100.1"] }),
    });
    expect(await elsewhere.pointsToPlatform("acme.com")).toBe(false);
    const missing = new NodeDnsVerifier({ ...options, resolver: resolver({}) });
    expect(await missing.pointsToPlatform("acme.com")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/tenancy run test -- node-dns-verifier`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// services/tenancy/src/infrastructure/node-dns-verifier.ts
import { promises as dns } from "node:dns";
import type { DnsVerifier } from "../domain/dns-verifier";

export interface DnsResolver {
  resolveCname(hostname: string): Promise<string[]>;
  resolve4(hostname: string): Promise<string[]>;
}

export interface NodeDnsVerifierOptions {
  /** The name merchants CNAME to, e.g. `shops.morbeh.store`. */
  readonly cnameTarget: string;
  /** The storefront's public IPv4s, for apex domains that cannot CNAME. */
  readonly ipv4Targets: readonly string[];
  readonly resolver?: DnsResolver;
}

const normalise = (name: string): string => name.toLowerCase().replace(/\.$/, "");

/** `DnsVerifier` over `node:dns`. A lookup failure (NXDOMAIN, no data, timeout) means "not yet". */
export class NodeDnsVerifier implements DnsVerifier {
  private readonly options: NodeDnsVerifierOptions;
  private readonly resolver: DnsResolver;

  constructor(options: NodeDnsVerifierOptions) {
    this.options = options;
    this.resolver = options.resolver ?? dns;
  }

  async pointsToPlatform(hostname: string): Promise<boolean> {
    const target = normalise(this.options.cnameTarget);
    const cnames = await this.resolver.resolveCname(hostname).catch(() => [] as string[]);
    if (cnames.some((name) => normalise(name) === target)) return true;
    const addresses = await this.resolver.resolve4(hostname).catch(() => [] as string[]);
    return addresses.some((ip) => this.options.ipv4Targets.includes(ip));
  }
}
```

In `tenancy.controller.ts`:

- Import the five use-case types plus their input types from `../application/shop-domains.use-cases`.
- Add the five fields to `TenancyControllerDeps`: `addCustomDomain`, `verifyDomain`, `setPrimaryDomain`, `listShopDomains`, `resolveHost`.
- Add these methods:

```ts
  async addCustomDomain(input: AddCustomDomainInput): Promise<ControllerResponse> {
    return present(await this.deps.addCustomDomain.execute(input), 201);
  }

  async verifyDomain(input: DomainIdInput): Promise<ControllerResponse> {
    return present(await this.deps.verifyDomain.execute(input), 200);
  }

  async setPrimaryDomain(input: DomainIdInput): Promise<ControllerResponse> {
    return present(await this.deps.setPrimaryDomain.execute(input), 200);
  }

  async listShopDomains(input: ShopIdInput): Promise<ControllerResponse> {
    return present(await this.deps.listShopDomains.execute(input), 200);
  }

  async resolveHost(input: ResolveHostInput): Promise<ControllerResponse> {
    return present(await this.deps.resolveHost.execute(input), 200);
  }
```

In `composition.ts`:

1. Add to `TenancyWiringDeps`:

```ts
  /** Plan 1A: e.g. `morbeh.store`; new shops get `<slug>.<this>`. Absent ⇒ no automatic subdomain. */
  readonly platformStoreDomain?: string;
  /** Plan 1A: absent ⇒ custom domains cannot be verified. */
  readonly dnsVerifier?: DnsVerifier;
```

2. Add `readonly domains: ShopDomainRepository;` to `TenancyRepos`.

3. In `buildController`, extend `tenancyDeps` with:

```ts
    ...(deps.platformStoreDomain === undefined
      ? {}
      : { platformStoreDomain: deps.platformStoreDomain }),
    ...(deps.dnsVerifier === undefined ? {} : { dnsVerifier: deps.dnsVerifier }),
```

and add the controller entries:

```ts
    addCustomDomain: new AddCustomDomain(tenancyDeps),
    verifyDomain: new VerifyDomain(tenancyDeps),
    setPrimaryDomain: new SetPrimaryDomain(tenancyDeps),
    listShopDomains: new ListShopDomains(tenancyDeps),
    resolveHost: new ResolveHost(tenancyDeps),
```

4. In the Prisma branch, add `domains: new PrismaShopDomainRepository(tenancyDeps)`. In the in-memory branch, add `domains: new InMemoryShopDomainRepository()`.

In `index.ts`, add:

```ts
export { Hostname } from "./domain/value-objects/hostname";
export { ShopDomain } from "./domain/shop-domain";
export type { ShopDomainKind, ShopDomainStatus } from "./domain/shop-domain";
export type { DnsVerifier } from "./domain/dns-verifier";
export type { ShopDomainRepository } from "./domain/repositories";
export { NodeDnsVerifier } from "./infrastructure/node-dns-verifier";
export type { ResolvedHost, ShopDomainView } from "./application/shop-domains.use-cases";
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm.cmd --filter @platform/tenancy run test`
Expected: PASS.

Run: `pnpm.cmd --filter @platform/tenancy run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add services/tenancy/src
git commit -m "feat(tenancy): wire shop domains and dns verification"
```

---

### Task 7: Admin wrappers and routes (four guarded routes, one public)

**Files:**

- Modify: `apps/admin/src/composition.ts` (`AdminWiringDeps`)
- Modify: `apps/admin/src/interfaces/tenancy.admin-controller.ts`
- Modify: `apps/admin/src/http/tenancy-routes.ts`
- Test: `apps/admin/src/http/shop-domains-routes.test.ts`

**Interfaces:**

- Consumes: `TenancyController.{addCustomDomain, verifyDomain, setPrimaryDomain, listShopDomains, resolveHost}` (Task 6).
- Produces these routes (served under `/api/v1`, like every `version: 1` route):

| Method | Path                            | Permission       | Notes                     |
| ------ | ------------------------------- | ---------------- | ------------------------- |
| `GET`  | `/tenants/:tenantId/domains`    | `tenancy:read`   |                           |
| `POST` | `/tenants/:tenantId/domains`    | `tenancy:update` | body `{ hostname }`       |
| `POST` | `/domains/:domainId/verify`     | `tenancy:update` |                           |
| `POST` | `/domains/:domainId/primary`    | `tenancy:update` |                           |
| `GET`  | `/public/domains/resolve?host=` | `tenancy:read`   | `public: true`, unguarded |

All five sit inside `tenancyRoutes`, so under multi they are pinned to the platform tenant by `pinRoutesToTenant`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/admin/src/http/shop-domains-routes.test.ts
import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import { wireAdmin } from "../composition";
import { tenancyRoutes } from "./tenancy-routes";

const clock: Clock = { now: () => new Date("2026-10-05T00:00:00.000Z") };
const staff: Principal = {
  id: "staff-1",
  kind: "staff",
  roles: ["admin"],
  tenantId: "tenant-local",
};

function routes(): readonly RouteDefinition[] {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  const admin = wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    platformStoreDomain: "morbeh.store",
    dnsVerifier: { pointsToPlatform: async (host: string) => host === "acme.com" },
  });
  return tenancyRoutes(admin);
}

function route(all: readonly RouteDefinition[], method: string, path: string): RouteDefinition {
  const found = all.find((r) => r.method === method && r.path === path);
  if (found === undefined) throw new Error(`no route ${method} ${path}`);
  return found;
}

type Res = { status: number; body: unknown };
const field = (res: Res, key: string): unknown => (res.body as Record<string, unknown>)[key];
const items = (res: Res): ReadonlyArray<Record<string, unknown>> =>
  (res.body as { items: ReadonlyArray<Record<string, unknown>> }).items;
function call(r: RouteDefinition, params: object, query: object, body?: unknown): Promise<Res> {
  return r.handle({
    body,
    params,
    query,
    context: { tenantId: "tenant-local", principal: staff, requestId: "req-1" },
  } as never) as Promise<Res>;
}

describe("shop domain routes (Plan 1A)", () => {
  it("a new shop resolves on its platform subdomain through the public route", async () => {
    const all = routes();
    const created = await call(
      route(all, "POST", "/tenants"),
      {},
      {},
      {
        slug: "acme",
        name: "Acme",
        isolationTier: "pooled",
      },
    );
    expect(created.status).toBe(201);
    const resolve = route(all, "GET", "/public/domains/resolve");
    expect(resolve.public).toBe(true);
    const hit = await call(resolve, {}, { host: "ACME.morbeh.store" });
    expect(hit.status).toBe(200);
    expect(hit.body).toEqual({
      shopId: field(created, "id"),
      hostname: "acme.morbeh.store",
      primaryHostname: "acme.morbeh.store",
      shopStatus: "active",
    });
    const miss = await call(resolve, {}, { host: "nobody.morbeh.store" });
    expect(miss.status).toBe(404);
  });

  it("add → verify → primary moves the shop's primary hostname to the custom domain", async () => {
    const all = routes();
    const created = await call(
      route(all, "POST", "/tenants"),
      {},
      {},
      {
        slug: "acme",
        name: "Acme",
        isolationTier: "pooled",
      },
    );
    const shopId = field(created, "id") as string;
    const added = await call(
      route(all, "POST", "/tenants/:tenantId/domains"),
      { tenantId: shopId },
      {},
      {
        hostname: "acme.com",
      },
    );
    expect(added.status).toBe(201);
    const domainId = field(added, "id") as string;
    expect(
      (await call(route(all, "POST", "/domains/:domainId/verify"), { domainId }, {})).status,
    ).toBe(200);
    expect(
      (await call(route(all, "POST", "/domains/:domainId/primary"), { domainId }, {})).status,
    ).toBe(200);
    const listed = await call(
      route(all, "GET", "/tenants/:tenantId/domains"),
      { tenantId: shopId },
      {},
    );
    expect(items(listed).map((d) => [d["hostname"], d["isPrimary"]])).toEqual([
      ["acme.com", true],
      ["acme.morbeh.store", false],
    ]);
    const hit = await call(
      route(all, "GET", "/public/domains/resolve"),
      {},
      { host: "acme.morbeh.store" },
    );
    expect(field(hit, "primaryHostname")).toBe("acme.com");
  });

  it("never puts aggregate internals on the wire", async () => {
    const all = routes();
    const created = await call(
      route(all, "POST", "/tenants"),
      {},
      {},
      {
        slug: "acme",
        name: "Acme",
        isolationTier: "pooled",
      },
    );
    const listed = await call(
      route(all, "GET", "/tenants/:tenantId/domains"),
      { tenantId: field(created, "id") as string },
      {},
    );
    for (const item of items(listed)) {
      expect(item).not.toHaveProperty("props");
      expect(item).not.toHaveProperty("_id");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/admin run test -- shop-domains-routes`
Expected: FAIL. Typecheck or runtime reports `platformStoreDomain` is unknown, or `no route GET /public/domains/resolve`.

- [ ] **Step 3: Write the implementation**

In `apps/admin/src/composition.ts`:

- Import `type DnsVerifier` from `@platform/tenancy`.
- Add these to `AdminWiringDeps`. They reach `wireTenancy` unchanged, through its existing `...deps` spread.

```ts
  /** Plan 1A: e.g. `morbeh.store`; new shops get `<slug>.<this>`. */
  readonly platformStoreDomain?: string;
  /** Plan 1A: verifies custom domains' DNS; absent ⇒ custom domains stay pending. */
  readonly dnsVerifier?: DnsVerifier;
```

In `apps/admin/src/interfaces/tenancy.admin-controller.ts`, add:

```ts
  async listShopDomains(
    principal: Principal,
    input: Parameters<TenancyController["listShopDomains"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "tenancy:read");
    if (denied) return denied;
    return this.tenancy.listShopDomains(input);
  }

  async addCustomDomain(
    principal: Principal,
    input: Parameters<TenancyController["addCustomDomain"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "tenancy:update");
    if (denied) return denied;
    return this.tenancy.addCustomDomain(input);
  }

  async verifyDomain(
    principal: Principal,
    input: Parameters<TenancyController["verifyDomain"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "tenancy:update");
    if (denied) return denied;
    return this.tenancy.verifyDomain(input);
  }

  async setPrimaryDomain(
    principal: Principal,
    input: Parameters<TenancyController["setPrimaryDomain"]>[0],
  ): Promise<AdminResponse> {
    const denied = await this.guard.ensure(principal, "tenancy:update");
    if (denied) return denied;
    return this.tenancy.setPrimaryDomain(input);
  }

  /**
   * Plan 1A: UNGUARDED on purpose — the storefront edge resolves a hostname before anyone is signed
   * in (same reasoning as `admin.publicReads`). Returns only shop id, hostnames and shop status.
   */
  async resolveHost(
    input: Parameters<TenancyController["resolveHost"]>[0],
  ): Promise<AdminResponse> {
    return this.tenancy.resolveHost(input);
  }
```

In `apps/admin/src/http/tenancy-routes.ts`, add these schemas near the others:

```ts
const domainIdParams = z.object({ domainId: z.string().min(1) });
const addDomainBody = z.object({ hostname: z.string().min(1).max(253) });
const resolveHostQuery = z.object({ host: z.string().min(1).max(260) });
```

Append these route definitions to the array returned by `tenancyRoutes`:

```ts
    defineRoute({
      method: "GET",
      path: "/tenants/:tenantId/domains",
      version: 1,
      permission: "tenancy:read",
      summary: "List a shop's domains",
      schema: { params: tenantIdParams },
      handle: ({ params, context }) =>
        admin.tenancy.listShopDomains(context.principal, { shopId: params.tenantId }),
    }),
    defineRoute({
      method: "POST",
      path: "/tenants/:tenantId/domains",
      version: 1,
      permission: "tenancy:update",
      idempotent: true,
      summary: "Add a custom domain to a shop (pending until verified)",
      schema: { params: tenantIdParams, body: addDomainBody },
      handle: ({ params, body, context }) =>
        admin.tenancy.addCustomDomain(context.principal, {
          shopId: params.tenantId,
          hostname: body.hostname,
        }),
    }),
    defineRoute({
      method: "POST",
      path: "/domains/:domainId/verify",
      version: 1,
      permission: "tenancy:update",
      idempotent: true,
      summary: "Verify a custom domain's DNS points at the platform",
      schema: { params: domainIdParams },
      handle: ({ params, context }) => admin.tenancy.verifyDomain(context.principal, params),
    }),
    defineRoute({
      method: "POST",
      path: "/domains/:domainId/primary",
      version: 1,
      permission: "tenancy:update",
      idempotent: true,
      summary: "Make a verified domain the shop's primary",
      schema: { params: domainIdParams },
      handle: ({ params, context }) => admin.tenancy.setPrimaryDomain(context.principal, params),
    }),
    defineRoute({
      method: "GET",
      path: "/public/domains/resolve",
      version: 1,
      permission: "tenancy:read",
      public: true,
      summary: "Public: resolve a hostname to the shop it serves (verified domains only)",
      schema: { querystring: resolveHostQuery },
      handle: ({ query }) => admin.tenancy.resolveHost({ hostname: query.host }),
    }),
```

> If the route `idempotent: true` flag requires an `Idempotency-Key` header at the transport, the test calls `handle` directly, so it is unaffected. Keep the flag consistent with the neighbouring `POST /tenants`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm.cmd --filter @platform/admin run test -- shop-domains-routes tenancy-routes`
Expected: PASS.

Run: `pnpm.cmd --filter @platform/admin run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/composition.ts apps/admin/src/interfaces/tenancy.admin-controller.ts apps/admin/src/http/tenancy-routes.ts apps/admin/src/http/shop-domains-routes.test.ts
git commit -m "feat(admin): expose shop domain routes and public host resolution"
```

---

### Task 8: Runtime configuration

**Files:**

- Modify: `apps/runtime/src/config.ts` (beside `TENANT_DEFAULT_ID`, around line 109)
- Modify: `apps/runtime/src/api.ts` (the `createAdminHttpApi({...})` call, around line 496)
- Test: `apps/runtime/src/config.shop-domains.test.ts` (new)

**Interfaces:**

- Produces three optional config keys:
  - `PLATFORM_STORE_DOMAIN?: string`
  - `STOREFRONT_CNAME_TARGET?: string`
  - `STOREFRONT_IPV4: string[]` (default `[]`)
- `api.ts` passes `platformStoreDomain`, and `dnsVerifier` (a `NodeDnsVerifier` only when `STOREFRONT_CNAME_TARGET` is set).

- [ ] **Step 1: Write the failing test**

First find the exported parser in `config.ts`: `grep -n "^export function\|^export const" apps/runtime/src/config.ts`. Use the function that turns an env record into `RuntimeConfig`; existing config tests show which. It is `loadRuntimeConfig(env)` (config.ts:449).

```ts
// apps/runtime/src/config.shop-domains.test.ts
import { describe, expect, it } from "vitest";
import { loadRuntimeConfig } from "./config";

const base = { APP_ENV: "local" } as const;

describe("Plan 1A config", () => {
  it("is all optional and off by default", () => {
    const config = loadRuntimeConfig({ ...base });
    expect(config.PLATFORM_STORE_DOMAIN).toBeUndefined();
    expect(config.STOREFRONT_CNAME_TARGET).toBeUndefined();
    expect(config.STOREFRONT_IPV4).toEqual([]);
  });

  it("parses a comma-separated IPv4 list", () => {
    const config = loadRuntimeConfig({
      ...base,
      PLATFORM_STORE_DOMAIN: "morbeh.store",
      STOREFRONT_CNAME_TARGET: "shops.morbeh.store",
      STOREFRONT_IPV4: " 203.0.113.10, 203.0.113.11 ",
    });
    expect(config.PLATFORM_STORE_DOMAIN).toBe("morbeh.store");
    expect(config.STOREFRONT_IPV4).toEqual(["203.0.113.10", "203.0.113.11"]);
  });

  it("rejects a non-IPv4 entry", () => {
    expect(() => loadRuntimeConfig({ ...base, STOREFRONT_IPV4: "not-an-ip" })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter @platform/runtime run test -- config.shop-domains`
Expected: FAIL. The keys are undefined, or the IPv4 list is not parsed.

- [ ] **Step 3: Write the implementation**

In `config.ts`, beside `TENANT_DEFAULT_ID`:

```ts
    /** Plan 1A: the zone shops get subdomains under (`<slug>.<this>`). Unset ⇒ no automatic subdomain. */
    PLATFORM_STORE_DOMAIN: z.string().min(3).optional(),
    /** Plan 1A: the name merchants CNAME custom domains to. Unset ⇒ custom domains cannot be verified. */
    STOREFRONT_CNAME_TARGET: z.string().min(3).optional(),
    /** Plan 1A: the storefront's public IPv4s, for apex custom domains (comma-separated). */
    STOREFRONT_IPV4: z
      .string()
      .optional()
      .transform((v) => (v ?? "").split(",").map((s) => s.trim()).filter((s) => s !== ""))
      .pipe(z.array(z.string().ip({ version: "v4" }))),
```

In `api.ts`, add `import { NodeDnsVerifier } from "@platform/tenancy";`, and inside the `createAdminHttpApi({...})` object, after `tenantId: runtime.config.TENANT_DEFAULT_ID,`:

```ts
    ...(runtime.config.PLATFORM_STORE_DOMAIN === undefined
      ? {}
      : { platformStoreDomain: runtime.config.PLATFORM_STORE_DOMAIN }),
    ...(runtime.config.STOREFRONT_CNAME_TARGET === undefined
      ? {}
      : {
          dnsVerifier: new NodeDnsVerifier({
            cnameTarget: runtime.config.STOREFRONT_CNAME_TARGET,
            ipv4Targets: runtime.config.STOREFRONT_IPV4,
          }),
        }),
```

If `@platform/tenancy` is not yet a dependency of `@platform/runtime`, add `"@platform/tenancy": "workspace:*"` to `apps/runtime/package.json` and run `pnpm.cmd install --offline`. If that is refused, run `pnpm.cmd install`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm.cmd --filter @platform/runtime run test -- config`
Expected: PASS, including the existing config tests.

Run: `pnpm.cmd --filter @platform/runtime run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/runtime/src/config.ts apps/runtime/src/api.ts apps/runtime/src/config.shop-domains.test.ts apps/runtime/package.json pnpm-lock.yaml
git commit -m "feat(runtime): configure platform store domain and dns verification"
```

---

### Task 9: Storefront resolves the shop from the `Host` header

**Files:**

- Create: `apps/storefront/src/lib/shop-host.ts`
- Test: `apps/storefront/src/lib/shop-host.test.ts`
- Create: `apps/storefront/src/middleware.ts`
- Create: `apps/storefront/src/app/api/tls-allowed/route.ts`
- Modify: `apps/storefront/src/lib/runtime-api.ts` (every `"x-tenant-id": TENANT_ID` use: lines ~109, ~148, ~177, ~202)

**Interfaces:**

- Consumes: `GET {RUNTIME_API_URL}/api/v1/public/domains/resolve?host=` (Task 7), sent with header `x-tenant-id: PLATFORM_TENANT_ID` (defaults to `TENANT_DEFAULT_ID`).
- Produces: `SHOP_ID_HEADER = "x-shop-id"`; `normalizeHost`; `createShopResolver`; `fetchShopFromRuntime`; `currentTenantId()` inside `runtime-api.ts`.

**Behaviour:**

- **When `STOREFRONT_HOST_ROUTING` is not `on`:** middleware does nothing, and `runtime-api.ts` uses `TENANT_DEFAULT_ID`. This is today's behaviour.
- **When it is `on`:**
  - middleware resolves the host;
  - unknown host → `404`;
  - suspended or cancelled shop → `503`;
  - otherwise it forwards the request with `x-shop-id` **overwritten** (a client-sent `x-shop-id` is never trusted).

- [ ] **Step 1: Write the failing test**

```ts
// apps/storefront/src/lib/shop-host.test.ts
import { describe, expect, it } from "vitest";
import { createShopResolver, normalizeHost, type ResolvedShop } from "./shop-host";

const shop: ResolvedShop = {
  shopId: "shop-1",
  hostname: "acme.com",
  primaryHostname: "acme.com",
  shopStatus: "active",
};

describe("normalizeHost", () => {
  it("lowercases, strips the port and a trailing dot", () => {
    expect(normalizeHost("ACME.com:3000")).toBe("acme.com");
    expect(normalizeHost("acme.com.")).toBe("acme.com");
  });

  it("returns null for a missing or empty host", () => {
    expect(normalizeHost(null)).toBeNull();
    expect(normalizeHost("   ")).toBeNull();
  });
});

describe("createShopResolver", () => {
  it("caches hits and misses for ttlMs, then refetches", async () => {
    let calls = 0;
    let now = 0;
    const resolve = createShopResolver({
      fetchShop: async (host) => {
        calls += 1;
        return host === "acme.com" ? shop : null;
      },
      now: () => now,
      ttlMs: 1000,
    });
    expect(await resolve("acme.com")).toEqual(shop);
    expect(await resolve("acme.com")).toEqual(shop);
    expect(await resolve("nobody.com")).toBeNull();
    expect(await resolve("nobody.com")).toBeNull();
    expect(calls).toBe(2);
    now = 1001;
    await resolve("acme.com");
    expect(calls).toBe(3);
  });

  it("does not cache a failed lookup (an outage must not pin a 404)", async () => {
    let calls = 0;
    const resolve = createShopResolver({
      fetchShop: async () => {
        calls += 1;
        throw new Error("runtime down");
      },
      now: () => 0,
      ttlMs: 1000,
    });
    await expect(resolve("acme.com")).rejects.toThrow("runtime down");
    await expect(resolve("acme.com")).rejects.toThrow("runtime down");
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm.cmd --filter storefront run test -- shop-host`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/storefront/src/lib/shop-host.ts
/** Plan 1A: Host → shop resolution for the storefront edge. Pure, so it is testable without Next. */

export const SHOP_ID_HEADER = "x-shop-id";

export interface ResolvedShop {
  readonly shopId: string;
  readonly hostname: string;
  readonly primaryHostname: string;
  readonly shopStatus: "active" | "suspended" | "cancelled";
}

export function normalizeHost(rawHost: string | null): string | null {
  if (rawHost === null) return null;
  const host = rawHost.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return host === "" ? null : host;
}

export interface ShopResolverDeps {
  readonly fetchShop: (hostname: string) => Promise<ResolvedShop | null>;
  readonly now: () => number;
  readonly ttlMs: number;
  readonly maxEntries?: number;
}

/** Caches answers (including "no such shop") for `ttlMs`; never caches a failure. */
export function createShopResolver(
  deps: ShopResolverDeps,
): (hostname: string) => Promise<ResolvedShop | null> {
  const cache = new Map<string, { value: ResolvedShop | null; expiresAt: number }>();
  const maxEntries = deps.maxEntries ?? 5000;
  return async (hostname) => {
    const hit = cache.get(hostname);
    if (hit !== undefined && hit.expiresAt > deps.now()) return hit.value;
    const value = await deps.fetchShop(hostname);
    cache.set(hostname, { value, expiresAt: deps.now() + deps.ttlMs });
    if (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return value;
  };
}

export function fetchShopFromRuntime(
  runtimeApiUrl: string,
  platformTenantId: string,
): (hostname: string) => Promise<ResolvedShop | null> {
  return async (hostname) => {
    const response = await fetch(
      `${runtimeApiUrl}/api/v1/public/domains/resolve?host=${encodeURIComponent(hostname)}`,
      { headers: { "x-tenant-id": platformTenantId }, cache: "no-store" },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`shop resolve failed with ${response.status}`);
    return (await response.json()) as ResolvedShop;
  };
}
```

```ts
// apps/storefront/src/middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import {
  SHOP_ID_HEADER,
  createShopResolver,
  fetchShopFromRuntime,
  normalizeHost,
} from "./lib/shop-host";

const RUNTIME_API_URL = process.env.RUNTIME_API_URL ?? "http://localhost:3080";
const PLATFORM_TENANT_ID =
  process.env.PLATFORM_TENANT_ID ?? process.env.TENANT_DEFAULT_ID ?? "tenant-local";

const resolveShop = createShopResolver({
  fetchShop: fetchShopFromRuntime(RUNTIME_API_URL, PLATFORM_TENANT_ID),
  now: () => Date.now(),
  ttlMs: 60_000,
});

const page = (status: number, text: string) =>
  new NextResponse(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const headers = new Headers(request.headers);
  headers.delete(SHOP_ID_HEADER); // never trust a client-sent shop id
  if (process.env.STOREFRONT_HOST_ROUTING !== "on") {
    return NextResponse.next({ request: { headers } });
  }
  const host = normalizeHost(request.headers.get("host"));
  if (host === null) return page(400, "Bad request");
  let shop;
  try {
    shop = await resolveShop(host);
  } catch {
    return page(503, "Temporarily unavailable / غير متاح مؤقتاً");
  }
  if (shop === null) return page(404, "Store not found / المتجر غير موجود");
  if (shop.shopStatus !== "active")
    return page(503, "This store is unavailable / هذا المتجر غير متاح");
  headers.set(SHOP_ID_HEADER, shop.shopId);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Static assets and Caddy's TLS "ask" endpoint never need a shop.
  matcher: ["/((?!_next/|favicon\\.ico|api/tls-allowed).*)"],
};
```

```ts
// apps/storefront/src/app/api/tls-allowed/route.ts
import { fetchShopFromRuntime, normalizeHost } from "@/lib/shop-host";

const RUNTIME_API_URL = process.env.RUNTIME_API_URL ?? "http://localhost:3080";
const PLATFORM_TENANT_ID =
  process.env.PLATFORM_TENANT_ID ?? process.env.TENANT_DEFAULT_ID ?? "tenant-local";

/**
 * Plan 1A: Caddy's on-demand TLS "ask" endpoint (`GET /api/tls-allowed?domain=x`). 200 ⇒ Caddy may
 * obtain a certificate for `x`; anything else ⇒ it must not. Only verified domains of non-cancelled
 * shops qualify, so nobody can make the platform request certificates for arbitrary names.
 */
export async function GET(request: Request): Promise<Response> {
  const host = normalizeHost(new URL(request.url).searchParams.get("domain"));
  if (host === null) return new Response(null, { status: 400 });
  try {
    const shop = await fetchShopFromRuntime(RUNTIME_API_URL, PLATFORM_TENANT_ID)(host);
    return new Response(null, {
      status: shop !== null && shop.shopStatus !== "cancelled" ? 200 : 404,
    });
  } catch {
    return new Response(null, { status: 503 });
  }
}
```

In `apps/storefront/src/lib/runtime-api.ts`:

1. Add `import { headers } from "next/headers";` and `import { SHOP_ID_HEADER } from "./shop-host";`.
2. Under the `TENANT_ID` constant, add:

```ts
/**
 * Plan 1A: the shop this request is for. With host routing off (default) it is the one deployment
 * tenant, as before. With it on, the middleware put the resolved shop id on the request; its absence
 * is a wiring bug, so this throws rather than silently serving the default shop.
 */
async function currentTenantId(): Promise<string> {
  if (process.env.STOREFRONT_HOST_ROUTING !== "on") return TENANT_ID;
  const shopId = (await headers()).get(SHOP_ID_HEADER);
  if (shopId === null || shopId === "") {
    throw new Error("storefront: no shop resolved for this request (middleware did not run)");
  }
  return shopId;
}
```

3. Replace every `"x-tenant-id": TENANT_ID` with `"x-tenant-id": await currentTenantId()`. Find them all with `grep -n "TENANT_ID" apps/storefront/src/lib/runtime-api.ts`. Every enclosing function is already `async`. If one is not, make it `async`; its callers already `await` it.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm.cmd --filter storefront run test`
Expected: PASS. The existing cart, catalog and i18n tests are untouched because routing defaults off.

Run: `pnpm.cmd --filter storefront run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/lib/shop-host.ts apps/storefront/src/lib/shop-host.test.ts apps/storefront/src/middleware.ts apps/storefront/src/app/api/tls-allowed/route.ts apps/storefront/src/lib/runtime-api.ts
git commit -m "feat(storefront): resolve the shop from the host header behind a flag"
```

---

### Task 10: Caddyfile, env documentation, gap register

**Files:**

- Create: `infrastructure/caddy/Caddyfile`
- Modify: `infrastructure/railway/README.md` (env var table)
- Modify: `docs/KNOWN_GAPS.md` and `docs/architecture/23-platform-gap-register.md` (new entry)

- [ ] **Step 1: Write the Caddyfile**

Not deployed now; it is used at the Hetzner move.

```caddyfile
# Plan 1A — single-server edge (Hetzner move). Every shop hostname gets a certificate on demand,
# but only after the storefront's /api/tls-allowed says the hostname is a verified shop domain.
# Let's Encrypt allows ~50 new certificates per registered domain per week: past that many new
# `*.{$PLATFORM_STORE_DOMAIN}` shops a week, switch the platform zone to one wildcard certificate
# (DNS challenge plugin) and keep on-demand for custom domains only.
{
	email {$ACME_EMAIL}
	on_demand_tls {
		ask http://storefront:3000/api/tls-allowed
	}
}

{$ADMIN_HOST} {
	reverse_proxy admin-web:3100
}

{$API_HOST} {
	reverse_proxy runtime:8080
}

https:// {
	tls {
		on_demand
	}
	reverse_proxy storefront:3000
}
```

- [ ] **Step 2: Document the variables**

In `infrastructure/railway/README.md`, add rows to the environment table:

| Service    | Variable                  | Value                             | Meaning                                                              |
| ---------- | ------------------------- | --------------------------------- | -------------------------------------------------------------------- |
| runtime    | `PLATFORM_STORE_DOMAIN`   | unset (e.g. `morbeh.store` later) | new shops get `<slug>.<this>`                                        |
| runtime    | `STOREFRONT_CNAME_TARGET` | unset                             | name merchants CNAME to; unset ⇒ custom domains cannot be verified   |
| runtime    | `STOREFRONT_IPV4`         | unset                             | storefront IPv4s for apex domains, comma-separated                   |
| storefront | `STOREFRONT_HOST_ROUTING` | **unset (off)**                   | `on` ⇒ shop resolved from `Host`; off ⇒ `TENANT_DEFAULT_ID` as today |
| storefront | `PLATFORM_TENANT_ID`      | unset                             | tenant header for the resolve call; defaults to `TENANT_DEFAULT_ID`  |

Add one sentence: "Turning `STOREFRONT_HOST_ROUTING` on for more than one shop also needs `TENANT_MODE=multi` on the API, which is an owner decision recorded in BLOCKERS.md, never set by an agent."

- [ ] **Step 3: Record the gap**

1. Find the highest `G-` number in `docs/KNOWN_GAPS.md` with `grep -o "G-[0-9]*" docs/KNOWN_GAPS.md | sort -t- -k2 -n | tail -1`.
2. Add the next number to both files, worded:

> **Shop domains (Plan 1A, 2026-10-05) — code complete, not live.**
>
> - `tenancy.shop_domains` and the host-routing middleware exist.
> - The migration `20261005000000_tenancy_shop_domains` is NOT yet deployed. The owner deploys it.
> - Host routing is off.
> - Live use needs: the migration; a purchased platform domain; `PLATFORM_STORE_DOMAIN`; and, for more than one shop, the owner's `TENANT_MODE=multi` decision.
> - Merchant-facing domain screens in admin-web are not built. They come in the next plan.

- [ ] **Step 4: Run the full gates, sequentially, never in parallel**

Run each, in order:

- `pnpm.cmd --filter @platform/tenancy run test`
- `pnpm.cmd --filter @platform/admin run test`
- `pnpm.cmd --filter @platform/runtime run test`
- `pnpm.cmd --filter storefront run test`
- `pnpm.cmd --filter @platform/db run test`

Then:

- `pnpm.cmd -r --no-bail run typecheck`
- `pnpm.cmd -r --no-bail run lint`
- `pnpm.cmd arch` (if the root script exists; check `package.json`).

Expected: every one exits 0, with no new lint warnings.

- [ ] **Step 5: Commit and push**

```bash
git add infrastructure/caddy/Caddyfile infrastructure/railway/README.md docs/KNOWN_GAPS.md docs/architecture/23-platform-gap-register.md
git commit -m "docs(tenancy): document shop domains, caddy edge and the open gap"
git push origin morbeh/w0-w17-w12
```

---

## Done criteria

- A shop created through `POST /tenants` with `PLATFORM_STORE_DOMAIN` set resolves on `<slug>.<zone>` through `GET /api/v1/public/domains/resolve` (route test).
- A custom domain:
  - cannot serve until verified;
  - cannot be verified unless DNS points at the platform;
  - can become primary only when verified;
  - and a shop has exactly one primary (unit test plus a database partial unique index).
- A hostname under the platform zone cannot be claimed as a custom domain.
- With `STOREFRONT_HOST_ROUTING` unset, the storefront behaves exactly as before.
- With it `on`:
  - unknown hosts get 404 and suspended shops get 503;
  - a client-sent `x-shop-id` is ignored;
  - a runtime outage gives 503 and is not cached.
- Caddy's ask endpoint approves only verified domains of non-cancelled shops.
- No env file, example, manifest or CI config sets `TENANT_MODE=multi`.
- No agent connected to a database; the migration is written and waiting for the owner.

## Stop conditions (stop and report to the owner instead of improvising)

- Any existing test outside the files above starts failing.
- `prisma generate` needs a database connection.
- `defineRoute` refuses a `public: true` route outside the `/public/` prefix, or the pipeline rejects the resolve call in single mode.
- Typecheck shows `BusinessRuleError` from `@platform/domain` is not a `DomainError`, and the `@platform/utils` alternative does not exist either.

## Owner steps after merge (not for agents)

1. Railway Console → runtime service: `cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy`.
2. Nothing else changes until a platform domain is bought. Then set `PLATFORM_STORE_DOMAIN`, and turn on `STOREFRONT_HOST_ROUTING` at the Hetzner move.
