import { describe, expect, it } from "vitest";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireCustomer360 } from "../composition";
import { generateLayeredDag, toDefinitions } from "../test-support/synthetic-attribute-graph";
import { TENANT_A } from "../test-support/tenants";

/**
 * Phase 6.4.1 hardening — Task 9 (Performance Benchmarks): cold vs. warm vs. incremental vs. full
 * evaluation paths.
 *
 * Deliberately **not** a `vitest bench()` (tinybench) file: `bench()`'s repeated-sampling model
 * assumes a stateless, side-effect-free operation run thousands of times — "cold" is a one-time state
 * transition by definition (an identifier is only ever evaluated for the first time once), so
 * resampling it thousands of times would actually be measuring "warm" over and over. This suite takes
 * one real, instrumented measurement per scenario instead, against `wireCustomer360` — the same
 * composition root the rest of this package's tests already use (Task 10: reuse, don't re-wire).
 *
 * This module's own vocabulary distinguishes two different "full" operations that are easy to
 * conflate: **recompute** (`RecalculateComputedAttributes`, re-runs every rule) vs. **rebuild**
 * (`RebuildComputedAttributes`, reconstructs the cache from the latest history snapshot, runs no rule
 * at all — see `docs/platform/COMPUTED_ATTRIBUTES_MODEL.md` §9). Both are measured, labeled precisely,
 * and the size gap between them is itself a finding worth reporting.
 */

const clock = { now: () => new Date("2026-07-21T00:00:00.000Z") };
const ids = { generate: () => crypto.randomUUID() };
const identifier = { type: "customer_id" as const, value: "cust-lifecycle" };
const GRAPH_SIZE = 200;

describe("Computed Attributes — evaluation lifecycle timing (Task 9)", () => {
  it("measures cold, warm, incremental, full-recompute, and full-rebuild against a 200-node registry", async () => {
    const graph = generateLayeredDag(GRAPH_SIZE);
    const definitions = toDefinitions(graph);
    const wired = wireCustomer360({
      serializer: new InMemoryEventSerializer(),
      idGenerator: ids,
      clock,
      computedAttributeDefinitions: { tenantId: TENANT_A, definitions: definitions },
    });

    const rootDefinition = definitions[0]!;

    // --- Cold: first-ever evaluation of one attribute for this identifier. ---
    const coldStart = performance.now();
    const cold = await wired.evaluateAttributeGraph.execute({
      tenantId: TENANT_A,
      identifier,
      definitions: [rootDefinition],
    });
    const coldMs = performance.now() - coldStart;
    expect(cold.ok).toBe(true);
    if (!cold.ok) throw new Error("unreachable");
    expect(cold.value.applied).toEqual([rootDefinition.id]);

    // --- Warm: re-evaluating the SAME attribute for the SAME identifier — the no-op guard path,
    // since this engine has no separate "cache hit, skip evaluation entirely" shortcut (Task 4's
    // finding: every evaluation re-runs the rule, cheap or not). ---
    const warmStart = performance.now();
    const warm = await wired.evaluateAttributeGraph.execute({
      tenantId: TENANT_A,
      identifier,
      definitions: [rootDefinition],
    });
    const warmMs = performance.now() - warmStart;
    expect(warm.ok).toBe(true);
    if (!warm.ok) throw new Error("unreachable");
    expect(warm.value.applied).toEqual([]); // no-op guard: identical value, nothing to persist

    // --- Populate the full registry once (setup for the incremental/rebuild measurements below;
    // not itself one of the timed scenarios). ---
    const populate = await wired.recalculateComputedAttributes.execute({
      tenantId: TENANT_A,
      identifier,
    });
    expect(populate.ok).toBe(true);

    // --- Incremental: one interior attribute changes; only its transitive dependents recompute. ---
    const midId = definitions[Math.floor(GRAPH_SIZE / 2)]!.id;
    const incrementalStart = performance.now();
    const incremental = await wired.recalculateComputedAttributes.execute({
      tenantId: TENANT_A,
      identifier,
      changed: [midId],
    });
    const incrementalMs = performance.now() - incrementalStart;
    expect(incremental.ok).toBe(true);
    if (!incremental.ok) throw new Error("unreachable");
    expect(incremental.value.recomputed.length).toBeLessThan(GRAPH_SIZE);

    // --- Full recompute: every rule in the registry re-runs (no `changed` scope given). ---
    const fullRecomputeStart = performance.now();
    const fullRecompute = await wired.recalculateComputedAttributes.execute({
      tenantId: TENANT_A,
      identifier,
    });
    const fullRecomputeMs = performance.now() - fullRecomputeStart;
    expect(fullRecompute.ok).toBe(true);
    if (!fullRecompute.ok) throw new Error("unreachable");
    expect(fullRecompute.value.recomputed.length).toBe(GRAPH_SIZE);

    // --- Full rebuild: cache reconstructed from the latest history snapshot — no rule evaluation at
    // all. Expected to be dramatically cheaper than full recompute; that gap is the point. ---
    const fullRebuildStart = performance.now();
    const fullRebuild = await wired.rebuildComputedAttributes.execute({
      tenantId: TENANT_A,
      identifier,
    });
    const fullRebuildMs = performance.now() - fullRebuildStart;
    expect(fullRebuild.ok).toBe(true);
    if (!fullRebuild.ok) throw new Error("unreachable");
    expect(fullRebuild.value.attributeCount).toBe(GRAPH_SIZE);

    // eslint-disable-next-line no-console -- intentional: captured into the hardening report's table.
    console.log(
      [
        `[Task 9] registry size=${GRAPH_SIZE}`,
        `cold=${coldMs.toFixed(3)}ms`,
        `warm=${warmMs.toFixed(3)}ms`,
        `incremental(1 changed, ${incremental.value.recomputed.length} recomputed)=${incrementalMs.toFixed(3)}ms`,
        `full-recompute(${GRAPH_SIZE} recomputed)=${fullRecomputeMs.toFixed(3)}ms`,
        `full-rebuild(cache-only, no rule eval)=${fullRebuildMs.toFixed(3)}ms`,
      ].join(" | "),
    );

    // A rebuild (read one snapshot, no rule evaluation) must stay meaningfully cheaper than a full
    // recompute (re-run every one of 200 rules) — the architectural distinction this module's own
    // vocabulary draws between the two operations, pinned down as a real regression guard.
    expect(fullRebuildMs).toBeLessThan(fullRecomputeMs);
  });
});
