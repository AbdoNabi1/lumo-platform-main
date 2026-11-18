import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const fetchMock = vi.fn();
const api = await import("./runtime-api");

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

interface Call {
  readonly url: URL;
  readonly init: RequestInit;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

function lastCall(): Call {
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("catalog list reads", () => {
  it("getProducts GETs /products with the page size and the tenant header", async () => {
    fetchMock.mockResolvedValue(json({ items: [{ id: "p1" }] }));

    expect(await api.getProducts(5)).toEqual([{ id: "p1" }]);
    const { url, init, headers } = lastCall();
    expect(url.pathname).toBe("/api/v1/public/products");
    expect(url.searchParams.get("first")).toBe("5");
    expect(init.method).toBeUndefined();
    expect(headers["x-tenant-id"]).toEqual(expect.any(String));
  });

  it("getProducts defaults to the 100 row ceiling and treats a missing items key as empty", async () => {
    expect(await api.getProducts()).toEqual([]);
    expect(lastCall().url.searchParams.get("first")).toBe("100");
  });

  it("getProducts returns null on a non-2xx and on a network error", async () => {
    fetchMock.mockResolvedValueOnce(json({ code: "BOOM" }, 500));
    expect(await api.getProducts()).toBeNull();

    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await api.getProducts()).toBeNull();
  });

  it("getProducts returns null when the body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }));
    expect(await api.getProducts()).toBeNull();
  });

  it("searchProducts sends the query alongside first", async () => {
    fetchMock.mockResolvedValue(json({ items: [{ id: "p2" }] }));

    expect(await api.searchProducts("red shirt & co", 20)).toEqual([{ id: "p2" }]);
    const { url } = lastCall();
    expect(url.pathname).toBe("/api/v1/public/products");
    expect(url.searchParams.get("query")).toBe("red shirt & co");
    expect(url.searchParams.get("first")).toBe("20");
  });

  it("getCategories sends no query string", async () => {
    fetchMock.mockResolvedValue(json({ items: [{ id: "c1" }] }));

    expect(await api.getCategories()).toEqual([{ id: "c1" }]);
    const { url } = lastCall();
    expect(url.pathname).toBe("/api/v1/public/categories");
    expect(url.search).toBe("");
  });

  it("getCollections, getPrices and getInventory hit their own routes with first", async () => {
    fetchMock.mockImplementation(async () => json({ items: [{ id: "x" }] }));

    expect(await api.getCollections(7)).toEqual([{ id: "x" }]);
    expect(lastCall().url.pathname).toBe("/api/v1/public/collections");
    expect(lastCall().url.searchParams.get("first")).toBe("7");

    expect(await api.getPrices(8)).toEqual([{ id: "x" }]);
    expect(lastCall().url.pathname).toBe("/api/v1/public/prices");
    expect(lastCall().url.searchParams.get("first")).toBe("8");

    expect(await api.getInventory(9)).toEqual([{ id: "x" }]);
    expect(lastCall().url.pathname).toBe("/api/v1/public/inventory");
    expect(lastCall().url.searchParams.get("first")).toBe("9");
  });

  it("getCollections returns null when the runtime answers 503", async () => {
    fetchMock.mockResolvedValue(json({}, 503));
    expect(await api.getCollections()).toBeNull();
  });
});

describe("catalog single reads", () => {
  it("getProductBySlug encodes the slug and returns the body", async () => {
    fetchMock.mockResolvedValue(json({ id: "p1", slug: "a/b c" }));

    expect(await api.getProductBySlug("a/b c")).toEqual({ id: "p1", slug: "a/b c" });
    expect(lastCall().url.pathname).toBe("/api/v1/public/products/a%2Fb%20c");
  });

  it("getProductBySlug returns null for an unknown product", async () => {
    fetchMock.mockResolvedValue(json({ code: "NOT_FOUND" }, 404));
    expect(await api.getProductBySlug("nope")).toBeNull();
  });

  it("getCollectionBySlug encodes the slug and returns null on 404 or failure", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "col1" }));
    expect(await api.getCollectionBySlug("sum mer")).toEqual({ id: "col1" });
    expect(lastCall().url.pathname).toBe("/api/v1/public/collections/sum%20mer");

    fetchMock.mockResolvedValueOnce(json({}, 404));
    expect(await api.getCollectionBySlug("nope")).toBeNull();

    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await api.getCollectionBySlug("x")).toBeNull();
  });
});

describe("cursor-paged reads", () => {
  it("getCollectionProducts passes the cursor and returns pageInfo", async () => {
    const pageInfo = { hasNextPage: true, endCursor: "c2" };
    fetchMock.mockResolvedValue(json({ items: [{ id: "p1" }], pageInfo }));

    expect(await api.getCollectionProducts("new/in", 10, "c1")).toEqual({
      items: [{ id: "p1" }],
      pageInfo,
    });
    const { url } = lastCall();
    expect(url.pathname).toBe("/api/v1/public/collections/new%2Fin/products");
    expect(url.searchParams.get("first")).toBe("10");
    expect(url.searchParams.get("after")).toBe("c1");
  });

  it("getCollectionProducts omits after on the first page and defaults pageInfo", async () => {
    fetchMock.mockResolvedValue(json({}));

    expect(await api.getCollectionProducts("all")).toEqual({
      items: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    expect(lastCall().url.searchParams.has("after")).toBe(false);
    expect(lastCall().url.searchParams.get("first")).toBe("100");
  });

  it("getCollectionProducts returns null on failure", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 500));
    expect(await api.getCollectionProducts("all")).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await api.getCollectionProducts("all")).toBeNull();
  });

  it("getProductReviews targets the by-product route with the cursor", async () => {
    fetchMock.mockResolvedValue(json({ items: [{ id: "r1" }] }));

    const page = await api.getProductReviews("prod/1", 3, "cur");
    expect(page?.items).toEqual([{ id: "r1" }]);
    expect(page?.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
    const { url } = lastCall();
    expect(url.pathname).toBe("/api/v1/public/reviews/by-product/prod%2F1");
    expect(url.searchParams.get("after")).toBe("cur");
  });
});

describe("store facts", () => {
  it("getPublicStore keeps only name and currency", async () => {
    fetchMock.mockResolvedValue(json({ name: "Shop", currency: "EGP", secret: "x" }));

    expect(await api.getPublicStore()).toEqual({ name: "Shop", currency: "EGP" });
    expect(lastCall().url.pathname).toBe("/api/v1/public/store");
  });

  it("getPublicStore returns null for a malformed body or a failure", async () => {
    fetchMock.mockResolvedValueOnce(json({ name: "Shop" }));
    expect(await api.getPublicStore()).toBeNull();
    fetchMock.mockResolvedValueOnce(json({}, 500));
    expect(await api.getPublicStore()).toBeNull();
  });

  it("getShippableCountries maps a valid body and rejects a malformed one", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ countries: ["EG", "SA"], restOfWorld: false, extra: 1 }),
    );
    expect(await api.getShippableCountries()).toEqual({
      countries: ["EG", "SA"],
      restOfWorld: false,
    });
    expect(lastCall().url.pathname).toBe("/api/v1/public/shipping/countries");

    fetchMock.mockResolvedValueOnce(json({ countries: "EG", restOfWorld: false }));
    expect(await api.getShippableCountries()).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await api.getShippableCountries()).toBeNull();
  });

  it("getPaymentMethods returns the methods, or null when absent or failing", async () => {
    fetchMock.mockResolvedValueOnce(json({ methods: ["cod", "card"] }));
    expect(await api.getPaymentMethods()).toEqual(["cod", "card"]);
    expect(lastCall().url.pathname).toBe("/api/v1/public/payment-methods");

    fetchMock.mockResolvedValueOnce(json({}));
    expect(await api.getPaymentMethods()).toBeNull();
    fetchMock.mockResolvedValueOnce(json({}, 500));
    expect(await api.getPaymentMethods()).toBeNull();
  });
});

describe("cart", () => {
  it("getCurrentCart sends the session as a header, never in the URL", async () => {
    fetchMock.mockResolvedValue(json({ cart: null }));

    expect(await api.getCurrentCart("sess-1")).toEqual({ status: 200, body: { cart: null } });
    const { url, headers } = lastCall();
    expect(url.pathname).toBe("/api/v1/public/carts/current");
    expect(url.search).toBe("");
    expect(headers["x-cart-session"]).toBe("sess-1");
  });

  it("getCurrentCart keeps 404 distinct from an unreachable runtime", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 404));
    expect(await api.getCurrentCart("s")).toEqual({ status: 404, body: null });
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await api.getCurrentCart("s")).toEqual({ status: 0, body: null });
  });

  it("createCart POSTs the session and currency as JSON", async () => {
    fetchMock.mockResolvedValue(json({ id: "cart-1" }, 201));

    expect(await api.createCart("sess-1", "EGP")).toEqual({ status: 201, body: { id: "cart-1" } });
    const { url, init, headers, body } = lastCall();
    expect(url.pathname).toBe("/api/v1/public/carts");
    expect(init.method).toBe("POST");
    expect(headers["content-type"]).toBe("application/json");
    expect(body).toEqual({ sessionRef: "sess-1", currency: "EGP" });
  });

  it("addCartItem posts the whole input to the encoded cart's items route", async () => {
    const input = { sessionRef: "s", productId: "p1", variantId: "v1", quantity: 2 };
    fetchMock.mockResolvedValue(json({ id: "cart/1" }));

    expect(await api.addCartItem("cart/1", input)).toEqual({
      status: 200,
      body: { id: "cart/1" },
    });
    const { url, body } = lastCall();
    expect(url.pathname).toBe("/api/v1/public/carts/cart%2F1/items");
    expect(body).toEqual(input);
  });

  it("addCartItem surfaces a 422 envelope", async () => {
    const envelope = { code: "VALIDATION" };
    fetchMock.mockResolvedValue(json(envelope, 422));
    expect(await api.addCartItem("c", { sessionRef: "s", productId: "p", quantity: 99 })).toEqual({
      status: 422,
      body: envelope,
    });
  });

  it("changeCartItemQuantity includes variantId only when given", async () => {
    await api.changeCartItemQuantity("c1", "s", "p1", 3);
    expect(lastCall().url.pathname).toBe("/api/v1/public/carts/c1/items/quantity");
    expect(lastCall().body).toEqual({ sessionRef: "s", productId: "p1", quantity: 3 });

    await api.changeCartItemQuantity("c1", "s", "p1", 0, "v9");
    expect(lastCall().body).toEqual({
      sessionRef: "s",
      productId: "p1",
      quantity: 0,
      variantId: "v9",
    });
  });

  it("removeCartItem includes variantId only when given", async () => {
    await api.removeCartItem("c1", "s", "p1");
    expect(lastCall().url.pathname).toBe("/api/v1/public/carts/c1/items/remove");
    expect(lastCall().body).toEqual({ sessionRef: "s", productId: "p1" });

    await api.removeCartItem("c1", "s", "p1", "v2");
    expect(lastCall().body).toEqual({ sessionRef: "s", productId: "p1", variantId: "v2" });
  });

  it("clearCart posts only the session ref and survives a network error", async () => {
    await api.clearCart("c1", "s");
    expect(lastCall().url.pathname).toBe("/api/v1/public/carts/c1/clear");
    expect(lastCall().body).toEqual({ sessionRef: "s" });

    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await api.clearCart("c1", "s")).toEqual({ status: 0, body: null });
  });

  it("a non-JSON error body yields the status with a null body", async () => {
    fetchMock.mockResolvedValue(new Response("Bad Gateway", { status: 502 }));
    expect(await api.clearCart("c1", "s")).toEqual({ status: 502, body: null });
  });
});

describe("checkout", () => {
  const address = {
    name: "A B",
    phone: "+200000000",
    line1: "1 Street",
    city: "Cairo",
    country: "EG",
  } as unknown as Parameters<typeof api.setCheckoutBillingAddress>[2];

  it("startCheckout posts session, cart and currency", async () => {
    fetchMock.mockResolvedValue(json({ id: "co-1" }, 201));

    expect(await api.startCheckout("s", "cart-1", "EGP")).toEqual({
      status: 201,
      body: { id: "co-1" },
    });
    const { url, body } = lastCall();
    expect(url.pathname).toBe("/api/v1/public/checkouts");
    expect(body).toEqual({ sessionRef: "s", cartRef: "cart-1", currency: "EGP" });
  });

  it("getCheckoutSession GETs with the session header and nulls the body on 404", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "co/1" }));
    expect(await api.getCheckoutSession("co/1", "s")).toEqual({
      status: 200,
      body: { id: "co/1" },
    });
    expect(lastCall().url.pathname).toBe("/api/v1/public/checkouts/co%2F1");
    expect(lastCall().headers["x-cart-session"]).toBe("s");

    fetchMock.mockResolvedValueOnce(json({}, 404));
    expect(await api.getCheckoutSession("co-1", "s")).toEqual({ status: 404, body: null });
  });

  it("loadCheckoutItems posts the cart id", async () => {
    await api.loadCheckoutItems("co-1", "s", "cart-1");
    expect(lastCall().url.pathname).toBe("/api/v1/public/checkouts/co-1/items");
    expect(lastCall().body).toEqual({ sessionRef: "s", cartId: "cart-1" });
  });

  it("billing and shipping address calls spread the address beside the session", async () => {
    await api.setCheckoutBillingAddress("co-1", "s", address);
    expect(lastCall().url.pathname).toBe("/api/v1/public/checkouts/co-1/billing-address");
    expect(lastCall().body).toEqual({ sessionRef: "s", ...address });

    await api.setCheckoutShippingAddress("co-1", "s", address);
    expect(lastCall().url.pathname).toBe("/api/v1/public/checkouts/co-1/shipping-address");
    expect(lastCall().body).toEqual({ sessionRef: "s", ...address });
  });

  it("setCheckoutContact posts the email", async () => {
    await api.setCheckoutContact("co-1", "s", "a@example.test");
    expect(lastCall().url.pathname).toBe("/api/v1/public/checkouts/co-1/contact");
    expect(lastCall().body).toEqual({ sessionRef: "s", email: "a@example.test" });
  });

  it("requestCheckoutShippingQuote returns the quotes", async () => {
    const quotes = [{ method: "std", amountMinor: 500 }];
    fetchMock.mockResolvedValue(json({ quotes }));

    expect(await api.requestCheckoutShippingQuote("co-1", "s")).toEqual({
      status: 200,
      body: { quotes },
    });
    expect(lastCall().url.pathname).toBe("/api/v1/public/checkouts/co-1/shipping-quote");
    expect(lastCall().body).toEqual({ sessionRef: "s" });
  });

  it("selectCheckoutShipping posts the chosen method", async () => {
    await api.selectCheckoutShipping("co-1", "s", "express");
    expect(lastCall().url.pathname).toBe("/api/v1/public/checkouts/co-1/shipping-selection");
    expect(lastCall().body).toEqual({ sessionRef: "s", method: "express" });
  });

  it("requestCheckoutTax returns the tax amount", async () => {
    fetchMock.mockResolvedValue(json({ taxMinor: 140 }));

    expect(await api.requestCheckoutTax("co-1", "s")).toEqual({
      status: 200,
      body: { taxMinor: 140 },
    });
    expect(lastCall().url.pathname).toBe("/api/v1/public/checkouts/co-1/tax");
  });

  it("selectCheckoutPayment posts the method ref and provider", async () => {
    await api.selectCheckoutPayment("co-1", "s", "pm-1", "manual");
    expect(lastCall().url.pathname).toBe("/api/v1/public/checkouts/co-1/payment-selection");
    expect(lastCall().body).toEqual({
      sessionRef: "s",
      paymentMethodRef: "pm-1",
      provider: "manual",
    });
  });

  it("recalculateCheckout posts the session and reports a 409 conflict", async () => {
    fetchMock.mockResolvedValue(json({ code: "CONFLICT" }, 409));

    expect(await api.recalculateCheckout("co-1", "s")).toEqual({
      status: 409,
      body: { code: "CONFLICT" },
    });
    expect(lastCall().url.pathname).toBe("/api/v1/public/checkouts/co-1/recalculate");
  });

  it("completeCheckout sends the idempotency key in both header and body", async () => {
    fetchMock.mockResolvedValue(json({ id: "co-1", status: "completed" }));

    expect(await api.completeCheckout("co-1", "s", "idem-1")).toEqual({
      status: 200,
      body: { id: "co-1", status: "completed" },
    });
    const { url, headers, body } = lastCall();
    expect(url.pathname).toBe("/api/v1/public/checkouts/co-1/complete");
    expect(headers["Idempotency-Key"]).toBe("idem-1");
    expect(body).toEqual({ sessionRef: "s", idempotencyKey: "idem-1" });
  });

  it("generateCheckoutPaymentIntentRequest GETs with the cart session header", async () => {
    fetchMock.mockResolvedValue(json({ amountMinor: 1000 }));

    expect(await api.generateCheckoutPaymentIntentRequest("co-1", "s")).toEqual({
      status: 200,
      body: { amountMinor: 1000 },
    });
    expect(lastCall().url.pathname).toBe("/api/v1/public/checkouts/co-1/payment-intent-request");
    expect(lastCall().headers["x-cart-session"]).toBe("s");
  });

  it("initiateCheckoutPayment posts to /payment and reports an unreachable runtime", async () => {
    fetchMock.mockResolvedValueOnce(json({ paymentIntentId: "pi_1" }));
    expect(await api.initiateCheckoutPayment("co-1", "s")).toEqual({
      status: 200,
      body: { paymentIntentId: "pi_1" },
    });
    expect(lastCall().url.pathname).toBe("/api/v1/public/checkouts/co-1/payment");

    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await api.initiateCheckoutPayment("co-1", "s")).toEqual({ status: 0, body: null });
  });
});

describe("customer account", () => {
  it("registerCustomer posts credentials with an Idempotency-Key header", async () => {
    fetchMock.mockResolvedValue(json({ customerRef: "cu-1" }, 201));

    expect(await api.registerCustomer("a@example.test", "A", "placeholder-pw", "idem-1")).toEqual({
      status: 201,
      body: { customerRef: "cu-1" },
    });
    const { url, headers, body } = lastCall();
    expect(url.pathname).toBe("/api/v1/public/auth/register");
    expect(headers["Idempotency-Key"]).toBe("idem-1");
    expect(body).toEqual({ email: "a@example.test", name: "A", password: "placeholder-pw" });
  });

  it("completeSignup posts the token and the chosen password", async () => {
    fetchMock.mockResolvedValue(json({ customerRef: "cu-1", email: "a@example.test" }));

    expect((await api.completeSignup("tok", "A", "placeholder-pw", "idem-2")).body).toEqual({
      customerRef: "cu-1",
      email: "a@example.test",
    });
    expect(lastCall().url.pathname).toBe("/api/v1/public/auth/signup/complete");
    expect(lastCall().body).toEqual({ token: "tok", name: "A", password: "placeholder-pw" });
    expect(lastCall().headers["Idempotency-Key"]).toBe("idem-2");
  });

  it("loginCustomer returns the session, and a 401 as a null body", async () => {
    fetchMock.mockResolvedValueOnce(json({ sessionId: "sid" }));
    expect(await api.loginCustomer("a@example.test", "placeholder-pw")).toEqual({
      status: 200,
      body: { sessionId: "sid" },
    });
    expect(lastCall().url.pathname).toBe("/api/v1/public/auth/login");
    expect(lastCall().body).toEqual({ email: "a@example.test", password: "placeholder-pw" });

    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
    expect(await api.loginCustomer("a@example.test", "bad")).toEqual({ status: 401, body: null });
  });

  it("logout and logout-all send the session header and an empty body", async () => {
    fetchMock.mockImplementation(async () => json({ revoked: true }));
    await api.logoutCustomer("sid", "idem-3");
    expect(lastCall().url.pathname).toBe("/api/v1/public/auth/logout");
    expect(lastCall().headers["x-customer-session"]).toBe("sid");
    expect(lastCall().headers["Idempotency-Key"]).toBe("idem-3");
    expect(lastCall().body).toEqual({});

    fetchMock.mockResolvedValue(json({ revoked: 3 }));
    expect((await api.logoutCustomerEverywhere("sid", "idem-4")).body).toEqual({ revoked: 3 });
    expect(lastCall().url.pathname).toBe("/api/v1/public/auth/logout-all");
  });

  it("refreshCustomerSession posts to /refresh with the session header", async () => {
    fetchMock.mockResolvedValue(json({ sessionId: "sid2" }));

    expect(await api.refreshCustomerSession("sid")).toEqual({
      status: 200,
      body: { sessionId: "sid2" },
    });
    expect(lastCall().url.pathname).toBe("/api/v1/public/auth/refresh");
    expect(lastCall().headers["x-customer-session"]).toBe("sid");
  });

  it("getCustomerProfile GETs /auth/me and maps 401 to a null body", async () => {
    fetchMock.mockResolvedValueOnce(json({ email: "a@example.test" }));
    expect(await api.getCustomerProfile("sid")).toEqual({
      status: 200,
      body: { email: "a@example.test" },
    });
    expect(lastCall().url.pathname).toBe("/api/v1/public/auth/me");
    expect(lastCall().headers["x-customer-session"]).toBe("sid");

    fetchMock.mockResolvedValueOnce(json({}, 401));
    expect(await api.getCustomerProfile("sid")).toEqual({ status: 401, body: null });
  });

  it("claimGuestCart posts the cart and guest session under the customer session", async () => {
    fetchMock.mockResolvedValue(json({ cartId: "c1", assigned: true }));

    expect((await api.claimGuestCart("sid", "c1", "guest", "idem-5")).body).toEqual({
      cartId: "c1",
      assigned: true,
    });
    expect(lastCall().url.pathname).toBe("/api/v1/public/auth/claim-cart");
    expect(lastCall().body).toEqual({ cartId: "c1", sessionRef: "guest" });
    expect(lastCall().headers["x-customer-session"]).toBe("sid");
  });
});

describe("wishlist", () => {
  it("getMyWishlist GETs /wishlists/me with the customer session", async () => {
    fetchMock.mockResolvedValue(json({ id: "w1", status: "active", items: [] }));

    expect((await api.getMyWishlist("sid")).body).toEqual({
      id: "w1",
      status: "active",
      items: [],
    });
    expect(lastCall().url.pathname).toBe("/api/v1/public/wishlists/me");
    expect(lastCall().headers["x-customer-session"]).toBe("sid");
  });

  it("add, remove and share post the product ref to their own routes", async () => {
    await api.addWishlistItem("sid", "p1", "i1");
    expect(lastCall().url.pathname).toBe("/api/v1/public/wishlists/me/items");
    expect(lastCall().body).toEqual({ productRef: "p1" });
    expect(lastCall().headers["Idempotency-Key"]).toBe("i1");

    await api.removeWishlistItem("sid", "p1", "i2");
    expect(lastCall().url.pathname).toBe("/api/v1/public/wishlists/me/items/remove");
    expect(lastCall().body).toEqual({ productRef: "p1" });

    fetchMock.mockResolvedValue(json({ id: "w1", shareToken: "tok" }));
    expect((await api.shareWishlistItem("sid", "p1", "i3")).body).toMatchObject({
      shareToken: "tok",
    });
    expect(lastCall().url.pathname).toBe("/api/v1/public/wishlists/me/items/share");
  });

  it("moveWishlistItemToCart sends the guest cart session with the product", async () => {
    await api.moveWishlistItemToCart("sid", "p1", "guest", "i4");
    expect(lastCall().url.pathname).toBe("/api/v1/public/wishlists/me/items/move-to-cart");
    expect(lastCall().body).toEqual({ productRef: "p1", sessionRef: "guest" });
    expect(lastCall().headers["x-customer-session"]).toBe("sid");
  });
});

describe("loyalty and reviews", () => {
  it("getMyLoyaltyBalance returns the account and maps 404 to no account", async () => {
    fetchMock.mockResolvedValueOnce(json({ balance: 10 }));
    expect((await api.getMyLoyaltyBalance("sid")).body).toEqual({ balance: 10 });
    expect(lastCall().url.pathname).toBe("/api/v1/public/loyalty/accounts/me");
    expect(lastCall().headers["x-customer-session"]).toBe("sid");

    fetchMock.mockResolvedValueOnce(json({}, 404));
    expect(await api.getMyLoyaltyBalance("sid")).toEqual({ status: 404, body: null });
  });

  it("createProductReview posts the input as-is under the session", async () => {
    fetchMock.mockResolvedValue(json({ reviewId: "r1", status: "pending" }, 201));
    const input = { productRef: "p1", rating: 5, bodyText: "great" };

    expect(await api.createProductReview("sid", input, "idem-6")).toEqual({
      status: 201,
      body: { reviewId: "r1", status: "pending" },
    });
    expect(lastCall().url.pathname).toBe("/api/v1/public/reviews");
    expect(lastCall().body).toEqual(input);
    expect(lastCall().headers["x-customer-session"]).toBe("sid");
    expect(lastCall().headers["Idempotency-Key"]).toBe("idem-6");
  });
});
