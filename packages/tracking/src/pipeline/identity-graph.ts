/**
 * Identity stitching (directive §Identity Stitching; doc 17 §4).
 *
 * The graph is **append-only and immutable**: a node is never mutated, an edge is never removed,
 * and a merge is a new observation rather than an overwrite. Identity history is the audit trail
 * for every attribution decision — if a stitch turns out to be wrong, we need to see *when* it was
 * asserted and on what evidence, which is impossible if the graph is edited in place.
 *
 * The platform stitches identity; it does not **own** it. `services/identity` owns the customer
 * record and consent (ADR-0032 §Ownership).
 */

import type {
  IdentifierType,
  IdentityConfidence,
  IdentityEdge,
} from "../envelope/identity-context";

/** An immutable node: one identifier value of one type. */
export interface IdentityNode {
  readonly type: IdentifierType;
  readonly value: string;
  readonly firstSeenAt: string;
}

/** Stable key for a node. Types are namespaced so an email can never collide with a customer id. */
export function nodeKey(type: IdentifierType, value: string): string {
  return `${type}:${value}`;
}

/**
 * An append-only graph. Both collections are readonly; every operation returns a **new** graph, so
 * a caller cannot accidentally mutate shared history.
 */
export interface IdentityGraph {
  readonly nodes: ReadonlyMap<string, IdentityNode>;
  readonly edges: readonly IdentityEdge[];
}

export const EMPTY_IDENTITY_GRAPH: IdentityGraph = { nodes: new Map(), edges: [] };

/**
 * Adds a node if unseen. An existing node is returned untouched — `firstSeenAt` is part of its
 * identity and re-observing an identifier must never move it forward.
 */
export function addNode(
  graph: IdentityGraph,
  type: IdentifierType,
  value: string,
  observedAt: string,
): IdentityGraph {
  const key = nodeKey(type, value);
  if (graph.nodes.has(key)) return graph;

  const nodes = new Map(graph.nodes);
  nodes.set(key, { type, value, firstSeenAt: observedAt });
  return { nodes, edges: graph.edges };
}

/**
 * Appends an observed link. Duplicate observations are retained deliberately: repeated evidence
 * for the same link is *what raises confidence*, so collapsing them would discard signal.
 */
export function addEdge(graph: IdentityGraph, edge: IdentityEdge): IdentityGraph {
  const withNodes = addNode(
    addNode(graph, edge.fromType, edge.fromValue, edge.observedAt),
    edge.toType,
    edge.toValue,
    edge.observedAt,
  );

  return { nodes: withNodes.nodes, edges: [...withNodes.edges, edge] };
}

/**
 * Identifier types that, when linked, constitute deterministic proof of the same person — a login
 * or a verified email. Everything else is probabilistic (shared device, same IP).
 */
const DETERMINISTIC_TYPES: readonly IdentifierType[] = [
  "customer_id",
  "external_id",
  "crm_id",
  "email_hash",
  "phone_hash",
  "loyalty_id",
];

/** Classifies an edge, so callers do not each invent their own confidence rules. */
export function classifyEdge(from: IdentifierType, to: IdentifierType): IdentityConfidence {
  return DETERMINISTIC_TYPES.includes(from) || DETERMINISTIC_TYPES.includes(to)
    ? "deterministic"
    : "probabilistic";
}

/** The identity cluster reachable from a seed, with the evidence that connected it. */
export interface ResolvedIdentity {
  readonly seed: IdentityNode;
  readonly members: readonly IdentityNode[];
  /** 0–1. Deterministic evidence dominates; corroborating observations add diminishing weight. */
  readonly confidenceScore: number;
  readonly confidence: IdentityConfidence;
  /** Edges traversed, so a stitch can always be explained. */
  readonly evidence: readonly IdentityEdge[];
}

/**
 * Resolves everything reachable from a seed identifier by breadth-first traversal. Traversal is
 * undirected: an edge asserts that two identifiers belong to the same person, which is a symmetric
 * claim.
 */
export function resolveIdentity(
  graph: IdentityGraph,
  seedType: IdentifierType,
  seedValue: string,
): ResolvedIdentity | undefined {
  const seedKey = nodeKey(seedType, seedValue);
  const seed = graph.nodes.get(seedKey);
  if (seed === undefined) return undefined;

  const visited = new Set<string>([seedKey]);
  const queue: string[] = [seedKey];
  const evidence: IdentityEdge[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;

    for (const edge of graph.edges) {
      const from = nodeKey(edge.fromType, edge.fromValue);
      const to = nodeKey(edge.toType, edge.toValue);

      const next = from === current ? to : to === current ? from : undefined;
      if (next === undefined) continue;

      evidence.push(edge);
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }

  const members = [...visited]
    .map((key) => graph.nodes.get(key))
    .filter((node): node is IdentityNode => node !== undefined);

  return {
    seed,
    members,
    confidenceScore: scoreConfidence(evidence),
    confidence: evidence.some((e) => e.confidence === "deterministic")
      ? "deterministic"
      : "probabilistic",
    evidence,
  };
}

/** A single deterministic link (a login, a verified email) anchors confidence here. */
export const DETERMINISTIC_FLOOR = 0.9;

/**
 * Hard ceiling for probabilistic-only evidence. It sits **below** {@link DETERMINISTIC_FLOOR} by
 * construction, so no amount of weak evidence can ever reach the certainty of one login.
 */
export const PROBABILISTIC_CEILING = 0.7;

/**
 * Confidence score in [0, 1].
 *
 * The two evidence classes occupy **disjoint bands**, which is the property that matters: a
 * cluster built only from shared devices and IP proximity must never outrank an authenticated
 * link, or a family sharing a tablet gets merged into one person and their attribution — and their
 * personal data — cross-contaminates.
 *
 * Within each band, corroborating observations add with diminishing returns.
 */
export function scoreConfidence(evidence: readonly IdentityEdge[]): number {
  if (evidence.length === 0) return 0;

  const deterministic = evidence.filter((e) => e.confidence === "deterministic").length;
  const probabilistic = evidence.length - deterministic;

  if (deterministic === 0) {
    return Number((PROBABILISTIC_CEILING * (1 - Math.pow(0.6, probabilistic))).toFixed(4));
  }

  // Starts at the floor for one deterministic link and approaches 1 as evidence accumulates.
  const corroboration =
    (1 - DETERMINISTIC_FLOOR) * (1 - Math.pow(0.5, deterministic - 1 + probabilistic * 0.5));

  return Math.min(1, Number((DETERMINISTIC_FLOOR + corroboration).toFixed(4)));
}

/**
 * Derives the edges implied by an event's identity block: every strong identifier is linked to the
 * visitor. This is the stitching step — it observes links, it never decides who someone is.
 */
export function stitchFromIdentifiers(
  graph: IdentityGraph,
  input: {
    readonly visitorId: string;
    readonly identifiers: readonly { readonly type: IdentifierType; readonly value: string }[];
    readonly observedAt: string;
    readonly source: string;
  },
): IdentityGraph {
  let next = addNode(graph, "visitor_id", input.visitorId, input.observedAt);

  for (const identifier of input.identifiers) {
    if (identifier.value.trim() === "") continue;

    next = addEdge(next, {
      fromType: "visitor_id",
      fromValue: input.visitorId,
      toType: identifier.type,
      toValue: identifier.value,
      confidence: classifyEdge("visitor_id", identifier.type),
      observedAt: input.observedAt,
      source: input.source,
    });
  }

  return next;
}
