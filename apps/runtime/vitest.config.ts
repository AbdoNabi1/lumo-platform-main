import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      // G-21 target is 80% across the board; this package measured below that on 2026-09-01 (lines
      // 70.95%, statements 70.95%, functions 70.25%, branches 79.45%). Thresholds below are ratcheted
      // 1pt under that measured baseline (a regression floor, not the target) so this gate blocks a
      // coverage DROP today without demanding an immediate backfill sprint — raise them as real tests
      // are added; never lower them to make a red run green.
      thresholds: {
        lines: 69,
        statements: 69,
        functions: 69,
        branches: 78,
      },
    },

    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
