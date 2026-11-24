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
  createCustomerSegment,
  deleteCustomerSegment,
  fetchCustomerSegment,
  fetchCustomerSegments,
  fetchSegmentMembers,
  fetchSegmentStoreCurrency,
  isSegmentCondition,
  previewCustomerSegment,
  updateCustomerSegment,
} = await import("./customer-segments");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const customView = {
  id: "7c1f0f6e-0000-4000-8000-000000000001",
  kind: "custom",
  key: null,
  name: "VIP",
  version: 2,
  conditions: [{ field: "orders_count", op: "gte", value: 3 }],
  updatedAt: "2026-11-24T10:00:00.000Z",
};
const defaultView = {
  id: "default:not_purchased",
  kind: "default",
  key: "notPurchased",
  name: null,
  version: null,
  conditions: [{ field: "orders_count", op: "eq", value: 0 }],
  updatedAt: null,
};
const member = {
  id: "c-1",
  name: "Nour",
  email: "n@example.com",
  isGuest: false,
  ordersCount: 2,
  amountSpentMinor: 1250,
  lastOrderAt: "2026-11-20T10:00:00.000Z",
  emailSubscribed: true,
  smsSubscribed: false,
};
const membersPage = {
  items: [member],
  pageInfo: { hasNextPage: false, endCursor: null },
  total: 1,
  currency: "EGP",
};

function lastCall(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  return fetchMock.mock.calls.at(-1) as [string, RequestInit];
}

beforeEach(() => {
  expect.hasAssertions();
  cookiesMock.mockResolvedValue({ get: () => undefined });
  vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("segment reads", () => {
  it("fetchCustomerSegments GETs /customer-segments and validates every row", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { items: [defaultView, customView] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCustomerSegments();

    expect(result).toEqual({ outcome: "ok", data: { items: [defaultView, customView] } });
    expect(lastCall(fetchMock)[0]).toBe("http://runtime.test/api/v1/customer-segments");
  });

  it("fetchCustomerSegments refuses a row with an unknown condition field", async () => {
    const bad = { ...customView, conditions: [{ field: "shoe_size", op: "eq", value: 1 }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { items: [bad] })));

    expect((await fetchCustomerSegments()).outcome).toBe("error");
  });

  it("fetchCustomerSegment encodes the id and maps 404 to not_found", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCustomerSegment("default:not purchased/x");

    expect(result).toEqual({ outcome: "not_found" });
    expect(lastCall(fetchMock)[0]).toBe(
      "http://runtime.test/api/v1/customer-segments/default%3Anot%20purchased%2Fx",
    );
  });

  it("fetchCustomerSegment returns a default view", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, defaultView)));

    expect(await fetchCustomerSegment("default:not_purchased")).toEqual({
      outcome: "ok",
      data: defaultView,
    });
  });

  it("fetchSegmentStoreCurrency GETs the fixed path and needs a currency string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { currency: "KWD" }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchSegmentStoreCurrency()).toEqual({ outcome: "ok", data: { currency: "KWD" } });
    expect(lastCall(fetchMock)[0]).toBe(
      "http://runtime.test/api/v1/customer-segments/store-currency",
    );

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { currency: "" })));
    expect((await fetchSegmentStoreCurrency()).outcome).toBe("error");
  });

  it("fetchSegmentMembers sends first/after/search, encodes the id, and returns the page", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, membersPage));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSegmentMembers("a/b", { first: 25, after: "x y", search: "nour" });

    expect(result).toEqual({ outcome: "ok", data: membersPage });
    expect(lastCall(fetchMock)[0]).toBe(
      "http://runtime.test/api/v1/customer-segments/a%2Fb/members?first=25&after=x+y&search=nour",
    );
  });

  it("fetchSegmentMembers with no query has no question mark", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, membersPage));
    vi.stubGlobal("fetch", fetchMock);

    await fetchSegmentMembers("s-1");

    expect(lastCall(fetchMock)[0]).toBe("http://runtime.test/api/v1/customer-segments/s-1/members");
  });

  it.each([
    ["no total", { total: undefined }],
    ["no currency", { currency: undefined }],
    ["a negative total", { total: -1 }],
    ["pageInfo missing", { pageInfo: undefined }],
    ["an item without ordersCount", { items: [{ ...member, ordersCount: undefined }] }],
    ["an item with a string amount", { items: [{ ...member, amountSpentMinor: "12" }] }],
  ])("fetchSegmentMembers refuses a page with %s", async (_label, patch) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { ...membersPage, ...patch })),
    );

    expect((await fetchSegmentMembers("s-1")).outcome).toBe("error");
  });

  it("fetchSegmentMembers surfaces a 503 UNAVAILABLE with status and code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(503, { code: "UNAVAILABLE", message: "needs db" })),
    );

    expect(await fetchSegmentMembers("s-1")).toMatchObject({
      outcome: "error",
      status: 503,
      code: "UNAVAILABLE",
    });
  });
});

describe("segment writes", () => {
  it("createCustomerSegment POSTs the body with the idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { segmentId: "s-9" }));
    vi.stubGlobal("fetch", fetchMock);
    const body = {
      name: "VIP",
      conditions: [{ field: "orders_count", op: "gte", value: 3 }],
    } as const;

    const result = await createCustomerSegment(body, "key-1");

    expect(result).toEqual({ outcome: "ok", data: { segmentId: "s-9" } });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/customer-segments");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(body);
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });

  it("createCustomerSegment maps 409 to conflict (message kept) and 422 to invalid (fields kept)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(409, {
            code: "CONFLICT",
            message: "A segment with this name already exists",
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse(422, {
            code: "VALIDATION",
            message: "Invalid segment",
            fields: [{ field: "conditions.0.value", message: "Enter a whole number" }],
          }),
        ),
    );

    expect(await createCustomerSegment({ name: "x", conditions: [] }, "k")).toMatchObject({
      outcome: "conflict",
      message: "A segment with this name already exists",
    });
    expect(await createCustomerSegment({ name: "x", conditions: [] }, "k")).toMatchObject({
      outcome: "invalid",
      fields: [{ field: "conditions.0.value", message: "Enter a whole number" }],
    });
  });

  it("updateCustomerSegment POSTs /:id with expectedVersion and a key; the id is encoded", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { segmentId: "s 1", version: 3 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateCustomerSegment("s 1", { expectedVersion: 2, name: "New" }, "key-2");

    expect(result).toEqual({ outcome: "ok", data: { segmentId: "s 1", version: 3 } });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/customer-segments/s%201");
    expect(JSON.parse(init.body as string)).toEqual({ expectedVersion: 2, name: "New" });
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-2");
  });

  it("updateCustomerSegment refuses an OK body with no version", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { segmentId: "s-1" })));

    expect((await updateCustomerSegment("s-1", { expectedVersion: 1 }, "k")).outcome).toBe("error");
  });

  it("deleteCustomerSegment POSTs /:id/delete with expectedVersion and a key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { segmentId: "s-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await deleteCustomerSegment("s/1", 4, "key-3");

    expect(result).toEqual({ outcome: "ok", data: { segmentId: "s-1" } });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/customer-segments/s%2F1/delete");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ expectedVersion: 4 });
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-3");
  });

  it("previewCustomerSegment sends NO idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, membersPage));
    vi.stubGlobal("fetch", fetchMock);
    const conditions = [{ field: "email_subscribed", value: true }] as const;

    const result = await previewCustomerSegment(conditions, 10);

    expect(result).toEqual({ outcome: "ok", data: membersPage });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/customer-segments/preview");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ conditions, first: 10 });
    expect(Object.keys(init.headers as Record<string, string>)).not.toContain("idempotency-key");
  });

  it("previewCustomerSegment omits first when not given and maps 422 with fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(422, {
        code: "VALIDATION",
        message: "Invalid segment",
        fields: [{ field: "conditions", message: "Add at least one condition" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await previewCustomerSegment([]);

    expect(JSON.parse(lastCall(fetchMock)[1].body as string)).toEqual({ conditions: [] });
    expect(result).toMatchObject({ outcome: "invalid" });
  });
});

describe("isSegmentCondition", () => {
  it.each([
    [{ field: "orders_count", op: "gte", value: 1 }],
    [{ field: "amount_spent", op: "lt", valueMinor: 0 }],
    [{ field: "last_order_date", op: "within_last_days", days: 30 }],
    [{ field: "last_order_date", op: "before", date: "2026-01-02" }],
    [{ field: "last_order_date", op: "never" }],
    [{ field: "email_subscribed", value: false }],
    [{ field: "sms_subscribed", value: true }],
    [{ field: "tags", op: "has_none", values: ["VIP"] }],
    [{ field: "country", op: "not_in", values: ["EG", "SA"] }],
    [{ field: "created_date", op: "not_within_last_days", days: 7 }],
    [{ field: "created_date", op: "on_or_after", date: "2026-01-02" }],
    [{ field: "language", op: "neq", value: "ar" }],
    [{ field: "language", op: "unset" }],
  ])("accepts %j", (condition) => {
    expect(isSegmentCondition(condition)).toBe(true);
  });

  it.each([
    [null],
    ["orders_count"],
    [{ field: "orders_count", op: "gte" }],
    [{ field: "orders_count", op: "contains", value: 1 }],
    [{ field: "orders_count", op: "gte", value: 1.5 }],
    [{ field: "amount_spent", op: "gte", value: 5 }],
    [{ field: "last_order_date", op: "within_last_days", date: "2026-01-02" }],
    [{ field: "last_order_date", op: "on_or_after", days: 3 }],
    [{ field: "email_subscribed", value: "yes" }],
    [{ field: "tags", op: "has_any", values: "VIP" }],
    [{ field: "country", op: "in", values: [1] }],
    [{ field: "language", op: "eq", value: "fr" }],
    [{ field: "unknown", op: "eq", value: 1 }],
  ])("refuses %j", (condition) => {
    expect(isSegmentCondition(condition)).toBe(false);
  });
});
