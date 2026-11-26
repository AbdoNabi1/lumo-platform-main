import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PUBLIC_CHECKOUT_SETTINGS } from "./checkout-settings-model";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const fetchMock = vi.fn();
const api = await import("./runtime-api");

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

function lastCall(): {
  url: URL;
  init: RequestInit;
  headers: Record<string, string>;
  body: unknown;
} {
  const [rawUrl, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return {
    url: new URL(rawUrl),
    init,
    headers: init.headers as Record<string, string>,
    body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(json({}));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("the public checkout settings read", () => {
  it("GETs /public/checkout-settings for the given shop, uncached, with a timeout", async () => {
    fetchMock.mockResolvedValue(json({ ...DEFAULT_PUBLIC_CHECKOUT_SETTINGS, cartLineLimit: 4 }));
    expect(await api.fetchPublicCheckoutSettings("shop-9")).toEqual({
      ...DEFAULT_PUBLIC_CHECKOUT_SETTINGS,
      cartLineLimit: 4,
    });
    const { url, init, headers } = lastCall();
    expect(url.pathname).toBe("/api/v1/public/checkout-settings");
    expect(headers["x-tenant-id"]).toBe("shop-9");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("getPublicCheckoutSettings reads for this request's shop", async () => {
    fetchMock.mockResolvedValue(json(DEFAULT_PUBLIC_CHECKOUT_SETTINGS));
    expect(await api.getPublicCheckoutSettings()).toEqual(DEFAULT_PUBLIC_CHECKOUT_SETTINGS);
    expect(lastCall().headers["x-tenant-id"]).toEqual(expect.any(String));
  });

  it("is null for a non-200, a network error, a non-JSON body and a body that is not settings", async () => {
    fetchMock.mockResolvedValueOnce(json({ code: "BOOM" }, 500));
    expect(await api.fetchPublicCheckoutSettings("s")).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await api.fetchPublicCheckoutSettings("s")).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200 }));
    expect(await api.fetchPublicCheckoutSettings("s")).toBeNull();
    fetchMock.mockResolvedValueOnce(json({ nameMode: "required" }));
    expect(await api.fetchPublicCheckoutSettings("s")).toBeNull();
  });
});

describe("checkout create and complete carry the customer's session", () => {
  it("startCheckout sends x-customer-session when a customer is signed in, and nothing extra for a guest", async () => {
    await api.startCheckout("guest-1", "cart-1", "EGP", "sess-1");
    expect(lastCall().headers["x-customer-session"]).toBe("sess-1");
    expect(lastCall().body).toEqual({ sessionRef: "guest-1", cartRef: "cart-1", currency: "EGP" });

    await api.startCheckout("guest-1", "cart-1", "EGP");
    expect(lastCall().headers).not.toHaveProperty("x-customer-session");
  });

  it("completeCheckout keeps its Idempotency-Key and adds x-customer-session only when signed in", async () => {
    await api.completeCheckout("cs-1", "guest-1", "key-1", "sess-1");
    expect(lastCall().url.pathname).toBe("/api/v1/public/checkouts/cs-1/complete");
    expect(lastCall().headers).toMatchObject({
      "Idempotency-Key": "key-1",
      "x-customer-session": "sess-1",
    });

    await api.completeCheckout("cs-1", "guest-1", "key-2");
    expect(lastCall().headers["Idempotency-Key"]).toBe("key-2");
    expect(lastCall().headers).not.toHaveProperty("x-customer-session");
    await api.completeCheckout("cs-1", "guest-1", "key-3", "");
    expect(lastCall().headers).not.toHaveProperty("x-customer-session");
  });

  it("setCheckoutContact sends marketingOptIn only when the shop asked", async () => {
    await api.setCheckoutContact("cs-1", "guest-1", "a@b.co");
    expect(lastCall().body).toEqual({ sessionRef: "guest-1", email: "a@b.co" });
    await api.setCheckoutContact("cs-1", "guest-1", "a@b.co", false);
    expect(lastCall().body).toEqual({
      sessionRef: "guest-1",
      email: "a@b.co",
      marketingOptIn: false,
    });
    await api.setCheckoutContact("cs-1", "guest-1", "a@b.co", true);
    expect(lastCall().body).toMatchObject({ marketingOptIn: true });
  });
});
