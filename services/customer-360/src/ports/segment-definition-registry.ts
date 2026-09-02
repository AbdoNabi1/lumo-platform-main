import type { DomainEvent } from "@platform/domain";
import type { SegmentDefinition } from "./segment-definition";

/**
 * Where `SegmentDefinition`s are stored and looked up. Unlike `AttributeDefinitionRegistry` (which is
 * deliberately read-only — Computed Attribute definitions are seed-only configuration), this registry
 * is **read-write**: the brief's `CreateSegment`/`UpdateSegment`/`DeleteSegment` use cases are a real
 * authoring lifecycle Computed Attributes never had. `save`/`delete` use the identical ADR-0060/D-042
 * compare-and-swap idiom every other versioned store in this context already follows — a definition is
 * still configuration, but it is configuration an operator edits through this engine's own write API,
 * not only through a seed/migration script.
 */
export interface SegmentDefinitionRegistry {
  /** Every known definition — how `EvaluateAllSegments`/`SegmentProjectionWorker`/
   * `SegmentMembershipWorker` discover the full segment set without a caller having to enumerate it by
   * hand. */
  list(tx?: unknown): Promise<readonly SegmentDefinition[]>;
  /** `null` when no definition is registered under this id — not an error. */
  getById(id: string, tx?: unknown): Promise<SegmentDefinition | null>;
  /**
   * Upsert. **Optimistic concurrency (ADR-0060).** When `expectedVersion` is provided, this is a
   * compare-and-swap write: the write only applies if the store's currently-persisted version for this
   * id equals `expectedVersion` — `0` meaning "no definition must exist yet" (`CreateSegment`).
   * Otherwise this throws `ConcurrencyError` (`@platform/utils`, `retryable: true`) — never silently
   * applied on top of stale state. `event` is written to the outbox in the same unit of work
   * (`SegmentCreated`/`SegmentUpdated`) — mirrors `JourneyStore.record`'s optional-event shape; there
   * is no separate history store for definitions to publish through instead (definitions are not an
   * append-only ledger the way membership is), so the event travels with the write itself.
   */
  save(
    definition: SegmentDefinition,
    expectedVersion?: number,
    event?: DomainEvent,
    tx?: unknown,
  ): Promise<void>;
  /**
   * Removes a definition from future evaluation only — never cascades into `SegmentMembership`/
   * `SegmentHistory` rows (this context is append-only/never-delete everywhere else; a definition is
   * the one genuinely deletable aggregate in it, and deleting it must not retroactively erase the
   * audit trail of memberships it once produced). `expectedVersion` is required (unlike `save`'s CAS
   * write) — there is no "rebuild" analog that would ever need an unconditional delete.
   */
  delete(id: string, expectedVersion: number, event?: DomainEvent, tx?: unknown): Promise<void>;
}
