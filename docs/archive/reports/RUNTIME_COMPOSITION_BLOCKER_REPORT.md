# RUNTIME_COMPOSITION_BLOCKER_REPORT — P1.5 (C-01)

**Scope:** Runtime Composition Hardening (C-01) — replace remaining in-memory `wireX` compositions
with the existing production Prisma composition, wherever one already exists.
**Status:** 33 of 35 named contexts converted (see `P1_5_ORDERS_REPORT.md` through
`P1_5_WISHLIST_REPORT.md`, commits `75b6478`..`35e94b4`). **2 contexts blocked.**

---

## Affected contexts

- `analytics` (`services/analytics/src/composition.ts`, `wireAnalytics()`)
- `platform-console` (`services/platform-console/src/composition.ts`, `wirePlatformConsole()`)

## Exact blocker

Both composition functions take **zero dependencies** — not even an optional `prisma`/`tenantId`
pair — and neither one constructs a repository, a unit of work, or an outbox writer:

```ts
// services/analytics/src/composition.ts
export function wireAnalytics(): WiredAnalytics {
  const registry = new SemanticRegistry();
  registerFinanceSemantics(registry);
  return { console: new AnalyticsConsoleController({ registry }), registry };
}
```

```ts
// services/platform-console/src/composition.ts
export function wirePlatformConsole(): WiredPlatformConsole {
  const projection = new PlatformKpisProjection();
  const controller = new PlatformConsoleController(projection);
  return {
    platformConsole: controller,
    ingest: (eventType, payload) => projection.apply(eventType, payload),
  };
}
```

`apps/admin/src/composition.ts` calls both with no arguments (`wireAnalytics()`,
`wirePlatformConsole()`), confirming this isn't an oversight in this milestone's wiring — the
production admin graph itself never threads `deps` into either.

Cross-referenced against every other converted context's precondition: `services/*/src/
infrastructure/prisma-*.ts` exists for all 33 converted contexts (verified before starting each
one). **No such file exists for `analytics` or `platform-console`** — confirmed by directory
listing (`services/analytics/src/infrastructure/` and `services/platform-console/src/
infrastructure/`, neither contains a `prisma-*.ts`) and by the original C-01 file-level `grep`
that scoped this milestone.

## Why

- **Analytics** (`SemanticRegistry`) is a Finance-semantics **catalog**, not an aggregate store —
  it registers formula/dimension definitions in-process at boot (`registerFinanceSemantics`). There
  is no row-shaped domain entity to persist; "durable" for this context would mean a durable
  read-model store backed by ClickHouse, which is a separate, already-disclosed and deliberately
  gated concern (see `lumo-analytics-implementation` — ClickHouse/ Analytics V2 intentionally
  deferred, `361f771`). Building a Prisma repository for it now would mean inventing a persistence
  shape with no primary-source design behind it.
- **Platform Console** (`PlatformKpisProjection`) is a pure in-memory event-sourced projection fed
  by `ingest()` — explicitly documented in its own file as read-model-only, "nothing to drain,"
  awaiting "a later runtime milestone" to wire `ingest` onto the live event bus. There is no
  aggregate, no domain repository interface, nothing a `PrismaXRepository` could implement against.

## Why this cannot be completed without violating the brief

The brief for this milestone is explicit: _"Replace the remaining InMemory runtime composition with
the existing production (Prisma-backed) composition wherever production implementations already
exist,"_ and _"Do NOT introduce any new abstractions,"_ _"Do NOT create new repositories."_ Closing
these two would require designing a new domain repository interface, a new Prisma model/migration,
and a new mapper for each — i.e., exactly the "implementation," not "wiring," work the brief
excludes. Per the brief's own stop condition: _"a production implementation does not already
exist"_ → STOP and report, rather than invent one.

## State

**C-01 is closed for all 33 contexts where a production Prisma implementation already existed.**
The platform now has **37 of 39 bounded contexts** on durable persistence (4 pre-existing:
customer-360, feature-registry, finance, security; 33 landed in this milestone). The 2 remaining
gaps (analytics, platform-console) are disclosed here, not silently left in the original C-01
finding's undifferentiated "35 in-memory" count — they were never candidates for a pure composition
swap.

## Not in scope for this report (disclosed, not fabricated)

- The C-01 Step-1 boot-time `assertDurablePersistence` guardrail — never requested by this
  milestone's brief; `DURABLE_CONTEXTS` does not exist anywhere in this repo.
- Live-DB verification of any of the 33 conversions (G-41 — no reachable database host in this
  environment). Every conversion passed `pnpm typecheck`/`lint`/`test`/`arch` (76/76 packages,
  0 architecture violations) after each commit; `prisma migrate deploy` against a real Postgres 16
  is the first CI run of `db-integration.yml` (restored in P1.1), same as P1.4 recorded.
