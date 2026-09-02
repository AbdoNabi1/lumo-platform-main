/**
 * A **relation tuple** (sprint P2.0-C §16, ReBAC) — `namespace:object#relation@subject`, the
 * Zanzibar/Keto shape. `subject` is either a direct principal id (`principal:abc`) or a **subject-set**
 * (`object#relation`) for indirect grants (group membership, role expansion). Security models tuples
 * for the in-context **decision** (`RelationshipGraph`); Ory **Keto** remains the enforcement point
 * (`packages/auth`) — this is the decide/enforce split, not a duplicate store.
 */
export interface RelationTupleProps {
  readonly namespace: string;
  readonly object: string;
  readonly relation: string;
  readonly subject: string;
}

export class RelationTuple {
  readonly id: string;
  readonly namespace: string;
  readonly object: string;
  readonly relation: string;
  readonly subject: string;

  constructor(props: RelationTupleProps & { readonly id: string }) {
    this.id = props.id;
    this.namespace = props.namespace;
    this.object = props.object;
    this.relation = props.relation;
    this.subject = props.subject;
    Object.freeze(this);
  }

  /** Stable dedup key (identity ignores the surrogate id). */
  key(): string {
    return `${this.namespace}:${this.object}#${this.relation}@${this.subject}`;
  }

  /**
   * Inverse of {@link key} — reconstructs the four tuple components from a `namespace:object#relation
   * @subject` key. Owned by the domain so the Keto synchronization consumer never re-parses the format
   * itself (single source of truth; round-trip tested). Returns `null` on a malformed key.
   */
  static parseKey(key: string): RelationTupleProps | null {
    const at = key.lastIndexOf("@");
    if (at <= 0) return null;
    const subject = key.slice(at + 1);
    const left = key.slice(0, at); // namespace:object#relation
    const colon = left.indexOf(":");
    if (colon <= 0) return null;
    const namespace = left.slice(0, colon);
    const rest = left.slice(colon + 1); // object#relation
    const hash = rest.lastIndexOf("#");
    if (hash <= 0) return null;
    const object = rest.slice(0, hash);
    const relation = rest.slice(hash + 1);
    if (object.length === 0 || relation.length === 0 || subject.length === 0) return null;
    return { namespace, object, relation, subject };
  }

  /** True when the subject is an indirect subject-set (`object#relation`) rather than a direct id. */
  get isSubjectSet(): boolean {
    return this.subject.includes("#");
  }
}

export interface RelationQuery {
  readonly namespace: string;
  readonly object: string;
  readonly relation: string;
  readonly subjectId: string;
}

const MAX_DEPTH = 32;

/**
 * The **relationship graph** — evaluates a ReBAC `check` over a set of tuples with **subject-set
 * rewrite** (userset expansion), cycle-safe and depth-bounded. Pure and deterministic; it mirrors
 * Keto's check semantics so the in-context decision matches enforcement.
 */
export class RelationshipGraph {
  check(tuples: readonly RelationTuple[], query: RelationQuery): boolean {
    return this.walk(tuples, query, new Set<string>(), 0);
  }

  private walk(
    tuples: readonly RelationTuple[],
    query: RelationQuery,
    seen: Set<string>,
    depth: number,
  ): boolean {
    if (depth > MAX_DEPTH) return false;
    const node = `${query.namespace}:${query.object}#${query.relation}`;
    if (seen.has(node)) return false;
    seen.add(node);
    for (const tuple of tuples) {
      if (
        tuple.namespace !== query.namespace ||
        tuple.object !== query.object ||
        tuple.relation !== query.relation
      )
        continue;
      if (tuple.subject === query.subjectId) return true;
      if (tuple.isSubjectSet) {
        const [usObject, usRelation] = tuple.subject.split("#") as [string, string];
        if (
          this.walk(
            tuples,
            {
              namespace: query.namespace,
              object: usObject,
              relation: usRelation,
              subjectId: query.subjectId,
            },
            seen,
            depth + 1,
          )
        )
          return true;
      }
    }
    return false;
  }
}
