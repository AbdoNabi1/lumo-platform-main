import { runReadScoped, type Database, type TransactionClient } from "@platform/db";

/** ADR-0014 point 3: reuse the caller's `tx` when given (it is already tenant-scoped by the unit of
 * work), else scope the read via `runReadScoped(prisma, tenantId, …)` — the same shape
 * `PrismaWishlistRepository` uses for every read. */
export function readScoped<T>(
  prisma: Database,
  tenantId: string,
  tx: unknown,
  run: (client: TransactionClient) => Promise<T>,
): Promise<T> {
  return tx !== undefined && tx !== null
    ? run(tx as TransactionClient)
    : runReadScoped(prisma, tenantId, run);
}
