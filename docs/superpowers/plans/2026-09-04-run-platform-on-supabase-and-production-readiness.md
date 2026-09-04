# Run the Lumo Platform on Supabase + Production Readiness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the platform from "boots but every API call returns 401" to a fully running, demonstrable, production-deployable commerce platform backed by Supabase Postgres, Upstash Redis, and Ory Network.

**Architecture:** The platform is a pnpm/Turborepo monorepo with 39 DDD bounded contexts (`services/*`) whose use-cases are composed into a single Fastify runtime (`apps/runtime`) exposing 424 `/api/v1/*` routes, consumed by two Next.js apps (`apps/admin-web`, `apps/storefront`). Persistence is Prisma → Supabase Postgres (38 schemas, 132 models, 130 tenant-scoped). Authentication is JWT-via-JWKS; authorization is relation-tuple based. This plan moves every remaining local/Docker dependency to a managed cloud service, then closes the wiring gaps that keep production-grade subsystems dormant.

**Tech Stack:** pnpm 11.9 · Turborepo · Next.js 15 · React 19 · TypeScript 5.6 · Fastify · Prisma 6.19 · Supabase Postgres · Upstash Redis · Ory Network (Hydra/Kratos/Keto) · Stripe · Vitest 2.1 · Playwright · Vercel

**Spec:** This plan is self-contained. Its findings baseline is the live investigation recorded in "Verified Baseline" below, which supersedes `PHASE_A43_VERCEL_SUPABASE_PRISMA_PRODUCTION_PREPARATION_REPORT.md` (that report predates the migrations actually being applied).

---

## Execution Status (updated 2026-09-04)

Branch: `feat/cloud-platform-runtime`.

| Task | Status | Evidence |
|---|---|---|
| 0 — Prerequisites | **partly done** | Developer Mode ON; Upstash provisioned. Ory Network project **not yet created** — Tasks 4/5/6 are blocked on it. |
| 1 — Upstash Redis | **done** | `/readyz` → 200 `{postgres: healthy, redis: healthy}` (was 503). PING/SET/GET verified over TLS. |
| 2 — Runtime Ory API key | **done** | `createOryFetch` + `ORY_API_KEY`; 6 new tests; runtime suite 223/223. |
| 3 — admin-web Ory API key | **done** | `oryAdminHeaders` at all 4 Hydra Admin call sites; 5 new tests; admin-web suite 598/598. |
| 7 — Windows build | **done** | Both apps build: storefront 13 routes, admin-web 82 routes. See correction below. |
| 4, 5, 6 | **blocked** | Need the Ory Network project + API key. |
| 8–18 | not started | |

**Correction to Task 7's premise.** Developer Mode did fix the `EPERM: symlink` failure, so the
conditional-`standalone` change the task describes was **not needed and was not made** — the
Dockerfiles and `next.config.ts` are untouched. But admin-web then failed for a *second,
unrelated and pre-existing* reason the plan did not anticipate: `next build` aborted with "You're
importing a component that needs next/headers". Three Client Components imported constants **as
values** from `@/lib/api/{finance,security}`, which import `./client` → `@/lib/auth/session` →
`next/headers`. Confirmed pre-existing by rebuilding with the Task 2/3 commits reverted — it
failed identically. Fixed by moving those constants into import-free sibling modules
(`finance-read-models.ts`, `security-transitions.ts`) and re-exporting them.

The reason this was a 3-file fix and not a 63-file one: every *other* Client Component importing
from `@/lib/api/*` uses `import type`, which TypeScript erases before webpack sees it. Only value
imports pull the module in. Any future work here should apply that same test before assuming scope.

This also means `PHASE_A43`'s claim that `pnpm --filter admin-web build` passed with 20 routes no
longer held at this commit — the real build emits 82 routes and was failing until this fix.

---

## Verified Baseline (measured 2026-09-04, not assumed)

Do **not** re-litigate these. They were verified by direct execution against the live system.

| Fact | Evidence |
|---|---|
| Supabase DB is live and fully migrated | `prisma migrate status` → "Database schema is up to date!", 37 migrations, 38 schemas at `aws-1-eu-west-3.pooler.supabase.com:5432` |
| Seed data already present | 168 tables; 13 non-empty: `catalog.products`=3, `catalog.brands`=1, `catalog.categories`=1, `catalog.collections`=1, `catalog.collection_items`=3, `catalog.product_variants`=3, `pricing.price_lists`=1, `pricing.prices`=3, `inventory.warehouses`=1, `inventory.inventory_items`=3, `identity.customers`=1, `platform.outbox`=24 |
| Runtime API boots against Supabase | `node node_modules/tsx/dist/cli.mjs src/api.ts` in `apps/runtime` → `{"msg":"api listening","port":3080,"env":"local"}` |
| 424 routes are served | `GET /openapi.json` → 424 paths under `/api/v1/*` |
| `/healthz` and `/metrics` return 200 | direct probe |
| `/readyz` returns **503** | direct probe — Redis health check fails, no Redis reachable |
| Every `/api/v1/*` returns **401** | direct probe, with and without a bearer token — no IdP reachable at `AUTH_JWKS_URL` |
| Typecheck is clean | `tsc --noEmit` in 10 workspaces (catalog, orders, checkout, payments, identity, tenancy, domain, db, runtime, admin-web, storefront) → 0 errors each |
| Tests pass | `services/catalog` → 57/57 passing |
| Zero technical debt markers | 0 occurrences of TODO/FIXME/HACK across 2,725 source files |
| No Docker on this machine | `docker` command not found |
| No Redis on this machine | port 6379 closed |
| Windows Developer Mode is OFF | `AllowDevelopmentWithoutDevLicense` registry value absent → `next build` fails with `EPERM: symlink` during standalone tracing |

## Known Gaps This Plan Closes

1. **Redis absent** → `/readyz` 503; rate limiting, idempotency, and distributed locks are all non-functional.
2. **No identity provider** → all 424 routes return 401.
3. **Ory clients send no API key.** `KetoAccessControl` (`packages/auth/src/keto.ts:31`) calls the read API with no `Authorization` header. Ory Network requires one. Same for the three Hydra Admin API call sites in admin-web.
4. **Only 14 of 66 permissions are granted** by `scripts/dev/seed-auth-local.mjs`. The admin API declares 66 distinct permission strings.
5. **Windows Developer Mode off** → production builds fail locally.
6. **Zero-trust security guard is dead code.** `buildSecurityHttpGuard` (`apps/runtime/src/security/wire-security-runtime.ts:90`) is never called. `apps/runtime/src/config.ts:248-262` hard-refuses `SECURITY_ZERO_TRUST_ENFORCEMENT=on` to prevent a silent no-op. ~4,300 lines of security application code are unreachable.
7. **Outbox relay disabled** → 24 domain events are sitting unpublished in `platform.outbox`.
8. **`DIRECT_URL` points at the pooler**, not a direct connection — unsafe for DDL/advisory locks during migrations.
9. **Object storage is in-memory** → uploaded media does not persist.
10. **Payments use the in-memory stub** → `verifyWebhook()` always returns true.
11. **Seed is too thin to demo** — no orders, discounts, content, or reviews.
12. **e2e coverage is 3 specs / 5 tests** for a 424-route platform.

## Global Constraints

- **Node 22 LTS is the declared target** (`.nvmrc`); the machine currently runs v24.19.0. Do not "fix" this — it works. Only flag it if a runtime error traces to it.
- **`turbo` is broken in this environment.** `node_modules/.bin/turbo` exits with `0xC0000135` (STATUS_DLL_NOT_FOUND). Do **not** use `pnpm build` / `pnpm typecheck` / `pnpm test` at the repo root. Invoke tools per-workspace instead:
  - typecheck: `node <REPO_ROOT>/node_modules/typescript/bin/tsc --noEmit` from the workspace dir
  - test: `node node_modules/vitest/vitest.mjs run` from the workspace dir
  - prisma: `node node_modules/prisma/build/index.js <cmd>` from `packages/db`
  - runtime: `node node_modules/tsx/dist/cli.mjs src/api.ts` from `apps/runtime`
  - next: `node node_modules/next/dist/bin/next <cmd>` from the app dir
- **Shell is PowerShell 5.1.** No `&&`, no `||`, no ternary, no `??`. Chain with `;` or `A; if ($?) { B }`.
- **`.env` holds live credentials. Never commit it, never print its values.** `.gitignore` already covers it — verify before every commit.
- **`APP_ENV=local` is what keeps the fail-closed guards permissive.** Changing it to anything else activates hard requirements in `apps/runtime/src/config.ts` (Ory URLs) and `apps/runtime/src/api.ts` (payment provider, MFA, object storage). Only change it in the task that says to.
- **Every model except `ProcessedEvent` and `DeadLetter` is tenant-scoped.** Any new query or seed row must carry `tenantId`. The local tenant is the value of `TENANT_DEFAULT_ID` in `.env`.
- **Commit after every task.** Repo is on `main` with 3 commits. Create a branch first (Task 1, Step 1).
- **Never weaken a fail-closed guard to make something pass.** If a guard blocks you, the correct fix is to configure the thing it is guarding, or to mount the code it says is unmounted.

---

## File Structure

**Created:**
- `scripts/ops/seed-ory-network.mjs` — idempotent Ory Network seeding: OAuth2 client, admin identity, all 66 Keto permission grants. Replaces the local-only `scripts/dev/seed-auth-local.mjs` for cloud use.
- `apps/runtime/src/ory-fetch.ts` — a single `createOryFetch(apiKey)` helper returning an `HttpFetch` that attaches the Ory API key. One place, so the Keto seam and any future Ory seam cannot drift.
- `apps/admin-web/src/lib/auth/ory-admin.ts` — `oryAdminHeaders()` for the three Hydra Admin API call sites.
- `apps/runtime/src/seed-demo.ts` — rich demo data (orders, discounts, reviews, content) layered on top of the existing `seed.ts` baseline.
- `apps/e2e/tests/admin-catalog.spec.ts`, `apps/e2e/tests/storefront-browse.spec.ts` — expanded e2e coverage.
- `docs/operations/CLOUD_RUNBOOK.md` — the operator runbook for the Supabase/Upstash/Ory topology.

**Modified:**
- `apps/runtime/src/config.ts` — add `ORY_API_KEY`; remove the H-01 refusal clause in Task 14.
- `apps/runtime/src/composition.ts:180-193` — Keto fetch seam uses `createOryFetch`.
- `apps/runtime/src/api.ts` — mount the security guard (Task 14).
- `apps/admin-web/src/lib/auth/config.ts` — add `oryApiKey`.
- `apps/admin-web/src/app/login/page.tsx`, `apps/admin-web/src/app/consent/page.tsx` — send Ory admin headers.
- `apps/admin-web/next.config.ts` — conditional `output: "standalone"` (Task 7).
- `.env`, `.env.example` — the cloud env contract.

---

## PHASE 0 — Operator Prerequisites

### Task 0: Provision cloud services and unblock the Windows build

> **⚠️ OPERATOR ACTION REQUIRED — an agent cannot create these accounts.** Stop and hand this task to the human. Every later task depends on the values produced here.

**Files:**
- Modify: `.env` (values only — never commit)

- [ ] **Step 1: Enable Windows Developer Mode**

Symlink creation currently fails, which breaks `next build`. In an **Administrator** PowerShell:

```bash
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" /t REG_DWORD /f /v "AllowDevelopmentWithoutDevLicense" /d "1"
```

Verify (should print `1`):

```bash
powershell -c "(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock').AllowDevelopmentWithoutDevLicense"
```

- [ ] **Step 2: Create an Upstash Redis database**

1. Go to https://console.upstash.com → **Create Database**
2. Type: **Regional**. Region: **eu-west-1** (closest to the Supabase project in `eu-west-3`; minimises round-trip latency on the rate-limiter hot path).
3. Enable **TLS**.
4. From the database page, copy the **`rediss://`** connection string (not the REST URL — `ioredis` needs the TCP protocol URL).

- [ ] **Step 3: Create an Ory Network project**

1. Go to https://console.ory.sh → **Create Project**. Note the project slug.
2. The project base URL is `https://<slug>.projects.oryapis.com`. Call it `ORY_SDK_URL`.
3. Create an **API key**: Project Settings → API Keys → Create. It starts with `ory_pat_`. Copy it — it is shown once.

- [ ] **Step 4: Record the values in `.env`**

Append to `D:\lumo-platform-main-main\lumo-platform-main-main\.env`, substituting real values:

```
# ── Upstash Redis ──
REDIS_URL=rediss://default:<UPSTASH_PASSWORD>@<UPSTASH_HOST>:6379

# ── Ory Network ──
ORY_SDK_URL=https://<slug>.projects.oryapis.com
ORY_API_KEY=ory_pat_<...>
AUTH_ISSUER_URL=https://<slug>.projects.oryapis.com
AUTH_JWKS_URL=https://<slug>.projects.oryapis.com/.well-known/jwks.json
HYDRA_PUBLIC_URL=https://<slug>.projects.oryapis.com
HYDRA_ADMIN_URL=https://<slug>.projects.oryapis.com
KRATOS_PUBLIC_URL=https://<slug>.projects.oryapis.com
KRATOS_ADMIN_URL=https://<slug>.projects.oryapis.com
KETO_READ_URL=https://<slug>.projects.oryapis.com
KETO_WRITE_URL=https://<slug>.projects.oryapis.com
AUTH_AUDIENCE=lumo-admin
AUTH_CLIENT_ID=lumo-admin-web
AUTH_CLIENT_SECRET=<generate a strong random string; you will register it in Task 5>
```

- [ ] **Step 5: Confirm `.env` is still ignored by git**

Run: `git check-ignore -v .env`
Expected: a line naming `.gitignore`. If it prints nothing, **stop** — do not proceed until `.env` is ignored.

---

## PHASE 1 — Make It Run Green

### Task 1: Wire Upstash Redis and turn `/readyz` green

**Files:**
- Modify: `.env` (done in Task 0)
- Modify: `.env.example` (document the cloud shape)

**Interfaces:**
- Consumes: `REDIS_URL` from Task 0.
- Produces: a runtime whose `/readyz` returns 200 — the precondition every later probe in this plan relies on.

- [ ] **Step 1: Create the working branch**

```bash
git checkout -b feat/cloud-platform-runtime
```

- [ ] **Step 2: Verify Redis connectivity in isolation before touching the runtime**

Create `packages/redis/redis-probe.mjs`:

```js
import Redis from "ioredis";
const url = process.env.REDIS_URL;
if (!url) throw new Error("REDIS_URL not set");
const r = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
await r.connect();
await r.set("lumo:probe", "ok", "EX", 30);
console.log("GET lumo:probe ->", await r.get("lumo:probe"));
console.log("PING ->", await r.ping());
await r.quit();
```

Run from `packages/redis`:

```bash
node redis-probe.mjs
```

Expected: `GET lumo:probe -> ok` then `PING -> PONG`.
If it hangs or throws `ENOTFOUND`/`WRONGPASS`, the `REDIS_URL` is wrong — fix it before continuing. Delete `redis-probe.mjs` when it passes.

- [ ] **Step 3: Boot the runtime and confirm `/readyz` is now 200**

From `apps/runtime`, with `.env` loaded into the process environment:

```bash
node node_modules/tsx/dist/cli.mjs src/api.ts
```

In a second shell:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3080/readyz
```

Expected: `200`. Before this task it was `503`.
If still 503, fetch the body — `curl -s http://localhost:3080/readyz` — and read which health check is failing.

- [ ] **Step 4: Update `.env.example` to document the cloud shape**

In `.env.example`, next to the existing `REDIS_URL` entry, add:

```
# Local Docker:   redis://localhost:6379
# Upstash (cloud): rediss://default:<password>@<host>:6379   ← TLS URL, not the REST URL
```

- [ ] **Step 5: Commit**

```bash
git add .env.example
git commit -m "docs(env): document Upstash TLS connection shape for REDIS_URL

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Add Ory API-key support to the runtime's Keto seam

`KetoAccessControl` sends no `Authorization` header. Ory Network rejects unauthenticated permission checks, and `KetoAccessControl` **fails closed** on any non-200 — so without this, every authorization check silently denies. The `fetch` is already injected at `composition.ts:185`, so this is fixed at the seam without touching `packages/auth`.

**Files:**
- Create: `apps/runtime/src/ory-fetch.ts`
- Create: `apps/runtime/src/ory-fetch.test.ts`
- Modify: `apps/runtime/src/config.ts` (add `ORY_API_KEY` to the zod schema)
- Modify: `apps/runtime/src/composition.ts:180-193`

**Interfaces:**
- Produces: `createOryFetch(apiKey: string | undefined): HttpFetch` — returns a fetch that adds `authorization: Bearer <apiKey>` when `apiKey` is defined, and is a plain passthrough when it is not (so local/self-hosted Keto keeps working unchanged).
- Consumes: `RuntimeConfig["ORY_API_KEY"]` added in this task.

- [ ] **Step 1: Write the failing test**

Create `apps/runtime/src/ory-fetch.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createOryFetch } from "./ory-fetch";

describe("createOryFetch", () => {
  it("attaches the bearer token when an api key is configured", async () => {
    const inner = vi.fn(async () => new Response("{}", { status: 200 }));
    const f = createOryFetch("ory_pat_abc", inner);
    await f("https://example.test/relation-tuples/check");
    const init = inner.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer ory_pat_abc");
  });

  it("preserves caller-supplied headers alongside the token", async () => {
    const inner = vi.fn(async () => new Response("{}", { status: 200 }));
    const f = createOryFetch("ory_pat_abc", inner);
    await f("https://example.test/x", { headers: { "content-type": "application/json" } });
    const headers = (inner.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["authorization"]).toBe("Bearer ory_pat_abc");
  });

  it("sends no authorization header when no api key is configured", async () => {
    const inner = vi.fn(async () => new Response("{}", { status: 200 }));
    const f = createOryFetch(undefined, inner);
    await f("https://example.test/x");
    const init = inner.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["authorization"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

From `apps/runtime`:

```bash
node node_modules/vitest/vitest.mjs run src/ory-fetch.test.ts
```

Expected: FAIL — `Cannot find module './ory-fetch'`.

- [ ] **Step 3: Write the implementation**

Create `apps/runtime/src/ory-fetch.ts`:

```ts
import type { HttpFetch } from "@platform/auth";

/**
 * Ory Network authenticates its permission/identity APIs with a project API key
 * (`ory_pat_...`), which self-hosted Keto in `infrastructure/docker/keto/keto.yml` does not
 * require. `KetoAccessControl` fails closed on any non-200, so an unauthenticated check against
 * Ory Network denies every permission silently rather than erroring loudly — hence the token is
 * attached here, at the one injected `fetch` seam, instead of inside `@platform/auth` (which must
 * stay deployment-agnostic).
 *
 * `apiKey === undefined` returns a plain passthrough, so the self-hosted/local topology is
 * byte-for-byte unchanged.
 */
export function createOryFetch(
  apiKey: string | undefined,
  inner: typeof fetch = fetch,
): HttpFetch {
  if (apiKey === undefined) {
    return async (url, init) => inner(url, init);
  }
  return async (url, init) =>
    inner(url, {
      ...init,
      headers: { ...(init?.headers ?? {}), authorization: `Bearer ${apiKey}` },
    });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node node_modules/vitest/vitest.mjs run src/ory-fetch.test.ts
```

Expected: 3 passed.

If `HttpFetch` is not exported from `@platform/auth`, check its actual export site — it is declared in `packages/auth/src/kratos.ts` and re-exported via `packages/auth/src/index.ts`. If it is not re-exported, import it as `import type { HttpFetch } from "@platform/auth/kratos"` or add the re-export; do not redeclare the type locally.

- [ ] **Step 5: Add `ORY_API_KEY` to the runtime config schema**

In `apps/runtime/src/config.ts`, inside the `z.object({...})`, immediately after the `KRATOS_ADMIN_URL` line, add:

```ts
    /**
     * Ory Network project API key (`ory_pat_...`). Absent ⇒ self-hosted Ory (no key needed, the
     * local docker-compose topology). Present ⇒ every Ory admin/permission call carries it. Same
     * present/absent convention as S3/Stripe above.
     */
    ORY_API_KEY: z.string().optional(),
```

- [ ] **Step 6: Use it at the Keto seam**

In `apps/runtime/src/composition.ts`, add to the imports:

```ts
import { createOryFetch } from "./ory-fetch";
```

Then replace line 185 (`fetch: async (url, init) => fetch(url, init),` inside the `new KetoAccessControl({...})` call) with:

```ts
        fetch: createOryFetch(config.ORY_API_KEY),
```

Leave the second `fetch: async (url, init) => fetch(url, init),` at line 246 alone — that one belongs to `StripePaymentProvider`, not Ory.

- [ ] **Step 7: Typecheck and run the full runtime suite**

From `apps/runtime`:

```bash
node ../../node_modules/typescript/bin/tsc --noEmit
```

Expected: exit 0, no output.

```bash
node node_modules/vitest/vitest.mjs run
```

Expected: all pass. The A.43 report recorded 184 tests here; the count should now be 187.

- [ ] **Step 8: Commit**

```bash
git add apps/runtime/src/ory-fetch.ts apps/runtime/src/ory-fetch.test.ts apps/runtime/src/config.ts apps/runtime/src/composition.ts
git commit -m "feat(runtime): authenticate Keto permission checks with an Ory Network API key

KetoAccessControl fails closed on any non-200, so an unauthenticated check
against Ory Network denied every permission silently. Attaches the token at
the injected fetch seam so @platform/auth stays deployment-agnostic and the
self-hosted topology is unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Add Ory API-key support to admin-web's Hydra Admin calls

`apps/admin-web` acts as Hydra's **login and consent provider**: it calls the Hydra Admin API to fetch and accept login/consent challenges. Against Ory Network those endpoints require the project API key. There are exactly three call sites.

**Files:**
- Create: `apps/admin-web/src/lib/auth/ory-admin.ts`
- Create: `apps/admin-web/src/lib/auth/ory-admin.test.ts`
- Modify: `apps/admin-web/src/lib/auth/config.ts`
- Modify: `apps/admin-web/src/app/login/page.tsx:94`, `:127`
- Modify: `apps/admin-web/src/app/consent/page.tsx:25`, `:37`

**Interfaces:**
- Consumes: `authConfig.oryApiKey`, added to `config.ts` in this task.
- Produces: `oryAdminHeaders(extra?: Record<string, string>): Record<string, string>` — merges the bearer token (when configured) into caller headers.

- [ ] **Step 1: Write the failing test**

Create `apps/admin-web/src/lib/auth/ory-admin.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("oryAdminHeaders", () => {
  it("includes the bearer token when ORY_API_KEY is set", async () => {
    vi.stubEnv("ORY_API_KEY", "ory_pat_xyz");
    vi.stubEnv("AUTH_CLIENT_SECRET", "s");
    const { oryAdminHeaders } = await import("./ory-admin");
    expect(oryAdminHeaders()["authorization"]).toBe("Bearer ory_pat_xyz");
  });

  it("merges caller headers with the token", async () => {
    vi.stubEnv("ORY_API_KEY", "ory_pat_xyz");
    vi.stubEnv("AUTH_CLIENT_SECRET", "s");
    const { oryAdminHeaders } = await import("./ory-admin");
    const h = oryAdminHeaders({ "content-type": "application/json" });
    expect(h["content-type"]).toBe("application/json");
    expect(h["authorization"]).toBe("Bearer ory_pat_xyz");
  });

  it("omits the token when ORY_API_KEY is unset (self-hosted Ory)", async () => {
    vi.stubEnv("AUTH_CLIENT_SECRET", "s");
    const { oryAdminHeaders } = await import("./ory-admin");
    expect(oryAdminHeaders()["authorization"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

From `apps/admin-web`:

```bash
node node_modules/vitest/vitest.mjs run src/lib/auth/ory-admin.test.ts
```

Expected: FAIL — cannot resolve `./ory-admin`.

- [ ] **Step 3: Add `oryApiKey` to the auth config**

In `apps/admin-web/src/lib/auth/config.ts`, inside the `authConfig` object literal, after the `cookieSameSite` line, add:

```ts
  /**
   * Ory Network project API key. The Hydra **Admin** API (login/consent challenge fetch+accept)
   * requires it on Ory Network; self-hosted Hydra in docker-compose does not. Unset ⇒ self-hosted,
   * calls go out unauthenticated exactly as before. Never a fallback value: an unset key must not
   * silently become a placeholder string (same rule as AUTH_CLIENT_SECRET above).
   */
  oryApiKey: process.env["ORY_API_KEY"],
```

- [ ] **Step 4: Write the implementation**

Create `apps/admin-web/src/lib/auth/ory-admin.ts`:

```ts
import { authConfig } from "./config";

/**
 * Headers for a Hydra **Admin** API call. Server-only — the API key must never reach a Client
 * Component. Returns caller headers untouched when no key is configured, so the self-hosted
 * docker-compose topology behaves exactly as it did before Ory Network support was added.
 */
export function oryAdminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  if (authConfig.oryApiKey === undefined || authConfig.oryApiKey.length === 0) return { ...extra };
  return { ...extra, authorization: `Bearer ${authConfig.oryApiKey}` };
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
node node_modules/vitest/vitest.mjs run src/lib/auth/ory-admin.test.ts
```

Expected: 3 passed.

- [ ] **Step 6: Apply the headers at all three Hydra Admin call sites**

In `apps/admin-web/src/app/login/page.tsx`, add the import:

```ts
import { oryAdminHeaders } from "@/lib/auth/ory-admin";
```

At line ~94 the challenge fetch currently has no `headers`. Add one:

```ts
  const loginRequest = await fetchWithTimeout(
    `${authConfig.hydraAdminUrl}/admin/oauth2/auth/requests/login?login_challenge=${encodeURIComponent(loginChallenge)}`,
    { headers: oryAdminHeaders() },
  );
```

(Keep the existing variable name on that line — read it before editing rather than assuming it is `loginRequest`.)

At line ~127, the accept call has `headers: { "content-type": "application/json" }`. Replace that with:

```ts
      headers: oryAdminHeaders({ "content-type": "application/json" }),
```

In `apps/admin-web/src/app/consent/page.tsx`, add the same import, then:
- line ~25 (challenge fetch): add `{ headers: oryAdminHeaders() }` as the second argument.
- line ~37 (accept): replace `headers: { "content-type": "application/json" }` with `headers: oryAdminHeaders({ "content-type": "application/json" }),`.

**Do not** add the key to the `${authConfig.hydraPublicUrl}/oauth2/token` call in `auth/callback/route.ts` or to any `kratosPublicUrl` call — those are *public* endpoints authenticated by `client_secret` or a session cookie. Sending a project API key there is wrong and may be rejected.

- [ ] **Step 7: Typecheck and run the admin-web suite**

From `apps/admin-web`:

```bash
node ../../node_modules/typescript/bin/tsc --noEmit
```

Expected: exit 0.

```bash
node node_modules/vitest/vitest.mjs run
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/admin-web/src/lib/auth/ory-admin.ts apps/admin-web/src/lib/auth/ory-admin.test.ts apps/admin-web/src/lib/auth/config.ts apps/admin-web/src/app/login/page.tsx apps/admin-web/src/app/consent/page.tsx
git commit -m "feat(admin-web): authenticate Hydra Admin API calls with an Ory Network API key

admin-web is Hydra's login/consent provider; those admin endpoints require a
project API key on Ory Network. Public token/session endpoints deliberately
left unauthenticated.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Configure the Ory Network project

> **⚠️ PARTLY OPERATOR ACTION.** The Ory Console steps need a human; the verification steps are agent-runnable.

**Files:**
- Create: `infrastructure/ory/network/permissions.opl.ts` (the OPL namespace definition, committed for reproducibility)
- Create: `infrastructure/ory/network/identity.schema.json` (the Ory Network identity schema)

**Interfaces:**
- Produces: an Ory Network project whose JWKS, `permissions` namespace, identity schema, and login/consent UI URLs match what the code already expects.

- [ ] **Step 1: Confirm the project base URL resolves and JWKS is served**

```bash
curl -s "$ORY_SDK_URL/.well-known/jwks.json" | head -c 300
```

Expected: a JSON object with a `keys` array. If it 404s, `ORY_SDK_URL` is wrong.

- [ ] **Step 2: Confirm the API key authenticates**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $ORY_API_KEY" "$ORY_SDK_URL/admin/identities"
```

Expected: `200`. A `401` means the key is wrong or lacks scope — regenerate it in the Ory Console.

- [ ] **Step 3: Commit the OPL namespace definition**

Ory Network defines permission namespaces in the Ory Permission Language, not in `keto.yml`. The self-hosted config (`infrastructure/docker/keto/keto.yml`) declares exactly one namespace, `permissions`, and `KetoAccessControl` checks tuples of the shape `(namespace=permissions, object=<permission>, relation=granted, subject_id=<principalId>)`.

Create `infrastructure/ory/network/permissions.opl.ts`:

```ts
// Ory Permission Language mirror of infrastructure/docker/keto/keto.yml's single `permissions`
// namespace. Committed so the Ory Network project config is reproducible and reviewable rather
// than living only in the Console. KetoAccessControl (packages/auth/src/keto.ts) checks tuples of
// the shape (namespace=permissions, object=<permission string>, relation=granted, subject_id=<id>),
// so `granted` holding a subject set of principals is the entire model — no hierarchy, because the
// hierarchy lives in the admin controllers' explicit permission strings.
import { Namespace, SubjectSet, Context } from "@ory/permission-namespace-types";

class User implements Namespace {}

class permissions implements Namespace {
  related: { granted: User[] };

  permits = {
    access: (ctx: Context): boolean => this.related.granted.includes(ctx.subject),
  };
}
```

Upload it in the Ory Console: **Permissions → Configure → Permission Rules**, paste, and save.

- [ ] **Step 4: Configure the identity schema**

In the Ory Console: **Identity → Identity Schema → Create new schema**, and paste the contents of `infrastructure/docker/kratos/identity.schema.json` verbatim. Save the resulting schema ID.

The `kind` and `roles` claims that drive authorization come from `metadata_public` (set through the Admin API in Task 5), **not** from traits — `apps/admin-web/src/app/login/page.tsx:120-124` reads `session.identity.metadata_public`. Do not add them to the schema.

Copy the file for the record:

```bash
mkdir -p infrastructure/ory/network
cp infrastructure/docker/kratos/identity.schema.json infrastructure/ory/network/identity.schema.json
```

- [ ] **Step 5: Point Ory's OAuth2 login and consent UI at admin-web**

In the Ory Console: **OAuth2 → Consent & Login settings**:
- Login UI URL: `http://localhost:3100/login`
- Consent UI URL: `http://localhost:3100/consent`

(Port 3100 is verified from `apps/admin-web/package.json`: `"dev": "next dev --port 3100"`. The storefront has no `--port` flag, so it takes Next's default of 3000. You will change these to the deployed origin in Task 17.)

- [ ] **Step 6: Commit the committed configs**

```bash
git add infrastructure/ory/network/
git commit -m "chore(ory): commit Ory Network permission namespace and identity schema

Keeps the cloud project config reproducible and reviewable instead of living
only in the Ory Console.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Seed Ory Network with the OAuth2 client, an admin identity, and all 66 permissions

The existing `scripts/dev/seed-auth-local.mjs` grants **14** read permissions and targets self-hosted Ory on `localhost`. The admin API declares **66** distinct permission strings, so 52 of them currently deny. This task writes the Ory Network equivalent with the complete set.

**Files:**
- Create: `scripts/ops/seed-ory-network.mjs`

**Interfaces:**
- Consumes: `ORY_SDK_URL`, `ORY_API_KEY`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`, `AUTH_AUDIENCE` from `.env`; `ADMIN_DEV_PASSWORD` from the shell (never from a file).
- Produces: an OAuth2 client, one admin identity, and 66 relation tuples — all idempotently.

- [ ] **Step 1: Derive the authoritative permission list from the code, not by hand**

```bash
grep -rhoE '"[a-z0-9]+:(read|write|create|update|delete|manage)"' apps/admin/src/interfaces/*.ts | sort -u | tr -d '"' > /tmp/perms.txt; wc -l < /tmp/perms.txt
```

Expected: `66`. If the count differs, the API surface changed — use the new list. Keep the file; Step 2 embeds it.

- [ ] **Step 2: Write the seed script**

Create `scripts/ops/seed-ory-network.mjs`:

```js
#!/usr/bin/env node
// Ory Network equivalent of scripts/dev/seed-auth-local.mjs. That script targets self-hosted Ory
// on localhost and grants only the 14 :read permissions the Phase A.30/A.31 screens needed; the
// admin API declares 66 distinct permission strings (grep apps/admin/src/interfaces/*.ts), so the
// other 52 denied. This grants all of them. Idempotent: safe to re-run.
//
// Usage:  ADMIN_DEV_PASSWORD='<strong password>' node scripts/ops/seed-ory-network.mjs
// Reads ORY_SDK_URL, ORY_API_KEY, AUTH_CLIENT_ID, AUTH_CLIENT_SECRET, AUTH_AUDIENCE from the env.

const ORY = required("ORY_SDK_URL");
const KEY = required("ORY_API_KEY");
const CLIENT_ID = process.env.AUTH_CLIENT_ID ?? "lumo-admin-web";
const CLIENT_SECRET = required("AUTH_CLIENT_SECRET");
const AUDIENCE = process.env.AUTH_AUDIENCE ?? "lumo-admin";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@lumo.local";
const ADMIN_PASSWORD = required("ADMIN_DEV_PASSWORD");
const REDIRECT_URI =
  process.env.ADMIN_WEB_ORIGIN !== undefined
    ? `${process.env.ADMIN_WEB_ORIGIN}/auth/callback`
    : "http://localhost:3100/auth/callback";

// Every permission string the admin controllers declare. Regenerate with:
//   grep -rhoE '"[a-z0-9]+:(read|write|create|update|delete|manage)"' apps/admin/src/interfaces/*.ts | sort -u
const PERMISSIONS = [
  "analytics:read", "automation:create", "automation:read",
  "brands:create", "brands:delete", "brands:read", "brands:update",
  "cart:create", "cart:read",
  "categories:create", "categories:delete", "categories:read", "categories:update",
  "components:create", "components:read",
  "content:create", "content:read", "content:update",
  "coupons:create", "coupons:read",
  "customer360:read", "customers:read",
  "experience:create", "experience:read",
  "experiments:create", "experiments:read",
  "finance:manage", "finance:read",
  "fulfillment:create", "fulfillment:read",
  "inventory:read", "localization:read", "loyalty:read",
  "notifications:create", "notifications:read",
  "orders:read", "organizations:create",
  "pages:read", "payments:read",
  "products:create", "products:delete", "products:read", "products:update",
  "promotions:create", "promotions:read",
  "recommendations:create", "recommendations:read",
  "reporting:read", "returns:create", "returns:read",
  "reviews:create", "reviews:read",
  "search:create", "search:read", "seo:read",
  "shipping:create", "shipping:read",
  "tenancy:create", "tenancy:read", "tenancy:update",
  "theme:create", "theme:read",
  "users:create", "wishlist:create", "wishlist:read",
];

function required(name) {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`${name} is required`);
  return v;
}

const admin = (path, init = {}) =>
  fetch(`${ORY}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, ...(init.headers ?? {}) },
  });

async function ensureOAuthClient() {
  const list = await admin(`/admin/clients?client_name=${encodeURIComponent(CLIENT_ID)}`);
  if (list.ok) {
    const existing = await list.json();
    const match = Array.isArray(existing) ? existing.find((c) => c.client_id === CLIENT_ID) : undefined;
    if (match !== undefined) {
      const patched = await admin(`/admin/clients/${CLIENT_ID}`, {
        method: "PUT",
        body: JSON.stringify(clientBody()),
      });
      if (!patched.ok) throw new Error(`update client failed: ${patched.status} ${await patched.text()}`);
      console.log(`OAuth2 client "${CLIENT_ID}" updated.`);
      return;
    }
  }
  const created = await admin("/admin/clients", { method: "POST", body: JSON.stringify(clientBody()) });
  if (!created.ok) throw new Error(`create client failed: ${created.status} ${await created.text()}`);
  console.log(`OAuth2 client "${CLIENT_ID}" created.`);
}

function clientBody() {
  return {
    client_id: CLIENT_ID,
    client_name: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    redirect_uris: [REDIRECT_URI],
    scope: "openid offline_access",
    audience: [AUDIENCE],
    token_endpoint_auth_method: "client_secret_post",
  };
}

async function ensureIdentity() {
  const found = await admin(`/admin/identities?credentials_identifier=${encodeURIComponent(ADMIN_EMAIL)}`);
  if (found.ok) {
    const list = await found.json();
    if (Array.isArray(list) && list.length > 0) {
      console.log(`Identity ${ADMIN_EMAIL} already exists (${list[0].id}).`);
      return list[0].id;
    }
  }
  const created = await admin("/admin/identities", {
    method: "POST",
    body: JSON.stringify({
      schema_id: process.env.ORY_IDENTITY_SCHEMA_ID ?? "default",
      traits: { email: ADMIN_EMAIL },
      metadata_public: { kind: "staff", roles: ["admin"] },
      credentials: { password: { config: { password: ADMIN_PASSWORD } } },
    }),
  });
  if (!created.ok) throw new Error(`create identity failed: ${created.status} ${await created.text()}`);
  const identity = await created.json();
  console.log(`Identity ${ADMIN_EMAIL} created (${identity.id}).`);
  return identity.id;
}

async function grantAll(subjectId) {
  let granted = 0;
  for (const permission of PERMISSIONS) {
    const res = await admin("/admin/relation-tuples", {
      method: "PUT",
      body: JSON.stringify({
        namespace: "permissions",
        object: permission,
        relation: "granted",
        subject_id: subjectId,
      }),
    });
    if (!res.ok) throw new Error(`grant "${permission}" failed: ${res.status} ${await res.text()}`);
    granted += 1;
  }
  console.log(`Granted ${granted} permissions to ${subjectId}.`);
}

await ensureOAuthClient();
const identityId = await ensureIdentity();
await grantAll(identityId);
console.log("Ory Network seeded.");
```

- [ ] **Step 3: Run it**

```bash
ADMIN_DEV_PASSWORD='<pick a strong password>' node scripts/ops/seed-ory-network.mjs
```

Expected output: client created/updated, identity created, `Granted 66 permissions`.

**Never** write the password into any file in the repo. Keep it in your password manager.

If the relation-tuple `PUT` returns 400/404, the endpoint shape differs on your project — confirm the correct write path with:

```bash
curl -s -H "Authorization: Bearer $ORY_API_KEY" "$ORY_SDK_URL/admin/relation-tuples?namespace=permissions" | head -c 300
```

and adjust the script rather than guessing.

- [ ] **Step 4: Verify a permission check the way the runtime performs it**

```bash
curl -s -H "Authorization: Bearer $ORY_API_KEY" "$ORY_SDK_URL/relation-tuples/check?namespace=permissions&object=products:read&relation=granted&subject_id=<IDENTITY_ID>"
```

Expected: `{"allowed":true}`. This is the exact query `KetoAccessControl.authorize` builds (`packages/auth/src/keto.ts:26-33`). If it returns `allowed:false`, the tuples did not land — do not proceed.

- [ ] **Step 5: Commit**

```bash
git add scripts/ops/seed-ory-network.mjs
git commit -m "feat(ops): seed Ory Network with OAuth2 client, admin identity, and all 66 permissions

The local seed script granted only 14 of the 66 permission strings the admin
controllers declare, so 52 denied. Derives the list from the controllers and
grants the complete set, idempotently.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Prove an authenticated API call returns 200

This is the gate for Phase 1. Before it, every `/api/v1/*` route returned 401.

**Files:** none (verification only)

- [ ] **Step 1: Restart the runtime with the Ory env loaded**

From `apps/runtime`, with the updated `.env` in the process environment:

```bash
node node_modules/tsx/dist/cli.mjs src/api.ts
```

The startup warning `authorization is permissive: KETO_READ_URL unset` should now be **gone** — `KETO_READ_URL` is set, so `CachedAccessControl`+`KetoAccessControl` are live instead of the local allow-all escape hatch (`apps/runtime/src/composition.ts:180-193`).

- [ ] **Step 2: Obtain an access token**

Complete the browser login flow once (Task 9 covers running admin-web), or mint a token directly with the `authorization_code` flow. The simplest check that does not need a browser is to confirm the OAuth2 metadata is reachable:

```bash
curl -s "$ORY_SDK_URL/.well-known/openid-configuration" | head -c 400
```

- [ ] **Step 3: Call a real endpoint with the token**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $ACCESS_TOKEN" "http://localhost:3080/api/v1/products?tenantId=$TENANT_DEFAULT_ID"
```

Expected: `200`.

Read the exact query/header contract for the route from `/openapi.json` rather than guessing parameter names:

```bash
curl -s http://localhost:3080/openapi.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s).paths['/api/v1/products'];console.log(JSON.stringify(p.get,null,2).slice(0,1200))})"
```

- [ ] **Step 4: Interpret the result**

- `200` → Phase 1 complete. The 3 products from the existing seed should appear in the body.
- `401` → the JWT was rejected. Check `iss` and `aud` in the token match `AUTH_ISSUER_URL` / `AUTH_AUDIENCE` exactly (trailing slash matters — `JwtVerifier` compares `issuer` strictly).
- `403` → authentication worked, authorization denied. The Keto tuples or the API key are wrong; re-run Task 5 Step 4.

- [ ] **Step 5: Record the working configuration**

Create `docs/operations/CLOUD_RUNBOOK.md` documenting: the three managed services, every env var and where its value comes from, how to re-seed Ory, and the three verification curls above (`/readyz` 200, permission check `allowed:true`, `/api/v1/products` 200). **Do not put any secret value in this file** — name the variables only.

- [ ] **Step 6: Commit**

```bash
git add docs/operations/CLOUD_RUNBOOK.md
git commit -m "docs(ops): cloud runbook for the Supabase + Upstash + Ory Network topology

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## PHASE 2 — See the Platform

### Task 7: Unblock the production build on Windows

`next build` currently fails with `EPERM: operation not permitted, symlink` while tracing standalone output. The page compilation itself already succeeds (13/13 static pages generated for storefront) — only the standalone copy step fails.

**Files:**
- Modify: `apps/admin-web/next.config.ts`
- Modify: `apps/storefront/next.config.ts` (only if it also sets `output: "standalone"` — check first)

**Interfaces:**
- Produces: a build that succeeds on Windows without Developer Mode, while keeping `output: "standalone"` for the Docker images that depend on it (`infrastructure/docker/admin-web.Dockerfile` copies `.next/standalone`).

- [ ] **Step 1: Confirm Developer Mode from Task 0 actually fixed it**

From `apps/storefront`:

```bash
node node_modules/next/dist/bin/next build
```

If this now exits 0, **skip to Step 4** — no code change is needed and the config must stay as-is for Docker.

- [ ] **Step 2: If it still fails, make `standalone` opt-in**

`output: "standalone"` is load-bearing for the Docker images and must not be removed. Make it conditional instead. In `apps/admin-web/next.config.ts`, replace the `output: "standalone",` line with:

```ts
  // `standalone` is required by infrastructure/docker/admin-web.Dockerfile, which copies
  // .next/standalone. Its file-tracing step creates symlinks, which fail with EPERM on Windows
  // without Developer Mode — and Vercel does not need it at all. Opt in explicitly where it is
  // needed (the Dockerfile sets NEXT_OUTPUT_STANDALONE=1) instead of paying for it everywhere.
  ...(process.env["NEXT_OUTPUT_STANDALONE"] === "1" ? { output: "standalone" as const } : {}),
```

- [ ] **Step 3: Set the flag in the Dockerfile so the image is unaffected**

In `infrastructure/docker/admin-web.Dockerfile`, add before the build command in the builder stage:

```dockerfile
ENV NEXT_OUTPUT_STANDALONE=1
```

Apply the same two edits to `apps/storefront/next.config.ts` and `infrastructure/docker/web.Dockerfile` **only if** the storefront config sets `output: "standalone"`. Read it first.

- [ ] **Step 4: Verify both apps build**

From `apps/storefront`, then from `apps/admin-web`:

```bash
node node_modules/next/dist/bin/next build
```

Expected: both exit 0. The A.43 report recorded storefront = 5 routes and admin-web = 20 routes; the route counts printed now should be at least that.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/next.config.ts apps/storefront/next.config.ts infrastructure/docker/admin-web.Dockerfile infrastructure/docker/web.Dockerfile
git commit -m "fix(build): make Next standalone output opt-in so Windows builds succeed

File tracing for standalone creates symlinks, which fail with EPERM on Windows
without Developer Mode. Docker images that copy .next/standalone opt in via
NEXT_OUTPUT_STANDALONE=1, so their behaviour is unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Seed rich demo data

The database has 3 products and no orders, discounts, or content. That is not enough to see the platform. `apps/runtime/src/seed.ts` already creates brand/category/products/collection/customer/price-list/warehouse/inventory — this layers commerce activity on top without duplicating it.

**Files:**
- Create: `apps/runtime/src/seed-demo.ts`
- Modify: `apps/runtime/package.json` (add a `seed:demo` script)

**Interfaces:**
- Consumes: the entities `seed.ts` creates. Run `seed.ts` first if the catalog tables are empty.
- Produces: orders in several states, an active discount, published content, and reviews — so every admin list screen has rows.

- [ ] **Step 1: Read the existing seed to reuse its exact composition pattern**

```bash
sed -n '1,100p' apps/runtime/src/seed.ts
```

`seed-demo.ts` must use the same `createPrismaClient` + composition-root + `unwrap()` shape. Do **not** write raw Prisma inserts — going around the use-cases skips domain invariants and outbox events, which is precisely what this platform's architecture exists to enforce.

- [ ] **Step 2: Enumerate the use-cases available for each entity you intend to create**

```bash
ls services/orders/src/application/ services/promotions/src/application/ services/reviews/src/application/ services/content/src/application/
```

Write the seed against these signatures. If a needed use-case does not exist, seed only what does and note the omission in the commit message — do not invent a use-case in a seed script.

- [ ] **Step 3: Write `seed-demo.ts`**

Model it directly on `seed.ts`: same imports, same `main()` structure, same `unwrap()` helper, same `logger.info` per created entity, same `finally { await prisma.$disconnect(); }`. Create, at minimum: 10 more products across 3 categories, 3 orders in different lifecycle states, 1 percentage discount, 3 published reviews, and 2 content pages.

- [ ] **Step 4: Add the script**

In `apps/runtime/package.json`, next to the existing seed entry, add:

```json
    "seed:demo": "tsx src/seed-demo.ts",
```

- [ ] **Step 5: Run it and verify row counts grew**

```bash
node node_modules/tsx/dist/cli.mjs src/seed-demo.ts
```

Then re-run the row-count query from the Verified Baseline and confirm `catalog.products` ≥ 13 and `orders.*` is non-empty.

- [ ] **Step 6: Commit**

```bash
git add apps/runtime/src/seed-demo.ts apps/runtime/package.json
git commit -m "feat(runtime): rich demo seed layered on the baseline seed

Adds orders, a discount, reviews, and content so every admin list screen has
rows. Goes through the use-cases, not raw Prisma, so domain invariants and
outbox events are exercised.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Run all three apps together and verify the admin reads from Supabase

**Files:** none (verification only)

- [ ] **Step 1: Start the runtime**

From `apps/runtime`: `node node_modules/tsx/dist/cli.mjs src/api.ts`

- [ ] **Step 2: Start admin-web**

From `apps/admin-web`: `node node_modules/next/dist/bin/next dev`
Confirm the port it prints. It must match the redirect URI registered in Task 5 and the login/consent UI URLs from Task 4 Step 5.

- [ ] **Step 3: Start the storefront**

From `apps/storefront`: `node node_modules/next/dist/bin/next dev`

- [ ] **Step 4: Log in through the real OAuth flow**

Open admin-web in a browser. You should be redirected to Ory, log in with `admin@lumo.local` and the password from Task 5, pass through the consent screen, and land back on the dashboard.

If the redirect loops, the login/consent UI URLs in the Ory project (Task 4 Step 5) do not match the port admin-web is actually running on.

- [ ] **Step 5: Walk the admin screens and record what works**

There are 82 pages under `apps/admin-web/src/app`. Visit at least: products, categories, brands, orders, customers, inventory, discounts, content, analytics. For each, note: renders with data / renders empty / errors.

Produce a short table in the commit message or a scratch file. **Report failures honestly** — a screen that errors is a finding, not something to hide or patch over in this task.

- [ ] **Step 6: Verify the storefront serves the seeded catalog**

Visit the storefront root, a collection page, and a product page. The products from Task 8 must appear. They are being read from Supabase through the runtime API — if they appear, the full stack is proven end-to-end.

- [ ] **Step 7: Record the results**

Append a "Verified Screens" section to `docs/operations/CLOUD_RUNBOOK.md` with the table from Step 5.

```bash
git add docs/operations/CLOUD_RUNBOOK.md
git commit -m "docs(ops): record verified admin and storefront screens against Supabase

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## PHASE 3 — Close the Runtime Gaps

### Task 10: Drain the outbox by enabling the relay

24 domain events are sitting unpublished in `platform.outbox`. The relay exists (`apps/runtime/src/outbox-relay-runtime.ts`) and is Docker-free by design — it polls Postgres instead of requiring Debezium CDC — but defaults to off.

**Files:**
- Modify: `.env`, `.env.example`

- [ ] **Step 1: Record the current backlog**

Query `platform.outbox` and note the row count and how many are unpublished. Read the table's columns first to find the published/processed marker — do not assume a column name.

- [ ] **Step 2: Enable the relay**

Add to `.env`:

```
OUTBOX_RELAY_ENABLED=true
OUTBOX_RELAY_INTERVAL_MS=2000
OUTBOX_RELAY_BATCH_SIZE=200
```

- [ ] **Step 3: Start the worker (the relay runs there, not in the api)**

From `apps/runtime`: `node node_modules/tsx/dist/cli.mjs src/worker.ts`

Note: `KAFKA_BROKERS` defaults to `localhost:19092` and no broker is running. Watch the logs. If the relay fails to publish because it cannot reach Kafka, that is the real finding — record it and stop; do not silently leave the flag on while it errors in a loop. Publishing to Kafka needs either Redpanda (Docker) or a managed Kafka. Note it as a deferred dependency in the runbook and revert the flag.

- [ ] **Step 4: Re-query the backlog**

If it drained, the relay works. If not, Step 3's finding stands.

- [ ] **Step 5: Commit whichever outcome is true**

Document the actual result in `docs/operations/CLOUD_RUNBOOK.md` — either "relay enabled and draining" or "relay blocked on a Kafka broker; deferred". Both are legitimate; misreporting is not.

---

### Task 11: Move object storage to Supabase Storage

Media currently uses `InMemoryObjectStorage` — uploads vanish on restart. Supabase Storage is S3-compatible, so it satisfies the existing `S3_*` config with no code change and keeps everything in one provider.

**Files:**
- Modify: `.env`, `.env.example`

- [ ] **Step 1: Create the bucket**

In the Supabase dashboard → **Storage** → create a bucket named `media`. Then **Project Settings → Storage → S3 Access Keys** → create one. Record the endpoint, region, access key ID, and secret.

- [ ] **Step 2: Configure**

Add to `.env`:

```
S3_ENDPOINT=https://<project-ref>.storage.supabase.co/storage/v1/s3
S3_REGION=<region shown in the dashboard>
S3_ACCESS_KEY_ID=<...>
S3_SECRET_ACCESS_KEY=<...>
S3_FORCE_PATH_STYLE=true
S3_BUCKET_MEDIA=media
```

- [ ] **Step 3: Restart the api and confirm the stub warning is gone**

The startup warning `Media object storage is permissive: no production S3 config` must no longer appear. Its presence means the config was not picked up.

- [ ] **Step 4: Upload a real file through the admin media screen and confirm it persists**

Restart the runtime, reload the screen, and confirm the file is still there.

- [ ] **Step 5: Commit the `.env.example` documentation**

```bash
git add .env.example
git commit -m "docs(env): document Supabase Storage as the S3-compatible object store

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Wire Stripe in test mode

`PaymentProvider` is the in-memory stub whose `verifyWebhook()` always returns true. `StripePaymentProvider` already exists in `@platform/psp-stripe` and activates as soon as both keys are present (`apps/runtime/src/composition.ts:240-250`).

**Files:**
- Modify: `.env`, `.env.example`

- [ ] **Step 1: Get test-mode keys**

From the Stripe Dashboard in **test mode**: the secret key (`sk_test_...`). For the webhook secret (`whsec_...`), run the Stripe CLI listener:

```bash
stripe listen --forward-to http://localhost:3080/api/v1/payments/webhook
```

Confirm the exact webhook path from `/openapi.json` before running this.

- [ ] **Step 2: Configure**

```
STRIPE_SECRET_KEY=sk_test_<...>
STRIPE_WEBHOOK_SECRET=whsec_<...>
```

- [ ] **Step 3: Confirm the stub warning is gone**

The startup warning `Payments webhook verification is permissive` must disappear.

- [ ] **Step 4: Exercise the existing sandbox validation script**

The repo ships one: `apps/runtime/scripts/c2-2-stripe-sandbox-validation.ts`.

```bash
node node_modules/tsx/dist/cli.mjs scripts/c2-2-stripe-sandbox-validation.ts
```

Read the script first to see what it expects.

- [ ] **Step 5: Trigger a webhook and confirm signature verification rejects a forged one**

```bash
stripe trigger payment_intent.succeeded
```

Then POST the same payload with a wrong signature and confirm the endpoint rejects it. This is the whole point of replacing the stub — verify it, do not assume it.

- [ ] **Step 6: Commit**

```bash
git add .env.example
git commit -m "docs(env): document Stripe test-mode configuration

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Fix `DIRECT_URL` to a true direct connection

Both `DATABASE_URL` and `DIRECT_URL` currently point at `pooler.supabase.com:5432`. `DIRECT_URL` is what Prisma uses for migrations, which need advisory locks and DDL — running those through a pooler is the documented failure mode for hung or corrupt migrations.

**Files:**
- Modify: `.env`, `.env.example`

- [ ] **Step 1: Get both connection strings from Supabase**

Dashboard → **Project Settings → Database → Connection string**:
- **Transaction pooler** (port `6543`) → for `DATABASE_URL`, with `?pgbouncer=true` appended.
- **Direct connection** (port `5432`, the `db.<ref>.supabase.co` host, not the pooler host) → for `DIRECT_URL`.

- [ ] **Step 2: Update `.env`**

```
DATABASE_URL=postgresql://<user>:<pass>@<pooler-host>:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://<user>:<pass>@db.<project-ref>.supabase.co:5432/postgres
```

- [ ] **Step 3: Verify migrations still resolve through the direct URL**

From `packages/db`:

```bash
node node_modules/prisma/build/index.js migrate status
```

Expected: "Database schema is up to date!" with 37 migrations — the same result as the baseline. A different result means the URL is wrong; fix it before proceeding.

- [ ] **Step 4: Verify the runtime still works through the transaction pooler**

Restart the api and re-run the Task 6 Step 3 authenticated call. Expected: still `200`.

If you see prepared-statement errors, `?pgbouncer=true` is missing or malformed on `DATABASE_URL`.

- [ ] **Step 5: Commit**

```bash
git add .env.example
git commit -m "docs(env): separate the transaction pooler from the direct connection

DIRECT_URL drives migrations, which need advisory locks and DDL; routing those
through the pooler is the documented cause of hung migrations.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Mount the zero-trust security guard

`buildSecurityHttpGuard` (`apps/runtime/src/security/wire-security-runtime.ts:90`) is defined and never called. `apps/runtime/src/config.ts:248-262` deliberately **refuses** `SECURITY_ZERO_TRUST_ENFORCEMENT=on` with an explicit error, so operators cannot be misled into thinking enforcement is active. Roughly 4,300 lines of security application code are unreachable. That refusal clause's own comment says: *"Remove this clause in the sprint that mounts the guard."* This is that sprint.

> This is the largest and riskiest task in the plan. It changes the authorization path for every request. Do it last among the Phase 3 tasks, and do not start it until Tasks 10–13 are done and committed.

**Files:**
- Modify: `apps/runtime/src/api.ts`
- Modify: `apps/runtime/src/config.ts:248-262` (remove the H-01 refusal)
- Create: `apps/runtime/src/security/mount-guard.test.ts`

**Interfaces:**
- Consumes: `buildSecurityHttpGuard(core: RuntimeCore): PermissionGuard`.
- Produces: an api whose authorization point is `SecurityPermissionGuard` when `SECURITY_ZERO_TRUST_ENFORCEMENT=on`, and the existing `AdminGuard` + Keto path when off.

- [ ] **Step 1: Read the guard and the existing enforcement point before changing anything**

```bash
sed -n '1,140p' apps/runtime/src/security/wire-security-runtime.ts
grep -n 'AdminGuard\|accessControl\|guard' apps/runtime/src/api.ts
```

Understand exactly what `PermissionGuard` requires and where `AdminGuard` is currently injected into `createAdminHttpApi`. Do not proceed on assumption.

- [ ] **Step 2: Verify the provisioning prerequisite**

`config.ts` already enforces that `SECURITY_ZERO_TRUST_ENFORCEMENT` requires `SECURITY_PRINCIPAL_PROVISIONING=on`, because enforcement fails closed against an empty store. Enable provisioning **first**, restart the worker, and confirm principals/roles/policies are actually written:

```
SECURITY_PRINCIPAL_PROVISIONING=on
```

Then query the `security` schema tables and confirm they are non-empty. **If they are empty, stop.** Turning on enforcement against an empty store will lock you out of the entire API.

- [ ] **Step 3: Write the failing test**

Create `apps/runtime/src/security/mount-guard.test.ts` asserting that `startApi` selects `SecurityPermissionGuard` when the flag is on and `AdminGuard` when it is off. Model the test setup on the existing runtime tests — read one first:

```bash
ls apps/runtime/src/*.test.ts apps/runtime/src/security/*.test.ts
```

- [ ] **Step 4: Run it and verify it fails**

```bash
node node_modules/vitest/vitest.mjs run src/security/mount-guard.test.ts
```

- [ ] **Step 5: Mount the guard in `api.ts`**

Select the guard based on `config.SECURITY_ZERO_TRUST_ENFORCEMENT` and pass it into `createAdminHttpApi` where `AdminGuard` goes today. Keep the off-path byte-for-byte identical to current behaviour.

- [ ] **Step 6: Remove the refusal clause**

Delete the `if (cfg.SECURITY_ZERO_TRUST_ENFORCEMENT) { ctx.addIssue(... "is not supported yet" ...) }` block at `apps/runtime/src/config.ts:248-262`, including its H-01 comment. Leave the *other* superRefine clause — the one requiring `SECURITY_PRINCIPAL_PROVISIONING` — in place. That one is still true and still protects you.

- [ ] **Step 7: Run the tests**

```bash
node node_modules/vitest/vitest.mjs run
node ../../node_modules/typescript/bin/tsc --noEmit
```

Expected: all pass, exit 0.

- [ ] **Step 8: Boot with enforcement on and verify a real request still authorizes**

```
SECURITY_PRINCIPAL_PROVISIONING=on
SECURITY_ZERO_TRUST_ENFORCEMENT=on
```

Restart the api. Re-run the Task 6 Step 3 authenticated call.

- `200` → enforcement is live and permitting correctly.
- `403` → the security store lacks the policy for this principal. Go back to Step 2; **do not** disable the guard to make it pass.

- [ ] **Step 9: Verify it actually denies**

Call an endpoint the admin identity has no permission for and confirm `403`. A guard that only ever allows is not enforcing anything — prove both directions.

- [ ] **Step 10: Commit**

```bash
git add apps/runtime/src/api.ts apps/runtime/src/config.ts apps/runtime/src/security/mount-guard.test.ts
git commit -m "feat(runtime): mount the zero-trust security guard as the HTTP authorization point

buildSecurityHttpGuard was defined but never called, so ~4,300 lines of
security application code were unreachable and config.ts refused the flag to
avoid a silent no-op. Mounts the guard behind SECURITY_ZERO_TRUST_ENFORCEMENT
and removes the H-01 refusal its own comment asked to remove once mounted.
The off-path keeps AdminGuard + Keto unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## PHASE 4 — Production Readiness

### Task 15: Expand end-to-end coverage

3 specs / 5 tests for 424 routes. Every subsystem this plan touched needs a regression test.

**Files:**
- Create: `apps/e2e/tests/admin-catalog.spec.ts`
- Create: `apps/e2e/tests/storefront-browse.spec.ts`
- Modify: `apps/e2e/tests/support/admin-login.ts` (point at Ory Network)

- [ ] **Step 1: Read the existing specs and support helpers**

```bash
cat apps/e2e/tests/operator-create-product.spec.ts apps/e2e/tests/support/admin-login.ts
```

Match their structure exactly. `admin-login.ts` targets local Ory and needs updating for Ory Network.

- [ ] **Step 2: Write `admin-catalog.spec.ts`**

Cover the full product lifecycle through the UI: create → add variant → set price → publish → verify on storefront → unpublish → archive. Each step asserts on rendered state, not on a bare 200.

- [ ] **Step 3: Write `storefront-browse.spec.ts`**

Cover: home renders products, collection page filters, product detail shows price and stock, search returns results, add-to-cart updates the cart.

- [ ] **Step 4: Run the suite**

```bash
node node_modules/@playwright/test/cli.js test
```

All three apps must be running. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/e2e/
git commit -m "test(e2e): cover the admin catalog lifecycle and storefront browsing

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: Full-repo verification gate

Nothing ships until every workspace is green. Because `turbo` is broken here, iterate explicitly.

**Files:** none

- [ ] **Step 1: Typecheck every workspace**

```bash
for d in packages/* services/* apps/*; do if [ -f "$d/tsconfig.json" ]; then (cd "$d" && node ../../node_modules/typescript/bin/tsc --noEmit >/dev/null 2>&1 && echo "PASS $d" || echo "FAIL $d"); fi; done
```

Expected: every line `PASS`. Investigate each `FAIL` individually.

- [ ] **Step 2: Test every workspace that has tests**

```bash
for d in packages/* services/* apps/*; do if [ -f "$d/vitest.config.ts" ] || [ -f "$d/vitest.config.mts" ]; then (cd "$d" && node node_modules/vitest/vitest.mjs run >/dev/null 2>&1 && echo "PASS $d" || echo "FAIL $d"); fi; done
```

- [ ] **Step 3: Run the architecture boundary check**

```bash
node node_modules/dependency-cruiser/bin/dependency-cruise.mjs --config .dependency-cruiser.cjs apps packages services
```

Expected: "no dependency violations found". The A.43 baseline was 1,572 modules / 6,857 dependencies with zero violations. A violation means this plan's changes broke a layering rule — fix the change, not the rule.

- [ ] **Step 4: Confirm no secrets are staged**

```bash
git status --short; git check-ignore -v .env
```

`.env` must not appear in `git status` as staged or untracked-to-be-added.

- [ ] **Step 5: Commit any fixes, then tag the verified state**

```bash
git tag -a cloud-verified-$(date +%Y%m%d) -m "All workspaces typecheck, test, and arch-check green on Supabase + Upstash + Ory Network"
```

---

### Task 17: Deploy

> **⚠️ OPERATOR ACTION for account setup.** Deployment publishes the platform to the internet — confirm with the human before running anything that creates a public deployment.

**Files:**
- Modify: `apps/admin-web/vercel.json`, `apps/storefront/vercel.json` (both already exist)

- [ ] **Step 1: Choose a host for `apps/runtime`**

The runtime is a long-running Fastify process with a worker and scheduler — it does **not** fit Vercel's serverless model. `infrastructure/railway/` and `infrastructure/k8s/` both exist. Railway is the lower-friction option; read `infrastructure/railway/` first and follow what is already there.

- [ ] **Step 2: Set every env var on the runtime host**

All of them, from `.env`, via the host's secret manager. Set `APP_ENV=production`.

This activates the fail-closed guards. Boot will now **fail** unless `KETO_WRITE_URL`, `KRATOS_PUBLIC_URL`, `KRATOS_ADMIN_URL`, a real payment provider, real object storage, and a real MFA provider are all configured. That is the intended design — it is verifying you actually finished Tasks 11–13.

- [ ] **Step 3: Handle the MFA guard**

`assertProductionMfaConfigured` (`apps/runtime/src/api.ts:26-38`) throws outside `local` while the `totp` method still resolves to `InMemoryTotpMfaProvider`. `composition.ts:235` wires a real `TotpMfaProvider` — confirm the resolver returns it, not the stub. If boot fails here, that is a genuine unfinished dependency; resolve it rather than weakening the guard.

- [ ] **Step 4: Deploy the two Next.js apps to Vercel**

Both already have `vercel.json`. Set `RUNTIME_API_URL` to the deployed runtime origin, plus `TENANT_DEFAULT_ID`, `APP_ENV=production`, and all `AUTH_*` / `ORY_API_KEY` / `HYDRA_*` / `KRATOS_*` values.

- [ ] **Step 5: Update the Ory project for the deployed origins**

In the Ory Console, change the login and consent UI URLs from `localhost` to the deployed admin-web origin, and add the deployed `/auth/callback` to the OAuth2 client's redirect URIs. Re-run `scripts/ops/seed-ory-network.mjs` with `ADMIN_WEB_ORIGIN` set to the deployed origin.

- [ ] **Step 6: Smoke-test production**

Run the same three checks from Task 6 against the deployed origins: `/readyz` → 200, permission check → `allowed:true`, authenticated `/api/v1/products` → 200. Then log into the deployed admin through the real OAuth flow.

- [ ] **Step 7: Update the runbook and commit**

```bash
git add docs/operations/CLOUD_RUNBOOK.md apps/admin-web/vercel.json apps/storefront/vercel.json
git commit -m "docs(ops): record the production deployment topology and smoke-test results

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 18: Turn on observability

`@platform/observability` ships a full OpenTelemetry SDK and `apps/runtime/src/telemetry.ts` wires it, but export is off by default.

**Files:**
- Modify: production env only

- [ ] **Step 1: Pick a collector**

Grafana Cloud, Honeycomb, or the self-hosted stack in `infrastructure/docker/otel/`. For a cloud-first topology, a managed OTLP endpoint is consistent with the rest of this plan.

- [ ] **Step 2: Configure**

```
OTEL_SERVICE_NAME=lumo-runtime
OTEL_EXPORTER_OTLP_ENDPOINT=<collector OTLP endpoint>
OTEL_TRACES_ENABLED=true
OTEL_METRICS_ENABLED=true
```

- [ ] **Step 3: Verify traces arrive**

Make an authenticated API call and confirm a trace appears in the backend within a minute. If nothing arrives, check the endpoint's protocol (HTTP vs gRPC) against what the SDK is configured to send.

- [ ] **Step 4: Confirm the Prometheus endpoint is scraped**

`/metrics` already serves Prometheus format. Point the scraper at it and confirm `process_uptime_seconds` appears.

- [ ] **Step 5: Commit the runbook update**

```bash
git add docs/operations/CLOUD_RUNBOOK.md
git commit -m "docs(ops): enable OpenTelemetry export and document the observability wiring

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Deferred — Explicitly Out of Scope

State these plainly when reporting completion; do not quietly treat them as done.

1. **Storefront depth.** 12 pages / 7,262 lines versus admin's 82 pages / 67,192. For a Shopify-class product the storefront *is* the product. This plan verifies the storefront works; it does not build it out. That deserves its own plan.
2. **Kafka/Redpanda broker.** Task 10 may conclude the outbox relay is blocked without one. Choosing and provisioning managed Kafka is a separate decision.
3. **ClickHouse and `services/analytics`.** `analytics` has 0 lines in its application layer and is one of only two contexts with no Prisma composition branch (the other is `platform-console`). Building it is a feature project.
4. **Squashed git history.** 3 commits total, the bulk in one called "feat: update project". `git bisect` is unusable. Nothing to fix retroactively — just keep commits granular from here.
5. **Prisma 6→7 migration.** `package.json#prisma` config is deprecated in favour of `prisma.config.ts`. Not urgent; 6.19.3 is supported.
6. **CRLF drift in `.prisma` files.** Cosmetic, repo-wide, pre-existing. Worth one deliberate formatting pass, not mixed into this work.

---

## Self-Review

**Spec coverage:** All 12 Known Gaps map to tasks — Redis→1, no IdP→4/5/6, missing API keys→2/3, 14-of-66 permissions→5, Developer Mode→0/7, dead security guard→14, outbox→10, DIRECT_URL→13, object storage→11, payment stub→12, thin seed→8, e2e→15. Deployment and observability are 17 and 18. Nothing in the gap list is unaddressed.

**Placeholder scan:** No "TBD", no "add error handling", no "similar to Task N". Tasks 8, 14, and 15 deliberately instruct the implementer to *read the existing code first* rather than embedding invented signatures — for `seed-demo.ts`, the guard mounting, and the e2e helpers, the real signatures live in files the executor must open, and inventing them here would produce confidently wrong code. Every other code block is literal and complete.

**Type consistency:** `createOryFetch(apiKey, inner?)` is defined in Task 2 Step 3 and used in Task 2 Step 6 with the same name and argument order. `oryAdminHeaders(extra?)` is defined in Task 3 Step 4 and used in Step 6 identically. `ORY_API_KEY` is added to the runtime schema (Task 2 Step 5) and to admin-web's config (Task 3 Step 3) under the same env name. `PERMISSIONS` in the seed script matches the 66 strings grepped from the controllers.

**Ordering:** Task 14 is correctly last in Phase 3 — it changes the authorization path for every request and must not run before the stack is otherwise proven. Task 13 (DIRECT_URL) is placed after the app-level tasks so a bad connection string cannot be confused with an app bug. Task 0 gates everything.
