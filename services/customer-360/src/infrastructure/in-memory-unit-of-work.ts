import type { TransactionalUnitOfWork } from "@platform/repository";

/**
 * In-memory unit of work for dev/test. Runs the work with a no-op transaction context; the Prisma
 * adapter (`PrismaUnitOfWork`, `@platform/db`) replaces this in production, at which point the
 * outbox write becomes truly atomic with the graph/decision writes.
 */
export class InMemoryUnitOfWork implements TransactionalUnitOfWork<unknown> {
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    return work(undefined);
  }
}
