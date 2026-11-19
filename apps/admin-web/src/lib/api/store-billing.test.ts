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

const { changeMyPlan, fetchMyBilling, fetchPublishedPlans, payMyInvoice } =
  await import("./store-billing");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const plan = {
  key: "growth",
  name: "Growth",
  planVersionRef: "pv-1",
  priceMinor: 29900,
  currency: "EGP",
  billingCycle: "monthly",
  trialDays: 14,
} as const;

const billing = {
  plan,
  status: "active",
  nextChargeAt: "2026-10-31T12:00:00.000Z",
  trialEndsAt: "2026-10-31T12:00:00.000Z",
  cardOnFile: false,
  invoices: [
    {
      id: "inv-1",
      status: "open",
      totalMinor: 29900,
      currency: "EGP",
      createdAt: "2026-10-17T00:00:00.000Z",
    },
  ],
};

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
  vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("store billing API", () => {
  it("reads GET /store/billing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, billing));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchMyBilling()).toEqual({ outcome: "ok", billing });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      "http://runtime.test/api/v1/store/billing",
    );
  });

  it("refuses a malformed billing view", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { ...billing, invoices: "none" })),
    );
    expect((await fetchMyBilling()).outcome).toBe("error");
  });

  it("reads the published plans and unwraps { items }", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: [plan] }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchPublishedPlans()).toEqual({ outcome: "ok", plans: [plan] });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      "http://runtime.test/api/v1/store/billing/plans",
    );
  });

  it("refuses a bare plans array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, [plan])));
    expect((await fetchPublishedPlans()).outcome).toBe("error");
  });

  it("POSTs the plan key with the idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: "sub-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await changeMyPlan("growth", "key-1");

    expect(result).toEqual({ outcome: "ok", data: { id: "sub-1" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/store/billing/plan");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ planKey: "growth" });
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-1");
  });

  it("POSTs pay for an invoice and answers the checkout URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { checkoutUrl: "https://pay.test/c/1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await payMyInvoice("inv-1", "key-2");

    expect(result).toEqual({ outcome: "ok", data: { checkoutUrl: "https://pay.test/c/1" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/store/billing/invoices/inv-1/pay");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("key-2");
  });

  it("projects a foreign invoice as not_found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, {})));
    expect((await payMyInvoice("other", "k")).outcome).toBe("not_found");
  });
});
