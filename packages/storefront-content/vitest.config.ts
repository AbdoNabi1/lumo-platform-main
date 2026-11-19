import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
    },
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
