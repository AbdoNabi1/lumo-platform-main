import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import { Prisma } from "@prisma/client";
import type { Cart } from "../domain/cart";
import type { CartListFilter, CartRepository } from "../domain/cart-repository";
import { CartMapper } from "./cart.mapper";

export interface PrismaCartRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

/** Prisma requires an explicit SQL-NULL sentinel for nullable `Json?` columns — bare `null` is ambiguous. */
function jsonOrDbNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

/**
 * Production `CartRepository` on the `cart` schema (Postgres is the durable source of truth;
 * Redis fronts it in Step 3). Optimistic locking on the cart row; the mutable line set is
 * replaced in the same transaction; outbox append shares the transaction (ADR-0003).
 */
export class PrismaCartRepository implements CartRepository {
  private readonly deps: PrismaCartRepositoryDeps;

  constructor(deps: PrismaCartRepositoryDeps) {
    this.deps = deps;
  }

  async save(cart: Cart, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const cartId = cart.id.toString();

    if (cart.version === 0) {
      await client.cart.create({ data: CartMapper.toCartRow(cart, tenantId) });
    } else {
      const updated = await client.cart.updateMany({
        where: { id: cartId, tenantId, version: cart.version },
        data: {
          customerRef: cart.customerRef ?? null,
          status: cart.status,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Cart ${cartId} was modified concurrently (expected version ${cart.version})`,
        );
      }
      await client.cartItem.deleteMany({ where: { cartId, tenantId } });
    }
    const items = CartMapper.toItemRows(cart, tenantId).map((row) => ({
      ...row,
      inventorySnapshot: jsonOrDbNull(row.inventorySnapshot),
      metadata: jsonOrDbNull(row.metadata),
    }));
    if (items.length > 0) {
      await client.cartItem.createMany({ data: items });
    }

    await this.deps.outbox.write(
      cart.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Cart | null> {
    const run = (client: TransactionClient) =>
      client.cart.findFirst({ where: { id, tenantId }, include: { items: true } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : this.toDomain(row);
  }

  /** Most-recently-updated active row wins when more than one exists (see the port doc comment). */
  async findBySessionRef(sessionRef: string, tenantId: string, tx?: unknown): Promise<Cart | null> {
    const run = (client: TransactionClient) =>
      client.cart.findFirst({
        where: { sessionRef, tenantId, status: "active" },
        orderBy: { updatedAt: "desc" },
        include: { items: true },
      });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : this.toDomain(row);
  }

  async list(
    page: CursorPage,
    tenantId: string,
    filter?: CartListFilter,
    tx?: unknown,
  ): Promise<Paginated<Cart>> {
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const run = (client: TransactionClient) =>
      client.cart.findMany({
        where: {
          tenantId,
          ...(filter?.status !== undefined ? { status: filter.status } : {}),
          ...(after ? { id: { gt: after } } : {}),
        },
        orderBy: { id: "asc" },
        take: limit + 1,
        include: { items: true },
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return buildPaginatedPage(
      rows.map((row) => this.toDomain(row)),
      limit,
      (c) => c.id.toString(),
    );
  }

  private toDomain(row: Prisma.CartGetPayload<{ include: { items: true } }>): Cart {
    return CartMapper.toDomain(
      row,
      row.items.map((item) => ({
        ...item,
        inventorySnapshot: item.inventorySnapshot as Record<string, unknown> | null,
        metadata: item.metadata as Record<string, unknown> | null,
      })),
    );
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaCartRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
