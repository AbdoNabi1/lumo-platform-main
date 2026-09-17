import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Customer } from "../domain/customer";
import type { CustomerListQuery, CustomerRepository } from "../domain/customer-repository";
import { CustomerMapper } from "./customer.mapper";

export interface PrismaCustomerRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

/**
 * Production `CustomerRepository` on the `identity` schema. Email uniqueness is the
 * `(tenant_id, email)` unique index — the database, not a scan, is the arbiter (D-032 repaid).
 * Addresses and the consent log are append-only inserts (`skipDuplicates`); the consent log is
 * never updated or deleted. Optimistic locking + same-transaction outbox per ADR-0003.
 */
export class PrismaCustomerRepository implements CustomerRepository {
  private readonly deps: PrismaCustomerRepositoryDeps;

  constructor(deps: PrismaCustomerRepositoryDeps) {
    this.deps = deps;
  }

  async save(customer: Customer, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const customerId = customer.id.toString();

    if (customer.version === 0) {
      await client.customer.create({ data: CustomerMapper.toCustomerRow(customer, tenantId) });
    } else {
      const updated = await client.customer.updateMany({
        where: { id: customerId, tenantId, version: customer.version },
        data: { name: customer.name, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Customer ${customerId} was modified concurrently (expected version ${customer.version})`,
        );
      }
    }
    const addresses = CustomerMapper.toAddressRows(customer, tenantId);
    if (addresses.length > 0) {
      await client.address.createMany({ data: addresses, skipDuplicates: true });
    }
    const consents = CustomerMapper.toConsentRows(customer, tenantId);
    if (consents.length > 0) {
      await client.consentRecord.createMany({ data: consents, skipDuplicates: true });
    }

    await this.deps.outbox.write(customer.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tenantId: string, tx?: unknown): Promise<Customer | null> {
    const run = (client: TransactionClient) =>
      client.customer.findFirst({
        where: { id, tenantId, deletedAt: null },
        include: {
          addresses: { orderBy: { createdAt: "asc" } },
          consents: { orderBy: { occurredAt: "asc" } },
        },
      });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : CustomerMapper.toDomain(row, row.addresses, row.consents);
  }

  async findByEmail(email: string, tenantId: string, tx?: unknown): Promise<Customer | null> {
    const run = (client: TransactionClient) =>
      client.customer.findFirst({
        where: { tenantId, email, deletedAt: null },
        include: {
          addresses: { orderBy: { createdAt: "asc" } },
          consents: { orderBy: { occurredAt: "asc" } },
        },
      });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : CustomerMapper.toDomain(row, row.addresses, row.consents);
  }

  /**
   * Most-recently-registered-first cursor page. Sorts on `id` (UUIDv7, time-ordered — D-022),
   * same technique as `PrismaOrderRepository.list`. `search` matches name or email
   * (case-insensitive substring).
   */
  async list(
    query: CustomerListQuery,
    tenantId: string,
    tx?: unknown,
  ): Promise<Paginated<Customer>> {
    const limit = normalizePageSize(query.first);
    const after = query.after !== undefined ? decodeCursor(query.after) : undefined;
    const search = query.search?.trim();
    const searchFilter =
      search !== undefined && search.length > 0
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {};

    const run = (client: TransactionClient) =>
      client.customer.findMany({
        where: {
          tenantId,
          deletedAt: null,
          ...(after !== undefined ? { id: { lt: after } } : {}),
          ...searchFilter,
        },
        include: {
          addresses: { orderBy: { createdAt: "asc" } },
          consents: { orderBy: { occurredAt: "asc" } },
        },
        orderBy: { id: "desc" },
        take: limit + 1,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);

    const customers = rows.map((row) => CustomerMapper.toDomain(row, row.addresses, row.consents));
    return buildPaginatedPage(customers, limit, (customer) => customer.id.toString());
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaCustomerRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
