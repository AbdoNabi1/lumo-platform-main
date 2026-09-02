import type { IdentityEdge, IdentityGraph } from "@platform/tracking";

/** Stable key for an edge. Endpoints are order-independent — `@platform/tracking` documents an
 * `IdentityEdge` as an undirected, symmetric same-person claim (traversal walks both directions),
 * so a caller retracting or looking up an edge by its two endpoints must match regardless of which
 * side was recorded as `from` vs. `to`. `observedAt` + `source` stay part of the key (not just
 * endpoints) so retracting one wrong observation never silently retracts a later, corroborating one
 * between the same two identifiers. */
function edgeKey(edge: IdentityEdge): string {
  const from = `${edge.fromType}:${edge.fromValue}`;
  const to = `${edge.toType}:${edge.toValue}`;
  const [first, second] = from <= to ? [from, to] : [to, from];
  return `${first}|${second}|${edge.observedAt}|${edge.source}`;
}

/**
 * Filters retracted edges out of a graph before resolution. Composes over `@platform/tracking`'s
 * exported `IdentityGraph` shape rather than reimplementing traversal — the graph itself is never
 * mutated or persisted in this filtered form; this is a read-time view.
 */
export function excludeRetractedEdges(
  graph: IdentityGraph,
  retracted: readonly IdentityEdge[],
): IdentityGraph {
  if (retracted.length === 0) return graph;
  const retractedKeys = new Set(retracted.map(edgeKey));
  return {
    nodes: graph.nodes,
    edges: graph.edges.filter((edge) => !retractedKeys.has(edgeKey(edge))),
  };
}

export { edgeKey };
