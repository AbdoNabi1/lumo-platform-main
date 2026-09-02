import type { PrismaClient } from "@prisma/client";
import type { Repository, TransactionalUnitOfWork } from "@platform/repository";
import { runInTransaction, type TransactionClient, type TransactionOptions } from "./transaction";

/**
 * Foundation for Prisma-backed repositories. Concrete repositories (later sprints) extend this
 * and bind it to a specific model delegate; this base supplies the injected client and a
 * transaction helper. It implements the persistence port from `@platform/repository`, so the
 * application layer depends only on the port — never on Prisma.
 */
export abstract class PrismaRepository<TEntity, TId> implements Repository<TEntity, TId> {
  protected readonly prisma: PrismaClient;

  protected constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  abstract findById(id: TId): Promise<TEntity | null>;
  abstract save(entity: TEntity): Promise<TEntity>;
  abstract delete(id: TId): Promise<void>;

  protected withTransaction<T>(
    work: (tx: TransactionClient) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    return runInTransaction(this.prisma, work, options);
  }
}

/**
 * Prisma-backed transactional unit of work: runs `work` inside a Prisma interactive transaction,
 * exposing the transaction-scoped client as the context (implements `TransactionalUnitOfWork`).
 */
export class PrismaUnitOfWork implements TransactionalUnitOfWork<TransactionClient> {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  run<T>(work: (context: TransactionClient) => Promise<T>): Promise<T> {
    return runInTransaction(this.prisma, work);
  }
}
