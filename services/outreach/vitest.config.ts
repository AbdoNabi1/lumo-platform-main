import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "./coverage",
      // Production source only: test files and the `src/testing/**` fixtures/contracts are not what the gate protects.
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/testing/**", "src/**/*.d.ts"],
      // Part 1 gate (plan Task 9): lines, statements, branches and functions at least 85% over production code.
      // Never lower these to make a red run green.
      thresholds: { lines: 85, statements: 85, branches: 85, functions: 85 },
    },
  },
});
