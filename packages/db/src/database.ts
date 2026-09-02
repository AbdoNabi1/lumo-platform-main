import type { DatabaseConfig } from "@platform/config/server";
import type { HealthCheck } from "@platform/health";
import { createPrismaClient, type Database } from "./client";
import { createDatabaseHealthCheck } from "./health";
import { runInTransaction, type TransactionClient, type TransactionOptions } from "./transaction";

/** A managed database handle: client, transaction runner, health probe, and lifecycle. */
export interface DatabaseHandle {
  readonly prisma: Database;
  transaction<T>(
    fn: (tx: TransactionClient) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;
  healthCheck(): HealthCheck;
  disconnect(): Promise<void>;
}

/** Composition root for the database infrastructure (dependency-injected config). */
export function createDatabase(config: DatabaseConfig): DatabaseHandle {
  const prisma = createPrismaClient(config);
  return {
    prisma,
    transaction: (fn, options) => runInTransaction(prisma, fn, options),
    healthCheck: () => createDatabaseHealthCheck(prisma),
    disconnect: () => prisma.$disconnect(),
  };
}
