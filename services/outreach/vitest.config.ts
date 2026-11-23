import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "./coverage",
      // Part 1 gate (plan Task 9): lines and branches at least 85%, measured at 97.9% / 94.2% when set. Never lower
      // these to make a red run green.
      thresholds: { lines: 85, statements: 85, branches: 85, functions: 85 },
    },
  },
});
