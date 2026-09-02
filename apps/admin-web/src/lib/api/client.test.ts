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

const { mutateAdminApi } = await import("./client");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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

describe("mutateAdminApi", () => {
  it("maps a 201 with a valid body to ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "product-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mutateAdminApi(
      "/api/v1/products",
      { method: "POST", body: { sku: "SKU-1" } },
      isRecord,
    );

    expect(result).toEqual({ outcome: "ok", data: { id: "product-1" } });
  });

  it("maps a 422 with fields to invalid, preserving the fields", async () => {
    const envelope = {
      code: "VALIDATION",
      message: "Invalid input",
      retryable: false,
      fields: [{ field: "sku", message: "must not be empty" }],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(422, envelope));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mutateAdminApi(
      "/api/v1/products",
      { method: "POST", body: {} },
      isRecord,
    );

    expect(result).toEqual({
      outcome: "invalid",
      message: "Invalid input",
      fields: [{ field: "sku", message: "must not be empty" }],
    });
  });

  it("treats a missing or malformed fields array as empty, never crashes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(422, { code: "VALIDATION", message: "bad" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mutateAdminApi(
      "/api/v1/products",
      { method: "POST", body: {} },
      isRecord,
    );

    expect(result).toEqual({ outcome: "invalid", message: "bad", fields: [] });
  });

  it("maps a 409 to conflict, using the API's own message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(409, { code: "CONFLICT", message: "already in flight" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mutateAdminApi(
      "/api/v1/products/p1",
      { method: "POST", body: {} },
      isRecord,
    );

    expect(result).toEqual({ outcome: "conflict", message: "already in flight" });
  });

  it("maps a 401 to unauthorized", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { code: "UNAUTHENTICATED" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mutateAdminApi("/api/v1/products", { method: "POST" }, isRecord);
    expect(result).toEqual({ outcome: "unauthorized" });
  });

  it("maps a 403 to forbidden", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { code: "FORBIDDEN" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mutateAdminApi("/api/v1/products", { method: "POST" }, isRecord);
    expect(result).toEqual({ outcome: "forbidden" });
  });

  it("maps a 404 to not_found", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mutateAdminApi("/api/v1/products/p1", { method: "DELETE" }, isRecord);
    expect(result).toEqual({ outcome: "not_found" });
  });

  it("maps a thrown fetch to the error outcome instead of throwing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mutateAdminApi("/api/v1/products", { method: "POST" }, isRecord);
    expect(result).toEqual({ outcome: "error", message: "ECONNREFUSED" });
  });

  it("sends the idempotency-key header when idempotencyKey is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "1" }));
    vi.stubGlobal("fetch", fetchMock);

    await mutateAdminApi(
      "/api/v1/products",
      { method: "POST", body: {}, idempotencyKey: "key-1" },
      isRecord,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("key-1");
  });

  it("does not send the idempotency-key header when idempotencyKey is absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: "1" }));
    vi.stubGlobal("fetch", fetchMock);

    await mutateAdminApi("/api/v1/products", { method: "POST", body: {} }, isRecord);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBeUndefined();
  });

  it("maps a 2xx whose body fails isValid to the error outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, "not an object"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mutateAdminApi("/api/v1/products", { method: "POST" }, isRecord);
    expect(result.outcome).toBe("error");
  });
});
