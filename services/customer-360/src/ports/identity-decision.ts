import type { IdentifierType, IdentityEdge } from "@platform/tracking";

/** A reference to one identifier, the unit merge/split/timeline queries operate on. */
export interface IdentifierRef {
  readonly type: IdentifierType;
  readonly value: string;
}

/**
 * An explicit, provenance-carrying decision — merge or split — layered on top of the append-only
 * observation graph (`@platform/tracking`'s `IdentityGraph`). Decisions are themselves append-only
 * and never overwritten (FF-CDP-03: merges must preserve provenance), which is why `split` retracts
 * an edge from resolution rather than deleting it.
 */
export interface IdentityDecision {
  readonly id: string;
  readonly kind: "merge" | "split";
  readonly subject: IdentifierRef;
  readonly related: IdentifierRef;
  /** The edge a split retracts from future resolution. Absent for a merge (the merge's own new
   * edge is recorded separately, alongside the graph, not here). */
  readonly retractedEdge?: IdentityEdge;
  readonly reason: string;
  readonly actor: string;
  readonly occurredAt: string;
}
