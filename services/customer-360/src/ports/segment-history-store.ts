import type { DomainEvent } from "@platform/domain";
import type { IdentifierRef } from "./identity-decision";
import type { SegmentHistoryEntry } from "../domain/segment-history";

/**
 * Persistence port for the segment-membership ledger — the durable source of truth `SegmentStore`'s
 * cache is rebuilt from. Append-only, same discipline as `AttributeHistoryStore`: an entry is never
 * updated or deleted, only appended — the audit trail behind "why is this customer a member of this
 * segment today, and when did they enter/exit" (the brief's Explainability + Segment History
 * requirements) depends on it.
 */
export interface SegmentHistoryStore {
  /** Persists one entry. `event` is written to the outbox in the same unit of work — mirrors
   * `AttributeHistoryStore.append`'s shape exactly. Optional: `RebuildSegmentMembership` appends a
   * `reason: "rebuilt"` entry with nothing new to publish (it recomputes the cache, it does not assert
   * a new fact). */
  append(entry: SegmentHistoryEntry, event?: DomainEvent, tx?: unknown): Promise<void>;
  /** Every entry for this `(identifier, segmentId)` pair, oldest first — the membership's own
   * history/provenance trail. */
  listFor(
    identifier: IdentifierRef,
    segmentId: string,
    tx?: unknown,
  ): Promise<readonly SegmentHistoryEntry[]>;
  /** The most recent entry only — `RebuildSegmentMembership` needs just this (each entry is a full
   * capture, so replay-from-latest is sufficient). `null` when the pair has no history yet. */
  latestFor(
    identifier: IdentifierRef,
    segmentId: string,
    tx?: unknown,
  ): Promise<SegmentHistoryEntry | null>;
}
