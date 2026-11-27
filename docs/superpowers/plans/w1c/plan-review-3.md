# Wave 1c plan review — round 3 (final convergence)

**R6 — RESOLVED. No blocking findings remain in this scoped review.**

## Scope and precedence

Reviewed only round 2's remaining R6 and contradictions that amendment precedence cannot resolve. Evidence: `plan-review-2.md:35–53,91–92` and `../2026-11-24-shopify-parity-w1c-segments.md:14,138–149`. R1–R5, R7–R8 and OPTIONAL R9–R12 are not reopened or upgraded.

The plan's line 14 establishes round 2 > round 1 > original task text, with later blocks winning within a task. Task 1's round-2 block explicitly overrides its round-1 block (line 147).

## R6 evidence

### A. Lock call shape — resolved

Task 1 line 148 now requires exactly:

```ts
await client.$executeRawUnsafe(
  "SELECT pg_advisory_xact_lock(hashtext($1))",
  "identity.customer_segments:" + tenantId,
);
```

It specifies the required transaction, unchanged tenant key and transaction-level lock, and lock → count → save ordering. It also requires a recording-client unit test asserting the exact lock call before count and insert. This adopts round 2's requested side-effect execution rather than the superseded `$queryRawUnsafe` result-decoding path.

### B. In-memory serialization — resolved

Task 1 line 149 requires the port's `withTenantSegmentsLock<T>(tenantId: string, fn: () => Promise<T>): Promise<T>`. The Prisma callback runs after the advisory lock in the same transaction, with the use case passing its transaction through. The in-memory implementation queues a per-tenant mutex around the asynchronous callback; `CreateCustomerSegment` runs count + save **inside** that callback, within its UoW. The critical section therefore covers the awaited operations rather than ending before them.

The same line requires the in-memory parallel-at-99 oracle: one successful create, one BUSINESS_RULE, final count 100, tenant B unaffected. The disposable-DB concurrency oracle at line 142 remains applicable; the newer block replaces the defective mechanism, not that test requirement.

### Precedence check

The earlier `lockTenantSegments` wording, `$queryRawUnsafe` call and immediate/no-op memory lock at line 142 are superseded. The operative callback contract and count/save placement are explicit in the later round-2 instruction. They are not additional mandatory alternatives to the callback-based critical section. No contradiction remains that the stated precedence cannot resolve.

## Verification and boundaries

Read AGENTS.md, the plan, round-2 review and Opus triage, and the existing `InMemoryUnitOfWork` implementation (`services/identity/src/infrastructure/in-memory-unit-of-work.ts:4–6`), which only invokes its callback. The amended plan explicitly accounts for that existing behavior with the repository-owned callback mutex.

This is acceptance of the amended plan, not certification of an implemented lock or passing concurrency tests. No pnpm, build, test suite, database operation, source edit or git write was performed. Only this review file was created.

VERDICT: AGREED
