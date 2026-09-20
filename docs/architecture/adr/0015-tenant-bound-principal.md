# ADR-0015: `Principal` carries the request's tenant; authorization decisions are made per tenant

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** Staff architecture (`WP-10` T10.5 finding G-67; scoping decided with the owner)
- **Affected documents:** `docs/architecture/23-platform-gap-register.md` (G-67 closed, G-70 opened), `docs/plans/phase-7/WP-10-multi-tenant-runtime.md`, `docs/plans/UNIFIED-ROADMAP.md`, `packages/db/prisma/MIGRATIONS.md` (§1, the rollout doctrine reused below)

## Context

T10.5 found that authorization decisions were tenant-blind end to end. `AccessControl.authorize(principal,
permission)` took a `Principal` of `{ id, kind, roles }` and a `Permission` that is a bare
`"<module>:<action>"` string, so nothing on the port could name a tenant. Three consequences followed from
that single fact:

1. `CachedAccessControl` keyed decisions `authz:<principalId>:<permission>` in the one global Redis keyspace
   (`REDIS_KEY_PREFIX` is not per tenant): a decision made serving tenant A was served to tenant B.
2. `AdminGuard.ensure` wrote an audit record with no tenant (`AuditEvent.tenantId` existed and was optional;
   the guard never set it), so the trail could not say which tenant a decision was for.
3. `KetoAccessControl` checked `(permissions, <bare permission>, granted, <principal id>)`.

The comment above `CachedAccessControl` said the keys "stay correct without change" because "when
tenant-scoped grants arrive, the tenant is part of the permission object". That was a deferred plan
(`keto.ts` also names `tenant/<id>/<permission>` as the intended object shape), not a mistake, and it never
landed: `Permission` is still a string with no tenant, and the principal had none either.

**What the tuples carry (checked, not assumed).** They carry no tenant anywhere. All three seed scripts
(`scripts/dev/seed-auth-local.mjs:110`, `scripts/ops/seed-ory-network.mjs:191`,
`apps/e2e/scripts/seed-e2e-identities.mjs:171`) write `object = <bare permission>` and a bare principal id as
the subject. The Security service's projection (`relation-sync.consumer.ts:37-46` write, `:64-73` delete)
parses the tuple key `namespace:object#relation@subject` from the event and PUTs it to Keto verbatim: the
tenant reaches the Postgres row (`relationTuples.put(tuple, input.tenantId, tx)`,
`authz.use-cases.ts:41`) and is dropped on the way to Keto. The Ory Network OPL
(`infrastructure/ory/network/permissions.opl.ts`) is a flat `granted: User[]`. A grant is therefore global
per principal, and no TypeScript-only change can make it tenant-scoped.

## Decision

We take **shape B**: `tenantId` becomes a required field of `Principal`
(`packages/contracts/src/principal.ts`).

- **The tenant is bound once, by the transport, from the resolved tenant.** `executeRoute`
  (`packages/http/src/server.ts:360`) builds `{ ...identity, tenantId }` after tenant resolution and hands
  that to the guard, the rate limiter and handlers. Nothing defaults a tenant.
- **Authenticators return a tenant-less `AuthenticatedIdentity`** (`{ id, kind, roles }`). A verified token
  may carry no tenant claim (T10.5's G-69 made that a rejection, not a fallback), so an authenticator cannot
  honestly supply one. The two shapes are distinct types so that "an identity that has not been bound to a
  tenant yet" cannot be passed to anything that decides or records an authorization. `Principal` extends `AuthenticatedIdentity`.
- **The anonymous public principal carries the resolved request tenant.** It is the fixed identity
  `{ id: "public", kind: "customer", roles: [] }` (`PUBLIC_IDENTITY`, `server.ts:308`) bound per request to
  the tenant the storefront request resolved to (via `x-tenant-id` or the domain resolver), so the same
  `public` id in two tenants is two different principals for every cache key and audit record.
- **Fixed by this ADR:** the decision-cache key is `authz:<tenant>:<principal>:<permission>` with tenant and
  principal URI-encoded so an id containing `:` cannot forge another entry (`keto.ts:154`); `AdminGuard`
  records `principal.tenantId` on every decision (`admin-guard.ts:31`).
- **Not fixed by this ADR:** `KetoAccessControl` receives the tenant through the principal and builds the
  object in one method (`objectFor`, `keto.ts:76`), which **returns the bare permission today**. Passing the
  tenant changes no Keto decision until the tuples are qualified. That is **G-70**, and the reproduction is
  committed as an `it.fails()` (`packages/auth/src/keto-tenant-grants.test.ts`) so the gap is executable.
- **Target tuple shape (decided, not yet built):** `object = tenant/<tenantId>/<permission>`. Rollout, in
  the same expand → migrate → contract doctrine `packages/db/prisma/MIGRATIONS.md` §1 mandates for schema:
  (1) dual-write bare and qualified tuples, from all four writers together (the three seeds and
  `relation-sync.consumer.ts`); (2) switch reads (`objectFor`) to the qualified object; (3) delete the bare
  tuples. Step 3 needs someone with Ory access, because the real tuples live in the Ory Network project the
  `.env` points at; local dev uses `dsn: memory` and re-seeds on restart. **Between steps 2 and 3 a
  verification must count bare vs qualified tuples and refuse to proceed unless they match** — a missed
  tuple fails closed and locks an admin out, and this is the step most likely to be skipped later.

**The TTL, now the key is tenant-scoped (D-048).** The cache TTL (default 30s) is still the revocation-latency
window: a revoked grant stays effective for at most that long. What changes is granularity — a revocation is
per `(tenant, principal, permission)` entry, and one principal in N tenants holds N independent entries
that expire independently. Nothing about the window itself got shorter or longer.

## Consequences

- **Positive:** the cross-tenant cache leak and the tenant-less audit record are closed by one contract
  change that flows through every path taking a `Principal`. Forgetting the tenant is now a compile error,
  not a review finding. The zero-trust guard already took `context.tenantId`; it now agrees with the
  principal instead of being the only place that knew.
- **Negative / trade-offs:** `Principal` gained a required field, which touched about sixty test fixtures
  (each given the tenant its own context already named — none was defaulted) and split the authenticator
  port's return type. A `Principal` can no longer be constructed before a tenant is resolved; code that
  needs an actor earlier (e.g. the `security-runtime` system actor used only for audit attribution in
  `KratosSessionRevoker`) takes `AuthenticatedIdentity`.
- **Follow-ups:** **G-70** (the tuple model; Critical under `TENANT_MODE=multi`); G-68 (storage keys) is
  independent and still open. Until both close, `TENANT_MODE=multi` must not be enabled.

## Alternatives considered

- **A — tenant inside `Permission`** (what the stale comment proposed). Rejected: a permission is _what_
  (`orders:refund`) and a tenant is _where_; conflating them makes every permission literal tenant-aware
  and every call site build strings, and it leaves the audit record and the guard signature untouched, so
  it would have fixed one of three consequences.
- **C — a `tenantId` parameter on `authorize`.** Rejected: it works, but every caller must pass it and
  nothing stops one passing the wrong value, so it is a weaker invariant than B for more call-site churn,
  and the audit record would still need the tenant threaded separately.
- **A cache-key-only fix.** Rejected as the _whole_ answer: it would turn the leak test green while grants
  stay global per principal. It is taken as part of B, with the remaining gap named (G-70) and held
  executable rather than left implied.
