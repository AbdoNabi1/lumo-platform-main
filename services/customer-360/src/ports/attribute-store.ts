import type { IdentifierRef } from "./identity-decision";
import type { ComputedAttribute } from "../domain/computed-attribute";

/**
 * Persistence port for the **current** materialized computed-attribute set — a rebuildable serving
 * cache, not the source of truth (`AttributeHistoryStore` is). Same rebuildable-cache contract
 * `ProfileStore`/`SessionStore` already establish: this store may be upserted in place because
 * losing or corrupting a row here is recoverable by `RebuildComputedAttributes`, never a data-loss
 * event.
 */
export interface AttributeStore {
  getCurrent(identifier: IdentifierRef, tx?: unknown): Promise<ComputedAttribute | null>;
  /**
   * Upsert — replaces whatever was cached for this identifier. Never call this expecting
   * append-only semantics (use `AttributeHistoryStore.append` for the durable record).
   *
   * **Optimistic concurrency (ADR-0060).** When `expectedVersion` is provided, this is a
   * compare-and-swap write, the same convention every other versioned repository on this platform
   * already follows (D-042): the write only applies if the store's currently-persisted version for
   * this identifier equals `expectedVersion` — `0` (`INITIAL_ATTRIBUTE_VERSION`,
   * `domain/attribute-version.ts`) meaning "no row must exist yet". Otherwise this throws
   * `ConcurrencyError` (`@platform/utils`, `retryable: true`) — the write is rejected outright, it
   * is never silently applied on top of stale state. `UpdateComputedAttributeProjection` is the one
   * caller that must pass this (it always has the version it just read).
   *
   * When `expectedVersion` is omitted, this is the original unconditional overwrite — reserved for
   * `RebuildComputedAttributes`'s recovery semantics (a cache being rebuilt from the durable ledger
   * has no trustworthy version of its own to compare against) and for tests seeding store state
   * directly. Never used by the normal evaluate-and-persist write path.
   */
  saveCurrent(attribute: ComputedAttribute, expectedVersion?: number, tx?: unknown): Promise<void>;
  /** Every identifier with at least one cached computed-attribute set — how
   * `ComputedAttributeProjectionWorker` finds what to rebuild without a separate registry (mirrors
   * `ProfileStore.listIdentifiers`/`SessionStore.listSessionIds`). */
  listIdentifiers(tx?: unknown): Promise<readonly IdentifierRef[]>;
}
