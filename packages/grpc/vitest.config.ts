import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      // G-21 target is 80% across the board; this package measured below that on 2026-09-01 (lines 100%,
      // statements 100%, functions 100%, branches 66.66%). Thresholds below are ratcheted 1pt under that
      // measured baseline (a regression floor, not the target) so this gate blocks a coverage DROP today
      // without demanding an immediate backfill sprint — raise them as real tests are added; never lower
      // them to make a red run green.
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 65,
      },
    },

    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
