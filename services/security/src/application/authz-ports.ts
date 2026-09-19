import type { RelationQuery, RelationTupleProps } from "../domain/relationship";

/**
 * The **relationship check** port (sprint P2.0-C §16, ReBAC) — answers a Zanzibar-style
 * `namespace:object#relation@subject` check. The in-memory adapter evaluates the
 * {@link RelationshipGraph} over stored tuples; the production adapter delegates to Ory **Keto**
 * (`packages/auth`), which is the enforcement point. Security decides; Keto enforces — no duplicate
 * tuple store on the enforcement path.
 */
export interface RelationshipCheckPort {
  check(query: RelationQuery, tenantId: string): Promise<boolean>;
}

/**
 * The **relationship synchronization** port (H-2 / G-SEC-4) — projects Security's ReBAC *decision*
 * tuples into the *enforcement* point (Ory **Keto**). Security decides against its own tuple store and
 * emits `security.relation.written/deleted`; the sync consumer drives this port so enforcement stays in
 * lockstep. Interface only in-context: Security is **never coupled** to Keto — the Keto adapter lives in
 * the composition/runtime layer (like `KetoAccessControl`), exactly as the frozen design requires.
 */
export interface RelationshipSyncPort {
  write(tuple: RelationTupleProps): Promise<void>;
  delete(tuple: RelationTupleProps): Promise<void>;
}
