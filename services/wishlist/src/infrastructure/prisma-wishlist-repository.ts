import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor, normalizePageSize } from "@platform/repository";
import type { CursorPage, Paginated } from "@platform/types";
import { ConcurrencyError } from "@platform/utils";
import type { Wishlist } from "../domain/wishlist";
import type { WishlistRepository } from "../domain/wishlist-repository";
import { WishlistMapper, type WishlistRow } from "./wishlist.mapper";

export interface PrismaWishlistRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
  /** Tenant scope for every query (ADR-0008 §2) — injected by the composition root. */
  readonly tenantId: string;
}

/** Production `WishlistRepository` on the `wishlist` schema. Optimistic locking + same-transaction outbox per ADR-0003. */
export class PrismaWishlistRepository implements WishlistRepository {
  private readonly deps: PrismaWishlistRepositoryDeps;

  constructor(deps: PrismaWishlistRepositoryDeps) {
    this.deps = deps;
  }

  async save(wishlist: Wishlist, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const tenantId = this.deps.tenantId;
    const wishlistId = wishlist.id.toString();
    const row = WishlistMapper.toRow(wishlist, tenantId);

    if (wishlist.version === 0) {
      await client.wishlist.create({ data: { ...row, items: row.items } });
    } else {
      const updated = await client.wishlist.updateMany({
        where: { id: wishlistId, tenantId, version: wishlist.version },
        data: {
          status: row.status,
          items: row.items,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Wishlist ${wishlistId} was modified concurrently (expected version ${wishlist.version})`,
        );
      }
    }

    await this.deps.outbox.write(wishlist.pullDomainEvents(), this.deps.context, client);
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Wishlist | null> {
    const run = (client: TransactionClient) =>
      client.wishlist.findFirst({ where: { id, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : WishlistMapper.toDomain(this.toMapperRow(row));
  }

  async findByCustomerRef(
    customerRef: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<Wishlist | null> {
    const run = (client: TransactionClient) =>
      client.wishlist.findFirst({ where: { customerRef, tenantId } });
    const row =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return row === null ? null : WishlistMapper.toDomain(this.toMapperRow(row));
  }

  async list(page: CursorPage, tenantId: string, tx?: unknown): Promise<Paginated<Wishlist>> {
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const run = (client: TransactionClient) =>
      client.wishlist.findMany({
        where: { tenantId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: "asc" },
        take: limit + 1,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await run(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, run);
    return buildPaginatedPage(
      rows.map((row) => WishlistMapper.toDomain(this.toMapperRow(row))),
      limit,
      (w) => w.id.toString(),
    );
  }

  private toMapperRow(row: {
    readonly id: string;
    readonly customerRef: string;
    readonly status: string;
    readonly items: unknown;
    readonly version: number;
  }): WishlistRow {
    return { ...row, items: row.items as WishlistRow["items"] };
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaWishlistRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}
