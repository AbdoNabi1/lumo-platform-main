import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      // G-21 target is 80% across the board; this package measured below that on 2026-09-01 (lines
      // 30.23%, statements 30.23%, functions 44.44%, branches 62.5%). Thresholds below are ratcheted 1pt
      // under that measured baseline (a regression floor, not the target) so this gate blocks a coverage
      // DROP today without demanding an immediate backfill sprint — raise them as real tests are added;
      // never lower them to make a red run green.
      thresholds: {
        lines: 29,
        statements: 29,
        functions: 43,
        branches: 61,
      },
    },

    environment: "jsdom",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
