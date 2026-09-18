import type { ComputedAttributeDefinition } from "./computed-attribute-definition";

/**
 * Where `ComputedAttributeDefinition`s are stored and looked up — deliberately its own port rather
 * than folded into `AttributeStore`, the same "definitions vs. current values are different
 * questions with different query shapes" reasoning `JourneyStore` vs. `SessionHistoryStore` already
 * documents for a different pair of concerns. A definition is authored configuration (edited rarely,
 * by an operator or an admin surface); a `ComputedAttribute`'s current values are a per-identifier
 * projection (recomputed constantly, by evaluation). Conflating the two stores would mean every
 * value read also has to filter out configuration rows, and vice versa.
 */
export interface AttributeDefinitionRegistry {
  /** Every known definition — how `EvaluateAttributeGraph`/`ComputedAttributeProjectionWorker`
   * discover the full dependency graph without a caller having to enumerate it by hand. */
  list(tenantId: string, tx?: unknown): Promise<readonly ComputedAttributeDefinition[]>;
  /** `null` when no definition is registered under this id — not an error; a dependency naming an
   * unregistered id is a configuration problem the caller surfaces explicitly (see
   * `EvaluateAttributeGraph`'s "unknown dependency" validation), not a silent skip. */
  getById(id: string, tenantId: string, tx?: unknown): Promise<ComputedAttributeDefinition | null>;
}
