import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The app's tsconfig uses `jsx: "preserve"` because Next.js owns the transform; under
  // Vitest there is no Next compiler, so ask esbuild for the automatic runtime directly.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      // G-21 target is 80% across the board; this package measured below that on 2026-09-01 (lines
      // 30.77%, statements 30.77%, functions 58.79%, branches 71.21%). Thresholds below are ratcheted
      // 1pt under that measured baseline (a regression floor, not the target) so this gate blocks a
      // coverage DROP today without demanding an immediate backfill sprint — raise them as real tests
      // are added; never lower them to make a red run green.
      thresholds: {
        lines: 29,
        statements: 29,
        functions: 57,
        branches: 70,
      },
    },

    environment: "jsdom",
    // 2026-10-18: the CI coverage run (v8-instrumented jsdom) took 6.7–8.5s on a few dialog/editor
    // tests, over the 5s default; the per-call waitFor timeouts inside them already allow 5s.
    testTimeout: 20_000,
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
