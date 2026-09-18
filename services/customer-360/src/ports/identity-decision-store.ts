import type { DomainEvent } from "@platform/domain";
import type { IdentityEdge } from "@platform/tracking";
import type { IdentifierRef, IdentityDecision } from "./identity-decision";

/**
 * Persistence port for merge/split decisions (provenance ledger, FF-CDP-03) and the derived set of
 * retracted edges resolution must exclude. Decisions are append-only, same discipline as the graph
 * itself.
 */
export interface IdentityDecisionStore {
  record(
    decision: IdentityDecision,
    event: DomainEvent,
    tenantId: string,
    tx?: unknown,
  ): Promise<void>;

  /** Every merge/split decision touching this identifier, oldest first — the identity timeline. */
  listFor(
    identifier: IdentifierRef,
    tenantId: string,
    tx?: unknown,
  ): Promise<readonly IdentityDecision[]>;

  /** Every edge retracted by a split, across all decisions — resolution excludes these. */
  retractedEdges(tenantId: string, tx?: unknown): Promise<readonly IdentityEdge[]>;
}
