import type { DomainEvent } from "@platform/domain";
import type { IdentityEdge, IdentityGraph } from "@platform/tracking";

/**
 * Persistence port for the accumulated identity graph. Customer 360 does not reimplement identity
 * stitching — it persists edges observed via `@platform/tracking`'s pure `stitchFromIdentifiers`/
 * `addEdge` and rehydrates the full graph so `resolveIdentity` can run over durable history, not
 * just the in-process one. One PostgreSQL row per edge (append-only, tenant-scoped).
 */
export interface IdentityGraphStore {
  /** Persists one edge (and its endpoint nodes). When `event` is supplied it is written to the
   * outbox in the same unit of work — organic observations always carry one; a merge/split's edge
   * is written silently here because its provenance event is published via
   * {@link IdentityDecisionStore.record} instead, so the fact is published exactly once. */
  appendEdge(edge: IdentityEdge, event?: DomainEvent, tx?: unknown): Promise<void>;

  /** Rehydrates the full graph from durable storage (tenant-scoped by the adapter). */
  loadGraph(tx?: unknown): Promise<IdentityGraph>;
}
