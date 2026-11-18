import type { OrderAnnotationRepository, OrderAnnotations } from "../domain/order-annotations";
import {
  clampSuggestionLimit,
  sortTags,
  TAG_SUGGESTION_LIMIT,
  tagKeyOf,
  type OrderTag,
  type TagUsage,
} from "../domain/order-tags";
import type { InMemoryOrderRepository } from "./in-memory-order-repository";

export interface InMemoryOrderAnnotationRepositoryDeps {
  /** The order store whose rows the annotations sit beside (the "columns" and the tag rows live there). */
  readonly orders: Pick<
    InMemoryOrderRepository,
    | "hasOrder"
    | "archivedAtOf"
    | "writeArchivedAt"
    | "noteOf"
    | "writeNote"
    | "tagsOf"
    | "writeTags"
    | "tagRowsOf"
  >;
}

/** In-memory {@link OrderAnnotationRepository}, mirroring `PrismaOrderAnnotationRepository`. */
export class InMemoryOrderAnnotationRepository implements OrderAnnotationRepository {
  private readonly orders: InMemoryOrderAnnotationRepositoryDeps["orders"];

  constructor(deps: InMemoryOrderAnnotationRepositoryDeps) {
    this.orders = deps.orders;
  }

  setArchived(
    orderIds: readonly string[],
    archivedAt: Date | null,
    tenantId: string,
  ): Promise<readonly string[]> {
    try {
      const changed: string[] = [];
      for (const orderId of new Set(orderIds)) {
        if (!this.orders.hasOrder(orderId, tenantId)) continue;
        const isArchived = this.orders.archivedAtOf(orderId, tenantId) !== null;
        if (isArchived === (archivedAt !== null)) continue;
        this.orders.writeArchivedAt(orderId, tenantId, archivedAt);
        changed.push(orderId);
      }
      return Promise.resolve(changed);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  annotationsOf(
    orderIds: readonly string[],
    tenantId: string,
  ): Promise<ReadonlyMap<string, OrderAnnotations>> {
    try {
      const found = new Map<string, OrderAnnotations>();
      for (const orderId of new Set(orderIds)) {
        if (!this.orders.hasOrder(orderId, tenantId)) continue;
        found.set(orderId, {
          archivedAt: this.orders.archivedAtOf(orderId, tenantId),
          note: this.orders.noteOf(orderId, tenantId),
          tags: sortTags(this.orders.tagsOf(orderId, tenantId).map((tag) => tag.tag)),
        });
      }
      return Promise.resolve(found);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  setNote(orderId: string, note: string | null, tenantId: string): Promise<boolean> {
    try {
      return Promise.resolve(this.orders.writeNote(orderId, tenantId, note));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  addTags(
    orderIds: readonly string[],
    tags: readonly OrderTag[],
    tenantId: string,
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    try {
      const added = new Map<string, readonly string[]>();
      for (const orderId of new Set(orderIds)) {
        if (!this.orders.hasOrder(orderId, tenantId)) continue;
        const current = this.orders.tagsOf(orderId, tenantId);
        const keys = new Set(current.map((tag) => tag.tagKey));
        const fresh = tags.filter((tag) => !keys.has(tag.tagKey));
        if (fresh.length === 0) continue;
        this.orders.writeTags(orderId, tenantId, [...current, ...fresh]);
        added.set(
          orderId,
          fresh.map((tag) => tag.tag),
        );
      }
      return Promise.resolve(added);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  removeTags(
    orderIds: readonly string[],
    tagKeys: readonly string[],
    tenantId: string,
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    try {
      const keys = new Set(tagKeys);
      const removed = new Map<string, readonly string[]>();
      for (const orderId of new Set(orderIds)) {
        if (!this.orders.hasOrder(orderId, tenantId)) continue;
        const current = this.orders.tagsOf(orderId, tenantId);
        const gone = current.filter((tag) => keys.has(tag.tagKey));
        if (gone.length === 0) continue;
        this.orders.writeTags(
          orderId,
          tenantId,
          current.filter((tag) => !keys.has(tag.tagKey)),
        );
        removed.set(
          orderId,
          gone.map((tag) => tag.tag),
        );
      }
      return Promise.resolve(removed);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  tagsInUse(
    tenantId: string,
    prefix = "",
    limit = TAG_SUGGESTION_LIMIT,
  ): Promise<readonly TagUsage[]> {
    try {
      // startsWith is literal: "%" or "_" in the prefix match only themselves, like the escaped LIKE.
      const start = tagKeyOf(prefix);
      const byKey = new Map<string, { tag: string; seq: number; count: number }>();
      for (const row of this.orders.tagRowsOf(tenantId)) {
        if (!row.tagKey.startsWith(start)) continue;
        const seen = byKey.get(row.tagKey);
        byKey.set(
          row.tagKey,
          seen === undefined
            ? { tag: row.tag, seq: row.seq, count: 1 }
            : {
                tag: row.seq < seen.seq ? row.tag : seen.tag,
                seq: Math.min(row.seq, seen.seq),
                count: seen.count + 1,
              },
        );
      }
      return Promise.resolve(
        [...byKey.entries()]
          .sort(
            ([keyA, a], [keyB, b]) => b.count - a.count || (keyA < keyB ? -1 : keyA > keyB ? 1 : 0),
          )
          .slice(0, clampSuggestionLimit(limit))
          .map(([, usage]) => ({ tag: usage.tag, count: usage.count })),
      );
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
