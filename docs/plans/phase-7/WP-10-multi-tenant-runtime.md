# WP-10 — Make the runtime actually multi-tenant

> **Read first:** [`../README.md`](../README.md) and [`README.md`](README.md), completely.
> **Depends on:** nothing. **Conflicts with:** WP-3, WP-5, WP-6, WP-7, WP-9 (`composition.ts`).
> **Closes:** G-53. This is the largest architectural change in Phase 7 — treat its ADR as the deliverable that matters most.

## Why this exists

Morbeh is sold as a SaaS. The database is built for it. The runtime is not, and it says so out loud.

`apps/runtime/src/composition.ts:134-146`:

```ts
// C2-6: every wireX({ prisma, tenantId }) branch pins its repositories to ONE tenantId at
// construction (ADR-0008), never per request. There is no per-request re-composition, so
// TENANT_MODE=multi would boot successfully and then either silently mis-scope every
// non-default-tenant request to TENANT_DEFAULT_ID's rows (if the HTTP tenant guard were absent)
// or reject every one of them (with it present) — neither is multi-tenancy. Fail closed at boot
// rather than advertise a mode nothing here implements.
if (config.TENANT_MODE === "multi") {
  throw new Error("Runtime composition does not support TENANT_MODE=multi: …");
}
```

That comment is correct, honest, and the right call for its time. It is also the thing standing
between this platform and its business model.

**Everything below the runtime is already tenant-aware:**

- ADR-0008 decided the model: tenant-aware core, pooled default, tiered isolation.
- Every business table carries `tenant_id` with tenant-led unique constraints (sprint 2.1).
- Every Prisma repository is tenant-scoped (sprint 2.2).
- `packages/http`'s pipeline resolves the tenant **first**, via a header/claim/domain chain
  (sprint 2.6).
- The event envelope carries `tenantId` (sprint H.1, ADR-0004).
- Storage keys are tenant-prefixed: `tenants/<t>/<ns>/<yyyy>/<mm>/<uuid>` (sprint 2.4).
- `services/tenancy` exists.

**The single missing piece is composition.** The object graph is built once, at boot, with one
tenant baked in.

## The decision you must make — and its two candidates

This is a genuine architectural fork. Pick one, and write the ADR **before** the code.

**Option A — per-request repository scoping.** Repositories stop capturing `tenantId` at
construction and instead take it from the transaction/request context that is already threaded
through every repository port and use case (ADR-0003 did that threading in sprint H.1 — read it).
The object graph stays a singleton.
_Cost:_ touching every repository signature — ~40 contexts.
_Benefit:_ one graph, constant memory, no cold start per tenant, and the change is mechanical and
uniformly verifiable.

**Option B — a per-tenant composition cache.** Build (and LRU-cache) one graph per tenant, resolved
per request from the tenant the HTTP pipeline already determined.
_Cost:_ memory grows with active tenants; a cold tenant pays construction latency; the cache becomes
a correctness surface (eviction, invalidation on config change) and a place tenants can leak into
each other.
_Benefit:_ far smaller diff.

**Recommendation: Option A.** The threading it needs already exists, it has no per-tenant runtime
state to get wrong, and the failure mode of Option B — a stale or mis-keyed cached graph serving one
tenant another's repositories — is exactly the failure this whole WP exists to prevent. Take Option B
only if you find a concrete blocker in Option A, and record that blocker in the ADR.

## Tasks

- [ ] **T10.1 — Read before touching anything.**
      ADR-0008 (tenancy), ADR-0003 (transaction context threading), ADR-0004 (tenant-ready
      envelope); `apps/runtime/src/composition.ts` in full; `packages/http`'s tenant-resolution
      chain; `services/tenancy/src/`; two or three Prisma repositories across different contexts to
      see how uniform the `tenantId` capture actually is (assume it is not perfectly uniform, and
      find the exceptions early — they are what will overrun the estimate).

- [ ] **T10.2 — Write the ADR first.** New ADR in `docs/architecture/`, registered in
      `docs/DECISIONS.md`: the option chosen, why, the migration path, and how tenant isolation is
      _verified_ rather than assumed. Do not start T10.3 until this is written — this is the one
      task in Phase 7 where doing the code first will cost more than it saves.

- [ ] **T10.3 — Implement it.**
      Mechanically, context by context. Keep the gates green between contexts rather than at the
      end; a 40-context change that only compiles at the end is unreviewable and unbisectable.
      Every non-uniform repository you find is worth a note in the ADR.

- [ ] **T10.4 — Remove the boot refusal, and replace it with a real guard.**
      Deleting the `TENANT_MODE === "multi"` throw is the last step, not the first. What replaces it
      is a boot-time assertion that per-request tenant resolution is actually wired: a request
      arriving with no resolvable tenant must be **rejected**, never defaulted to
      `TENANT_DEFAULT_ID`. Silent defaulting is how one tenant reads another's data.

- [ ] **T10.5 — Tenant isolation tests. This is the deliverable.**
      Not a smoke test — an adversarial one. For a representative set of contexts: - Tenant A's request cannot read, write, or _count_ tenant B's rows. - A forged tenant header does not override the tenant from a verified claim. - An event published under tenant A is not consumed into tenant B's projections. - A storage key written by tenant A is unreachable from tenant B. - A cache entry (`packages/redis`) populated by tenant A is not served to tenant B —
      check `REDIS_KEY_PREFIX` handling, because a shared cache is the classic leak that survives
      a perfectly tenant-scoped database. - An idempotency key from tenant A does not suppress tenant B's identical request. - A rate-limit bucket is not shared across tenants.
      Write these as a reusable suite, not one-offs, so a new context can be added to it cheaply.

- [ ] **T10.6 — Tenant lifecycle.**
      Provisioning a tenant (create the row, seed defaults, register the domain), suspending one,
      and deleting one — including what deletion means for data the platform is legally required to
      erase. G-32 (tenant lifecycle ops) and G-25 (GDPR erasure runbook) are both open; this task
      may only _narrow_ them. Say precisely what you closed and what you did not.

- [ ] **T10.7 — Cross-cutting sweep.**
      Walk every shared singleton in the runtime and ask "is this keyed by tenant?": metrics labels,
      log context, health checks, the scheduler's jobs (a job that runs "for the tenant" must now
      run per tenant), the outbox relay, consumer runtimes, feature flags
      (`packages/feature-flags` supports org-level targeting — verify it is actually resolved
      per request), and entitlements (`packages/entitlement` is explicitly tenant×feature — verify).

## Definition of done

- [ ] `TENANT_MODE=multi` boots, and two tenants serve correct, isolated data through the same process.
- [ ] Every test in T10.5 passes, and each one **fails** if you deliberately remove the guard it
      covers. A tenant-isolation test that cannot fail is worse than none.
- [ ] A request with no resolvable tenant is rejected, never defaulted.
- [ ] The ADR is written, registered, and matches what the code does.
- [ ] G-53 closed; G-23/G-32/G-38 updated with what actually changed.
- [ ] Repo-wide gates green, plus `pnpm arch`.

## Known traps

- **The database is the easy half.** Every leak you will find is somewhere else: Redis keys, the
  cache, idempotency keys, rate-limit buckets, metrics labels, object-storage prefixes, the search
  index, ClickHouse (WP-3 — its sort key must lead with `tenant_id`), log context, and any
  in-process memoisation someone added for speed.
- **Do not default a missing tenant.** Ever. Reject.
- **Do not make `tenantId` a parameter the caller can pass freely.** It comes from the verified
  principal or the resolved domain, through the request context — never from a body field, a query
  parameter, or an argument an LLM tool could supply (see WP-5).
- **This WP will surface unrelated bugs.** Anything that quietly assumed one tenant will break.
  Record each one in `BLOCKERS.md` rather than expanding scope to fix them all here.
