/**
 * The Computed Attributes dependency graph — pure graph theory over attribute *names*, never over
 * `@platform/rules`' `RuleSet` or `@platform/expression`'s `Expression` (which definition owns which
 * rule set is a `ports/computed-attribute-definition.ts` concern; this module never needs to know).
 * Kept here, not in application, because "does this dependency graph have a cycle" and "what order
 * must these attributes evaluate in" are facts about the graph alone — no I/O, no clock, no rule
 * evaluation, the same purity discipline `session-views.ts`'s `journeySegments`/`journeyState`
 * already hold themselves to for a different, but structurally similar, graph-shaped read.
 */

/** One edge: `attribute` cannot be evaluated until `dependsOn` has a value. */
export interface AttributeDependency {
  readonly attribute: string;
  readonly dependsOn: string;
}

export interface AttributeCycleError {
  readonly code: "cycle";
  /** The cycle itself, in traversal order, first node repeated last (`["a", "b", "c", "a"]`) — a
   * caller-facing, unambiguous explanation of exactly which attributes form the loop, not just "a
   * cycle exists somewhere". */
  readonly cycle: readonly string[];
}

export type TopologicalOrderResult =
  | { readonly ok: true; readonly order: readonly string[] }
  | { readonly ok: false; readonly error: AttributeCycleError };

/**
 * Orders `attributes` so every dependency is evaluated before its dependents (Kahn's algorithm).
 * Deterministic for a given input: nodes with no unresolved dependency enter the frontier in
 * `attributes`' own declaration order and are processed FIFO, so identical inputs always produce an
 * identical order — the same determinism guarantee the evaluator built on top of this must uphold
 * end-to-end (Phase 6.4 brief's explicit requirement).
 *
 * **Stops rather than guesses on a cycle**: if every remaining attribute still has an unresolved
 * dependency once the frontier is exhausted, the graph has at least one cycle — `findCycle` extracts
 * one concrete cycle (not merely "a cycle exists") from exactly those stuck nodes, via DFS
 * back-edge detection, so the caller gets an actionable error rather than a silent partial order.
 */
export function topologicalOrder(
  attributes: readonly string[],
  dependencies: readonly AttributeDependency[],
): TopologicalOrderResult {
  const requires = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // getOrCreate, not get-then-assert: returns the (possibly freshly created) list itself, so
  // callers never need a non-null assertion on a lookup they just guaranteed will succeed.
  const getRequires = (name: string): string[] => {
    const existing = requires.get(name);
    if (existing !== undefined) return existing;
    const created: string[] = [];
    requires.set(name, created);
    return created;
  };
  const getDependents = (name: string): string[] => {
    const existing = dependents.get(name);
    if (existing !== undefined) return existing;
    const created: string[] = [];
    dependents.set(name, created);
    return created;
  };
  const ensure = (name: string): void => {
    getRequires(name);
    getDependents(name);
    if (!inDegree.has(name)) inDegree.set(name, 0);
  };

  for (const name of attributes) ensure(name);
  for (const edge of dependencies) {
    ensure(edge.attribute);
    ensure(edge.dependsOn);
    getRequires(edge.attribute).push(edge.dependsOn);
    getDependents(edge.dependsOn).push(edge.attribute);
    inDegree.set(edge.attribute, (inDegree.get(edge.attribute) ?? 0) + 1);
  }

  const allNames = [...inDegree.keys()];
  const remaining = new Map(inDegree);
  const queue = allNames.filter((name) => remaining.get(name) === 0);
  const order: string[] = [];

  // `queue` grows during iteration (BFS frontier) — a `for...of` over an array picks up elements
  // pushed after iteration starts (its default iterator re-reads `length` on every step), so this
  // needs no index/cursor and therefore no non-null assertion on a bounds-checked index.
  for (const name of queue) {
    order.push(name);
    for (const dependent of dependents.get(name) ?? []) {
      const next = (remaining.get(dependent) ?? 0) - 1;
      remaining.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }

  if (order.length === allNames.length) {
    return { ok: true, order };
  }

  const resolved = new Set(order);
  const stuck = allNames.filter((name) => !resolved.has(name));
  return { ok: false, error: { code: "cycle", cycle: findCycle(stuck, requires) } };
}

/** DFS back-edge cycle extraction, restricted to `candidates` (nodes Kahn's algorithm could never
 * resolve — provably at least one real cycle lives among them). */
function findCycle(
  candidates: readonly string[],
  requires: ReadonlyMap<string, string[]>,
): readonly string[] {
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];

  function visit(name: string): readonly string[] | undefined {
    const current = state.get(name);
    if (current === "visiting") {
      const start = path.indexOf(name);
      return [...path.slice(start), name];
    }
    if (current === "done") return undefined;

    state.set(name, "visiting");
    path.push(name);
    for (const next of requires.get(name) ?? []) {
      const found = visit(next);
      if (found !== undefined) return found;
    }
    path.pop();
    state.set(name, "done");
    return undefined;
  }

  for (const name of candidates) {
    const found = visit(name);
    if (found !== undefined) return found;
  }

  // Unreachable in practice: `topologicalOrder` only calls this with a non-empty `candidates` whose
  // members it has already proven cannot all reach in-degree zero, which is only possible if a
  // cycle exists among them. Returned as a (deliberately honest, non-empty) fallback rather than
  // thrown, so a caller's error handling never has to special-case "cycle but no path" separately
  // from "cycle".
  return candidates;
}

/**
 * Every attribute transitively affected by a change to any attribute in `changed` — **including**
 * `changed` itself, so a caller gets one unified recompute set rather than needing to remember to
 * union it back in. This is the mechanism behind the Phase 6.4 brief's Incremental Evaluation
 * requirement: when one attribute's inputs change, only this closure is worth re-evaluating, never
 * the full attribute set.
 *
 * Returns an unordered set deliberately — evaluation order is a separate concern
 * (`topologicalOrder`'s job). A caller filters the full graph's own topological order down to this
 * set (`fullOrder.filter((name) => closure.has(name))`) to get a correctly ordered recompute
 * sequence: a sub-sequence of a valid topological order is itself a valid topological order for the
 * induced sub-graph, so no second graph traversal — and no second cycle check — is ever needed here.
 */
export function dependentsOf(
  changed: readonly string[],
  dependencies: readonly AttributeDependency[],
): ReadonlySet<string> {
  const dependents = new Map<string, string[]>();
  for (const edge of dependencies) {
    const list = dependents.get(edge.dependsOn) ?? [];
    list.push(edge.attribute);
    dependents.set(edge.dependsOn, list);
  }

  const closure = new Set<string>(changed);
  const queue = [...changed];
  // Same growing-array `for...of` as `topologicalOrder` — no cursor, no non-null assertion.
  for (const name of queue) {
    for (const dependent of dependents.get(name) ?? []) {
      if (!closure.has(dependent)) {
        closure.add(dependent);
        queue.push(dependent);
      }
    }
  }

  return closure;
}
