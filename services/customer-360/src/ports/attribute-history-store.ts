import type { DomainEvent } from "@platform/domain";
import type { IdentifierRef } from "./identity-decision";
import type { AttributeSnapshot } from "../domain/attribute-snapshot";

/**
 * Persistence port for the computed-attribute ledger — the durable source of truth `AttributeStore`'s
 * cache is rebuilt from. Append-only, same discipline as `ProfileHistoryStore`/`SessionHistoryStore`:
 * a snapshot is never updated or deleted, only appended — the audit trail behind "why is this
 * customer's attribute what it is today" (Phase 6.4's Explainability requirement) depends on it.
 */
export interface AttributeHistoryStore {
  /** Persists one snapshot. `event` is written to the outbox in the same unit of work — mirrors
   * `ProfileHistoryStore.append`'s shape exactly (same package, same convention). Optional, mirroring
   * `SessionHistoryStore.append`'s own divergence: `RebuildComputedAttributes` appends a
   * `reason: "rebuilt"` snapshot with nothing new to publish (it recomputes the cache, it does not
   * assert a new fact). */
  append(
    snapshot: AttributeSnapshot,
    tenantId: string,
    event?: DomainEvent,
    tx?: unknown,
  ): Promise<void>;
  /** Every snapshot for this identifier, oldest first — the attribute set's own history/provenance
   * trail. */
  listFor(
    identifier: IdentifierRef,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly AttributeSnapshot[]>;
  /** The most recent snapshot only — `RebuildComputedAttributes` needs just this (each snapshot is a
   * full capture, so replay-from-latest is sufficient; see `domain/attribute-snapshot.ts`). `null`
   * when the identifier has no history yet. */
  latestFor(
    identifier: IdentifierRef,
    tenantId: string,
    tx?: unknown,
  ): Promise<AttributeSnapshot | null>;
}
