import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      // G-21 target is 80% across the board; this package measured below that on 2026-09-01 (lines
      // 65.23%, statements 65.23%, functions 64.28%, branches 88.07%). Thresholds below are ratcheted
      // 1pt under that measured baseline (a regression floor, not the target) so this gate blocks a
      // coverage DROP today without demanding an immediate backfill sprint — raise them as real tests
      // are added; never lower them to make a red run green.
      // 2026-10-18 re-baseline (CI): this gate never ran in CI from August to October (earlier steps
      // failed first), so coverage fell unseen. Lowered to 1pt under the CI-measured value: lines 64->60 (CI 61.46%), statements 64->60 (CI 61.46%).
      // A floor to raise again as tests are backfilled, not a new target.
      // 2026-10-18 backfill: unit tests for the Prisma repositories over createFakePrisma
      // (prisma-repositories.test.ts) cover what the DATABASE_URL_TEST-gated suite skips in CI.
      // Measured locally (Windows, a lower bound for CI): lines 88.23%, statements 88.23%, functions 91.34%, branches 92.59%. Ratcheted to 1pt under.
      thresholds: {
        lines: 87,
        statements: 87,
        functions: 90,
        branches: 91,
      },
    },

    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
