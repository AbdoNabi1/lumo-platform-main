import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      // G-21 target is 80% across the board; this package measured below that on 2026-09-01 (lines
      // 64.57%, statements 64.57%, functions 65%, branches 89.11%). Thresholds below are ratcheted 1pt
      // under that measured baseline (a regression floor, not the target) so this gate blocks a coverage
      // DROP today without demanding an immediate backfill sprint — raise them as real tests are added;
      // never lower them to make a red run green.
      thresholds: {
        lines: 63,
        statements: 63,
        functions: 64,
        branches: 80,
      },
    },

    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
