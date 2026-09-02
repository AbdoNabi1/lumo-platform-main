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
  fetchTrialBalance,
  fetchIncomeStatement,
  fetchBalanceSheet,
  fetchFinanceReadModelPage,
  fetchFinanceReadModelRow,
  isFinanceReadModelName,
} = await import("./finance");

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

describe("fetchTrialBalance", () => {
  it("returns the ok outcome with the rows on a successful response", async () => {
    const body = { rows: [{ accountRef: "4000", debitMinor: 0, creditMinor: 5000 }] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await fetchTrialBalance("2026-01-01", "2026-01-31", "USD");
    expect(result).toEqual({ outcome: "ok", data: body });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://runtime.test/api/v1/finance/trial-balance?startDate=2026-01-01&endDate=2026-01-31&currency=USD",
    );
  });

  it("maps a 401 to the unauthorized outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { code: "UNAUTHENTICATED" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTrialBalance("2026-01-01", "2026-01-31", "USD");
    expect(result).toEqual({ outcome: "unauthorized" });
  });

  it("maps a 500 to the error outcome, never demo data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { code: "UNEXPECTED" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTrialBalance("2026-01-01", "2026-01-31", "USD");
    expect(result.outcome).toBe("error");
  });

  it("maps an unexpected response shape to the error outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTrialBalance("2026-01-01", "2026-01-31", "USD");
    expect(result.outcome).toBe("error");
  });

  it("maps a network failure to the error outcome instead of throwing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTrialBalance("2026-01-01", "2026-01-31", "USD");
    expect(result).toEqual({ outcome: "error", message: "ECONNREFUSED" });
  });
});

describe("fetchIncomeStatement", () => {
  it("un-nests the Balance value objects' `.props` wrapper into a flat MoneyDto", async () => {
    const wire = {
      revenue: { props: { amountMinor: 500_000, currency: "USD" } },
      cogs: { props: { amountMinor: 200_000, currency: "USD" } },
      expenses: { props: { amountMinor: 100_000, currency: "USD" } },
      netIncome: { props: { amountMinor: 200_000, currency: "USD" } },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, wire));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchIncomeStatement("2026-01-01", "2026-01-31", "USD");
    expect(result).toEqual({
      outcome: "ok",
      data: {
        revenue: { amountMinor: 500_000, currency: "USD" },
        cogs: { amountMinor: 200_000, currency: "USD" },
        expenses: { amountMinor: 100_000, currency: "USD" },
        netIncome: { amountMinor: 200_000, currency: "USD" },
      },
    });
  });

  it("maps a 401 to the unauthorized outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { code: "UNAUTHENTICATED" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchIncomeStatement("2026-01-01", "2026-01-31", "USD");
    expect(result).toEqual({ outcome: "unauthorized" });
  });

  it("maps a response missing the `.props` nesting to the error outcome, not a crash", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        revenue: { amountMinor: 500_000, currency: "USD" },
        cogs: { amountMinor: 0, currency: "USD" },
        expenses: { amountMinor: 0, currency: "USD" },
        netIncome: { amountMinor: 0, currency: "USD" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchIncomeStatement("2026-01-01", "2026-01-31", "USD");
    expect(result.outcome).toBe("error");
  });
});

describe("fetchBalanceSheet", () => {
  it("un-nests assets/liabilities/equity into flat MoneyDtos", async () => {
    const wire = {
      assets: { props: { amountMinor: 900_000, currency: "USD" } },
      liabilities: { props: { amountMinor: 300_000, currency: "USD" } },
      equity: { props: { amountMinor: 600_000, currency: "USD" } },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, wire));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchBalanceSheet("2026-01-01", "2026-01-31", "USD");
    expect(result).toEqual({
      outcome: "ok",
      data: {
        assets: { amountMinor: 900_000, currency: "USD" },
        liabilities: { amountMinor: 300_000, currency: "USD" },
        equity: { amountMinor: 600_000, currency: "USD" },
      },
    });
  });

  it("maps a network failure to the error outcome instead of throwing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchBalanceSheet("2026-01-01", "2026-01-31", "USD");
    expect(result).toEqual({ outcome: "error", message: "ECONNREFUSED" });
  });
});

describe("fetchFinanceReadModelPage", () => {
  it("requests the model's rows and returns the ok outcome", async () => {
    const page = {
      items: [{ period: "2026-07", currency: "USD", revenueMinor: 100 }],
      nextCursor: null,
      total: 1,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, page));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await fetchFinanceReadModelPage("profit");
    expect(result).toEqual({ outcome: "ok", data: page });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/finance/read-models/profit?");
  });

  it("forwards the optional query params", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { items: [], nextCursor: null, total: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    await fetchFinanceReadModelPage("profit", { periodKey: "2026-07", limit: 50, order: "desc" });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://runtime.test/api/v1/finance/read-models/profit?periodKey=2026-07&order=desc&limit=50",
    );
  });

  it("returns an ok outcome with an empty page for an unrecognised model name (no backend 404)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { items: [], nextCursor: null, total: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFinanceReadModelPage("not-a-real-model");
    expect(result).toEqual({
      outcome: "ok",
      data: { items: [], nextCursor: null, total: 0 },
    });
  });
});

describe("fetchFinanceReadModelRow", () => {
  it("returns the ok outcome with the row's value", async () => {
    const row = { period: "2026-07", currency: "USD", revenueMinor: 100 };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { value: row }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFinanceReadModelRow("profit", "2026-07");
    expect(result).toEqual({ outcome: "ok", value: row });
  });

  it("maps a 404 to the not_found outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFinanceReadModelRow("profit", "missing-key");
    expect(result).toEqual({ outcome: "not_found" });
  });

  it("maps a 401 to the unauthorized outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { code: "UNAUTHENTICATED" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFinanceReadModelRow("profit", "2026-07");
    expect(result).toEqual({ outcome: "unauthorized" });
  });
});

describe("isFinanceReadModelName", () => {
  it("accepts the three models FinanceProjectionService actually populates", () => {
    expect(isFinanceReadModelName("profit")).toBe(true);
    expect(isFinanceReadModelName("margin")).toBe(true);
    expect(isFinanceReadModelName("financial_health")).toBe(true);
  });

  it("rejects an unsupported model name", () => {
    expect(isFinanceReadModelName("not-a-real-model")).toBe(false);
  });
});
