import type { TransactionalUnitOfWork } from "@platform/repository";

/**
 * In-memory unit of work for the walking skeleton — runs the work with a no-op transaction
 * context. A real adapter (a Prisma interactive transaction) replaces this with the first
 * persistent context, at which point the outbox write becomes truly atomic with the state change.
 */
export class InMemoryUnitOfWork implements TransactionalUnitOfWork<unknown> {
  async run<T>(work: (context: unknown) => Promise<T>): Promise<T> {
    return work(undefined);
  }
}
