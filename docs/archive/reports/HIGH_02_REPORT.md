# HIGH-02 — Audit Trail Persistence

**Source finding:** `H2-1` in `FINAL_PRODUCTION_READINESS_AUDIT_v2.md` — _"The production audit trail is
in-memory; the durable adapter exists and is unwired."_
**Type:** Remediation. Code changed. **Public contract impact: none** (an already-optional field is now
populated; nothing is added or removed from any exported type).

---

## 1. Investigate

- `apps/admin/src/http/server.ts:64-68` — `createAdminHttpApi` builds `AdminGuard` with
  `auditTrail: deps.auditTrail ?? new InMemoryAuditTrail()`.
- `apps/admin/src/composition.ts:129,347-348` — `AdminWiringDeps.auditTrail?: AuditTrail` already
  exists as an optional field; `wireAdmin` applies the same `?? new InMemoryAuditTrail()` fallback.
- `apps/runtime/src/api.ts` (before this change) — the object literal passed to `createAdminHttpApi`
  did not include `auditTrail` at all.
- `packages/db/src/audit/prisma-audit-trail.ts:12` — `PrismaAuditTrail implements AuditTrail`, already
  exported from `packages/db/src/index.ts:11`.
- `packages/db/prisma/schema/platform.prisma` — the `platform.audit_events` table already exists.
- `infrastructure/docker/redpanda/bootstrap-topics.sh` — `platform.audit.entry_recorded.v1` already
  exists with 7-year retention.

Every authorization decision on every admin action (`AdminGuard.ensure`, `apps/admin/src/interfaces/
admin-guard.ts:26-42` — records both `allow` and `deny`) was written to
`apps/admin/src/infrastructure/in-memory-audit-trail.ts`'s process-local array: destroyed on every
restart/rollout, and an unbounded in-process memory leak against the container's memory limit. The
durable adapter, the table, and the retention topic all already existed — the wiring was one field.

## 2. Prove

Added `apps/runtime/src/api.h-02-audit-trail-regression.test.ts`, following the existing mock-and-
inspect-the-call convention from `api.v1-guard-regression.test.ts` (mocks `@platform/admin`'s
`createAdminHttpApi` and inspects the deps object `startApi()` actually passes it — the only way to
observe this without changing `startApi`'s signature). Before this change the test would have failed
with `deps.auditTrail` being `undefined`.

## 3. Implement

`apps/runtime/src/api.ts` — imported `PrismaAuditTrail` from `@platform/db` and added
`auditTrail: new PrismaAuditTrail(runtime.prisma, runtime.idGenerator)` to the `createAdminHttpApi` call,
alongside the existing `paymentVerification` wiring in the same object literal.

## 4. Run

| Gate             | Result                                                             |
| ---------------- | ------------------------------------------------------------------ |
| `pnpm typecheck` | ✅ 76/76                                                           |
| `pnpm lint`      | ✅ 76/76                                                           |
| `pnpm test`      | ✅ 76/76 tasks; `@platform/runtime` 27 files / 127 tests (was 126) |
| `pnpm arch`      | ✅ no dependency violations (1,531 modules, 6,672 deps)            |

## 5. Scope discipline

No architecture change, no new bounded context, no public API change — `AuditTrail` and `AdminHttpDeps`
are both unchanged; `auditTrail` was already an optional field on `AdminWiringDeps`, only unused by
`apps/runtime`. `InMemoryAuditTrail` remains the correct default for tests and any caller that does not
supply one (e.g. `apps/admin`'s own composition when used standalone).
