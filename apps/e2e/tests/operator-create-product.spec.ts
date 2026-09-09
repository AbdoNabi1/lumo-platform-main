import { test, expect } from "@playwright/test";
import { loginToAdminWeb } from "./support/admin-login";

/**
 * T6.1 spec 2/3 — operator create: log in → create product → see it in the storefront.
 *
 * Uses the seeded `e2e-operator@morbeh.local` identity (`../scripts/seed-e2e-identities.mjs`), which —
 * unlike `scripts/dev/seed-auth-local.mjs`'s default seed — carries the `products:create`/
 * `products:publish` Keto grants this flow actually needs against the real backend, plus the
 * `operator` role `apps/admin-web/src/middleware.ts` requires for `/products/new`.
 */
test.describe("operator create", () => {
  const slug = `e2e-operator-created-${Date.now()}`;
  const productName = `E2E Operator Product ${Date.now()}`;

  test("log in, create a product, publish it, and see it on the storefront", async ({
    page,
    context,
  }) => {
    await page.goto("/products/new");
    await loginToAdminWeb(page, "e2e-operator@morbeh.local", requireEnv("E2E_PASSWORD"));
    await expect(page).toHaveURL(/\/products\/new/);

    // Field ids from `apps/admin-web/src/components/products/product-create-form.tsx`:
    // `${formId}-sku` / `${formId}-name` / `${formId}-slug`, plus at least one variant row.
    await page.locator('input[id$="-sku"]').fill(slug);
    await page.locator('input[id$="-name"]').fill(productName);
    await page.locator('input[id$="-slug"]').fill(slug);
    await page.locator('input[name="variantSku"]').first().fill(`${slug}-var1`);
    await page.locator('input[name="variantPriceAmountMinor"]').first().fill("2999");
    await page.locator('input[name="variantCurrency"]').first().fill("USD");

    await page.getByRole("button", { name: /create|submit/i }).click();

    // `createProductAction` redirects to `/products/{id}` on success.
    await page.waitForURL(/\/products\/[^/]+$/, { timeout: 15_000 });
    await expect(page.getByText(productName)).toBeVisible();

    await page.getByRole("button", { name: /publish/i }).click();
    await expect(page.getByText(/published/i)).toBeVisible({ timeout: 15_000 });

    const storefrontBaseURL = process.env["STOREFRONT_URL"] ?? "http://localhost:3000";
    const storefrontPage = await context.newPage();
    await storefrontPage.goto(`${storefrontBaseURL}/products/${slug}`);
    await expect(storefrontPage.getByRole("heading", { name: productName })).toBeVisible();
  });
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required (no default) — set it before running the e2e suite.`);
  }
  return value;
}
