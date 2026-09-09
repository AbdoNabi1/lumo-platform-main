import { test, expect } from "@playwright/test";
import { loginToAdminWeb } from "./support/admin-login";
import { createAndPublishProduct, sessionTokenFrom } from "./support/admin-api";

/**
 * T6.1 spec 1/3 — guest purchase: browse → add to cart → checkout → confirmation.
 *
 * `beforeAll` creates+publishes one real product via the runtime API (see
 * `support/admin-api.ts`'s doc comment for why that's API-direct rather than through the admin-web
 * UI) — a fresh slug per run (`Date.now()`-suffixed) so repeat runs against the same database
 * never collide on slug uniqueness.
 *
 * The final assertion is annotated `test.fail()`: `docs/plans/BLOCKERS.md`'s "T2.3" entry
 * documents that `POST /public/checkouts/:id/complete` throws for a genuine guest session (no
 * `customerRef`) — which every unauthenticated storefront session is, by definition, exactly what
 * this spec drives. Every step up to "place order" exercises real, working surface and is asserted
 * normally; only placing the order itself is expected to fail today. `test.fail()` means: if this
 * gap is ever closed, this spec starts unexpectedly PASSING, which Playwright reports as a
 * failure — a forcing function to come back and remove this annotation, rather than a test that
 * silently keeps asserting the bug.
 */
test.describe("guest purchase", () => {
  const slug = `e2e-guest-purchase-${Date.now()}`;
  const productName = "E2E Guest Purchase Test Toy";

  test.beforeAll(async ({ browser }) => {
    const adminBaseURL = process.env["ADMIN_WEB_URL"] ?? "http://localhost:3100";
    const context = await browser.newContext({ baseURL: adminBaseURL });
    const page = await context.newPage();
    await page.goto("/products/new");
    await loginToAdminWeb(page, "e2e-operator@morbeh.local", requireEnv("E2E_PASSWORD"));

    const token = await sessionTokenFrom(context);
    await createAndPublishProduct(context.request, token, {
      sku: slug,
      name: productName,
      slug,
      priceAmountMinor: 2999,
    });
    await context.close();
  });

  test("browse, add to cart, and attempt checkout", async ({ page }) => {
    test.fail(); // see the module doc comment — known guest-checkout-completion gap (BLOCKERS.md T2.3)

    await page.goto(`/products/${slug}`);
    await expect(page.getByRole("heading", { name: productName })).toBeVisible();

    await page.getByRole("button", { name: /add to cart/i }).click();
    await expect(page.getByRole("link", { name: /view cart|cart/i })).toBeVisible();

    await page.goto("/cart");
    await expect(page.getByText(productName)).toBeVisible();

    await page.goto("/checkout");
    await page.locator("#line1").fill("1 Test Street");
    await page.locator("#city").fill("Testville");
    await page.locator("#postalCode").fill("12345");
    await page.locator("#country").fill("US");
    await page.getByRole("button", { name: /continue/i }).click();

    // Shipping method: whichever quote comes back first.
    await page.locator('input[name="shipping-method"]').first().check();
    await page.getByRole("button", { name: /continue/i }).click();

    // Billing address — same shape as shipping.
    await page.locator("#line1").fill("1 Test Street");
    await page.locator("#city").fill("Testville");
    await page.locator("#postalCode").fill("12345");
    await page.locator("#country").fill("US");
    await page.getByRole("button", { name: /continue/i }).click();

    // Payment step — one fixed, pre-checked provider selection, no card entry
    // (`apps/storefront/src/components/checkout-view.tsx`).
    await page.getByRole("button", { name: /continue/i }).click();

    await page.getByRole("button", { name: /place order/i }).click();

    await page.waitForURL(/\/checkout\/confirmation/);
    await expect(page.getByText(/order/i)).toBeVisible();
    // The real assertion this flow is FOR: a guest can complete a purchase end-to-end.
    await expect(page.locator("body")).not.toContainText(/nothing to confirm/i);
  });
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required (no default) — set it before running the e2e suite.`);
  }
  return value;
}
