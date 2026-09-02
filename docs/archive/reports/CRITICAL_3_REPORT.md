# CRITICAL-3 REPORT — Repositories pinned to one tenant at construction; requests resolve tenant per call

**Finding closed:** C2-6, `FINAL_PRODUCTION_READINESS_AUDIT_v2.md`
**Type:** Fail-closed guardrail. No repository redesign, no new bounded context, no public API removed
(one new rejection path is added, which is the fix, not a break).

## Investigate

- `apps/runtime/src/api.ts:43` — `tenantId: runtime.config.TENANT_DEFAULT_ID` is passed to
  `createAdminHttpApi` **once**, at process start.
- `apps/admin/src/http/server.ts:41` (pre-fix) — `wireAdmin(deps)` is called **once**, at server
  construction, threading that single `tenantId` into every `wireX({ prisma, tenantId })` call
  (`apps/admin/src/composition.ts:283-321`).
- Every Prisma composition branch closes over `tenantId` at construction and never accepts it again
  per call (representative: `services/wishlist/src/composition.ts:81-99` — `tenantId` is read once,
  passed into `PrismaWishlistRepository`'s constructor).
- `apps/admin/src/http/server.ts:53` (pre-fix) — `tenantResolvers: [headerTenantResolver]` resolves a
  **fresh tenant per request** from `x-tenant-id`.
- `packages/http/src/server.ts:240-249,307-312` — the resolved tenant reaches `context.tenantId` and
  is passed into every `route.handle({ ..., context })`.
- **Exhaustive check:** `git grep -n "context.tenantId"` across the entire repository returns **zero**
  matches inside `apps/admin/src/http/*routes.ts` (all ~40 route files). Every route handler
  destructures `context.principal` only (representative:
  `apps/admin/src/http/admin-routes.ts:371,380,389,...`) and calls admin controller methods that were
  built once against the pinned `tenantId`. The only 4 files anywhere that reference
  `context.tenantId` are `server.test.ts`, `outbox-writer.ts` (a different, event-context object), and
  `security-log-context.ts`/`edge-zero-trust.ts` — both part of the zero-trust runtime that has zero
  production callers (H2-3).
- `apps/runtime/src/config.ts:34` — `TENANT_MODE: z.enum(["single","multi"])` is declared and
  validated, and (before this fix) read by nothing.

**Conclusion, proven, not assumed:** the resolved per-request tenant is computed by the pipeline and
then discarded — every admin route ignores it and hits repositories permanently pinned to
`TENANT_DEFAULT_ID`. In single-tenant operation (today's only configured mode) this produces correct
results. The moment a second tenant's caller sends any `x-tenant-id`, that request is served — and
would silently write — against `tenant-local`'s rows.

## Prove

No repository evidence contradicted the finding; the exhaustive `context.tenantId` grep (above) is the
proof. `TENANT_MODE=multi` is validated by `config.ts` but was, before this fix, read nowhere —
confirmed by the same repository-wide search used in the audit's H2-3/L2-2 findings.

## Implement

This is a genuine multi-tenant capability gap, not a logic bug — closing it for real (per-request
repository re-scoping) means threading `tenantId` through every use case and repository call, which is
a design change requiring an ADR, not a configuration or wiring fix. Per the work order ("do not
redesign architecture"), the fix here is the guardrail: make the existing single-tenant pinning
**explicit and fail closed**, so a mismatched tenant is rejected instead of silently mis-scoped.

**1. HTTP layer — reject a request tenant that does not match the pinned one**
(`apps/admin/src/http/server.ts`):

```ts
function singleTenantGuardedResolver(pinnedTenantId: string | undefined): TenantResolver {
  return (input) => {
    const resolved = headerTenantResolver(input);
    if (pinnedTenantId === undefined) return resolved; // no Prisma pinning to guard
    return resolved === pinnedTenantId ? resolved : null;
  };
}
```

used in place of the bare `headerTenantResolver` for `tenantResolvers`. Returning `null` on a mismatch
routes through the pipeline's **existing** unresolved-tenant path
(`packages/http/src/server.ts:246-248` — `AuthorizationError("No tenant resolved for this request")`, 403) — no new error type, no new status code, no public contract change. When `deps.tenantId` is
`undefined` (in-memory composition — nothing is pinned to anything), behavior is byte-for-byte
unchanged.

**2. Boot layer — refuse `TENANT_MODE=multi`** (`apps/runtime/src/composition.ts`, start of
`buildRuntimeCore`):

```ts
if (config.TENANT_MODE === "multi") {
  throw new Error(
    "Runtime composition does not support TENANT_MODE=multi: every Prisma repository is pinned " +
      "to one tenantId at construction (ADR-0008), never per request. Implementing multi-tenant " +
      "composition is a design change (ADR), not a configuration switch.",
  );
}
```

Same fail-closed convention already used for `AUTH_JWKS_URL`/`KETO_READ_URL` two lines below it — a
mode nothing implements now refuses to boot instead of silently behaving like single-tenant (or, after
guard 1, silently rejecting every non-default-tenant request while claiming to support multi-tenancy).

**What did not change:** no repository, use case, or `wireX` signature; no route signature; no event
contract; `TenantResolver`'s type is untouched (the guard is a `TenantResolver`, composed the same way
any other one would be).

## Run

**New tests, 6 total:**

`apps/admin/src/http/tenant-guard.e2e.test.ts` (3 cases, real HTTP requests via `app.inject`, a
`createAdminHttpApi` instance constructed with `tenantId: "tenant-pinned"` and no `prisma`):

```
✓ resolves the tenant when the header matches the one every repository was pinned to
✓ rejects a request tenant that does not match the pinned tenant (would otherwise read/write the wrong tenant's rows)
✓ rejects a request with no tenant header at all, same as before this guard existed
```

`apps/runtime/src/composition.test.ts` (+1 case):

```
✓ FAILS CLOSED on TENANT_MODE=multi — repositories are pinned to one tenant at construction (C2-6)
```

The pre-existing `apps/admin/src/http/admin-http.e2e.test.ts` (6 cases, no `tenantId` in its
`createAdminHttpApi` call) all still pass unmodified — confirming the `pinnedTenantId === undefined`
passthrough branch preserves prior behavior exactly.

Quality gates:

| Gate      | Result                                                                   |
| --------- | ------------------------------------------------------------------------ |
| typecheck | ✅ 76/76                                                                 |
| lint      | ✅ 76/76                                                                 |
| test      | ✅ admin: 3 files / 35 tests (+1 file, +3 tests); runtime: 9/9 (+1 test) |
| arch      | ✅ 0 violations (1,531 modules, 6,672 dependencies)                      |

## Scope note

Real multi-tenancy — per-request repository scoping — is out of scope here by the work order's own
rule ("do not redesign architecture") and is exactly what the audit flagged needs an ADR. This fix
closes the silent-leak risk; it does not add the capability the architecture's Tenancy context and
SaaS plans advertise. That remains a real product gap, now failing loudly instead of silently.

## Status: FIXED (guardrail — see scope note for the deferred capability)
