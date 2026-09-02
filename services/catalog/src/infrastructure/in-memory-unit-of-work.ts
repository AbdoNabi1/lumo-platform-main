import type { TransactionalUnitOfWork } from "@platform/repository";

/**
 * In-memory unit of work — runs the work with a no-op transaction context. A Prisma adapter
 * replaces this (outbox written atomically with state) when the database is wired.
 */
export class InMemoryUnitOfWork implements TransactionalUnitOfWork<unknown> {
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    return work(undefined);
  }
}
