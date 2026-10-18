import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { EventContext, OutboxWriter } from "@platform/messaging";
import { buildPaginatedPage, decodeCursor } from "@platform/repository";
import type { Paginated } from "@platform/types";
import { ConcurrencyError, UnexpectedError } from "@platform/utils";
import { Prisma } from "@prisma/client";
import type { Order } from "../domain/order";
import type { OrderListQuery, OrderRepository } from "../domain/order-repository";
import {
  orderListWhere,
  orderPageSize,
  RECIPIENT_SEARCH_CAP,
  recipientSearchWhere,
} from "./order-list-where";
import { OrderMapper } from "./order.mapper";

/**
 * Hard cap on rows scanned per `list()` call when a `status` filter is active (Phase 2
 * admin-web productization). Status is derived from `order_events`, never a stored column
 * (see the class doc), so filtering by it can't be pushed into a single indexed WHERE — this
 * repository instead walks the same `id desc` pages `list()` already fetches, hydrating each
 * row (which reconstructs `history` anyway) and filtering in application code. The cap bounds
 * worst-case latency on a tenant with many non-matching orders; `fetchStatusFilteredPage`
 * documents how pagination stays correct (no skipped/duplicated rows) when the cap is hit
 * before a full page of matches is found.
 */
const STATUS_FILTER_SCAN_CAP = 500;

export interface PrismaOrderRepositoryDeps {
  readonly prisma: Database;
  readonly outbox: OutboxWriter<TransactionClient>;
  readonly context: EventContext;
}

/** Prisma requires an explicit SQL-NULL sentinel for nullable `Json?` columns — bare `null` is ambiguous. */
function jsonOrDbNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

/**
 * Production `OrderRepository` on the `orders` schema. Writes REQUIRE the unit of work's
 * transaction client (ADR-0003) so the aggregate rows and the outbox append commit atomically;
 * reads use it when supplied (read-your-writes inside a transaction). Optimistic locking: updates
 * are `WHERE id AND tenant_id AND version`; zero affected rows ⇒ `ConcurrencyError` — no retry,
 * no silent overwrite. Order status is never stored — the append-only `order_events` rows are
 * the record and rehydration derives it (G-12).
 */
export class PrismaOrderRepository implements OrderRepository {
  private readonly deps: PrismaOrderRepositoryDeps;

  constructor(deps: PrismaOrderRepositoryDeps) {
    this.deps = deps;
  }

  async save(order: Order, tenantId: string, tx?: unknown): Promise<void> {
    const client = this.requireTx(tx);
    const row = OrderMapper.toOrderRow(order, tenantId);

    if (order.version === 0) {
      // First persistence: version 1 on disk (fresh aggregates are always in-memory version 0).
      await client.order.create({
        data: {
          ...row,
          billingAddress: jsonOrDbNull(row.billingAddress),
          totals: jsonOrDbNull(row.totals),
        },
      });
      await client.orderItem.createMany({ data: OrderMapper.toItemRows(order, tenantId) });
      await client.orderShippingAddress.create({ data: OrderMapper.toAddressRow(order, tenantId) });
      await client.orderEvent.createMany({ data: OrderMapper.toEventRows(order, tenantId) });
    } else {
      const updated = await client.order.updateMany({
        where: { id: order.id.toString(), tenantId, version: order.version },
        data: {
          checkoutRef: row.checkoutRef,
          paymentRef: row.paymentRef,
          fulfillmentRef: row.fulfillmentRef,
          billingAddress: jsonOrDbNull(row.billingAddress),
          totals: jsonOrDbNull(row.totals),
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ConcurrencyError(
          `Order ${order.id.toString()} was modified concurrently (expected version ${order.version})`,
        );
      }
      // Append-only history: only entries not yet persisted insert (PK = event id).
      await client.orderEvent.createMany({
        data: OrderMapper.toEventRows(order, tenantId),
        skipDuplicates: true,
      });
    }

    await this.deps.outbox.write(
      order.pullDomainEvents(),
      { ...this.deps.context, tenantId },
      client,
    );
  }

  /** ADR-0014: `tenantId` is an explicit parameter; reuse the caller's `tx` if given, else scope via `runReadScoped`. */
  async findById(id: string, tenantId: string, tx?: unknown): Promise<Order | null> {
    return this.scoped(tenantId, tx, (client) => this.findByIdWith(client, id, tenantId));
  }

  private async findByIdWith(
    client: TransactionClient,
    id: string,
    tenantId: string,
  ): Promise<Order | null> {
    const row = await client.order.findFirst({
      where: { id, tenantId },
      include: {
        items: true,
        events: { orderBy: { occurredAt: "asc" } },
      },
    });
    if (row === null) {
      return null;
    }
    const address = await client.orderShippingAddress.findFirst({
      where: { orderId: id, tenantId },
    });
    if (address === null) {
      throw new UnexpectedError(
        `Corrupt orders data: order ${id} is missing its shipping-address row`,
      );
    }
    return OrderMapper.toDomain(
      {
        ...row,
        billingAddress: row.billingAddress as OrderRowBillingAddress | null,
        totals: row.totals as OrderRowTotals | null,
      },
      row.items,
      row.events,
      address,
    );
  }

  /**
   * Most-recently-placed-first cursor page. Sorts on `id` (UUIDv7, time-ordered — D-022) rather
   * than `created_at`, matching `PrismaProductRepository.list`'s cursor technique — just walked in
   * the opposite direction (`desc` + `lt`, since "recent" reads newest-first, vs. Product's
   * oldest-first `asc` + `gt`). `buildPaginatedPage` only needs each row's own sort key, so it
   * works unchanged in either direction. Reconstructs full aggregates (batching the one-row-per-
   * order shipping address lookup instead of N+1, since `findById` fetches it separately) — this
   * mirrors Product's `list()`, which also rehydrates full aggregates rather than a shortcut shape.
   *
   * Order operations Part 1: the list tabs' predicates (`archived`, `open`, `paymentStatus`, `ids`,
   * `createdFrom`/`createdTo`) are pushed into SQL by {@link orderListWhere} — `archived_at` checks plus
   * `EXISTS`/`NOT EXISTS` over `order_events`, built from the same event-type sets the pure status
   * functions read — and `search` also matches the shipping recipient's name and phone (a capped
   * first query on `order_shipping_addresses`, see {@link recipientSearchWhere}). Pages are capped by
   * {@link orderPageSize} (250, for export), not the generic 100.
   */
  async list(query: OrderListQuery, tenantId: string, tx?: unknown): Promise<Paginated<Order>> {
    return this.scoped(tenantId, tx, (client) => this.listWith(client, query, tenantId));
  }

  private async listWith(
    client: TransactionClient,
    query: OrderListQuery,
    tenantId: string,
  ): Promise<Paginated<Order>> {
    const limit = orderPageSize(query.first);
    const after = query.after !== undefined ? decodeCursor(query.after) : undefined;
    const search = query.search?.trim() ?? "";
    const recipientOrderIds =
      search.length > 0 ? await this.recipientMatches(client, tenantId, search) : [];

    if (query.status !== undefined) {
      return this.fetchStatusFilteredPage(
        client,
        tenantId,
        after,
        limit,
        query.status,
        query,
        recipientOrderIds,
      );
    }

    const orders = await this.fetchOrders(
      client,
      tenantId,
      after,
      limit + 1,
      query,
      recipientOrderIds,
    );
    return buildPaginatedPage(orders, limit, (order) => order.id.toString());
  }

  /** Step one of the recipient search (spec §1.3): the orders whose shipping recipient name or phone matches, capped. */
  private async recipientMatches(
    client: Database | TransactionClient,
    tenantId: string,
    search: string,
  ): Promise<readonly string[]> {
    const rows = await client.orderShippingAddress.findMany({
      // The tenant is restated here so `check-prisma-tenant-where` can read it at the call site.
      where: { ...recipientSearchWhere(search, tenantId), tenantId },
      select: { orderId: true },
      take: RECIPIENT_SEARCH_CAP,
    });
    return rows.map((row) => row.orderId);
  }

  /**
   * Scans `id desc` pages (each already hydrated by `fetchOrders`, `history` included) until
   * `limit + 1` orders match `status`, the table is exhausted, or `STATUS_FILTER_SCAN_CAP` rows
   * have been examined. Pagination stays correct even when the cap is hit mid-scan: `endCursor`
   * is the last row EXAMINED (not the last match), so a follow-up call with that cursor resumes
   * scanning exactly where this one stopped — no order is ever skipped or double-counted, even
   * though a single "page" may come back with fewer than `limit` items while more matches exist
   * further back.
   */
  private async fetchStatusFilteredPage(
    client: Database | TransactionClient,
    tenantId: string,
    after: string | undefined,
    limit: number,
    status: string,
    query: OrderListQuery,
    recipientOrderIds: readonly string[],
  ): Promise<Paginated<Order>> {
    // An export page (250) must not turn one batch into 1,000 hydrated rows: never batch past the cap.
    const batchSize = Math.min(Math.max(limit * 4, 50), STATUS_FILTER_SCAN_CAP);
    const matches: Order[] = [];
    let cursor = after;
    let scanned = 0;
    let exhausted = false;

    while (matches.length <= limit && scanned < STATUS_FILTER_SCAN_CAP) {
      const batch = await this.fetchOrders(
        client,
        tenantId,
        cursor,
        batchSize,
        query,
        recipientOrderIds,
      );
      if (batch.length === 0) {
        exhausted = true;
        break;
      }
      for (const order of batch) {
        if (order.status === status && matches.length <= limit) {
          matches.push(order);
        }
      }
      scanned += batch.length;
      cursor = batch[batch.length - 1]?.id.toString();
      if (batch.length < batchSize) {
        exhausted = true;
        break;
      }
    }

    if (matches.length > limit) {
      const items = matches.slice(0, limit);
      return {
        items,
        pageInfo: { hasNextPage: true, endCursor: items[items.length - 1]?.id.toString() ?? null },
      };
    }
    return {
      items: matches,
      pageInfo: {
        hasNextPage: !exhausted,
        endCursor: exhausted
          ? (matches[matches.length - 1]?.id.toString() ?? null)
          : (cursor ?? null),
      },
    };
  }

  /** Fetches `take` orders (fully hydrated), `id desc`, filtered by {@link orderListWhere}. Shared by the unfiltered and status-filtered paths. */
  private async fetchOrders(
    client: Database | TransactionClient,
    tenantId: string,
    after: string | undefined,
    take: number,
    query: OrderListQuery,
    recipientOrderIds: readonly string[],
  ): Promise<Order[]> {
    const rows = await client.order.findMany({
      // The tenant is restated here so `check-prisma-tenant-where` can read it at the call site.
      where: { ...orderListWhere(query, tenantId, after, recipientOrderIds), tenantId },
      include: { items: true, events: { orderBy: { occurredAt: "asc" } } },
      orderBy: { id: "desc" },
      take,
    });
    if (rows.length === 0) {
      return [];
    }

    const addresses = await client.orderShippingAddress.findMany({
      where: { orderId: { in: rows.map((row) => row.id) }, tenantId },
    });
    const addressByOrderId = new Map(addresses.map((address) => [address.orderId, address]));

    return rows.map((row) => {
      const address = addressByOrderId.get(row.id);
      if (address === undefined) {
        throw new UnexpectedError(
          `Corrupt orders data: order ${row.id} is missing its shipping-address row`,
        );
      }
      return OrderMapper.toDomain(
        {
          ...row,
          billingAddress: row.billingAddress as OrderRowBillingAddress | null,
          totals: row.totals as OrderRowTotals | null,
        },
        row.items,
        row.events,
        address,
      );
    });
  }

  /** Reuses the caller's `tx` if given, else scopes a read via `runReadScoped` (ADR-0014). */
  private scoped<T>(
    tenantId: string,
    tx: unknown,
    run: (client: TransactionClient) => Promise<T>,
  ): Promise<T> {
    return tx !== undefined && tx !== null
      ? run(tx as TransactionClient)
      : runReadScoped(this.deps.prisma, tenantId, run);
  }

  private requireTx(tx: unknown): TransactionClient {
    if (tx === undefined || tx === null) {
      throw new Error(
        "PrismaOrderRepository.save requires the unit of work's transaction client (ADR-0003).",
      );
    }
    return tx as TransactionClient;
  }
}

interface OrderRowBillingAddress {
  readonly line1: string;
  readonly city: string;
  readonly postalCode: string;
  readonly country: string;
  /** Plan 3A: absent on billing JSON written before the recipient was captured. */
  readonly recipientName?: string | null;
  readonly phone?: string | null;
  readonly line2?: string | null;
}
interface OrderRowTotals {
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly shippingMinor: number;
  readonly discountMinor: number;
  readonly totalMinor: number;
  readonly currency: string;
}
