import type { IdentifierRef } from "./identity-decision";
import type { CustomerProfile } from "../domain/customer-profile";

/**
 * Persistence port for the **current** materialized profile — a rebuildable serving cache, not the
 * source of truth (`ProfileHistoryStore` is). Matches 03-CUSTOMER_360_SPEC.md §15 exactly:
 * "Projection is rebuildable by event replay" — this store may be upserted in place (unlike the
 * append-only ledgers) because losing or corrupting a row here is recoverable by
 * `RebuildProfileProjection`, never a data-loss event.
 */
export interface ProfileStore {
  getCurrent(identifier: IdentifierRef, tx?: unknown): Promise<CustomerProfile | null>;
  /** Upsert — replaces whatever was cached for this identifier. Safe only because this store is a
   * disposable projection; never call this expecting append-only semantics (use
   * `ProfileHistoryStore.append` for the durable record). */
  saveCurrent(profile: CustomerProfile, tx?: unknown): Promise<void>;
  /** Every identifier with at least one cached profile — how `ProfileProjectionWorker` finds what to
   * rebuild without needing a separate registry. */
  listIdentifiers(tx?: unknown): Promise<readonly IdentifierRef[]>;
}
