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
  fetchReturnByOrder,
  createReturn,
  decideReturn,
  generateReturnRma,
  receiveReturnPackage,
  recordReturnInspection,
  acceptReturnItems,
  advanceReturn,
  resolveReturn,
} = await import("./returns");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

const returnDetail = {
  id: "return-1",
  orderRef: "order-1",
  status: "requested",
  items: [
    {
      orderItemRef: "item-1",
      productRef: "product-1",
      quantity: 1,
      reasonCode: "damaged",
      reasonNote: null,
      disposition: null,
    },
  ],
  rmaNumber: null,
  approved: null,
  approvalNote: null,
  refundOutcome: null,
  refundAmountMinor: null,
  refundCurrency: null,
};

describe("fetchReturnByOrder", () => {
  it("returns the ok outcome with the return request for a successful response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, returnDetail));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchReturnByOrder("order-1");
    expect(result).toEqual({ outcome: "ok", returnRequest: returnDetail });
  });

  it("maps a 404 to not_found (no return opened for this order)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchReturnByOrder("order-1");
    expect(result).toEqual({ outcome: "not_found" });
  });

  it("maps a 401 to unauthorized", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchReturnByOrder("order-1");
    expect(result).toEqual({ outcome: "unauthorized" });
  });

  it("sends the orderId url-encoded", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, returnDetail));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    await fetchReturnByOrder("order with spaces");

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://runtime.test/api/v1/orders/order%20with%20spaces/return");
  });
});

/**
 * T5.3's 8 return write functions. None of their handlers map the response through a DTO (see
 * `returns.ts`'s own doc comment above `isUnknown`), so every one of these asserts the request
 * shape only (path, method, body, idempotency header) plus the ok/error mapping — same discipline
 * `orders.test.ts`'s T5.2 write-function tests use for the 5 non-DTO order writes.
 */
describe("T5.3 write functions", () => {
  function stubOk(body: unknown = {}): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
    return fetchMock;
  }

  function requestOf(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
    return fetchMock.mock.calls[0] as [string, RequestInit];
  }

  it("createReturn posts to /returns with orderRef and items", async () => {
    const fetchMock = stubOk();
    const input = {
      orderRef: "order-1",
      items: [
        {
          orderItemRef: "item-1",
          productRef: "product-1",
          quantity: 2,
          reasonCode: "damaged",
          reasonNote: "Box was crushed",
        },
      ],
    };
    const result = await createReturn(input, "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/returns");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });

  it("decideReturn posts approved and an optional note to /returns/:returnId/decision", async () => {
    const fetchMock = stubOk();
    await decideReturn("return-1", true, "Looks legitimate", "key-2");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/returns/return-1/decision");
    expect(JSON.parse(init.body as string)).toEqual({
      approved: true,
      note: "Looks legitimate",
    });
  });

  it("decideReturn omits note from the body when not given", async () => {
    const fetchMock = stubOk();
    await decideReturn("return-1", false, undefined, "key-2b");
    const [, init] = requestOf(fetchMock);
    expect(JSON.parse(init.body as string)).toEqual({ approved: false });
  });

  it("generateReturnRma posts rmaNumber to /returns/:returnId/rma", async () => {
    const fetchMock = stubOk();
    await generateReturnRma("return-1", "RMA-123", "key-3");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/returns/return-1/rma");
    expect(JSON.parse(init.body as string)).toEqual({ rmaNumber: "RMA-123" });
  });

  it("receiveReturnPackage posts source and callbackId to /returns/:returnId/receive with the idempotency header even though the route itself is not idempotent", async () => {
    const fetchMock = stubOk();
    await receiveReturnPackage("return-1", "warehouse-1", "callback-1", "key-4");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/returns/return-1/receive");
    expect(JSON.parse(init.body as string)).toEqual({
      source: "warehouse-1",
      callbackId: "callback-1",
    });
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-4");
  });

  it("recordReturnInspection posts itemRef, passed, and an optional note to /returns/:returnId/inspection", async () => {
    const fetchMock = stubOk();
    await recordReturnInspection("return-1", "item-1", true, "Undamaged", "key-5");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/returns/return-1/inspection");
    expect(JSON.parse(init.body as string)).toEqual({
      itemRef: "item-1",
      passed: true,
      note: "Undamaged",
    });
  });

  it("acceptReturnItems posts the items array to /returns/:returnId/accept", async () => {
    const fetchMock = stubOk();
    const items = [{ orderItemRef: "item-1", disposition: "restock" }];
    await acceptReturnItems("return-1", items, "key-6");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/returns/return-1/accept");
    expect(JSON.parse(init.body as string)).toEqual({ items });
  });

  it("advanceReturn posts toStatus to /returns/:returnId/transitions", async () => {
    const fetchMock = stubOk();
    await advanceReturn("return-1", "closed", "key-7");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/returns/return-1/transitions");
    expect(JSON.parse(init.body as string)).toEqual({ toStatus: "closed" });
  });

  it("resolveReturn posts outcome plus optional amountMinor/currency to /returns/:returnId/resolution", async () => {
    const fetchMock = stubOk();
    await resolveReturn("return-1", "refund", 1999, "USD", "key-8");
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/returns/return-1/resolution");
    expect(JSON.parse(init.body as string)).toEqual({
      outcome: "refund",
      amountMinor: 1999,
      currency: "USD",
    });
  });

  it("resolveReturn omits amountMinor/currency from the body when not given", async () => {
    const fetchMock = stubOk();
    await resolveReturn("return-1", "replacement", undefined, undefined, "key-9");
    const [, init] = requestOf(fetchMock);
    expect(JSON.parse(init.body as string)).toEqual({ outcome: "replacement" });
  });

  it("maps a 403 to forbidden for a permission-gated write", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, {}));
    vi.stubGlobal("fetch", fetchMock);
    const result = await advanceReturn("return-1", "closed", "key-10");
    expect(result).toEqual({ outcome: "forbidden" });
  });

  it("maps a 409 to conflict (e.g. an invalid transition for the current status)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(409, { message: "Invalid transition" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await advanceReturn("return-1", "closed", "key-11");
    expect(result).toEqual({ outcome: "conflict", message: "Invalid transition" });
  });

  it("maps a 422 to invalid, preserving the fields", async () => {
    const envelope = {
      message: "Invalid input",
      fields: [{ field: "rmaNumber", message: "must not be empty" }],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(422, envelope));
    vi.stubGlobal("fetch", fetchMock);
    const result = await generateReturnRma("return-1", "", "key-12");
    expect(result).toEqual({
      outcome: "invalid",
      message: "Invalid input",
      fields: [{ field: "rmaNumber", message: "must not be empty" }],
    });
  });
});
