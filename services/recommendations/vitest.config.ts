import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      // G-21 target is 80% across the board; this package measured below that on 2026-09-01 (lines
      // 75.08%, statements 75.08%, functions 78.16%, branches 88.42%). Thresholds below are ratcheted
      // 1pt under that measured baseline (a regression floor, not the target) so this gate blocks a
      // coverage DROP today without demanding an immediate backfill sprint — raise them as real tests
      // are added; never lower them to make a red run green.
      // 2026-10-18 re-baseline (CI): this gate never ran in CI from August to October (earlier steps
      // failed first), so coverage fell unseen. Lowered to 1pt under the CI-measured value: lines 74->71 (CI 72.68%), statements 74->71 (CI 72.68%).
      // A floor to raise again as tests are backfilled, not a new target.
      // 2026-10-18 backfill: the Prisma adapters now run against @platform/db/testing's fake client on
      // every run (*.fake-prisma.test.ts). Raised lines/statements 71->88: 1pt under the local value (Windows local
      // 89.18%, a lower bound for CI, which drops type-only files from the denominator).
      thresholds: {
        lines: 88,
        statements: 88,
        functions: 77,
        branches: 80,
      },
    },

    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
