import { runReadScoped, type Database, type TransactionClient } from "@platform/db";
import type { OrderAnnotationRepository, OrderAnnotations } from "../domain/order-annotations";
import {
  clampSuggestionLimit,
  sortTags,
  TAG_SUGGESTION_LIMIT,
  tagKeyOf,
  type OrderTag,
  type TagUsage,
} from "../domain/order-tags";
import { uuidsOf } from "./order-list-where";

export interface PrismaOrderAnnotationRepositoryDeps {
  readonly prisma: Database;
}

/** `LIKE` treats `%`, `_` and `\` specially; a typed prefix must match literally (Review Focus 1). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function writeClient(tx: unknown, method: string): TransactionClient {
  if (tx === undefined || tx === null) {
    throw new Error(
      `PrismaOrderAnnotationRepository.${method} requires the unit of work's transaction client (ADR-0003).`,
    );
  }
  return tx as TransactionClient;
}

interface TagUsageRow {
  readonly tag: string;
  readonly count: number | bigint;
}

/**
 * Production {@link OrderAnnotationRepository}: `orders.orders.archived_at` / `note` and
 * `orders.order_tags`, each a plain tenant-scoped write — no `version` condition, no history row, no
 * outbox event (spec §1.2, §2.1). Writes need the unit of work's `tx`; reads use it when given, else
 * `runReadScoped` (ADR-0014).
 */
export class PrismaOrderAnnotationRepository implements OrderAnnotationRepository {
  private readonly deps: PrismaOrderAnnotationRepositoryDeps;

  constructor(deps: PrismaOrderAnnotationRepositoryDeps) {
    this.deps = deps;
  }

  async setArchived(
    orderIds: readonly string[],
    archivedAt: Date | null,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly string[]> {
    const client = writeClient(tx, "setArchived");
    const ids = uuidsOf(orderIds);
    if (ids.length === 0) return [];
    // The target-state condition lives IN the UPDATE, so under concurrency exactly one writer's guarded
    // update matches a row: the loser affects 0 rows, reports it unchanged and cannot overwrite the
    // winner's timestamp. One guarded update per id because `updateMany` only returns a count.
    const targetState = archivedAt === null ? { not: null } : null;
    const changed: string[] = [];
    for (const id of ids) {
      const { count } = await client.order.updateMany({
        where: { tenantId, id, archivedAt: targetState },
        data: { archivedAt },
      });
      if (count > 0) changed.push(id);
    }
    return changed;
  }

  async annotationsOf(
    orderIds: readonly string[],
    tenantId: string,
    tx?: unknown,
  ): Promise<ReadonlyMap<string, OrderAnnotations>> {
    const ids = uuidsOf(orderIds);
    if (ids.length === 0) return new Map();
    const read = async (client: TransactionClient) => {
      const orders = await client.order.findMany({
        where: { tenantId, id: { in: ids } },
        select: { id: true, archivedAt: true, note: true },
      });
      const tags =
        orders.length === 0
          ? []
          : await client.orderTag.findMany({
              where: { tenantId, orderId: { in: orders.map((order) => order.id) } },
              select: { orderId: true, tag: true },
            });
      return { orders, tags };
    };
    const { orders, tags } =
      tx !== undefined && tx !== null
        ? await read(tx as TransactionClient)
        : await runReadScoped(this.deps.prisma, tenantId, read);
    const tagsByOrder = new Map<string, string[]>();
    for (const row of tags) {
      tagsByOrder.set(row.orderId, [...(tagsByOrder.get(row.orderId) ?? []), row.tag]);
    }
    return new Map(
      orders.map((row) => [
        row.id,
        {
          archivedAt: row.archivedAt ?? null,
          note: row.note ?? null,
          tags: sortTags(tagsByOrder.get(row.id) ?? []),
        },
      ]),
    );
  }

  async setNote(
    orderId: string,
    note: string | null,
    tenantId: string,
    tx?: unknown,
  ): Promise<boolean> {
    const client = writeClient(tx, "setNote");
    const [id] = uuidsOf([orderId]);
    if (id === undefined) return false;
    const { count } = await client.order.updateMany({ where: { tenantId, id }, data: { note } });
    return count > 0;
  }

  async addTags(
    orderIds: readonly string[],
    tags: readonly OrderTag[],
    tenantId: string,
    tx?: unknown,
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    const client = writeClient(tx, "addTags");
    const ids = await this.ownedIds(client, orderIds, tenantId);
    if (ids.length === 0 || tags.length === 0) return new Map();
    const existing = await client.orderTag.findMany({
      where: { tenantId, orderId: { in: ids }, tagKey: { in: tags.map((tag) => tag.tagKey) } },
      select: { orderId: true, tagKey: true },
    });
    const present = new Set(existing.map((row) => `${row.orderId}\u0000${row.tagKey}`));
    const added = new Map<string, string[]>();
    const rows: { tenantId: string; orderId: string; tag: string; tagKey: string }[] = [];
    for (const orderId of ids) {
      for (const { tag, tagKey } of tags) {
        if (present.has(`${orderId}\u0000${tagKey}`)) continue;
        rows.push({ tenantId, orderId, tag, tagKey });
        added.set(orderId, [...(added.get(orderId) ?? []), tag]);
      }
    }
    // ON CONFLICT DO NOTHING: a concurrent add of the same tag never fails this call.
    if (rows.length > 0) await client.orderTag.createMany({ data: rows, skipDuplicates: true });
    return added;
  }

  async removeTags(
    orderIds: readonly string[],
    tagKeys: readonly string[],
    tenantId: string,
    tx?: unknown,
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    const client = writeClient(tx, "removeTags");
    const ids = uuidsOf(orderIds);
    const keys = [...new Set(tagKeys)];
    if (ids.length === 0 || keys.length === 0) return new Map();
    const rows = await client.orderTag.findMany({
      where: { tenantId, orderId: { in: ids }, tagKey: { in: keys } },
      select: { orderId: true, tag: true },
    });
    if (rows.length === 0) return new Map();
    await client.orderTag.deleteMany({
      where: { tenantId, orderId: { in: ids }, tagKey: { in: keys } },
    });
    const removed = new Map<string, string[]>();
    for (const row of rows)
      removed.set(row.orderId, [...(removed.get(row.orderId) ?? []), row.tag]);
    return removed;
  }

  async tagsInUse(
    tenantId: string,
    prefix = "",
    limit = TAG_SUGGESTION_LIMIT,
  ): Promise<readonly TagUsage[]> {
    const pattern = `${escapeLike(tagKeyOf(prefix))}%`;
    const take = clampSuggestionLimit(limit);
    // Tenant-filtered in the SQL itself (raw queries are outside the Prisma where-guard). The spelling
    // shown is the shop's EARLIEST row of the key; ties order by key in byte order, like the in-memory twin.
    const rows = await runReadScoped(
      this.deps.prisma,
      tenantId,
      (client) => client.$queryRaw<TagUsageRow[]>`
        SELECT (ARRAY_AGG("tag" ORDER BY "created_at", "tag"))[1] AS "tag", COUNT(*)::int AS "count"
        FROM "orders"."order_tags"
        WHERE "tenant_id" = ${tenantId} AND "tag_key" LIKE ${pattern} ESCAPE '\\'
        GROUP BY "tag_key"
        ORDER BY COUNT(*) DESC, "tag_key" COLLATE "C" ASC
        LIMIT ${take}`,
    );
    return rows.map((row) => ({ tag: row.tag, count: Number(row.count) }));
  }

  /** The ids among `orderIds` that are orders of THIS shop — tag rows are only ever written for those. */
  private async ownedIds(
    client: TransactionClient,
    orderIds: readonly string[],
    tenantId: string,
  ): Promise<string[]> {
    const ids = uuidsOf(orderIds);
    if (ids.length === 0) return [];
    const rows = await client.order.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true },
    });
    const owned = new Set(rows.map((row) => row.id));
    return ids.filter((id) => owned.has(id));
  }
}
