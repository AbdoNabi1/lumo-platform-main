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
  fetchReviewsPage,
  fetchReviewsByProduct,
  fetchReview,
  createReview,
  advanceReview,
  voteReview,
  reportReview,
  respondToReview,
  moderateReview,
} = await import("./reviews");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const REVIEW: unknown = {
  id: "review-1",
  productRef: "product-1",
  customerRef: "customer-1",
  rating: 4,
  bodyText: "Good product",
  assetRefs: [],
  verifiedPurchase: true,
  status: "pending",
  helpfulCount: 0,
  unhelpfulCount: 0,
  reportCount: 0,
  merchantResponse: null,
};

beforeEach(() => {
  cookiesMock.mockResolvedValue({ get: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("fetchReviewsPage", () => {
  it("returns items and pageInfo on success, sending the status filter", async () => {
    const page = { items: [REVIEW], pageInfo: { hasNextPage: false, endCursor: null } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, page));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await fetchReviewsPage({ first: 20, status: "pending" });

    expect(result).toEqual({ outcome: "ok", items: page.items, pageInfo: page.pageInfo });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://runtime.test/api/v1/reviews?first=20&status=pending");
  });

  it("omits the status param when no filter is given", async () => {
    const page = { items: [], pageInfo: { hasNextPage: false, endCursor: null } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, page));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    await fetchReviewsPage({ first: 20 });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://runtime.test/api/v1/reviews?first=20");
  });

  it("surfaces unauthorized", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchReviewsPage({});

    expect(result).toEqual({ outcome: "unauthorized" });
  });
});

describe("fetchReviewsByProduct", () => {
  it("hits the by-product route", async () => {
    const page = { items: [REVIEW], pageInfo: { hasNextPage: false, endCursor: null } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, page));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await fetchReviewsByProduct("product-1", { first: 10 });

    expect(result).toEqual({ outcome: "ok", items: page.items, pageInfo: page.pageInfo });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://runtime.test/api/v1/reviews/by-product/product-1?first=10");
  });
});

describe("fetchReview", () => {
  it("returns the review on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, REVIEW));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await fetchReview("review-1");

    expect(result).toEqual({ outcome: "ok", review: REVIEW });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("http://runtime.test/api/v1/reviews/review-1");
  });

  it("surfaces not_found", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, {}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchReview("missing");

    expect(result).toEqual({ outcome: "not_found" });
  });
});

describe("createReview", () => {
  it("sends the right path, method, body and idempotency header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "review-1" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const input = {
      productRef: "product-1",
      customerRef: "customer-1",
      rating: 5,
      bodyText: "Great",
    };
    const result = await createReview(input, "key-1");

    expect(result).toEqual({ outcome: "ok", data: { id: "review-1" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/reviews");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("key-1");
  });

  it("maps a 422 to invalid, preserving the fields", async () => {
    const envelope = {
      message: "Invalid input",
      fields: [{ field: "bodyText", message: "must not be empty" }],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(422, envelope));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createReview(
      { productRef: "p", customerRef: "c", rating: 1, bodyText: "" },
      "key-1",
    );

    expect(result).toEqual({
      outcome: "invalid",
      message: "Invalid input",
      fields: [{ field: "bodyText", message: "must not be empty" }],
    });
  });
});

describe("advanceReview", () => {
  it("posts toStatus to the transitions route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await advanceReview("review-1", "published", "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/reviews/review-1/transitions");
    expect(JSON.parse(init.body as string)).toEqual({ toStatus: "published" });
  });
});

describe("voteReview", () => {
  it("posts customerRef/helpful to the vote route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await voteReview(
      "review-1",
      { customerRef: "customer-1", helpful: true },
      "key-1",
    );

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/reviews/review-1/vote");
    expect(JSON.parse(init.body as string)).toEqual({ customerRef: "customer-1", helpful: true });
  });
});

describe("reportReview", () => {
  it("posts to the report route without an idempotency header (not idempotent)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await reportReview("review-1", { reporterRef: "customer-2" });

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/reviews/review-1/report");
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBeUndefined();
  });
});

describe("respondToReview", () => {
  it("posts responseText to the respond route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const result = await respondToReview("review-1", "Thanks for the feedback!", "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/reviews/review-1/respond");
    expect(JSON.parse(init.body as string)).toEqual({
      responseText: "Thanks for the feedback!",
    });
  });
});

describe("moderateReview", () => {
  it("posts actionId/action/moderatorRef/reason to the moderate route with the idempotency header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RUNTIME_API_URL", "http://runtime.test");

    const input = {
      actionId: "key-1",
      action: "reject" as const,
      moderatorRef: "moderator-1",
      reason: "Spam",
    };
    const result = await moderateReview("review-1", input, "key-1");

    expect(result.outcome).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://runtime.test/api/v1/reviews/review-1/moderate");
    expect(JSON.parse(init.body as string)).toEqual(input);
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("key-1");
  });
});
