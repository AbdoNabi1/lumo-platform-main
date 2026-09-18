import { describe, expect, it } from "vitest";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireCustomer360 } from "../composition";
import { generateLayeredDag, toDefinitions } from "../test-support/synthetic-attribute-graph";
import { TENANT_A } from "../test-support/tenants";

/**
 * Phase 6.4.1 hardening — Task 8 (Memory Profiling).
 *
 * A plain dependency-free Node script (matching `perf/bench/http-bench.mjs`'s convention, as the
 * original plan called for) turned out not to fit this measurement: this repo has no `tsx`/`ts-node`
 * dependency anywhere, and `http-bench.mjs` itself only ever imports Node built-ins — it never needs
 * to load workspace TypeScript source. Adding a TS-execution dependency solely for one profiling
 * script would be exactly the kind of unjustified new-dependency introduction this sprint's
 * constraints forbid. Vitest already compiles this package's TypeScript for every other test in this
 * suite, so this measurement runs as a vitest test instead — same real `process.memoryUsage()` data,
 * no new tooling.
 *
 * Forced GC (`global.gc()`) is used when available (`node --expose-gc`, or `NODE_OPTIONS=--expose-gc`
 * before `pnpm test`) to get a clean before/after heap delta; when unavailable, the measurement still
 * runs but the numbers are directional only (uncollected garbage from prior runs can inflate the
 * delta) — reported honestly in the hardening report, not silently assumed away.
 *
 * FINDING surfaced by this suite (full detail + verdict in
 * `docs/implementation/SPRINT_6_4_1_HARDENING_REPORT.md`): a full recompute of a fresh identifier's
 * entire registry retains memory **quadratically** in registry size, not linearly. Cause: every
 * `AttributeSnapshot` is a *full* capture of the cumulative attribute map at that point
 * (`domain/attribute-snapshot.ts:16-18`, explicitly "the same accepted tradeoff `ProfileSnapshot`
 * documents"), and `applyAttributeUpdate` copies the whole map on every applied change
 * (`domain/computed-attribute.ts:109`). Evaluating N attributes for one identifier in topological
 * order therefore appends N snapshots of size 1, 2, 3, ..., N — O(N^2) total retained map entries in
 * `AttributeHistoryStore`, in-memory today and equally in `PrismaAttributeHistoryStore`'s JSON column
 * in production. This is a real, measured consequence of an already-reviewed, deliberately-chosen
 * domain design (not a bug to fix here — "DO NOT redesign the architecture") that only bites at
 * registry sizes far past what a "scores, tiers, flags, segments" catalog realistically reaches
 * (dozens, not thousands) — see the report for the exact numbers and the calibrated risk read.
 */

const clock = { now: () => new Date("2026-07-21T00:00:00.000Z") };
const ids = { generate: () => crypto.randomUUID() };

function heapMb(): number {
  return process.memoryUsage().heapUsed / (1024 * 1024);
}

/** `--expose-gc` puts `gc` on `global` at runtime, but `@types/node` deliberately does not declare it
 * (it's a V8 flag-gated global, not a stable Node API) — narrowed through `globalThis` rather than an
 * ambient `declare global` augmentation, which would leak the (possibly absent) type everywhere. */
function forcedGc(): (() => void) | undefined {
  return (globalThis as { gc?: () => void }).gc;
}

async function settle(): Promise<void> {
  const gc = forcedGc();
  if (gc !== undefined) {
    gc();
    gc(); // a second pass catches objects freed by the first pass's own finalization
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function measureFullRecompute(size: number): Promise<{ deltaMb: number; elapsedMs: number }> {
  const graph = generateLayeredDag(size);
  const definitions = toDefinitions(graph);
  const wired = wireCustomer360({
    serializer: new InMemoryEventSerializer(),
    idGenerator: ids,
    clock,
    computedAttributeDefinitions: { tenantId: TENANT_A, definitions: definitions },
  });

  await settle();
  const before = heapMb();
  const start = performance.now();

  const result = await wired.recalculateComputedAttributes.execute({
    tenantId: TENANT_A,
    identifier: { type: "customer_id", value: `cust-memory-${size}` },
  });
  if (!result.ok) throw new Error("unreachable");

  const elapsedMs = performance.now() - start;
  await settle();
  const after = heapMb();

  return { deltaMb: after - before, elapsedMs };
}

describe("Computed Attributes — memory profile (Task 8)", () => {
  it("heap growth for a single full recompute of a fresh identifier scales quadratically with registry size (O(N^2) full-snapshot-per-change, not a leak — see file header)", async () => {
    const sizes = [100, 500, 1000, 2000];
    const measurements: { size: number; deltaMb: number; elapsedMs: number }[] = [];

    for (const size of sizes) {
      const { deltaMb, elapsedMs } = await measureFullRecompute(size);
      measurements.push({ size, deltaMb, elapsedMs });
    }

    // eslint-disable-next-line no-console -- intentional: captured into the hardening report's table.
    console.log(
      `[Task 8] full-recompute heap-vs-size (gcAvailable=${forcedGc() !== undefined}): ` +
        measurements
          .map(
            (m) => `N=${m.size} delta=${m.deltaMb.toFixed(2)}MB time=${m.elapsedMs.toFixed(1)}ms`,
          )
          .join(" | "),
    );

    for (const m of measurements) {
      expect(Number.isFinite(m.deltaMb)).toBe(true);
    }

    // Without forced GC (no `--expose-gc`, e.g. a plain `pnpm test` run), an uncollected-garbage
    // delta from an EARLIER measurement in this same loop can make a LATER, genuinely smaller
    // measurement read as negative or noisy — the numbers are then directional only, exactly the
    // limitation documented in this file's header. The quantitative quadratic-vs-linear assertion
    // below is only meaningful with a clean, GC-settled before/after delta per sample, so it only
    // runs when forced GC is actually available; otherwise this test still captures and logs real
    // numbers for the report; it just doesn't gate on them.
    if (forcedGc() === undefined) return;

    for (const m of measurements) {
      expect(m.deltaMb).toBeGreaterThanOrEqual(0);
    }

    // Quadratic-vs-linear discriminator: doubling N (500 -> 1000, or 1000 -> 2000) should roughly
    // quadruple the retained delta for O(N^2) growth, not merely double it as O(N) growth would.
    // Loose bound (>2.5x, not the theoretical ~4x) to absorb GC/allocator noise while still failing
    // outright if the growth were actually linear (~2x) or better.
    const at1000 = measurements.find((m) => m.size === 1000)!;
    const at2000 = measurements.find((m) => m.size === 2000)!;
    expect(
      at2000.deltaMb,
      `doubling registry size 1000->2000 only grew heap ${(at2000.deltaMb / Math.max(at1000.deltaMb, 0.01)).toFixed(2)}x — expected super-linear (quadratic) growth per the documented full-snapshot-per-change design`,
    ).toBeGreaterThan(at1000.deltaMb * 2.5);
  }, 30_000);

  it("does not grow heap unboundedly across 20 repeated NO-OP full recomputes of an already-settled 300-node identifier (leak smoke test, isolated from the O(N^2) full-registry-write cost above)", async () => {
    const size = 300;
    const repeatedRuns = 20;
    const graph = generateLayeredDag(size);
    const definitions = toDefinitions(graph);
    const wired = wireCustomer360({
      serializer: new InMemoryEventSerializer(),
      idGenerator: ids,
      clock,
      computedAttributeDefinitions: { tenantId: TENANT_A, definitions: definitions },
    });
    const identifier = { type: "customer_id" as const, value: "cust-memory-repeat" };

    // Prime once so the steady state (no-op re-evaluations — nothing to apply, no new snapshots) is
    // what gets measured, not the O(N^2) first-write cost characterized above.
    await wired.recalculateComputedAttributes.execute({ tenantId: TENANT_A, identifier });

    await settle();
    const before = heapMb();
    const samples: number[] = [];

    for (let i = 0; i < repeatedRuns; i += 1) {
      await wired.recalculateComputedAttributes.execute({ tenantId: TENANT_A, identifier });
      if (i % 5 === 4) {
        await settle();
        samples.push(heapMb());
      }
    }

    await settle();
    const after = heapMb();

    // eslint-disable-next-line no-console -- intentional: captured into the hardening report.
    console.log(
      `[Task 8] ${repeatedRuns} repeated no-op recomputes, ${size} nodes: heap before=${before.toFixed(2)}MB after=${after.toFixed(2)}MB samples=[${samples.map((s) => s.toFixed(2)).join(", ")}]MB gcAvailable=${forcedGc() !== undefined}`,
    );

    // Without forced GC, uncollected garbage from the loop's own earlier iterations inflates this
    // delta unpredictably (observed ~40MB of GC-pending garbage vs. ~0MB net once GC actually runs
    // between samples, in manual `--expose-gc` runs) — the same directional-only limitation as
    // above. Numbers are always logged for the report; the gating bound only applies when a clean
    // per-sample delta is actually measurable.
    if (forcedGc() === undefined) return;

    // Loose bound, not a tight one: a smoke test for genuinely unbounded growth (e.g. an accidental
    // accumulating cache or retained event list on the steady-state no-op path specifically), not a
    // precise leak detector — precise leak hunting needs a real heap-snapshot tool (out of scope: no
    // new dependency for one profiling script).
    expect(
      after - before,
      `heap grew by ${(after - before).toFixed(2)}MB across ${repeatedRuns} repeated no-op runs`,
    ).toBeLessThan(25);
  }, 30_000);
});
