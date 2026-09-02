import type { Database, TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Price } from "../domain/price";
import type { PriceRepository } from "../domain/price-repository";
import type { PriceList } from "../domain/price-list";
import type { PriceListRepository } from "../domain/price-list-repository";
import { PriceListMapper, PriceMapper } from "./pricing.mappers";

export interface PrismaPricingRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  /** Tenant scope for every query (ADR-0008 §2) — injected by the composition root. */
  readonly tenantId: string;
}

function requireTx(tx: unknown, repo: string): TransactionClient {
  if (tx === undefined || tx === null) {
    throw new Error(`${repo}.save requires the unit of work's transaction client (ADR-0003).`);
  }
  return tx as TransactionClient;
}

/** Production `PriceRepository` on the `pricing` schema (ADR-0003 locking + same-tx outbox). */
export class PrismaPriceRepository implements PriceRepository {
  private readonly deps: PrismaPricingRepositoryDeps;

  constructor(deps: PrismaPricingRepositoryDeps) {
    this.deps = deps;
  }

  async save(price: Price, tx?: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaPriceRepository");
    const tenantId = this.deps.tenantId;
    const row = PriceMapper.toRow(price, tenantId);

    if (price.version === 0) {
      await client.price.create({ data: row });
    } else {
      const updated = await client.price.updateMany({
        where: { id: price.id.toString(), tenantId, version: price.version },
        data: {
          amountMinor: row.amountMinor,
          currency: row.currency,
          compareAtMinor: row.compareAtMinor,
          costMinor: row.costMinor,
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo,
          taxClassRef: row.taxClassRef,
          status: row.status,
          deletedAt: row.deletedAt,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Price ${price.id.toString()} was modified concurrently (expected version ${price.version})`,
        );
      }
    }

    await this.deps.outbox.write(price.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<Price | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.price.findFirst({
      where: { id, tenantId: this.deps.tenantId, deletedAt: null },
    });
    return row === null ? null : PriceMapper.toDomain(row);
  }

  async delete(price: Price, tx?: unknown): Promise<void> {
    await this.save(price, tx);
  }

  async findPublishedByProduct(
    productRef: string,
    currency: string,
    tx?: unknown,
  ): Promise<readonly Price[]> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const rows = await client.price.findMany({
      where: {
        tenantId: this.deps.tenantId,
        productRef,
        currency,
        status: "published",
        deletedAt: null,
      },
    });
    return rows.map((row) => PriceMapper.toDomain(row));
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<Price>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.price.findMany({
      where: {
        tenantId: this.deps.tenantId,
        deletedAt: null,
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    return buildPaginatedPage(
      rows.map((row) => PriceMapper.toDomain(row)),
      limit,
      (p) => p.id.toString(),
    );
  }
}

/** Production `PriceListRepository` on the `pricing` schema (ADR-0003 locking + same-tx outbox). */
export class PrismaPriceListRepository implements PriceListRepository {
  private readonly deps: PrismaPricingRepositoryDeps;

  constructor(deps: PrismaPricingRepositoryDeps) {
    this.deps = deps;
  }

  async save(list: PriceList, tx?: unknown): Promise<void> {
    const client = requireTx(tx, "PrismaPriceListRepository");
    const tenantId = this.deps.tenantId;

    if (list.version === 0) {
      await client.priceList.create({ data: PriceListMapper.toRow(list, tenantId) });
    } else {
      const updated = await client.priceList.updateMany({
        where: { id: list.id.toString(), tenantId, version: list.version },
        data: { status: list.status, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `PriceList ${list.id.toString()} was modified concurrently (expected version ${list.version})`,
        );
      }
    }

    await this.deps.outbox.write(list.pullDomainEvents(), this.deps.context, client);
  }

  async findById(id: string, tx?: unknown): Promise<PriceList | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.priceList.findFirst({
      where: { id, tenantId: this.deps.tenantId, deletedAt: null },
    });
    return row === null ? null : PriceListMapper.toDomain(row);
  }
}
