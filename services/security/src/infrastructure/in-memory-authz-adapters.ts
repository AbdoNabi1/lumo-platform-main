import { RelationshipGraph, type RelationQuery } from "../domain/relationship";
import type { RelationTupleRepository } from "../domain/repositories";
import type { RelationshipCheckPort } from "../application/authz-ports";

/**
 * In-memory {@link RelationshipCheckPort} — evaluates the {@link RelationshipGraph} (subject-set
 * rewrite) over the stored tuples. This is the in-context ReBAC **decision** engine; the production
 * adapter delegates to Ory **Keto** (`packages/auth`, the enforcement point) — same check semantics,
 * no duplicated enforcement store (ADR-0023 decide/enforce split).
 */
export class InMemoryRelationshipCheck implements RelationshipCheckPort {
  private readonly graph = new RelationshipGraph();
  constructor(private readonly tuples: RelationTupleRepository) {}

  async check(query: RelationQuery, tenantId: string): Promise<boolean> {
    return this.graph.check(await this.tuples.listAll(tenantId), query);
  }
}
