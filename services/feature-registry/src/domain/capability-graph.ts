/**
 * CapabilityGraph (P1.1.1 §3) — a pure, deterministic dependency graph over feature definitions. Edges are drawn
 * from each feature's `dependencies` and its compatibility `requires`. The Feature Registry stores the flat lists;
 * this read-only service derives the enterprise graph on demand (Feature → Capability → … → Feature), supporting
 * traversal, reverse lookup, cycle detection, compatibility validation, upgrade-path and impact analysis.
 *
 * Deterministic: every result is sorted; traversal order never depends on insertion order.
 */
export interface CapabilityGraphNode {
  readonly key: string;
  /** Keys this node directly depends on / requires. */
  readonly dependsOn: readonly string[];
}

export interface CompatibilityGap {
  readonly key: string;
  readonly missing: readonly string[];
}

function sortUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

export class CapabilityGraph {
  private readonly edges: Map<string, string[]>;

  constructor(nodes: readonly CapabilityGraphNode[]) {
    this.edges = new Map();
    for (const node of nodes) this.edges.set(node.key, sortUnique(node.dependsOn));
    // Ensure referenced-but-undefined nodes still exist as (empty) vertices for traversal.
    for (const deps of [...this.edges.values()])
      for (const d of deps) if (!this.edges.has(d)) this.edges.set(d, []);
  }

  static fromFeatures(
    features: readonly {
      readonly key: string;
      readonly dependencies: readonly { readonly featureKey: string }[];
      readonly requires: readonly string[];
    }[],
  ): CapabilityGraph {
    return new CapabilityGraph(
      features.map((f) => ({
        key: f.key,
        dependsOn: [...f.dependencies.map((d) => d.featureKey), ...f.requires],
      })),
    );
  }

  keys(): readonly string[] {
    return sortUnique(this.edges.keys());
  }

  /** Direct dependencies of a key. */
  dependenciesOf(key: string): readonly string[] {
    return this.edges.get(key) ?? [];
  }

  /** All transitive dependencies (deterministic; excludes the node itself; safe on cycles). */
  transitiveDependencies(key: string): readonly string[] {
    const out = new Set<string>();
    const visit = (k: string): void => {
      for (const d of this.edges.get(k) ?? [])
        if (!out.has(d)) {
          out.add(d);
          visit(d);
        }
    };
    visit(key);
    out.delete(key);
    return sortUnique(out);
  }

  /** Direct dependents (reverse lookup). */
  dependents(key: string): readonly string[] {
    const out: string[] = [];
    for (const [k, deps] of this.edges) if (deps.includes(key)) out.push(k);
    return sortUnique(out);
  }

  /** Impact analysis — every feature transitively affected by a change to `key`. */
  impactOf(key: string): readonly string[] {
    const out = new Set<string>();
    const visit = (k: string): void => {
      for (const dep of this.dependents(k))
        if (!out.has(dep)) {
          out.add(dep);
          visit(dep);
        }
    };
    visit(key);
    out.delete(key);
    return sortUnique(out);
  }

  /** Circular-dependency detection — returns each cycle as an ordered key list (empty when acyclic). */
  detectCycles(): readonly (readonly string[])[] {
    const cycles: string[][] = [];
    const seen = new Set<string>();
    const stack: string[] = [];
    const inStack = new Set<string>();
    const visit = (k: string): void => {
      if (inStack.has(k)) {
        const start = stack.indexOf(k);
        if (start >= 0) cycles.push([...stack.slice(start), k]);
        return;
      }
      if (seen.has(k)) return;
      seen.add(k);
      stack.push(k);
      inStack.add(k);
      for (const d of this.edges.get(k) ?? []) visit(d);
      stack.pop();
      inStack.delete(k);
    };
    for (const k of this.keys()) visit(k);
    return cycles;
  }

  hasCycle(): boolean {
    return this.detectCycles().length > 0;
  }

  /** Compatibility validation — for each key, the required dependencies not present in `available`. */
  validateAgainst(available: Iterable<string>): readonly CompatibilityGap[] {
    const have = new Set(available);
    const gaps: CompatibilityGap[] = [];
    for (const k of this.keys()) {
      const missing = (this.edges.get(k) ?? []).filter((d) => !have.has(d));
      if (missing.length > 0) gaps.push({ key: k, missing: sortUnique(missing) });
    }
    return gaps;
  }

  /**
   * Upgrade-path analysis — a deterministic dependency path from `from` to `to` (following dependency edges),
   * or `null` when unreachable. Cycle-safe.
   */
  upgradePath(from: string, to: string): readonly string[] | null {
    const queue: string[][] = [[from]];
    const seen = new Set<string>([from]);
    while (queue.length > 0) {
      const path = queue.shift();
      if (path === undefined) break;
      const tail = path[path.length - 1];
      if (tail === to) return path;
      if (tail === undefined) continue;
      for (const d of this.edges.get(tail) ?? []) {
        if (!seen.has(d)) {
          seen.add(d);
          queue.push([...path, d]);
        }
      }
    }
    return null;
  }
}
