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
      // 2026-10-18 re-baseline (CI): this gate never ran in CI from August to October (earlier steps
      // failed first), so coverage fell unseen. Lowered to 1pt under the CI-measured value: lines 69->66 (CI 67.99%), statements 69->66 (CI 67.99%).
      // 2026-10-18 backfill: tests for the tracking registry (snapshot, store, hot-reload handle and
      // watcher, seed), tracking adapters and wiring, health-server, entitlement telemetry/middleware/
      // usage quota, the payment settlement source and security-instrumentation raised local
      // (Windows, a lower bound for CI) coverage to lines 72.91%, statements 72.91%, functions
      // 88.93%, branches 84.8% — back above the 2026-09-01 floors. Thresholds re-ratcheted to 1pt
      // under that. Never lower them to make a red run green.
      thresholds: {
        lines: 71,
        statements: 71,
        functions: 87,
        branches: 83,
      },
    },

    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
