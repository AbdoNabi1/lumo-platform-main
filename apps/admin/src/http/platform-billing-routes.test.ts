import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "@platform/http";
import { platformBillingRoutes } from "./platform-billing-routes";
import { paymentsWebhookRoutes } from "./payments-webhook-routes";
import type { WiredAdmin } from "../composition";

/**
 * G-74 (1): Morbeh's card-token callback is its OWN route. It hands the RAW bytes and the `hmac`
 * query parameter to Licensing (which verifies them against Morbeh's billing secret) and never
 * touches Payments' store webhook seam.
 */
const rawBody = new TextEncoder().encode(JSON.stringify({ type: "TOKEN", obj: { id: 1 } }));

function context(withBody: boolean): RequestContext {
  return {
    tenantId: "t-1",
    principal: { id: "public", kind: "customer", roles: [], tenantId: "t-1" },
    requestId: "req-1",
    correlationId: "req-1",
    ...(withBody ? { rawBody } : {}),
    headers: {},
  };
}

function fakeAdmin(recordCardToken: ReturnType<typeof vi.fn>, paymentsWebhook = {}): WiredAdmin {
  return { licensing: { recordCardToken }, paymentsWebhook } as unknown as WiredAdmin;
}

describe("Morbeh's card-token callback route", () => {
  it("is public (the PSP has no Bearer token) and lives at its own path", () => {
    const [route] = platformBillingRoutes(fakeAdmin(vi.fn()));
    expect(route?.public).toBe(true);
    expect(route?.path).toBe("/platform-billing/paymob/card-token");
    const storePaths = paymentsWebhookRoutes(fakeAdmin(vi.fn())).map((r) => r.path);
    expect(storePaths).not.toContain(route?.path);
  });

  it("passes the RAW bytes and the hmac query parameter to Licensing", async () => {
    const recordCardToken = vi.fn().mockResolvedValue({ status: 200, body: { status: "active" } });
    const [route] = platformBillingRoutes(fakeAdmin(recordCardToken));

    const response = await route!.handle({
      body: {},
      params: {},
      query: { hmac: "abc123" },
      context: context(true),
    });

    expect(response.status).toBe(200);
    expect(recordCardToken).toHaveBeenCalledTimes(1);
    const [input] = recordCardToken.mock.calls[0]!;
    expect(input.rawBody).toBe(rawBody);
    expect(input.signature).toBe("abc123");
  });

  it("answers 401 without a raw body, and never reaches Licensing", async () => {
    const recordCardToken = vi.fn();
    const [route] = platformBillingRoutes(fakeAdmin(recordCardToken));

    const response = await route!.handle({
      body: {},
      params: {},
      query: { hmac: "abc123" },
      context: context(false),
    });

    expect(response.status).toBe(401);
    expect(recordCardToken).not.toHaveBeenCalled();
  });

  it("passes through Licensing's refusal of an unverified callback (401)", async () => {
    const recordCardToken = vi
      .fn()
      .mockResolvedValue({ status: 401, body: { code: "UNAUTHENTICATED" } });
    const [route] = platformBillingRoutes(fakeAdmin(recordCardToken));

    const response = await route!.handle({
      body: {},
      params: {},
      query: { hmac: "forged" },
      context: context(true),
    });

    expect(response.status).toBe(401);
  });
});
