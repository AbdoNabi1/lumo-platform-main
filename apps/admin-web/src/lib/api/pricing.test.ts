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
  createPriceList,
  activatePriceList,
  createPrice,
  changePrice,
  publishPrice,
  createTaxClass,
  createPricingRule,
} = await import("./pricing");

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

function requestOf(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  return fetchMock.mock.calls[0] as [string, RequestInit];
}

/**
 * T5.6's 7 Pricing write functions. `createPriceList`/`createPrice`/`createTaxClass`/
 * `createPricingRule`'s handlers return the created aggregate directly (no DTO mapping, per
 * `pricing.ts`'s own doc comment), so each is asserted to read only an `id` off the response, same
 * as `products.test.ts`'s `createProduct` case. `activatePriceList`/`changePrice`/`publishPrice`
 * read nothing off their responses, same as `inventory.test.ts`'s write-function tests.
 */
describe("T5.6 pricing write functions", () => {
  it("createPriceList posts name/currency to /price-lists and reads the created id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "price-list-1" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const input = { name: "Standard", currency: "USD" };
    const result = await createPriceList(input, "key-1");

    expect(result).toEqual({ outcome: "ok", data: { id: "price-list-1" } });
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/price-lists");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });

  it("createPriceList reads an empty id when the response carries no id field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { name: "Standard" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await createPriceList({ name: "Standard", currency: "USD" }, "key-1");

    expect(result).toEqual({ outcome: "ok", data: { id: "" } });
  });

  it("activatePriceList posts to /price-lists/:priceListId/activate with no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    await activatePriceList("price-list-1", "key-2");

    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/price-lists/price-list-1/activate");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-2");
  });

  it("createPrice posts the full body to /prices and reads the created id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "price-1" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const input = {
      priceListId: "price-list-1",
      productId: "product-1",
      amountMinor: 2999,
      currency: "USD",
      compareAtMinor: 3999,
      costMinor: 1000,
      effectiveFrom: "2026-01-01T00:00:00Z",
      effectiveTo: "2026-12-31T00:00:00Z",
      taxClassRef: "tax-class-1",
    };
    const result = await createPrice(input, "key-3");

    expect(result).toEqual({ outcome: "ok", data: { id: "price-1" } });
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/prices");
    expect(JSON.parse(init.body as string)).toEqual(input);
  });

  it("changePrice posts amountMinor/currency/compareAtMinor/costMinor to /prices/:priceId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const input = { amountMinor: 3499, currency: "USD", compareAtMinor: 3999, costMinor: 1200 };
    await changePrice("price-1", input, "key-4");

    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/prices/price-1");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
  });

  it("publishPrice posts to /prices/:priceId/publish with no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    await publishPrice("price-1", "key-5");

    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/prices/price-1/publish");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-5");
  });

  it("createTaxClass posts code/name to /tax-classes and reads the created id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "tax-class-1" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const input = { code: "STANDARD", name: "Standard rate" };
    const result = await createTaxClass(input, "key-6");

    expect(result).toEqual({ outcome: "ok", data: { id: "tax-class-1" } });
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/tax-classes");
    expect(JSON.parse(init.body as string)).toEqual(input);
  });

  it("createPricingRule posts type/value/priority to /pricing-rules and reads the created id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "pricing-rule-1" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const input = { type: "percentage" as const, value: 10, priority: 1 };
    const result = await createPricingRule(input, "key-7");

    expect(result).toEqual({ outcome: "ok", data: { id: "pricing-rule-1" } });
    const [url, init] = requestOf(fetchMock);
    expect(url).toBe("http://runtime.test/api/v1/pricing-rules");
    expect(JSON.parse(init.body as string)).toEqual(input);
  });

  it("maps a 403 to forbidden", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await publishPrice("price-1", "key-8");
    expect(result).toEqual({ outcome: "forbidden" });
  });

  it("maps a 422 to invalid, preserving the fields", async () => {
    const envelope = {
      code: "VALIDATION",
      message: "Invalid input",
      retryable: false,
      fields: [{ field: "currency", message: "must be 3 characters" }],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(422, envelope));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await createPriceList({ name: "Standard", currency: "US" }, "key-9");

    expect(result).toEqual({
      outcome: "invalid",
      message: "Invalid input",
      fields: [{ field: "currency", message: "must be 3 characters" }],
    });
  });
});
