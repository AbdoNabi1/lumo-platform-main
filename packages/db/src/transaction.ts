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
