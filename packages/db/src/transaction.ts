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
