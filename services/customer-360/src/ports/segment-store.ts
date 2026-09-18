import type { IdentifierRef } from "./identity-decision";
import type { SegmentMembership, SegmentMembershipStatus } from "../domain/segment-membership";

/**
 * Persistence port for the **current** materialized segment-membership rows — a rebuildable serving
 * cache, not the source of truth (`SegmentHistoryStore` is). Keyed by `(identifier, segmentId)`, one
 * row per pair, **not** one JSON blob per identifier the way `AttributeStore` is — see
 * `SEGMENTATION_MODEL.md` §2: `GetSegmentMembers` needs `WHERE segment_id = X AND status = 'entered'`,
 * only achievable with a per-membership row, and per-segment CAS is strictly finer-grained than
 * per-identifier CAS as a side benefit (writes to two different segments for the same customer never
 * contend).
 */
export interface SegmentStore {
  getCurrent(
    identifier: IdentifierRef,
    segmentId: string,
    tenantId: string,
    tx?: unknown,
  ): Promise<SegmentMembership | null>;
  /**
   * Upsert — replaces whatever was cached for this `(identifier, segmentId)` pair. Never call this
   * expecting append-only semantics (use `SegmentHistoryStore.append` for the durable record).
   *
   * **Optimistic concurrency (ADR-0060).** When `expectedVersion` is provided, this is a
   * compare-and-swap write (D-042): the write only applies if the store's currently-persisted version
   * for this pair equals `expectedVersion` — `0` (`INITIAL_SEGMENT_VERSION`) meaning "no row must
   * exist yet". Otherwise this throws `ConcurrencyError`. `UpdateSegmentMembershipProjection` is the
   * one caller that must pass this (it always has the version it just read).
   *
   * When `expectedVersion` is omitted, this is the original unconditional overwrite — reserved for
   * `RebuildSegmentMembership`'s recovery semantics and for tests seeding store state directly. Never
   * used by the normal evaluate-and-persist write path.
   */
  saveCurrent(
    membership: SegmentMembership,
    tenantId: string,
    expectedVersion?: number,
    tx?: unknown,
  ): Promise<void>;
  /** Every membership row for this identifier, across all segments — how `GetCustomerSegments`
   * assembles a `CustomerSegment` view without a caller enumerating every segment id by hand. */
  listForIdentifier(
    identifier: IdentifierRef,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly SegmentMembership[]>;
  /** Every membership row for this segment, optionally filtered to one `status` (defaults to
   * `"entered"`, matching `GetSegmentMembers`' "who is in this segment right now" default) — the read
   * shape none of the other three engines in this context need, and the reason this store is keyed
   * per-membership rather than per-identifier. */
  listMembers(
    segmentId: string,
    tenantId: string,
    status?: SegmentMembershipStatus,
    tx?: unknown,
  ): Promise<readonly SegmentMembership[]>;
  /** Every distinct `(identifier, segmentId)` pair with a cached row — how `SegmentProjectionWorker`
   * finds what to rebuild without a separate registry (mirrors `AttributeStore.listIdentifiers`). */
  listIdentifiers(
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly { identifier: IdentifierRef; segmentId: string }[]>;
}
