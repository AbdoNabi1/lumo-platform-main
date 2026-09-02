import { describe, expect, it } from "vitest";
import { addEdge, EMPTY_IDENTITY_GRAPH, resolveIdentity } from "@platform/tracking";
import { excludeRetractedEdges } from "./identity-resolution";

describe("excludeRetractedEdges", () => {
  it("removes only the exact retracted edge, leaving corroborating evidence intact", () => {
    const wrongEdge = {
      fromType: "visitor_id" as const,
      fromValue: "v1",
      toType: "device_id" as const,
      toValue: "shared-family-tablet",
      confidence: "probabilistic" as const,
      observedAt: "2026-07-01T00:00:00.000Z",
      source: "server_stitch",
    };
    const otherEdge = {
      ...wrongEdge,
      toValue: "device_id-2",
      observedAt: "2026-07-02T00:00:00.000Z",
    };

    const graph = addEdge(addEdge(EMPTY_IDENTITY_GRAPH, wrongEdge), otherEdge);
    const filtered = excludeRetractedEdges(graph, [wrongEdge]);

    expect(filtered.edges).toHaveLength(1);
    expect(filtered.edges[0]).toEqual(otherEdge);
    // Nodes are never removed — a retraction disputes a LINK, not the identifier's existence.
    expect(filtered.nodes.size).toBe(graph.nodes.size);
  });

  it("retracts an edge regardless of which endpoint was recorded as from vs. to", () => {
    // @platform/tracking documents an IdentityEdge as an undirected, symmetric same-person claim
    // (identity-graph.ts: "Traversal is undirected"). A caller retracting an edge it reconstructed
    // from `GetIdentityTimeline` (which reports a subject/counterpart view, not the original
    // from/to) must still match the stored edge even with endpoints swapped.
    const stored = {
      fromType: "visitor_id" as const,
      fromValue: "v1",
      toType: "device_id" as const,
      toValue: "shared-tablet",
      confidence: "probabilistic" as const,
      observedAt: "2026-07-01T00:00:00.000Z",
      source: "server_stitch",
    };
    const swapped = {
      ...stored,
      fromType: stored.toType,
      fromValue: stored.toValue,
      toType: stored.fromType,
      toValue: stored.fromValue,
    };

    const graph = addEdge(EMPTY_IDENTITY_GRAPH, stored);
    const filtered = excludeRetractedEdges(graph, [swapped]);

    expect(filtered.edges).toHaveLength(0);
  });

  it("is a no-op when nothing is retracted", () => {
    const edge = {
      fromType: "visitor_id" as const,
      fromValue: "v1",
      toType: "email_hash" as const,
      toValue: "hash1",
      confidence: "deterministic" as const,
      observedAt: "2026-07-01T00:00:00.000Z",
      source: "checkout",
    };
    const graph = addEdge(EMPTY_IDENTITY_GRAPH, edge);
    expect(excludeRetractedEdges(graph, [])).toBe(graph);
  });

  it("a retracted edge is excluded from BFS resolution", () => {
    const edge = {
      fromType: "visitor_id" as const,
      fromValue: "v1",
      toType: "device_id" as const,
      toValue: "shared-tablet",
      confidence: "probabilistic" as const,
      observedAt: "2026-07-01T00:00:00.000Z",
      source: "server_stitch",
    };
    const graph = addEdge(EMPTY_IDENTITY_GRAPH, edge);
    const withoutEdge = excludeRetractedEdges(graph, [edge]);

    const resolved = resolveIdentity(withoutEdge, "visitor_id", "v1");
    expect(resolved?.members).toHaveLength(1);
    expect(resolved?.members[0]?.value).toBe("v1");
  });
});
