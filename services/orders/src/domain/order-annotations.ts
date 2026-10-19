import type { OrderTag, TagUsage } from "./order-tags";

/**
 * What staff record ON an order, outside the `Order` aggregate (order operations, spec §1.2 / §2.1):
 * writing it never bumps the aggregate's `version` and never adds a history row, so it can never
 * conflict with a payment webhook or a fulfillment write.
 */
export interface OrderAnnotations {
  /** When the order was archived (Shopify's reversible Archive); null = not archived. */
  readonly archivedAt: Date | null;
  /** Part 2: the staff note; null = "No notes". */
  readonly note: string | null;
  /** Part 2: the order's tags (display spelling), sorted by key. */
  readonly tags: readonly string[];
}

/** Persistence port for {@link OrderAnnotations}. ADR-0014: `tenantId` per call; writes need the unit of work's `tx`. */
export interface OrderAnnotationRepository {
  /**
   * Sets (a Date) or clears (null) the archive timestamp of those given orders of this shop that are
   * not already in that state, and returns the ids it changed. Unknown ids and other shops' ids are
   * never changed. No version check, no history row.
   */
  setArchived(
    orderIds: readonly string[],
    archivedAt: Date | null,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly string[]>;
  /** The annotations of each given order of this shop; an id missing from the map is not an order of this shop. */
  annotationsOf(
    orderIds: readonly string[],
    tenantId: string,
    tx?: unknown,
  ): Promise<ReadonlyMap<string, OrderAnnotations>>;
  /** Part 2: writes the note of this shop's order; false when this shop has no such order. */
  setNote(orderId: string, note: string | null, tenantId: string, tx?: unknown): Promise<boolean>;
  /**
   * Part 2: adds each tag (by `tagKey`) that each given order of this shop does not carry yet, and
   * answers, per order, the spellings it added (orders that gained nothing are absent). Other shops'
   * and unknown ids are skipped.
   */
  addTags(
    orderIds: readonly string[],
    tags: readonly OrderTag[],
    tenantId: string,
    tx?: unknown,
  ): Promise<ReadonlyMap<string, readonly string[]>>;
  /** Part 2: removes those tag keys from each given order of this shop; per order, the stored spellings it removed. */
  removeTags(
    orderIds: readonly string[],
    tagKeys: readonly string[],
    tenantId: string,
    tx?: unknown,
  ): Promise<ReadonlyMap<string, readonly string[]>>;
  /**
   * Part 2: the shop's distinct tags whose key starts with `prefix` (literal, case-insensitive), most
   * used first then by key, at most `limit` (1..50, default 50). The spelling is the shop's earliest.
   */
  tagsInUse(tenantId: string, prefix?: string, limit?: number): Promise<readonly TagUsage[]>;
}
