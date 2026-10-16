import { test, expect } from "@playwright/test";
import { loginToAdminWeb } from "./support/admin-login";
import { createAndPublishProduct, getOrderAsOperator, sessionTokenFrom } from "./support/admin-api";

/**
 * T6.1 spec 1/3 — guest purchase: browse → add to cart → checkout → confirmation → an order exists.
 *
 * `beforeAll` creates+publishes one real product via the runtime API (see
 * `support/admin-api.ts`'s doc comment for why that's API-direct rather than through the admin-web
 * UI) — a fresh slug per run (`Date.now()`-suffixed) so repeat runs against the same database
 * never collide on slug uniqueness — and keeps the operator's session token so the test can read
 * the resulting order back at the end.
 *
 * **History — what the `test.fail()` that used to sit on this spec was, and what closed it.** The
 * final step was annotated `test.fail()` because `POST /public/checkouts/:id/complete` threw for a
 * genuine guest session (`docs/plans/BLOCKERS.md` T2.3, gap G-52): `OrderCreationAdapter` required
 * a `customerRef`, which no unauthenticated storefront session has — exactly what this spec
 * drives. It was a deliberate forcing function: the day the gap closed, the spec would start
 * unexpectedly PASSING, which Playwright reports as a failure, so the annotation could not outlive
 * the bug. WP-1 closed it: checkout now collects a contact email (the first step, `#contact-email`),
 * and at completion Identity finds or creates a guest customer from it (`ResolveGuestCustomer`,
 * scoped to the session's tenant) and the order is placed against that customer. The annotation is
 * gone and every step below is asserted normally.
 *
 * The email is unique per run, so each run creates a NEW guest customer; the returning-guest and
 * two-tenant behaviours are covered where they can be controlled exactly — `guest-checkout.e2e.test.ts`
 * and `public-checkout-routes.test.ts` in `apps/admin` — not here.
 */
test.describe("guest purchase", () => {
  const slug = `e2e-guest-purchase-${Date.now()}`;
  const productName = "E2E Guest Purchase Test Toy";
  const guestEmail = `e2e-guest-${Date.now()}@example.com`;
  let operatorToken = "";

  test.beforeAll(async ({ browser }) => {
    const adminBaseURL = process.env["ADMIN_WEB_URL"] ?? "http://localhost:3100";
    const context = await browser.newContext({ baseURL: adminBaseURL });
    const page = await context.newPage();
    await page.goto("/products/new");
    await loginToAdminWeb(page, "e2e-operator@morbeh.local", requireEnv("E2E_PASSWORD"));

    const token = await sessionTokenFrom(context);
    operatorToken = token;
    await createAndPublishProduct(context.request, token, {
      sku: slug,
      name: productName,
      slug,
      priceAmountMinor: 2999,
    });
    await context.close();
  });

  test("browse, add to cart, check out as a guest, and land on a confirmation for a real order", async ({
    page,
    request,
  }) => {
    await page.goto(`/products/${slug}`);
    await expect(page.getByRole("heading", { name: productName })).toBeVisible();

    await page.getByRole("button", { name: /add to cart/i }).click();
    await expect(page.getByRole("link", { name: /view cart|cart/i })).toBeVisible();

    await page.goto("/cart");
    await expect(page.getByText(productName)).toBeVisible();

    await page.goto("/checkout");

    // Contact step (WP-1) — the guest's receipt address; completing resolves a guest customer from it.
    await page.locator("#contact-email").fill(guestEmail);
    await page.getByRole("button", { name: /continue/i }).click();

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
    await expect(page.getByRole("heading", { name: /thanks for your order/i })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/nothing to confirm/i);

    // The confirmation shows the order reference the completed session carries...
    const orderRef = (
      await page
        .locator("dt", { hasText: /order reference/i })
        .locator("xpath=following-sibling::dd")
        .innerText()
    ).trim();
    expect(orderRef.length).toBeGreaterThan(0);

    // ...and the order behind it really exists, attached to a customer (the guest one resolved from
    // the contact email) — the thing a guest purchase is FOR. Read back as the operator.
    const order = await getOrderAsOperator(request, operatorToken, orderRef);
    expect(order.customerRef.length).toBeGreaterThan(0);
  });
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required (no default) — set it before running the e2e suite.`);
  }
  return value;
}
