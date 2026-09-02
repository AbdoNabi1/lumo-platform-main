# H-01 — Production audit trail is in-memory; the compliant Prisma adapter exists and is never constructed

| Field                      | Value                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**               | High                                                                                                                                   |
| **Area**                   | Security / Compliance / Reliability (memory)                                                                                           |
| **Baseline**               | `main` @ `756bce3`                                                                                                                     |
| **Blocker verdict**        | **True blocker.** Not a deferral — the production adapter, its table, and its indexes all exist. Only the constructor call is missing. |
| **Public contract change** | **No.**                                                                                                                                |

---

## 1. Location

| File                                                     | Lines         | What is there                                                     |
| -------------------------------------------------------- | ------------- | ----------------------------------------------------------------- |
| `apps/admin/src/http/server.ts`                          | 37            | `auditTrail: deps.auditTrail ?? new InMemoryAuditTrail()`         |
| `apps/admin/src/composition.ts`                          | 323           | `const auditTrail = deps.auditTrail ?? new InMemoryAuditTrail();` |
| `apps/admin/src/composition.ts`                          | 119–123       | `readonly auditTrail?: AuditTrail;` — the optional seam           |
| `apps/admin/src/infrastructure/in-memory-audit-trail.ts` | 8–13          | The in-memory implementation                                      |
| `apps/admin/src/interfaces/admin-guard.ts`               | 28–34         | Records every decision, allow and deny                            |
| `apps/runtime/src/api.ts`                                | 31–47         | **Does not pass `auditTrail`**                                    |
| `packages/db/src/audit/prisma-audit-trail.ts`            | 12–35         | The production adapter — **zero construction sites**              |
| `packages/db/src/index.ts`                               | 11            | `export { PrismaAuditTrail } from "./audit/prisma-audit-trail";`  |
| `packages/db/prisma/schema/platform.prisma`              | ~60–75        | `AuditEvent` model, `@@map("audit_events")`                       |
| `.../migrations/20260704000000_init/migration.sql`       | 328, 465, 468 | Table + two indexes already created                               |

---

## 2. Current implementation

Every admin authorization decision is audited — this part is correct and deliberate:

```ts
// apps/admin/src/interfaces/admin-guard.ts:26-34
async ensure(principal: Principal, permission: Permission): Promise<AdminResponse | null> {
  const allowed = await this.deps.accessControl.authorize(principal, permission);
  await this.deps.auditTrail.record({
    principalId: principal.id,
    principalKind: principal.kind,
    permission,
    decision: allowed ? "allow" : "deny",
    occurredAt: this.deps.clock.now().toISOString(),
  });
  ...
```

The sink is an optional dependency with an in-memory default:

```ts
// apps/admin/src/http/server.ts:35-39
const guard = new AdminGuard({
  accessControl: deps.accessControl ?? new AllowAllAccessControl(),
  auditTrail: deps.auditTrail ?? new InMemoryAuditTrail(),
  clock: deps.clock,
});
```

`apps/runtime/src/api.ts:31-47` passes `accessControl`, `prisma`, `tenantId`, `paymentVerification`, `health`, `rateLimiter`, `idempotencyKeys`, and `responseCache` — **but not `auditTrail`.** So production resolves to:

```ts
// apps/admin/src/infrastructure/in-memory-audit-trail.ts:3-13
/**
 * In-memory `AuditTrail` for local development and tests — append-only, never pruned. The
 * production adapter (Phase 2) appends through the transactional outbox as
 * `audit.entry.recorded` into 7-year archival storage (doc 20 §14, ADR-0009).
 */
export class InMemoryAuditTrail implements AuditTrail {
  private readonly entries: AuditEvent[] = [];
  async record(event: AuditEvent): Promise<void> { this.entries.push(event); }
```

The production adapter it refers to **already exists and is complete**:

```ts
// packages/db/src/audit/prisma-audit-trail.ts:12-34
export class PrismaAuditTrail implements AuditTrail {
  constructor(prisma: Database, idGenerator: IdGenerator) { ... }

  async record(event: AuditEvent): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        id: this.idGenerator.generate(),
        principalId: event.principalId,
        principalKind: event.principalKind,
        permission: event.permission,
        decision: event.decision,
        occurredAt: new Date(event.occurredAt),
        ...(event.tenantId !== undefined ? { tenantId: event.tenantId } : {}),
        ...(event.metadata !== undefined ? { metadata: { ...event.metadata } } : {}),
      },
    });
  }
}
```

```
$ git grep -n "PrismaAuditTrail" -- '*.ts'
packages/db/src/audit/prisma-audit-trail.ts:12:export class PrismaAuditTrail implements AuditTrail {
packages/db/src/index.ts:11:export { PrismaAuditTrail } from "./audit/prisma-audit-trail";
```

Two hits: the class and its re-export. **Never constructed.**

The backing table exists with the right indexes, already created by the initial migration:

```sql
-- migrations/20260704000000_init/migration.sql:328, 465, 468
CREATE TABLE "platform"."audit_events" (...);
CREATE INDEX "audit_events_tenant_id_occurred_at_idx" ON "platform"."audit_events"("tenant_id", "occurred_at");
CREATE INDEX "audit_events_principal_id_occurred_at_idx" ON "platform"."audit_events"("principal_id", "occurred_at");
```

---

## 3. Why it is incorrect

Everything required is present except one constructor call.

1. **The default is an unsafe fallback in a production path.** `?? new InMemoryAuditTrail()` is the right shape for tests and `local`. In production it silently substitutes a `void` sink for a compliance control. Compare `apps/runtime/src/composition.ts:111-119`, which refuses to fall back to permissive authorization outside `local` — the same discipline was not applied to auditing.
2. **The in-memory implementation is explicitly labelled unsuitable.** Its own docblock says _"for local development and tests — append-only, never pruned"_ and names the production adapter that should replace it. That adapter now exists; the comment was never updated and the wiring was never done.
3. **`InMemoryAuditTrail` is unbounded by construction.** `private readonly entries: AuditEvent[] = []` with `push` and no eviction. This is a plain memory leak on the hottest path in the API.
4. **Two independent instances are created per API process** (`server.ts:37` and `composition.ts:323`, see L-4), so the leak is doubled and the two trails hold different subsets.

---

## 4. Production impact

**(a) Compliance loss.** `packages/db/src/audit/prisma-audit-trail.ts:5-8` states the requirement: _"Append-only by contract … there is deliberately no update/delete path (SOC2 CC7 / PCI DSS 10.x)."_ ADR-0009 mandates an immutable trail. In production today the trail is destroyed on every restart, rollout, OOM, and scale-in — and with `replicas: 2` (`infrastructure/k8s/20-deployment-api.yaml:12`) each pod holds a different fragment, so no complete record exists anywhere even while running. A "who authorized what" question after an incident is unanswerable.

**(b) Guaranteed OOM.** One array entry per authorized admin request, never evicted, in a container limited to `memory: 512Mi` (`20-deployment-api.yaml`). At a modest 10 req/s of admin traffic and ~200 bytes per entry, this is ~170 MB/day _per instance_ — on top of the 35 in-memory context repositories (C-01) sharing the same heap. The pod OOMs, Kubernetes restarts it, and the restart destroys the application state described in C-01. **H-01 is therefore also the most likely trigger for C-01's data loss.**

**(c) Silent failure.** Nothing logs, warns, or reports that the audit sink is non-durable. `AdminGuard`'s contract is that _"an audit-write failure fails the action"_ (`admin-guard.ts:16-17`) — and `InMemoryAuditTrail.record` never fails, so the safety property holds vacuously.

---

## 5. Smallest additive fix

**Two lines.** This is the smallest fix in the entire audit.

```ts
// apps/runtime/src/api.ts
import { PrismaAuditTrail } from "@platform/db";   // already exported

const app = await createAdminHttpApi({
  ...
  prisma: runtime.prisma,
  tenantId: runtime.config.TENANT_DEFAULT_ID,
  auditTrail: new PrismaAuditTrail(runtime.prisma, runtime.idGenerator),   // ← the fix
  paymentVerification: new PrismaPaymentVerificationAdapter(...),
});
```

`@platform/db` is already a dependency of `apps/runtime` (`apps/runtime/package.json`), and `PrismaAuditTrail` is already exported. No new dependency, no new file.

### Recommended companions (small, additive)

1. **Fail closed outside `local`**, matching the existing precedent at `apps/runtime/src/composition.ts:111-119`:
   ```ts
   if (deps.auditTrail === undefined && config.APP_ENV !== "local") {
     throw new Error("A durable AuditTrail is required outside APP_ENV=local (ADR-0009).");
   }
   ```
2. **Collapse the duplicate guard** (L-4): `createAdminHttpApi` builds one `AdminGuard` at `server.ts:35` and `wireAdmin` builds another at `composition.ts:324`. Pass one through rather than constructing two.
3. **Update the stale comment** at `in-memory-audit-trail.ts:3-6` — it says the production adapter appends _"through the transactional outbox as `audit.entry.recorded`"_, but `PrismaAuditTrail` writes directly to `platform.audit_events`. Reconcile the doc with the shipped design.

---

## 6. Public contract impact

**None.**

- `AuditTrail` (`@platform/contracts`) is unchanged. `PrismaAuditTrail` already `implements` it.
- `AdminWiringDeps.auditTrail` is already declared optional (`apps/admin/src/composition.ts:123`) — the fix supplies a value that the interface already accepts.
- No HTTP route, response shape, event schema, or package export changes.
- The optional fail-closed check changes boot behaviour only outside `APP_ENV=local`, leaving tests and local development identical.

---

## 7. Blocker or intentional deferral?

**True blocker, and no longer a valid deferral.**

It _was_ a deferral. `in-memory-audit-trail.ts:3-6` says _"The production adapter (Phase 2)…"_ and `apps/admin/src/composition.ts:119-123` says the in-memory trail is the default _"until the real provider is wired"_. That was reasonable when the adapter did not exist.

**The adapter now exists, the table exists, the indexes exist, and the export exists.** The deferral has been overtaken by its own resolution — only the two-line wiring was missed. `docs/KNOWN_GAPS.md` has no open gap for it (G-24/25/26/27 cover _outcome_ audit, GDPR erasure, retention automation, and PCI scope — not this).

Given the fix is two lines against already-shipped, already-tested infrastructure, and given the consequence is an unbounded memory leak plus loss of a SOC2/PCI control, this is a blocker.

---

## 8. How this was verified

- `git grep -n "PrismaAuditTrail" -- '*.ts'` → 2 hits (class + re-export). Zero construction sites.
- `git grep -n "auditTrail" -- 'apps/**/*.ts'` (tests excluded) → 6 hits; `apps/runtime` never supplies one.
- `packages/db/src/audit/prisma-audit-trail.ts` read in full (35 lines).
- `apps/admin/src/infrastructure/in-memory-audit-trail.ts` read in full (19 lines).
- `apps/admin/src/interfaces/admin-guard.ts` read in full (43 lines).
- `apps/admin/src/http/server.ts` read in full (62 lines); `apps/runtime/src/api.ts` read in full (66 lines).
- `git grep -n "audit_events" -- '*.prisma' '*.sql'` → model + table + 2 indexes present since the init migration.
- No code was modified.
