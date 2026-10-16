import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      // Already at/above the 80% target (G-21) as of 2026-09-01 — capped at exactly 80, not
      // the (higher) measured figure, so routine refactors don't make this gate brittle.
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },

    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
