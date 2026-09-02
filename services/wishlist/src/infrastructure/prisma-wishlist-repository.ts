import type { Database, TransactionClient } from "@platform/db";
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

  async findById(id: string, tx?: unknown): Promise<Wishlist | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.wishlist.findFirst({ where: { id, tenantId: this.deps.tenantId } });
    if (row === null) return null;
    return WishlistMapper.toDomain(this.toMapperRow(row));
  }

  async findByCustomerRef(customerRef: string, tx?: unknown): Promise<Wishlist | null> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const row = await client.wishlist.findFirst({
      where: { customerRef, tenantId: this.deps.tenantId },
    });
    if (row === null) return null;
    return WishlistMapper.toDomain(this.toMapperRow(row));
  }

  async list(page: CursorPage, tx?: unknown): Promise<Paginated<Wishlist>> {
    const client = (tx as TransactionClient | undefined) ?? this.deps.prisma;
    const after = page.after !== undefined ? decodeCursor(page.after) : undefined;
    const limit = normalizePageSize(page.first);
    const rows = await client.wishlist.findMany({
      where: {
        tenantId: this.deps.tenantId,
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
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
