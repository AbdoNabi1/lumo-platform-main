import { bench, describe } from "vitest";
import { dependentsOf, topologicalOrder } from "../domain/attribute-dependency";
import { generateChain, generateLayeredDag } from "./synthetic-attribute-graph";

/**
 * Phase 6.4.1 hardening — Task 7 (Large DAG Stress Tests) benchmark half; correctness lives in
 * `domain/attribute-dependency.stress.test.ts`. Run with `vitest bench` (not picked up by
 * `vitest run` — `vitest.config.ts`'s `test.include` is scoped to `*.test.ts`). Raw numbers captured
 * into `docs/implementation/SPRINT_6_4_1_HARDENING_REPORT.md`.
 *
 * Lives in `test-support/`, not `domain/`, even though it only benchmarks a `domain/` module: the
 * synthetic-graph generator it needs (`synthetic-attribute-graph.ts`) imports `@platform/rules`/
 * `@platform/expression` to build `ComputedAttributeDefinition`s for the incremental-recompute bench
 * in `../application/computed-attributes.bench.ts` — pulling that generator into anything physically
 * under `src/domain/` would trip dependency-cruiser's `domain-stays-pure` rule (`domain/` may depend
 * only on the shared kernel, never `@platform/rules`/`@platform/expression`), even though this file's
 * own bench code only ever calls pure `domain/attribute-dependency` functions.
 *
 * These measure `topologicalOrder`/`dependentsOf` in isolation — the per-call cost of the "rebuilt
 * every time, never cached" design documented in `docs/platform/COMPUTED_ATTRIBUTES_MODEL.md:106-114`
 * — to answer Task 1's real question (does the rebuild cost matter at scale) with data instead of
 * assumption.
 */

const SIZES = [100, 500, 1000, 5000, 10000] as const;

for (const size of SIZES) {
  const chain = generateChain(size);
  const dag = generateLayeredDag(size);

  describe(`topologicalOrder — ${size} nodes`, () => {
    bench("chain", () => {
      topologicalOrder(chain.names, chain.edges);
    });

    bench("layered DAG", () => {
      topologicalOrder(dag.names, dag.edges);
    });
  });

  describe(`dependentsOf (single seed, root) — ${size} nodes`, () => {
    bench("chain", () => {
      dependentsOf([chain.names[0]!], chain.edges);
    });

    bench("layered DAG", () => {
      dependentsOf([dag.names[0]!], dag.edges);
    });
  });
}
