import { test, expect } from "@playwright/test";
import { loginToAdminWeb } from "./support/admin-login";

/**
 * T6.1 spec 3/3 — authorization: `viewer`, `operator`, and `admin` each hit a route above their
 * own level and land on `/forbidden`, not the page.
 *
 * `ROUTE_ROLE_REQUIREMENTS` (`apps/admin-web/src/middleware.ts`) ranks `viewer(0) < operator(1) <
 * admin(2)`, longest-prefix-match, and defaults any unlisted route to `admin` (deny-by-default).
 * `/products/new` is explicitly `operator`; `/security` is not in the table at all, so it falls to
 * the `admin` default — that pairing is what lets one route stand in for "above operator" and
 * `/products/new` double as "above viewer," without needing to enumerate the full table here.
 */
test.describe("authorization", () => {
  test("viewer hitting an operator+ route is redirected to /forbidden", async ({ page }) => {
    await page.goto("/products/new");
    await loginToAdminWeb(page, "e2e-viewer@morbeh.local", requireEnv("E2E_PASSWORD"));
    await expect(page).toHaveURL(/\/forbidden/);
  });

  test("operator hitting an admin-only route is redirected to /forbidden", async ({ page }) => {
    await page.goto("/security");
    await loginToAdminWeb(page, "e2e-operator@morbeh.local", requireEnv("E2E_PASSWORD"));
    await expect(page).toHaveURL(/\/forbidden/);
  });

  test("admin can reach a route above viewer/operator level", async ({ page }) => {
    await page.goto("/products/new");
    await loginToAdminWeb(page, "e2e-admin@morbeh.local", requireEnv("E2E_PASSWORD"));
    await expect(page).not.toHaveURL(/\/forbidden/);
    await expect(page).toHaveURL(/\/products\/new/);
  });
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required (no default) — set it before running the e2e suite.`);
  }
  return value;
}
