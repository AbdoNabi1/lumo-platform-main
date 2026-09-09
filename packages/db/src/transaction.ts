import type { Prisma, PrismaClient } from "@prisma/client";

/** Transaction-scoped client (Prisma interactive transaction handle). */
export type TransactionClient = Prisma.TransactionClient;

export interface TransactionOptions {
  readonly maxWaitMs?: number;
  readonly timeoutMs?: number;
}

/**
 * Runs `fn` inside a database transaction (Prisma interactive transaction).
 * Automatically rolls back if `fn` rejects.
 */
export function runInTransaction<T>(
  prisma: PrismaClient,
  fn: (tx: TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  return prisma.$transaction(fn, {
    maxWait: options.maxWaitMs,
    timeout: options.timeoutMs,
  });
}

/**
 * ADR-0014: runs `fn` inside a Prisma interactive transaction with `app.tenant_id` set for its
 * duration — `set_config('app.tenant_id', $1, true)` as the FIRST statement, before `fn` sees the
 * transaction client. The third `set_config` argument (`true`) makes the setting transaction-local
 * (`SET LOCAL` semantics): it is visible only inside this transaction and is discarded on
 * commit/rollback, so it never leaks onto a pooled connection Prisma's own client-side pool later
 * hands to an unrelated caller.
 *
 * Parameterized via `$executeRaw`'s tagged-template form — `tenantId` is bound, never
 * string-interpolated into SQL text.
 *
 * This is the "SET LOCAL wrapper" ADR-0014 point 2 describes for writes (reused by
 * `PrismaUnitOfWork` once that call site is converted) and the primitive `runReadScoped` below
 * builds on for reads.
 */
export function runInTenantTransaction<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    },
    {
      maxWait: options.maxWaitMs,
      timeout: options.timeoutMs,
    },
  );
}

/**
 * ADR-0014 point 3: the read-side counterpart to `runInTenantTransaction`, for call sites that need
 * no multi-statement atomicity — only the tenant-scoping side effect `app.tenant_id` provides once
 * the connection role is RLS-enforcing (ADR-0014 Phase 2). Every read call site converted under
 * WP-10/T10.3 routes through this instead of a bare `prisma.<model>.findX(...)`; see ADR-0014's
 * benchmark amendment (2026-09-09) for the measured cost of doing so and the fallback if it proves
 * too high.
 */
export function runReadScoped<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  return runInTenantTransaction(prisma, tenantId, fn);
}

/**
 * ADR-0014 (2026-09-09 amendment — "try the cheaper implementation first" before deciding the
 * `runReadScoped` fallback): the SAME tenant-scoping effect as `runReadScoped`, via Prisma's
 * `$transaction([...])` ARRAY form instead of the interactive `async (tx) => {...}` form.
 *
 * Why this can be cheaper: the interactive form is a genuinely round-trip-serial protocol — the
 * engine opens the transaction and then waits for the client's next instruction before sending
 * anything else to Postgres, because it cannot know in advance whether `fn` will run one query or
 * ten, or branch on the first query's result. `BEGIN`, `SET LOCAL`, the query, and `COMMIT` are
 * therefore four round trips awaited in sequence. The array form gives the engine every statement
 * up front, so it does not need to round-trip back to the JS event loop between them — it can
 * pipeline `BEGIN` + both statements + `COMMIT` without waiting on Node.
 *
 * **Hard constraint the caller must respect: no application logic can run between the two
 * statements.** `operation` must be a single, already-constructed Prisma operation (e.g.
 * `prisma.product.findMany({...})`, called but NOT awaited — a lazy `PrismaPromise`) with nothing
 * to branch on before it runs. A read call site that needs to inspect one query's result before
 * deciding the next one is NOT a candidate for this form; keep `runReadScoped`'s interactive form
 * for those, and confirm the call site is genuinely single-query before switching it to this one.
 *
 * Not yet wired into any repository — this exists to be benchmarked against `runReadScoped` before
 * ADR-0014's fallback decision is made, per that amendment. See the ADR for the comparative numbers
 * once measured; do not assume this is faster without reading them.
 */
export function runReadScopedBatched<T>(
  prisma: PrismaClient,
  tenantId: string,
  operation: Prisma.PrismaPromise<T>,
): Promise<T> {
  return prisma
    .$transaction([
      prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
      operation,
    ])
    .then(([, result]) => result);
}
