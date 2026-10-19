import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, jwtVerifyMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  jwtVerifyMock: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify: jwtVerifyMock,
}));

const {
  fetchOrdersPage,
  fetchRecentOrders,
  placeOrder,
  createOrderFromCheckout,
  refundOrder,
  advanceOrder,
  markOrderPaid,
  requestPaymentCapture,
  requestFulfillment,
  bulkOrders,
  fetchOrderExportRows,
  fetchPackingSlips,
  archiveOrder,
  updateOrderNote,
  changeOrderTags,
  fetchOrderTagSuggestions,
  addOrderComment,
  editOrderComment,
  deleteOrderComment,
} = await import("./orders");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  // No session cookie by default — matches the pre-Phase-A.32 "no session yet" baseline every
  // test below except the new session-forwarding case was already written against.
  cookiesMock.mockResolvedValue({ get: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("fetchRecentOrders", () => {
  it("returns the ok outcome with the orders from a successful response", async () => {
    const page = {
      items: [
        {
          id: "order-1",
          orderNumber: "ORD-1",
          customerRef: "customer-1",
          status: "paid",
          currency: "USD",
          totalMinor: 1999,
          createdAt: "2026-07-05T00:00:00.000Z",
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, page));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRecentOrders(5);
    expect(result).toEqual({ outcome: "ok", orders: page.items });
  });

  it("returns an ok outcome with an empty list when the page has no orders", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRecentOrders(5);
    expect(result).toEqual({ outcome: "ok", orders: [] });
  });

  it("maps a 401 to the unauthorized outcome, never demo data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { code: "UNAUTHENTICATED" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRecentOrders(5);
    expect(result).toEqual({ outcome: "unauthorized" });
  });

  it("maps a 403 to the unauthorized outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { code: "FORBIDDEN" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRecentOrders(5);
    expect(result).toEqual({ outcome: "unauthorized" });
  });

  it("maps a 500 to the error outcome with a message, never demo data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { code: "UNEXPECTED" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRecentOrders(5);
    expect(result.outcome).toBe("error");
  });

  it("maps a network failure to the error outcome instead of throwing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRecentOrders(5);
    expect(result).toEqual({ outcome: "error", message: "ECONNREFUSED" });
  });

  it("maps an unexpected response shape to the error outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRecentOrders(5);
    expect(result.outcome).toBe("error");
  });

  it("sends the tenant header and the page-size query param, with no bearer token by default", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
    vi.stubEnv("TENANT_DEFAULT_ID", "tenant-x");
    vi.stubEnv("ADMIN_API_TOKEN", "");

    await fetchRecentOrders(7);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/orders?first=7");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-tenant-id"]).toBe("tenant-x");
    expect(headers["authorization"]).toBeUndefined();
  });

  it("forwards ADMIN_API_TOKEN as a bearer token when configured", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ADMIN_API_TOKEN", "secret-token");

    await fetchRecentOrders(5);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer secret-token");
  });

  it("forwards the logged-in staff member's session token instead of ADMIN_API_TOKEN when both are present", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ADMIN_API_TOKEN", "server-to-server-fallback-token");
    cookiesMock.mockResolvedValue({ get: () => ({ value: "staff-session-jwt" }) });
    jwtVerifyMock.mockResolvedValue({ payload: { sub: "identity-1", kind: "staff", roles: [] } });

    await fetchRecentOrders(5);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer staff-session-jwt");
  });
});

/**
 * T5.2's 7 order write functions. `placeOrder`/`createOrderFromCheckout` read an `id` off an
 * unmapped `Order` aggregate response (same discipline `createProduct`'s own tests use in
 * `products.test.ts`); the remaining 5 assert the request shape only (path, method, body,
 * idempotency header) plus the ok/error mapping, since their handlers don't map the response
 * through a DTO either (see the doc comments above them in `orders.ts`).
 */
describe("T5.2 write functions", () => {
  function stubOk(body: unknown = {}): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
    return fetchMock;
  }

  function requestOf(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
    return fetchMock.mock.calls[0] as [string, RequestInit];
  }

  const lineItem = {
    productId: "product-1",
    name: "Wooden Blocks",
    unitPriceAmountMinor: 2999,
    quantity: 1,
  };
  const address = { line1: "123 Main St", city: "Springfield", postalCode: "12345", country: "US" };

  describe("placeOrder", () => {
    it("posts to /orders with the right body and idempotency header", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "order-1" }));
      vi.stubGlobal("fetch", fetchMock);
      vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

      const input = {
        customerRef: "customer-1",
        currency: "USD",
        items: [lineItem],
        shippingAddress: address,
      };
      const result = await placeOrder(input, "key-1");

      expect(result).toEqual({ outcome: "ok", data: { id: "order-1" } });
      const [url, init] = requestOf(fetchMock);
      expect(url).toBe("http://runtime.test/api/v1/orders");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual(input);
      expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
    });

    it("returns an empty id, still ok, when the response has no readable id", async () => {
      stubOk({});
      const result = await placeOrder(
        { customerRef: "customer-1", currency: "USD", items: [lineItem], shippingAddress: address },
        "key-1",
      );
      expect(result).toEqual({ outcome: "ok", data: { id: "" } });
    });

    it("maps a 422 to invalid, preserving the fields", async () => {
      const envelope = {
        message: "Invalid input",
        fields: [{ field: "customerRef", message: "must not be empty" }],
      };
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(422, envelope));
      vi.stubGlobal("fetch", fetchMock);

      const result = await placeOrder(
        { customerRef: "", currency: "USD", items: [lineItem], shippingAddress: address },
        "key-1",
      );

      expect(result).toEqual({
        outcome: "invalid",
        message: "Invalid input",
        fields: [{ field: "customerRef", message: "must not be empty" }],
      });
    });
  });

  describe("createOrderFromCheckout", () => {
    it("posts to /orders/from-checkout with checkoutRef, billing, and shipping addresses", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "order-2" }));
      vi.stubGlobal("fetch", fetchMock);
      vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

      const input = {
        checkoutRef: "checkout-1",
        customerRef: "customer-1",
        currency: "USD",
        items: [lineItem],
        billingAddress: address,
        shippingAddress: address,
      };
      const result = await createOrderFromCheckout(input, "key-2");

      expect(result).toEqual({ outcome: "ok", data: { id: "order-2" } });
      const [url, init] = requestOf(fetchMock);
      expect(url).toBe("http://runtime.test/api/v1/orders/from-checkout");
      expect(JSON.parse(init.body as string)).toEqual(input);
    });

    it("maps a 409 to conflict (e.g. currency mismatch with the checkout session)", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse(409, {
          message: "Checkout session currency does not match the requested order currency",
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await createOrderFromCheckout(
        {
          checkoutRef: "checkout-1",
          customerRef: "customer-1",
          currency: "EUR",
          items: [lineItem],
          billingAddress: address,
          shippingAddress: address,
        },
        "key-2",
      );

      expect(result).toEqual({
        outcome: "conflict",
        message: "Checkout session currency does not match the requested order currency",
      });
    });
  });

  it("refundOrder posts to /orders/:orderId/refund with no body", async () => {
    const fetchMock = stubOk();
    const result = await refundOrder("order-1", "key-3");
    expect(result.outcome).toBe("ok");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/orders/order-1/refund");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-3");
  });

  it("advanceOrder posts toStatus to /orders/:orderId/advance", async () => {
    const fetchMock = stubOk();
    await advanceOrder("order-1", "cancelled", "key-4");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/orders/order-1/advance");
    expect(JSON.parse(init.body as string)).toEqual({ toStatus: "cancelled" });
  });

  it("markOrderPaid posts paymentRef to /orders/:orderId/mark-paid", async () => {
    const fetchMock = stubOk();
    await markOrderPaid("order-1", "psp-ref-1", "key-5");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/orders/order-1/mark-paid");
    expect(JSON.parse(init.body as string)).toEqual({ paymentRef: "psp-ref-1" });
  });

  it("requestPaymentCapture posts to /orders/:orderId/request-payment-capture with no body", async () => {
    const fetchMock = stubOk();
    await requestPaymentCapture("order-1", "key-6");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/orders/order-1/request-payment-capture");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-6");
  });

  it("requestFulfillment posts to /orders/:orderId/request-fulfillment with no body", async () => {
    const fetchMock = stubOk();
    await requestFulfillment("order-1", "key-7");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/orders/order-1/request-fulfillment");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-7");
  });

  it("maps a 403 to forbidden for a permission-gated write", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, {}));
    vi.stubGlobal("fetch", fetchMock);
    const result = await refundOrder("order-1", "key-8");
    expect(result).toEqual({ outcome: "forbidden" });
  });
});

describe("fetchOrdersPage view (order operations Part 1)", () => {
  it("sends ?view= for a tab, and nothing for All", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          jsonResponse(200, { items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await fetchOrdersPage({ view: "unpaid", first: 50 });
    await fetchOrdersPage({ view: "all" });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("view=unpaid");
    expect(String(fetchMock.mock.calls[1]?.[0])).not.toContain("view=");
  });
});

describe("bulkOrders", () => {
  it("posts the action and ids with the idempotency key and returns the per-order results", async () => {
    const results = [{ orderId: "o-1", outcome: "ok" }];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { results }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await bulkOrders("archive", ["o-1"], "key-1");

    expect(result).toEqual({ outcome: "ok", data: { results } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/orders\/bulk$/);
    expect(JSON.parse(String(init.body))).toEqual({ action: "archive", orderIds: ["o-1"] });
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });
});

describe("fetchOrderExportRows", () => {
  it("sends the API's own parameter names (search, not q) and the ids as one comma list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await fetchOrderExportRows({ view: "unpaid", search: "mona", ids: ["a", "b"], first: 250 });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/v1/orders/export-rows");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      view: "unpaid",
      search: "mona",
      ids: "a,b",
      first: "250",
    });
  });
});

describe("fetchPackingSlips / archiveOrder (order operations Part 1)", () => {
  it("asks for the slips of the ids as one comma list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { slips: [] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchPackingSlips(["a", "b"])).toEqual({ outcome: "ok", slips: [] });
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(
      /\/api\/v1\/orders\/packing-slips\?ids=a,b$/,
    );
  });

  it("archives through POST /orders/:id/archive with the idempotency key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { orderId: "o-1", archivedAt: "x" }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await archiveOrder("o-1", "key-1")).outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/orders\/o-1\/archive$/);
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });
});

describe("note, tags and suggestions (order operations Part 2)", () => {
  it("puts the note with the idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { note: "Ring twice" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await updateOrderNote("o-1", "Ring twice", "key-1")).toEqual({
      outcome: "ok",
      data: { note: "Ring twice" },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/orders\/o-1\/note$/);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ note: "Ring twice" });
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });

  it("posts only the tag lists it was given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { tags: ["VIP"] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await changeOrderTags("o-1", { add: ["VIP"] }, "key-2")).toEqual({
      outcome: "ok",
      data: { tags: ["VIP"] },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/orders\/o-1\/tags$/);
    expect(JSON.parse(String(init.body))).toEqual({ add: ["VIP"] });
  });

  it("asks for suggestions by prefix and answers null on failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { tags: [{ tag: "VIP", count: 2 }] }))
      .mockResolvedValueOnce(jsonResponse(500, { message: "down" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchOrderTagSuggestions("v i")).toEqual([{ tag: "VIP", count: 2 }]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/api\/v1\/order-tags\?q=v%20i$/);
    expect(await fetchOrderTagSuggestions("v")).toBeNull();
  });
});

describe("comments (order operations Part 2)", () => {
  const entry = {
    id: "e-1",
    kind: "comment",
    authorName: "Ahmed",
    body: "Called",
    data: {},
    createdAt: "2026-10-19T09:00:00.000Z",
    editedAt: null,
    deleted: false,
    canEdit: true,
    canDelete: true,
  };

  it("posts, patches and deletes under the order's comments path with the idempotency key", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, entry)));
    vi.stubGlobal("fetch", fetchMock);
    expect(await addOrderComment("o-1", "Called", "k-1")).toEqual({ outcome: "ok", data: entry });
    await editOrderComment("o-1", "e 1", "Called again", "k-2");
    await deleteOrderComment("o-1", "e-1", "k-3");
    const calls = fetchMock.mock.calls as [string, RequestInit][];
    expect(calls.map(([url, init]) => [init.method, url.replace(/^.*\/api\/v1/, "")])).toEqual([
      ["POST", "/orders/o-1/comments"],
      ["PATCH", "/orders/o-1/comments/e%201"],
      ["DELETE", "/orders/o-1/comments/e-1"],
    ]);
    expect(JSON.parse(String(calls[1]?.[1].body))).toEqual({ body: "Called again" });
    expect((calls[2]?.[1].headers as Record<string, string>)["idempotency-key"]).toBe("k-3");
  });
});
