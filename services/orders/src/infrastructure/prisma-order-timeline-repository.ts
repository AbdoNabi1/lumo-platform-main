import type { Prisma } from "@prisma/client";
import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import { UnexpectedError } from "@platform/utils";
import {
  isOrderTimelineKind,
  TIMELINE_READ_LIMIT,
  type OrderTimelineData,
  type OrderTimelineEntry,
  type OrderTimelineRepository,
} from "../domain/order-timeline";
import { uuidsOf } from "./order-list-where";

export interface PrismaOrderTimelineRepositoryDeps {
  readonly prisma: Database;
}

interface TimelineRow {
  readonly id: string;
  readonly orderId: string;
  readonly kind: string;
  readonly authorRef: string | null;
  readonly authorName: string | null;
  readonly body: string | null;
  readonly data: unknown;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  readonly deletedAt: Date | null;
}

function writeClient(tx: unknown, method: string): TransactionClient {
  if (tx === undefined || tx === null) {
    throw new Error(
      `PrismaOrderTimelineRepository.${method} requires the unit of work's transaction client (ADR-0003).`,
    );
  }
  return tx as TransactionClient;
}

/** Reads only the known keys of the JSONB payload; anything else is ignored. */
function readData(value: unknown): OrderTimelineData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const tags = raw["tags"];
  const cleared = raw["cleared"];
  const draftNumber = raw["draftNumber"];
  return {
    ...(Array.isArray(tags)
      ? { tags: tags.filter((tag): tag is string => typeof tag === "string") }
      : {}),
    ...(typeof cleared === "boolean" ? { cleared } : {}),
    ...(typeof draftNumber === "string" ? { draftNumber } : {}),
  };
}

function toEntry(row: TimelineRow): OrderTimelineEntry {
  if (!isOrderTimelineKind(row.kind)) {
    throw new UnexpectedError(
      `Corrupt order data: timeline entry ${row.id} has kind "${row.kind}"`,
    );
  }
  return {
    id: row.id,
    orderId: row.orderId,
    kind: row.kind,
    authorRef: row.authorRef ?? null,
    authorName: row.authorName ?? null,
    body: row.body ?? null,
    data: readData(row.data),
    createdAt: row.createdAt,
    editedAt: row.editedAt ?? null,
    deletedAt: row.deletedAt ?? null,
  };
}

function newestFirst(a: OrderTimelineEntry, b: OrderTimelineEntry): number {
  return b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/** Production {@link OrderTimelineRepository} on `orders.order_timeline_entries` (tenant-scoped, ADR-0014). */
export class PrismaOrderTimelineRepository implements OrderTimelineRepository {
  private readonly deps: PrismaOrderTimelineRepositoryDeps;

  constructor(deps: PrismaOrderTimelineRepositoryDeps) {
    this.deps = deps;
  }

  async append(entry: OrderTimelineEntry, tenantId: string, tx?: unknown): Promise<void> {
    const client = writeClient(tx, "append");
    await client.orderTimelineEntry.create({
      data: {
        id: entry.id,
        tenantId,
        orderId: entry.orderId,
        kind: entry.kind,
        authorRef: entry.authorRef,
        authorName: entry.authorName,
        body: entry.body,
        data: entry.data as unknown as Prisma.InputJsonValue,
        createdAt: entry.createdAt,
        editedAt: entry.editedAt,
        deletedAt: entry.deletedAt,
      },
    });
  }

  async listForOrder(
    orderId: string,
    tenantId: string,
    options: { readonly first: number },
    tx?: unknown,
  ): Promise<readonly OrderTimelineEntry[]> {
    const [id] = uuidsOf([orderId]);
    if (id === undefined) return [];
    const take = Math.max(1, Math.min(Math.trunc(options.first), TIMELINE_READ_LIMIT));
    const read = (client: TransactionClient) =>
      client.orderTimelineEntry.findMany({
        where: { tenantId, orderId: id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
      });
    const rows =
      tx !== undefined && tx !== null
        ? await read(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, read);
    return rows.map(toEntry).sort(newestFirst);
  }

  async findById(
    entryId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<OrderTimelineEntry | null> {
    const [id] = uuidsOf([entryId]);
    if (id === undefined) return null;
    const read = (client: TransactionClient) =>
      client.orderTimelineEntry.findFirst({ where: { tenantId, id } });
    const row =
      tx !== undefined && tx !== null
        ? await read(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, read);
    return row === null ? null : toEntry(row);
  }

  async update(entry: OrderTimelineEntry, tenantId: string, tx?: unknown): Promise<void> {
    const client = writeClient(tx, "update");
    await client.orderTimelineEntry.updateMany({
      where: { tenantId, id: entry.id },
      data: { body: entry.body, editedAt: entry.editedAt, deletedAt: entry.deletedAt },
    });
  }
}
