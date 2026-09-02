import { defineConfig, devices } from "@playwright/test";

/**
 * T6.1 (Phase 6 safety net) — the first Playwright suite in this repo. There is real backend
 * behind every one of these specs: `apps/storefront`/`apps/admin-web` have no mock-server mode
 * (both fail closed outside `APP_ENV=local|development`, per each app's own `src/lib/env.ts`), so
 * running this suite for real needs the full local stack up first — see `./README.md`.
 *
 * `webServer` below only starts the two Next.js dev servers themselves; it does NOT start
 * `apps/runtime` (api/worker/scheduler), Postgres/Redis/Kafka/Keto/Kratos/Hydra, run migrations,
 * or seed auth identities — none of that is a "start a server and wait for a port" operation
 * Playwright's `webServer` can express. Bring that up first with:
 *
 *   docker compose -f infrastructure/docker/docker-compose.yml up -d
 *   pnpm --filter @platform/db db:migrate:deploy
 *   node apps/e2e/scripts/seed-e2e-identities.mjs   # requires E2E_PASSWORD (no default)
 *   pnpm --filter @platform/runtime dev                    # api :3080 / worker :3081 / scheduler :3082
 *
 * then `pnpm --filter @platform/e2e e2e` (or `pnpm e2e` at the repo root, via turbo).
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false, // each spec seeds/mutates real shared backend state — see the specs' own doc comments
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "storefront",
      testMatch: /guest-purchase\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env["STOREFRONT_URL"] ?? "http://localhost:3000",
      },
    },
    {
      name: "admin-web",
      testMatch: /(operator-create-product|authorization)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env["ADMIN_WEB_URL"] ?? "http://localhost:3100",
      },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter storefront dev",
      cwd: "../..",
      url: process.env["STOREFRONT_URL"] ?? "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter admin-web dev",
      cwd: "../..",
      url: process.env["ADMIN_WEB_URL"] ?? "http://localhost:3100",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
