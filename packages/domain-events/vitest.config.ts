import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      // G-21 target is 80% across the board; this package measured below that on 2026-09-01 (lines
      // 60.86%, statements 60.86%, functions 77.77%, branches 85.71%). Thresholds below are ratcheted
      // 1pt under that measured baseline (a regression floor, not the target) so this gate blocks a
      // coverage DROP today without demanding an immediate backfill sprint — raise them as real tests
      // are added; never lower them to make a red run green.
      // 2026-10-18 re-baseline (CI): this gate never ran in CI from August to October (earlier steps
      // failed first), so coverage fell unseen. Lowered to 1pt under the CI-measured value: lines 59->53 (CI 54.54%), functions 76->62 (CI 63.63%), statements 59->53 (CI 54.54%).
      // 2026-10-18 backfill: tests for requireEnvelopeTenant/MissingEnvelopeTenantError,
      // JsonEventSerializer and the public entry points raised local (Windows, a lower bound for CI)
      // coverage to lines 70.21%, statements 70.21%, functions 90.9%, branches 95.23% — back above the
      // 2026-09-01 floors. Thresholds re-ratcheted to 1pt under that; serializer.ts is type-only and
      // reads 0%. Never lower them to make a red run green.
      thresholds: {
        lines: 69,
        statements: 69,
        functions: 89,
        branches: 94,
      },
    },

    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
