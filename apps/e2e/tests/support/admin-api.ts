import type { APIRequestContext, BrowserContext } from "@playwright/test";

export const RUNTIME_API_URL = process.env["RUNTIME_API_URL"] ?? "http://localhost:3080";
export const TENANT_ID = process.env["TENANT_DEFAULT_ID"] ?? "tenant-local";

/**
 * Reads the admin-web session JWT straight off the browser context's cookie jar. It's httpOnly
 * (never reachable from page JS — `apps/admin-web/src/app/auth/callback/route.ts` sets it that
 * way on purpose), but Playwright drives the real network layer, not page JS, so this is the same
 * class of access a reverse proxy or the Next.js server itself already has — not a workaround of
 * the httpOnly protection, just a different vantage point on it.
 */
export async function sessionTokenFrom(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === "morbeh_admin_session");
  if (session === undefined) {
    throw new Error(
      "no morbeh_admin_session cookie found — call loginToAdminWeb() before sessionTokenFrom()",
    );
  }
  return session.value;
}

/**
 * Reads one order back through the runtime API as the logged-in operator (`GET /orders/:orderId`,
 * `apps/admin/src/http/admin-routes.ts`). The confirmation page only shows the order reference the
 * public checkout session carries, which proves the SESSION was completed; this proves an `Order`
 * actually exists behind it and is attached to a customer — the thing G-52 was about.
 */
export async function getOrderAsOperator(
  request: APIRequestContext,
  sessionToken: string,
  orderId: string,
): Promise<{ readonly customerRef: string }> {
  const response = await request.get(`${RUNTIME_API_URL}/api/v1/orders/${orderId}`, {
    headers: { authorization: `Bearer ${sessionToken}`, "x-tenant-id": TENANT_ID },
  });
  if (!response.ok()) {
    throw new Error(
      `fixture: GET /orders/${orderId} failed (${response.status()}): ${await response.text()}`,
    );
  }
  const order = (await response.json()) as { readonly customerRef?: unknown };
  if (typeof order.customerRef !== "string" || order.customerRef.length === 0) {
    throw new Error(`fixture: order ${orderId} has no customerRef: ${JSON.stringify(order)}`);
  }
  return { customerRef: order.customerRef };
}

/**
 * Creates and publishes one product directly against the runtime API (`POST /products` then
 * `POST /products/:id/publish`, `apps/admin/src/http/admin-routes.ts`), using the real JWT a
 * logged-in operator session carries. Fixture setup for `guest-purchase.spec.ts` — that spec is
 * about the BUYING flow, not product creation (which `operator-create-product.spec.ts` already
 * covers through the real UI), so going straight through the API here is the standard Playwright
 * pattern for "state this test needs but isn't the thing under test," not a shortcut around
 * anything the buying flow itself exercises.
 */
export async function createAndPublishProduct(
  request: APIRequestContext,
  sessionToken: string,
  input: {
    readonly sku: string;
    readonly name: string;
    readonly slug: string;
    readonly priceAmountMinor: number;
  },
): Promise<{ readonly id: string }> {
  const headers = {
    authorization: `Bearer ${sessionToken}`,
    "x-tenant-id": TENANT_ID,
    "content-type": "application/json",
    "idempotency-key": `e2e-create-${input.slug}`,
  };

  const createResponse = await request.post(`${RUNTIME_API_URL}/api/v1/products`, {
    headers,
    data: {
      sku: input.sku,
      name: input.name,
      slug: input.slug,
      variants: [{ sku: input.sku, priceAmountMinor: input.priceAmountMinor, currency: "USD" }],
    },
  });
  if (!createResponse.ok()) {
    throw new Error(
      `fixture: POST /products failed (${createResponse.status()}): ${await createResponse.text()}`,
    );
  }
  const created = (await createResponse.json()) as { readonly id?: unknown };
  const id = typeof created.id === "string" ? created.id : "";
  if (id.length === 0) {
    throw new Error(`fixture: POST /products returned no id: ${JSON.stringify(created)}`);
  }

  const publishResponse = await request.post(`${RUNTIME_API_URL}/api/v1/products/${id}/publish`, {
    headers: { ...headers, "idempotency-key": `e2e-publish-${input.slug}` },
  });
  if (!publishResponse.ok()) {
    throw new Error(
      `fixture: POST /products/${id}/publish failed (${publishResponse.status()}): ${await publishResponse.text()}`,
    );
  }

  return { id };
}
