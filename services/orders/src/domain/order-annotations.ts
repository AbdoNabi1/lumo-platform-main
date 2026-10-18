/**
 * What staff record ON an order, outside the `Order` aggregate (order operations, spec §1.2): writing it
 * never bumps the aggregate's `version` and never adds a history row, so it can never conflict with a
 * payment webhook or a fulfillment write. Part 1: the archive timestamp. Part 2 adds the note and tags.
 */
export interface OrderAnnotations {
  /** When the order was archived (Shopify's reversible Archive); null = not archived. */
  readonly archivedAt: Date | null;
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
}
