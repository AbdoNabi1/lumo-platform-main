import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("jose", () => ({ createRemoteJWKSet: vi.fn(() => ({})), jwtVerify: vi.fn() }));

const {
  activateDiscount,
  createDiscount,
  deactivateDiscount,
  deleteDiscount,
  discountClassOf,
  fetchDiscount,
  fetchDiscountsPage,
  isDiscountDto,
  updateDiscount,
} = await import("./discounts");
import type { DiscountDto, DiscountInput } from "./discounts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const dto: DiscountDto = {
  id: "promo-1",
  type: "amount_off_order",
  method: "code",
  title: "SALE10",
  code: "SALE10",
  status: "active",
  value: { kind: "percentage", amount: 10 },
  appliesTo: null,
  appliesOncePerOrder: false,
  buys: null,
  gets: null,
  maxUsesPerOrder: null,
  countries: null,
  maxShippingRateMinor: null,
  minimumRequirement: { kind: "amount", amountMinor: 20000 },
  customerEligibility: { kind: "all" },
  usageLimit: null,
  oncePerCustomer: false,
  combinesWith: { product: false, order: false, shipping: true },
  startsAt: "2026-10-16T10:00:00.000Z",
  endsAt: null,
  usageCount: 3,
};

const input: DiscountInput = {
  type: "amount_off_order",
  method: "code",
  code: "SALE10",
  value: { kind: "percentage", amount: 10 },
  minimumRequirement: { kind: "none" },
  customerEligibility: { kind: "all" },
  oncePerCustomer: false,
  combinesWith: { product: false, order: false, shipping: false },
  startsAt: "2026-10-16T10:00:00.000Z",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
  vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

function lastCall(): [string, RequestInit] {
  return fetchMock.mock.calls.at(-1) as [string, RequestInit];
}

describe("discountClassOf", () => {
  it("maps Shopify's types to their combination class", () => {
    expect(discountClassOf("amount_off_products")).toBe("product");
    expect(discountClassOf("buy_x_get_y")).toBe("product");
    expect(discountClassOf("amount_off_order")).toBe("order");
    expect(discountClassOf("free_shipping")).toBe("shipping");
  });
});

describe("isDiscountDto", () => {
  it("accepts the API's shape and rejects others", () => {
    expect(isDiscountDto(dto)).toBe(true);
    expect(isDiscountDto({ ...dto, type: "bogus" })).toBe(false);
    expect(isDiscountDto({ id: "x" })).toBe(false);
    expect(isDiscountDto(null)).toBe(false);
  });
});

describe("fetchDiscountsPage", () => {
  it("sends view, q, first and after, and returns the page", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { items: [dto], pageInfo: { hasNextPage: true, endCursor: "c2" } }),
    );

    const result = await fetchDiscountsPage({
      view: "active",
      q: " sale ",
      first: 20,
      after: "c1",
    });

    expect(result).toEqual({
      outcome: "ok",
      items: [dto],
      pageInfo: { hasNextPage: true, endCursor: "c2" },
    });
    const url = new URL(lastCall()[0]);
    expect(url.pathname).toBe("/api/v1/discounts");
    expect(url.searchParams.get("view")).toBe("active");
    expect(url.searchParams.get("q")).toBe("sale");
    expect(url.searchParams.get("first")).toBe("20");
    expect(url.searchParams.get("after")).toBe("c1");
  });

  it("leaves out view=all and an empty search", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { items: [], pageInfo: { hasNextPage: false, endCursor: null } }),
    );

    await fetchDiscountsPage({ view: "all", q: "  " });

    const url = new URL(lastCall()[0]);
    expect(url.searchParams.has("view")).toBe(false);
    expect(url.searchParams.has("q")).toBe(false);
  });

  it("reports unauthorized and a bad shape", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    expect(await fetchDiscountsPage({})).toEqual({ outcome: "unauthorized" });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { nope: true }));
    expect((await fetchDiscountsPage({})).outcome).toBe("error");
  });
});

describe("fetchDiscount", () => {
  it("reads one discount by id", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, dto));
    expect(await fetchDiscount("promo 1")).toEqual({ outcome: "ok", discount: dto });
    expect(lastCall()[0]).toBe("http://runtime.test/api/v1/discounts/promo%201");
  });

  it("answers not_found for a 404", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, {}));
    expect(await fetchDiscount("gone")).toEqual({ outcome: "not_found" });
  });
});

describe("discount writes", () => {
  it("creates with POST, the body and the idempotency key", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, dto));

    const result = await createDiscount(input, "key-1");

    expect(result).toEqual({ outcome: "ok", data: dto });
    const [url, init] = lastCall();
    expect(url).toBe("http://runtime.test/api/v1/discounts");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });

  it("updates with PUT on the discount's path", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, dto));
    await updateDiscount("promo-1", input, "key-2");
    const [url, init] = lastCall();
    expect(url).toBe("http://runtime.test/api/v1/discounts/promo-1");
    expect(init.method).toBe("PUT");
  });

  it("deletes with DELETE", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: "promo-1", deleted: true }));
    expect((await deleteDiscount("promo-1", "key-3")).outcome).toBe("ok");
    const [url, init] = lastCall();
    expect(url).toBe("http://runtime.test/api/v1/discounts/promo-1");
    expect(init.method).toBe("DELETE");
  });

  it("activates and deactivates with POST on their routes", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, dto));
    await activateDiscount("promo-1", "key-4");
    expect(lastCall()[0]).toBe("http://runtime.test/api/v1/discounts/promo-1/activate");
    await deactivateDiscount("promo-1", "key-5");
    expect(lastCall()[0]).toBe("http://runtime.test/api/v1/discounts/promo-1/deactivate");
    expect(lastCall()[1].method).toBe("POST");
  });

  it("keeps a 422's field issues", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(422, {
        code: "VALIDATION",
        message: "Invalid discount",
        retryable: false,
        fields: [{ field: "code", message: "This code is already in use" }],
      }),
    );
    expect(await createDiscount(input, "key-6")).toEqual({
      outcome: "invalid",
      message: "Invalid discount",
      fields: [{ field: "code", message: "This code is already in use" }],
    });
  });
});
